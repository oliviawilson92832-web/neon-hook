/**
 * NEON HOOK — standalone boot.
 *
 * Vanilla JS entry: wires the framework-free game engine to the DOM UI,
 * initialises the CrazyGames SDK and manages the rewarded-revive flow.
 */
import { REVIVE_COOLDOWN_MS } from '../src/game/constants';
import { adErrorMessage, cg } from '../src/game/crazygames';
import { Game } from '../src/game/engine';
import { clearScores, loadScores, loadSettings, saveSettings } from '../src/game/storage';
import * as UI from './ui.js';
import { uiState } from './ui.js';

const settings = loadSettings();
let game = null;
let sdkReady = false;
let adState = 'idle';
let lastResult = null;
const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

/* ───────────────────────── helpers ───────────────────────── */
const soundOn = () => settings.sfx || settings.music;

function applySettings() {
  saveSettings(settings);
  if (game) game.setSettings(settings);
  UI.setSoundIcon(soundOn());
  UI.repaintToggles(settings);
}

function refreshScores() {
  const s = loadScores();
  UI.cacheScores(s);
  return s;
}

/** Space / canvas taps must not restart the run while a revive is on offer. */
function syncRetryLock() {
  const lock = game && game.state === 'gameover' && (uiState.reviveOffered || uiState.adBusy);
  if (game) game.setRetryLock(!!lock);
}

function setAd(next, message) {
  adState = next;
  uiState.adBusy = next === 'pending' || next === 'playing';
  UI.setAdState(next, message);
  syncRetryLock();
}

/* ───────────────────────── game ───────────────────────── */
game = new Game(
  UI.el.canvas,
  UI.hudEls,
  {
    onState: (s) => {
      UI.setScreen(s);
      if (s === 'playing') setAd('idle', '');
      if (s === 'menu') {
        uiState.reviveOffered = false;
        refreshScores();
        UI.renderScores(loadScores(), -1);
      }
      syncRetryLock();
    },
    onGameOver: (result) => {
      lastResult = result;
      const scores = refreshScores();
      uiState.reviveOffered = UI.eligibleForRevive(result, sdkReady);
      UI.showResult(result, scores, uiState.reviveOffered);
      UI.setHint(
        isCoarse
          ? uiState.reviveOffered
            ? 'Choose Revive or Retry above'
            : 'Tap anywhere to retry instantly'
          : uiState.reviveOffered
            ? 'Press <kbd>R</kbd> for a fresh run'
            : 'Press <kbd>SPACE</kbd> or click anywhere to retry',
      );
      syncRetryLock();
    },
    onSettings: (s) => {
      Object.assign(settings, s);
      saveSettings(settings);
      UI.setSoundIcon(soundOn());
      UI.repaintToggles(settings);
    },
    onRevive: () => {
      // The banked score entry was withdrawn by the engine; refresh the board.
      const scores = refreshScores();
      UI.renderScores(scores, -1);
      uiState.reviveOffered = false;
      setAd('idle', '');
    },
  },
  settings,
);

/* ───────────────────────── UI wiring ───────────────────────── */
UI.cacheScores(loadScores());
UI.initUI(
  {
    onStart: () => game.startRun(),
    onPress: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      game.pressFromUI(e.pointerId, e.pointerType);
    },
    onPause: () => game.pause(),
    onResume: () => game.resume(),
    onMenu: () => game.toMenu(),
    onToggleSound: () => {
      const on = !soundOn();
      settings.sfx = on;
      settings.music = on;
      applySettings();
      game.audio.unlock();
    },
    onToggle: (key) => {
      settings[key] = !settings[key];
      applySettings();
      game.audio.unlock();
    },
    onName: (name) => {
      settings.name = name;
      applySettings();
    },
    onClearScores: () => {
      clearScores();
      refreshScores();
      UI.renderScores([], -1);
    },
    onRevive: () => requestRevive(),
  },
  settings,
);

UI.setScreen('menu');
UI.setSoundIcon(soundOn());

// Debug handle (?debug) — handy for automated smoke tests, unused by the game.
if (/[?&]debug/.test(location.search)) window.__nh = game;

/* ───────────────────────── rewarded revive ───────────────────────── */
function requestRevive() {
  if (!game || adState === 'pending' || adState === 'playing') return;
  setAd('pending', '');
  cg.requestRewarded({
    // Mute only once the ad truly starts, per CrazyGames requirements.
    onStarted: () => {
      setAd('playing', '');
      game.audio.setDucked(true);
    },
    // Reward granted here and only here.
    onFinished: () => {
      game.audio.setDucked(false);
      UI.markAdRequested();
      setAd('idle', '');
      game.revive();
    },
    // Never reward on error; tell the player why.
    onError: (e) => {
      game.audio.setDucked(false);
      UI.markAdRequested();
      setAd('error', adErrorMessage(e));
      uiState.reviveOffered = false;
      UI.setReviveOffer(false, 0);
      const wait = Math.max(0, REVIVE_COOLDOWN_MS);
      window.setTimeout(() => {
        // Put the retry button back once the ad attempt has settled.
        UI.setReviveOffer(false, wait);
      }, 0);
    },
  });
}

/* ───────────────────────── boot ───────────────────────── */
// The loading screen must never wait on the portal SDK (it may be absent).
Promise.resolve(document.fonts ? document.fonts.ready : null)
  .catch(() => null)
  .then(() => UI.hideBoot());

void (async () => {
  await cg.init();
  sdkReady = cg.available && !cg.adblock;
  // Report loading only while the menu is up (never mid-run).
  if (game.state === 'menu') {
    cg.loadingStart();
    await Promise.resolve(document.fonts ? document.fonts.ready : null).catch(() => null);
    cg.loadingStop();
  }
  // If a game-over screen is already up, refresh the offer eligibility.
  if (lastResult && game.state === 'gameover') {
    uiState.reviveOffered = UI.eligibleForRevive(lastResult, sdkReady);
    UI.setReviveOffer(uiState.reviveOffered, uiState.reviveOffered ? REVIVE_COOLDOWN_MS : 0);
    syncRetryLock();
  }
})();
