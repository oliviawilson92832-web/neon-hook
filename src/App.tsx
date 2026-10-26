import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { GameOver, type AdState } from './components/GameOver';
import { Hud } from './components/Hud';
import { Menu } from './components/Menu';
import { PauseMenu } from './components/PauseMenu';
import { REVIVE_COOLDOWN_MS, REVIVE_MIN_METERS } from './game/constants';
import { adErrorMessage, cg } from './game/crazygames';
import { Game, type GameState, type HudEls, type RunResult } from './game/engine';
import { clearScores, loadScores, loadSettings, saveSettings, type ScoreEntry, type Settings } from './game/storage';

const isCoarse = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudEls = useRef<HudEls>({});
  const gameRef = useRef<Game | null>(null);
  const [gs, setGs] = useState<GameState>('menu');
  const [result, setResult] = useState<RunResult | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>(() => loadScores());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const settingsRef = useRef(settings);

  // ── CrazyGames / rewarded-ad state ──
  const [sdkReady, setSdkReady] = useState(false);
  const [adState, setAdState] = useState<AdState>('idle');
  const [adMessage, setAdMessage] = useState('');
  const lastAdAt = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(
      canvas,
      hudEls.current,
      {
        onState: (s) => {
          setGs(s);
          if (s === 'menu') setScores(loadScores());
          if (s === 'playing') {
            setAdState('idle');
            setAdMessage('');
          }
        },
        onGameOver: (r) => {
          setResult(r);
          setScores(loadScores());
        },
        onSettings: (s) => {
          settingsRef.current = s;
          setSettings(s);
          saveSettings(s);
        },
        onRevive: () => setScores(loadScores()),
      },
      settingsRef.current,
    );
    gameRef.current = game;

    // Boot sequence: init the SDK, then bracket the real asset work
    // (web fonts) with loadingStart / loadingStop.
    let cancelled = false;
    void (async () => {
      await cg.init();
      if (cancelled) return;
      setSdkReady(cg.available && !cg.adblock);
      cg.loadingStart();
      try {
        await (document.fonts?.ready ?? Promise.resolve());
      } catch {
        /* ignore */
      }
      cg.loadingStop();
    })();

    return () => {
      cancelled = true;
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
    gameRef.current?.setSettings(next);
    gameRef.current?.audio.unlock();
  };

  const pointerPress = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    gameRef.current?.pressFromUI(e.pointerId, e.pointerType);
  };

  // Offer a revive only for a real run, once per run, and never on the demo.
  const reviveOffered =
    sdkReady && !!result && result.revivesUsed === 0 && result.meters >= REVIVE_MIN_METERS && result.score > 0;
  const reviveCooldown = Math.max(0, REVIVE_COOLDOWN_MS - (Date.now() - lastAdAt.current));

  // While the offer is on screen, Space / canvas taps must not restart the run.
  useEffect(() => {
    const lock = gs === 'gameover' && (reviveOffered || adState === 'pending' || adState === 'playing');
    gameRef.current?.setRetryLock(lock);
  }, [gs, reviveOffered, adState]);

  const requestRevive = useCallback(() => {
    const game = gameRef.current;
    if (!game || adState === 'pending' || adState === 'playing') return;
    setAdMessage('');
    setAdState('pending');
    cg.requestRewarded({
      onStarted: () => {
        // Mute only once the ad truly starts, per CrazyGames requirements.
        setAdState('playing');
        game.audio.setDucked(true);
      },
      onFinished: () => {
        game.audio.setDucked(false);
        lastAdAt.current = Date.now();
        setAdState('idle');
        game.revive(); // reward granted only here
      },
      onError: (e) => {
        game.audio.setDucked(false);
        lastAdAt.current = Date.now();
        setAdState('error');
        setAdMessage(adErrorMessage(e));
      },
    });
  }, [adState]);

  const soundOn = settings.sfx || settings.music;
  const hudVisible = gs === 'playing' || gs === 'countdown' || gs === 'paused' || gs === 'dying';

  return (
    <div className="fixed inset-0 overflow-hidden bg-void">
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="game-canvas absolute inset-0 block h-full w-full" aria-label="Neon Hook game canvas" />
      </div>

      <Hud
        els={hudEls}
        visible={hudVisible}
        soundOn={soundOn}
        onPause={() => gameRef.current?.pause()}
        onToggleSound={() => updateSettings({ sfx: !soundOn, music: !soundOn })}
      />

      {gs === 'menu' && (
        <Menu
          scores={scores}
          settings={settings}
          onSettings={updateSettings}
          onPlayPointer={pointerPress}
          onPlayKey={() => gameRef.current?.startRun()}
          onClearScores={() => {
            clearScores();
            setScores([]);
          }}
        />
      )}

      {gs === 'paused' && (
        <PauseMenu
          settings={settings}
          onSettings={updateSettings}
          onResume={() => gameRef.current?.resume()}
          onRestartPointer={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            gameRef.current?.startRun();
            gameRef.current?.pressFromUI(e.pointerId, e.pointerType);
          }}
          onRestartKey={() => gameRef.current?.startRun()}
          onMenu={() => gameRef.current?.toMenu()}
        />
      )}

      {gs === 'gameover' && result && (
        <GameOver
          result={result}
          scores={scores}
          touch={isCoarse}
          reviveOffered={reviveOffered}
          reviveCooldown={reviveCooldown}
          adState={adState}
          adMessage={adMessage}
          onRevive={requestRevive}
          onRetryPointer={pointerPress}
          onRetryKey={() => gameRef.current?.startRun()}
          onMenu={() => gameRef.current?.toMenu()}
        />
      )}

      <div className="scanlines pointer-events-none absolute inset-0" />
    </div>
  );
}
