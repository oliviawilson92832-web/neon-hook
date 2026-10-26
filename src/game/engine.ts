import { AudioEngine } from './audio';
import { Background } from './background';
import { botThink } from './bot';
import * as C from './constants';
import { COLORS, P_CYAN, P_GOLD, P_MAGENTA, P_RED, P_VIOLET, P_WHITE, PALETTE } from './constants';
import { cg } from './crazygames';
import { font, K_DOT, K_SQUARE, makeGlowSprite, Particles, Popups } from './fx';
import { clamp, damp, fmt, TAU } from './math';
import { Sim } from './sim';
import { addScore, loadScores, removeScore, type Settings } from './storage';
import { L_PULSE, L_ROTOR, L_SLIDER, L_SWEEP, type DeathCause, type Gem, type Laser, type Peg } from './types';

export type GameState = 'menu' | 'playing' | 'countdown' | 'paused' | 'dying' | 'gameover';

export interface HudEls {
  score?: HTMLElement | null;
  dist?: HTMLElement | null;
  best?: HTMLElement | null;
  mult?: HTMLElement | null;
  multBar?: HTMLElement | null;
  energy?: HTMLElement | null;
  energyWrap?: HTMLElement | null;
}

export interface RunResult {
  score: number;
  meters: number;
  gems: number;
  nearMisses: number;
  perfects: number;
  maxMult: number;
  cause: DeathCause;
  rank: number;
  isBest: boolean;
  prevBest: number;
  time: number;
  /** Revives already spent this run — a second one is never offered. */
  revivesUsed: number;
}

export interface EngineCallbacks {
  onState: (s: GameState) => void;
  onGameOver: (r: RunResult) => void;
  onSettings: (s: Settings) => void;
  /** Fired after a rewarded-ad revive so the UI can refresh the score board. */
  onRevive: () => void;
}

const HOLD_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyX', 'KeyJ', 'KeyK']);
const TRAIL = 26;
const SPEED_LINES = 18;
const RAINBOW = ['#ff3d6e', '#ff8a3d', '#ffd23f', '#5dff9d', '#3cf2ff', '#7b8cff', '#ff3df0'];

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export class Game {
  readonly audio = new AudioEngine();
  state: GameState = 'menu';

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hud: HudEls;
  private cb: EngineCallbacks;
  private settings: Settings;
  private bg = new Background();
  private sim: Sim;
  private parts = new Particles();
  private pops = new Popups();
  private glow: HTMLCanvasElement[];

  // view
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private base = 1;
  private zoom = 1;
  private k = 1;
  private camX = 0;
  private camY = 0;
  private viewW = 1;
  private viewH = 1;
  private quality = 2;
  private ftEma = 1 / 60;
  private slowFrames = 0;

  // loop
  private raf = 0;
  private lastT = 0;
  private time = 0;

  // input
  private holds = new Set<string>();
  private pressQueued = false;
  private touchMode = false;

  // juice
  private trauma = 0;
  private shakeX = 0;
  private shakeY = 0;
  private shakeR = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private hitstop = 0;
  private trailX = new Float32Array(TRAIL);
  private trailY = new Float32Array(TRAIL);
  private trailHead = 0;
  private trailCount = 0;
  private ropeT = 1;
  private ropeRetract = 0;
  private retractX = 0;
  private retractY = 0;
  private missT = 0;
  private bannerText = '';
  private bannerSub = '';
  private bannerColor = '#fff';
  private bannerT = 0;
  private countdownT = 0;
  private lastCount = 0;
  private dyingT = 0;
  private gameOverAt = 0;
  private demoResetT = 0;
  private perfectCd = 0;
  private target: Peg | null = null;
  private slX = new Float32Array(SPEED_LINES);
  private slY = new Float32Array(SPEED_LINES);
  private slL = new Float32Array(SPEED_LINES);
  private slS = new Float32Array(SPEED_LINES);
  private speedFx = 0;
  private runCount = 0;
  private tutorial = true;
  private best = 0;
  private newBestShown = false;
  private lastEntryStamp = 0;
  private retryLock = false;
  private hc = { score: -1, dist: -1, best: -1, mult: -1, bar: -1, energy: -1, od: false };
  private ro: ResizeObserver | null = null;
  private debug = typeof location !== 'undefined' && /[?&]debug/.test(location.search);
  private workMs = 0;
  private fpsEma = 60;

  constructor(canvas: HTMLCanvasElement, hud: HudEls, cb: EngineCallbacks, settings: Settings) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.hud = hud;
    this.cb = cb;
    this.settings = settings;
    this.audio.setSfx(settings.sfx);
    this.audio.setMusic(settings.music);
    this.glow = PALETTE.map((c) => makeGlowSprite(c));
    this.best = loadScores()[0]?.score ?? 0;

    this.sim = new Sim({
      attach: (p, n) => this.evAttach(p, n),
      release: (pf, sp) => this.evRelease(pf, sp),
      miss: () => this.evMiss(),
      gem: (g, v, s) => this.evGem(g, v, s),
      nearMiss: (x, y, v) => this.evNear(x, y, v),
      multUp: (m) => this.evMultUp(m),
      comboLost: () => {
        if (!this.sim.demo) this.audio.comboLost();
      },
      overdrive: () => this.evOverdrive(),
      overdriveEnd: () => {
        if (!this.sim.demo) this.audio.overdriveEnd();
        this.audio.setIntensity(0);
      },
      smash: (x, y, v) => this.evSmash(x, y, v),
      bounce: (x, y) => this.evBounce(x, y),
      milestone: (m) => this.evMilestone(m),
      death: (c, x, y) => this.evDeath(c, x, y),
    });

    for (let i = 0; i < SPEED_LINES; i++) this.respawnSpeedLine(i, true);

    this.resize();
    this.startDemo();
    this.audio.setMode('menu');

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('contextmenu', this.prevent);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerdown', this.unlockAudio, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.resize);
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas.parentElement);
    }
    this.raf = requestAnimationFrame(this.loop);
    if (this.debug) (window as unknown as { __game?: Game }).__game = this;
  }

  /** Debug/automation snapshot (only meaningful with ?debug) */
  get stats() {
    const s = this.sim;
    return { state: this.state, fps: this.fpsEma, workMs: this.workMs, quality: this.quality, x: s.x, y: s.y, alive: s.alive, score: s.score, particles: this.parts.n, dpr: this.dpr, k: this.k };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('contextmenu', this.prevent);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerdown', this.unlockAudio, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.resize);
    this.ro?.disconnect();
    this.audio.destroy();
  }

  // ───────────────────────── public API ─────────────────────────
  /** While a revive offer / ad is on screen, Space + canvas taps must not restart. */
  setRetryLock(locked: boolean) {
    this.retryLock = locked;
  }

  setSettings(s: Settings) {
    this.settings = s;
    this.audio.setSfx(s.sfx);
    this.audio.setMusic(s.music);
  }

  /** Press coming from a DOM overlay (PLAY / RETRY / tap-to-retry) — keeps holding until pointerup */
  pressFromUI(pointerId: number, pointerType: string) {
    this.touchMode = pointerType !== 'mouse';
    this.pressHold('p:' + pointerId);
  }

  startRun() {
    this.audio.unlock();
    this.runCount++;
    this.best = loadScores()[0]?.score ?? 0;
    this.tutorial = this.runCount === 1 || this.best === 0;
    this.newBestShown = false;
    this.sim.reset((Math.random() * 1e9) | 0, false);
    this.sim.launch();
    this.resetFx();
    this.updateCamera(0, true);
    this.setState('playing');
    this.retryLock = false;
    cg.gameplayStart();
    this.audio.setMode('game');
    this.audio.setIntensity(0);
    this.audio.launch();
    this.parts.cone(C.START_X, C.START_Y + 14, 26, Math.PI * 0.8, 0.9, 200, 600, P_CYAN, 0.5, 2.5);
    this.parts.ring(C.START_X, C.START_Y, 60, P_CYAN, 0.45);
    this.addTrauma(0.25);
    this.hc.best = -1;
  }

  restart() {
    this.startRun();
  }

  /**
   * @param fromFocus true when triggered by tab/window focus loss. CrazyGames
   * tracks focus itself and asks games NOT to emit gameplayStop for it.
   */
  pause(fromFocus = false) {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.pressQueued = false;
    this.setState('paused');
    if (!fromFocus) cg.gameplayStop();
    this.audio.setMode('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.unlock();
    this.countdownT = 1.5;
    this.lastCount = 0;
    this.setState('countdown');
    this.audio.setMode('game');
  }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause();
  }

  toMenu() {
    cg.gameplayStop();
    this.retryLock = false;
    this.startDemo();
    this.setState('menu');
    this.audio.setMode('menu');
    this.audio.setIntensity(0);
  }

  // ───────────────────────── input ─────────────────────────
  private prevent = (e: Event) => e.preventDefault();

  private unlockAudio = () => this.audio.unlock();

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.touchMode = e.pointerType !== 'mouse';
    this.pressHold('p:' + e.pointerId);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.holds.delete('p:' + e.pointerId);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    const tag = tgt?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    this.audio.unlock();
    const code = e.code;
    if (HOLD_KEYS.has(code)) {
      e.preventDefault();
      if (e.repeat) return;
      this.touchMode = false;
      this.pressHold('k:' + code);
      return;
    }
    if (e.repeat) return;
    switch (code) {
      case 'Escape':
      case 'KeyP':
        e.preventDefault();
        if (this.state === 'playing' || this.state === 'countdown') this.pause();
        else if (this.state === 'paused') this.resume();
        break;
      case 'Enter':
        if (tag === 'BUTTON') return;
        e.preventDefault();
        if (this.state === 'menu') this.startRun();
        else if (this.state === 'gameover' && this.canRetry()) this.startRun();
        else if (this.state === 'paused') this.resume();
        break;
      case 'KeyR':
        if (this.state === 'playing' || this.state === 'paused' || this.state === 'countdown') this.startRun();
        else if (this.state === 'gameover' && this.canRetry()) this.startRun();
        break;
      case 'KeyM': {
        const on = !(this.settings.sfx || this.settings.music);
        const next = { ...this.settings, sfx: on, music: on };
        this.setSettings(next);
        this.cb.onSettings(next);
        break;
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (HOLD_KEYS.has(e.code)) this.holds.delete('k:' + e.code);
  };

  private onBlur = () => {
    this.holds.clear();
    if (this.state === 'playing' || this.state === 'countdown') this.pause(true);
  };

  private onVisibility = () => {
    if (document.hidden) {
      this.holds.clear();
      if (this.state === 'playing' || this.state === 'countdown') this.pause(true);
    }
    this.lastT = 0;
  };

  private canRetry() {
    return performance.now() - this.gameOverAt > 380;
  }

  private pressHold(id: string) {
    this.audio.unlock();
    const wasHeld = this.holds.size > 0;
    this.holds.add(id);
    switch (this.state) {
      case 'menu':
        this.startRun();
        break;
      case 'gameover':
        if (!this.retryLock && this.canRetry()) this.startRun();
        break;
      case 'paused':
        if (id.startsWith('k:')) this.resume();
        break;
      case 'playing':
        if (!wasHeld) this.pressQueued = true;
        break;
      default:
        break;
    }
  }

  // ───────────────────────── state ─────────────────────────
  private setState(s: GameState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState(s);
  }

  private resetFx() {
    this.parts.clear();
    this.pops.clear();
    this.trailCount = 0;
    this.trauma = 0;
    this.flash = 0;
    this.hitstop = 0;
    this.ropeT = 1;
    this.ropeRetract = 0;
    this.missT = 0;
    this.bannerT = 0;
    this.dyingT = 0;
    this.pressQueued = false;
    this.speedFx = 0;
    this.target = null;
  }

  private startDemo() {
    this.sim.reset((Math.random() * 1e9) | 0, true);
    this.sim.launch();
    this.resetFx();
    this.demoResetT = 0;
    this.updateCamera(0, true);
  }

  private finishRun() {
    const s = this.sim;
    const score = s.score;
    const prevBest = this.best;
    const stamp = Date.now();
    this.lastEntryStamp = stamp;
    const { rank } = addScore({ name: this.settings.name, score, meters: s.meters, gems: s.gemsCollected, date: stamp });
    if (score > this.best) this.best = score;
    const result: RunResult = {
      score,
      meters: s.meters,
      gems: s.gemsCollected,
      nearMisses: s.nearMisses,
      perfects: s.perfects,
      maxMult: s.maxMult,
      cause: s.deathCause,
      rank,
      isBest: score > prevBest && score > 0,
      prevBest,
      time: s.time,
      revivesUsed: s.revives,
    };
    this.gameOverAt = performance.now();
    this.cb.onGameOver(result);
    this.setState('gameover');
  }

  // ───────────────────────── loop ─────────────────────────
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.lastT) {
      this.lastT = now;
      return;
    }
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.25) dt = 1 / 60;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) return;
    this.perf(dt);
    const t0 = this.debug ? performance.now() : 0;
    this.frame(dt);
    this.render();
    if (this.debug) {
      this.workMs += (performance.now() - t0 - this.workMs) * 0.05;
      this.fpsEma += (1 / dt - this.fpsEma) * 0.05;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.font = font(11, 700);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(4, this.cssH - 22, 250, 18);
      ctx.fillStyle = '#5dff9d';
      ctx.fillText(`${this.fpsEma.toFixed(0)} fps  ${this.workMs.toFixed(2)} ms  q${this.quality}  p${this.parts.n}`, 8, this.cssH - 7);
    }
  };

  private perf(dt: number) {
    if (this.state !== 'playing' && this.state !== 'menu') return;
    this.ftEma += (dt - this.ftEma) * 0.05;
    if (this.ftEma > 1 / 47) {
      if (++this.slowFrames > 150 && this.quality > 0) {
        this.quality--;
        this.slowFrames = 0;
        this.ftEma = 1 / 60;
        this.parts.cap = [320, 600, 900][this.quality];
        this.resize();
      }
    } else if (this.slowFrames > 0) this.slowFrames--;
  }

  private frame(dt: number) {
    this.time += dt;
    let fx = dt;
    switch (this.state) {
      case 'menu':
        this.updateDemo(dt);
        break;
      case 'playing':
        fx = this.updatePlaying(dt);
        break;
      case 'countdown': {
        fx = 0;
        this.countdownT -= dt;
        const n = Math.ceil(this.countdownT / 0.5);
        if (n !== this.lastCount && n > 0) {
          this.lastCount = n;
          this.audio.countdown(false);
        }
        if (this.countdownT <= 0) {
          this.audio.countdown(true);
          this.pressQueued = false;
          this.setState('playing');
          cg.gameplayStart();
        }
        break;
      }
      case 'paused':
        fx = 0;
        break;
      case 'dying':
        fx = this.updateDying(dt);
        break;
      case 'gameover':
        fx = dt * 0.5;
        this.sim.update(dt * 0.3);
        break;
    }
    this.parts.update(fx);
    this.pops.update(fx);
    if (this.state !== 'paused') {
      this.updateShake(dt);
      this.flash = Math.max(0, this.flash - dt * 2.4);
      this.bannerT -= dt;
      this.perfectCd -= dt;
      if (this.ropeRetract > 0) this.ropeRetract -= fx;
      if (this.missT > 0) this.missT -= fx;
    }
    if (this.state !== 'paused' && this.state !== 'countdown') this.updateCamera(dt, false);
    this.updateSpeedLines(fx);
    const s = this.sim;
    this.target = s.alive ? s.findTarget(s.peg) : null;
    if (this.state === 'playing' && !this.newBestShown && this.best > 0 && s.score > this.best) {
      this.newBestShown = true;
      this.banner('NEW BEST!', 'YOU ARE THE LEGEND NOW', COLORS.gold);
      cg.happytime();
      this.audio.milestone();
      this.parts.ring(s.x, s.y, 120, P_GOLD, 0.5);
      this.bump(this.hud.best, 1.5);
    }
    this.updateHud();
  }

  private updatePlaying(dt: number): number {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return 0;
    }
    const s = this.sim;
    s.held = this.holds.size > 0;
    if (this.pressQueued) {
      this.pressQueued = false;
      if (!s.peg) s.press();
    }
    s.update(dt);
    this.ropeT += dt;
    this.pushTrail();
    return dt;
  }

  private updateDying(dt: number): number {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return 0;
    }
    this.dyingT += dt;
    this.sim.update(dt * 0.25);
    if (this.dyingT > 1.0) this.finishRun();
    return dt * 0.45;
  }

  private updateDemo(dt: number) {
    const s = this.sim;
    if (this.demoResetT > 0) {
      this.demoResetT -= dt;
      s.update(dt * 0.3);
      if (this.demoResetT <= 0) this.startDemo();
      return;
    }
    s.held = botThink(s);
    s.update(dt);
    this.ropeT += dt;
    this.pushTrail();
    if (s.x > 60000) this.startDemo();
  }

  private pushTrail() {
    this.trailHead = (this.trailHead + 1) % TRAIL;
    this.trailX[this.trailHead] = this.sim.x;
    this.trailY[this.trailHead] = this.sim.y;
    if (this.trailCount < TRAIL) this.trailCount++;
  }

  private addTrauma(a: number) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  private updateShake(dt: number) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const amt = this.settings.shake ? this.trauma * this.trauma : 0;
    const t = this.time * 50;
    this.shakeX = amt * 24 * (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 3.1 + 1.7) * 0.4);
    this.shakeY = amt * 20 * (Math.sin(t * 1.7 + 0.5) * 0.6 + Math.sin(t * 2.9 + 3.1) * 0.4);
    this.shakeR = amt * 0.03 * Math.sin(t * 1.1 + 2.2);
  }

  private updateCamera(dt: number, snap: boolean) {
    const s = this.sim;
    const speed = s.speed;
    const zt = 1 - 0.14 * clamp((speed - 600) / 1000, 0, 1) - (s.overdrive > 0 ? 0.04 : 0);
    this.zoom = snap ? zt : damp(this.zoom, zt, 2.2, dt);
    this.k = this.base * this.zoom;
    this.viewW = this.cssW / this.k;
    this.viewH = this.cssH / this.k;
    // narrow (portrait) views keep the player nearer the middle so the anchor peg stays visible
    const wide = clamp((this.viewW - 560) / 700, 0, 1);
    const look = clamp(s.vx * 0.16, -this.viewW * 0.05, this.viewW * (0.06 + 0.08 * wide));
    const tx = s.x - this.viewW * (0.42 - 0.1 * wide) + look;
    const baseY = (C.VIEW_H - this.viewH) / 2;
    const ty = Math.min(baseY, s.y - this.viewH * 0.24);
    if (snap) {
      this.camX = tx;
      this.camY = ty;
    } else {
      this.camX = damp(this.camX, tx, 7, dt);
      this.camY = damp(this.camY, ty, 5, dt);
    }
  }

  private respawnSpeedLine(i: number, anywhere: boolean) {
    this.slX[i] = anywhere ? Math.random() * this.cssW : this.cssW + Math.random() * this.cssW * 0.6;
    this.slY[i] = Math.random() * this.cssH;
    this.slL[i] = 60 + Math.random() * 180;
    this.slS[i] = 1400 + Math.random() * 1600;
  }

  private updateSpeedLines(dt: number) {
    const s = this.sim;
    const target = (this.state === 'playing' || this.state === 'menu') && s.alive ? clamp((s.speed - 1000) / 700, 0, 1) : 0;
    this.speedFx = damp(this.speedFx, Math.max(target, s.overdrive > 0 ? 0.6 : 0), 4, Math.max(dt, 0.001));
    if (dt <= 0) return;
    for (let i = 0; i < SPEED_LINES; i++) {
      this.slX[i] -= this.slS[i] * dt;
      if (this.slX[i] + this.slL[i] < 0) this.respawnSpeedLine(i, false);
    }
  }

  // ───────────────────────── sim events → juice ─────────────────────────
  private evAttach(peg: Peg, isNew: boolean) {
    this.ropeT = 0;
    this.ropeRetract = 0;
    this.missT = 0;
    this.parts.burst(peg.x, peg.y, isNew ? 12 : 6, 120, 380, P_CYAN, 0.35, 2.2);
    this.parts.ring(peg.x, peg.y, 30, P_CYAN, 0.35);
    this.addTrauma(0.06);
    if (!this.sim.demo) this.audio.attach();
  }

  private evRelease(perfect: boolean, speed: number) {
    const s = this.sim;
    const lp = s.lastPeg;
    this.ropeRetract = 0.12;
    this.retractX = lp ? lp.x : s.x;
    this.retractY = lp ? lp.y : s.y;
    const back = Math.atan2(-s.vy, -s.vx);
    this.parts.cone(s.x, s.y, perfect ? 14 : 6, back, 0.9, 150, 420, perfect ? P_GOLD : P_CYAN, 0.4, 2.2);
    if (perfect) this.parts.ring(s.x, s.y, 46, P_GOLD, 0.4);
    if (s.demo) return;
    this.audio.release(speed);
    if (perfect) {
      this.audio.perfect();
      this.addTrauma(0.05);
      if (this.perfectCd <= 0) {
        this.popup(s.x, s.y - 36, 'PERFECT', COLORS.gold, 15, 0.7);
        this.perfectCd = 1.1;
      }
    }
  }

  private evMiss() {
    this.missT = 0.25;
    if (!this.sim.demo) this.audio.miss();
  }

  private evGem(g: Gem, value: number, streak: number) {
    const prism = g.kind === 1;
    this.parts.burst(g.x, g.y, prism ? 22 : 10, 80, prism ? 440 : 300, prism ? P_MAGENTA : P_GOLD, 0.45, 2.4);
    this.parts.ring(g.x, g.y, prism ? 56 : 28, prism ? P_MAGENTA : P_GOLD, 0.35);
    if (prism) this.parts.burst(g.x, g.y, 8, 40, 180, P_CYAN, 0.5, 9, K_DOT);
    if (this.sim.demo) return;
    if (prism) {
      this.audio.prism();
      this.addTrauma(0.12);
    } else this.audio.gem(streak);
    this.popup(g.x, g.y - 20, '+' + value, prism ? COLORS.magenta : COLORS.gold, prism ? 20 : 14, 0.75);
    this.bump(this.hud.score, 1.12);
  }

  private evNear(x: number, y: number, value: number) {
    this.parts.burst(x, y, 16, 150, 480, P_WHITE, 0.35, 2);
    this.addTrauma(0.14);
    if (this.sim.demo) return;
    this.audio.nearMiss();
    this.popup(this.sim.x, this.sim.y - 42, 'CLOSE! +' + value, '#ffffff', 17, 0.9);
  }

  private evMultUp(m: number) {
    const s = this.sim;
    this.parts.ring(s.x, s.y, 70, P_CYAN, 0.45);
    if (s.demo) return;
    this.audio.multUp(m);
    this.popup(s.x, s.y - 62, 'x' + m, COLORS.cyan, 26, 0.95);
    this.bump(this.hud.mult, 1.7);
  }

  private evOverdrive() {
    const s = this.sim;
    this.flash = 0.35;
    this.flashColor = COLORS.gold;
    this.addTrauma(0.35);
    this.parts.ring(s.x, s.y, 160, P_GOLD, 0.6);
    this.parts.burst(s.x, s.y, 30, 200, 700, P_GOLD, 0.6, 3);
    this.banner('OVERDRIVE', '2× GEMS · LASER-PROOF', COLORS.gold);
    this.audio.setIntensity(1);
    if (!s.demo) this.audio.overdrive();
  }

  private evSmash(x: number, y: number, value: number) {
    this.parts.burst(x, y, 26, 150, 700, P_RED, 0.55, 3);
    this.parts.burst(x, y, 12, 100, 500, P_GOLD, 0.5, 2.5);
    this.parts.burst(x, y, 10, 60, 360, P_RED, 0.9, 6, K_SQUARE, 900);
    this.parts.ring(x, y, 80, P_GOLD, 0.4);
    this.addTrauma(0.3);
    this.hitstop = 0.045;
    if (this.sim.demo) return;
    this.audio.smash();
    this.popup(x, y - 24, 'SMASH +' + value, COLORS.orange, 18, 0.9);
  }

  private evBounce(x: number, y: number) {
    this.parts.cone(x, y, 18, -Math.PI / 2, 1.4, 200, 600, P_CYAN, 0.45, 2.4);
    this.parts.ring(x, y, 60, P_CYAN, 0.4);
    this.addTrauma(0.15);
    this.audio.bounce();
    this.popup(x, y - 60, 'SAFETY NET', COLORS.cyan, 15, 1.0);
  }

  private evMilestone(m: number) {
    if (this.sim.demo) return;
    this.banner(`${fmt(m)} M`, 'KEEP SWINGING', COLORS.cyan);
    this.audio.milestone();
  }

  private evDeath(cause: DeathCause, x: number, y: number) {
    const s = this.sim;
    const px = s.x;
    const py = s.y;
    this.parts.burst(px, py, 50, 200, 950, P_CYAN, 0.8, 3);
    this.parts.burst(px, py, 26, 100, 600, P_WHITE, 0.6, 2.5);
    this.parts.burst(px, py, 14, 60, 380, cause === 'void' ? P_MAGENTA : P_RED, 1.1, 7, K_SQUARE, 700);
    this.parts.ring(px, py, 130, P_CYAN, 0.6);
    this.parts.ring(px, py, 70, P_WHITE, 0.4);
    if (cause === 'void') this.parts.cone(px, C.VOID_Y, 30, -Math.PI / 2, 1.0, 300, 900, P_MAGENTA, 0.8, 3, 1400);
    if (cause === 'laser') this.parts.burst(x, y, 16, 100, 500, P_RED, 0.5, 2.5);
    this.flash = s.demo ? 0.3 : 0.9;
    this.flashColor = cause === 'void' ? COLORS.magenta : cause === 'wall' ? COLORS.red : '#ffffff';
    this.trailCount = 0;
    if (s.demo) {
      this.demoResetT = 0.9;
      return;
    }
    this.addTrauma(0.95);
    this.hitstop = 0.11;
    this.dyingT = 0;
    this.audio.death();
    cg.gameplayStop();
    this.audio.setMode('over');
    this.audio.setIntensity(0);
    this.setState('dying');
  }

  /**
   * Grants the rewarded-ad second chance. Only valid straight after a death.
   * The score banked by finishRun() is withdrawn so the run is recorded once.
   */
  revive() {
    if (this.state !== 'gameover' && this.state !== 'dying') return;
    const s = this.sim;
    if (s.demo) return;

    if (this.lastEntryStamp) {
      removeScore(this.lastEntryStamp);
      this.lastEntryStamp = 0;
    }

    s.revive();
    this.parts.clear();
    this.pops.clear();
    this.trailCount = 0;
    this.trauma = 0;
    this.flash = 0.25;
    this.flashColor = COLORS.cyan;
    this.hitstop = 0;
    this.dyingT = 0;
    this.ropeT = 1;
    this.ropeRetract = 0;
    this.missT = 0;
    this.pressQueued = false;
    this.holds.clear();
    this.target = null;
    this.retryLock = false;

    this.parts.ring(s.x, s.y, 150, P_CYAN, 0.6);
    this.parts.ring(s.x, s.y, 90, P_WHITE, 0.45);
    this.parts.burst(s.x, s.y, 34, 180, 700, P_CYAN, 0.6, 3);
    this.banner('REVIVED', 'SHIELD ACTIVE — GO!', COLORS.cyan);
    this.updateCamera(0, true);

    this.setState('playing');
    cg.gameplayStart();
    this.audio.setMode('game');
    this.audio.launch();
    this.audio.milestone();
    this.cb.onRevive();
  }

  private popup(x: number, y: number, text: string, color: string, size: number, life: number) {
    this.pops.spawn(x, y, text, color, Math.max(size, (size * 0.85) / Math.max(this.k, 0.01)), life);
  }

  private banner(text: string, sub: string, color: string) {
    this.bannerText = text;
    this.bannerSub = sub;
    this.bannerColor = color;
    this.bannerT = 1.7;
  }

  private bump(el: HTMLElement | null | undefined, scale: number) {
    if (!el || typeof el.animate !== 'function') return;
    el.animate([{ transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: 260, easing: 'cubic-bezier(.2,1.5,.4,1)' });
  }

  // ───────────────────────── HUD ─────────────────────────
  private updateHud() {
    if (this.state === 'menu') return;
    const h = this.hud;
    const c = this.hc;
    const s = this.sim;
    const score = s.score;
    if (score !== c.score && h.score) {
      c.score = score;
      h.score.textContent = fmt(score);
    }
    const m = s.meters;
    if (m !== c.dist && h.dist) {
      c.dist = m;
      h.dist.textContent = fmt(m) + ' m';
    }
    const best = Math.max(this.best, score);
    if (best !== c.best && h.best) {
      c.best = best;
      h.best.textContent = fmt(best);
    }
    if (s.mult !== c.mult && h.mult) {
      c.mult = s.mult;
      h.mult.textContent = 'x' + s.mult;
      h.mult.dataset.level = String(Math.min(s.mult, 8));
    }
    const bar = Math.round((s.comboT / C.COMBO_TIME) * 200) / 200;
    if (bar !== c.bar && h.multBar) {
      c.bar = bar;
      h.multBar.style.transform = `scaleX(${bar})`;
    }
    const en = Math.round((s.energy / C.OVERDRIVE_GEMS) * 200) / 200;
    if (en !== c.energy && h.energy) {
      c.energy = en;
      h.energy.style.transform = `scaleX(${en})`;
    }
    const od = s.overdrive > 0;
    if (od !== c.od && h.energyWrap) {
      c.od = od;
      h.energyWrap.dataset.od = od ? '1' : '0';
    }
  }

  // ───────────────────────── resize ─────────────────────────
  private resize = () => {
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const cap = this.quality === 2 ? 2 : this.quality === 1 ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (pw === this.canvas.width && ph === this.canvas.height && w === this.cssW && h === this.cssH) return;
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.base = Math.min(h / C.VIEW_H, w / C.MIN_VIEW_W);
    this.bg.build(w, h, dpr, this.base);
    this.updateCamera(0, true);
    for (let i = 0; i < SPEED_LINES; i++) this.respawnSpeedLine(i, true);
    this.render();
  };

  // ───────────────────────── render ─────────────────────────
  private render() {
    const ctx = this.ctx;
    const s = this.sim;
    const W = this.cssW;
    const H = this.cssH;
    const k = this.k;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';

    const hy = (C.VOID_Y - this.camY) * k + this.shakeY * 0.4;
    this.bg.drawSky(ctx, this.camX, hy, this.time);
    const danger = s.alive && this.state !== 'menu' ? clamp((s.y - (C.VOID_Y - 180)) / 180, 0, 1) : 0;
    this.bg.drawFloor(ctx, this.camX, hy, this.time, danger, k);

    // world space
    const cx = W / 2;
    const cy = H / 2;
    ctx.translate(cx + this.shakeX, cy + this.shakeY);
    ctx.rotate(this.shakeR);
    ctx.translate(-cx, -cy);
    ctx.scale(k, k);
    ctx.translate(-this.camX, -this.camY);
    const minX = this.camX - 80;
    const maxX = this.camX + this.viewW + 80;

    this.drawStartPad(ctx);
    this.drawNet(ctx);
    this.drawLasers(ctx, minX, maxX);
    this.drawGems(ctx, minX, maxX);
    this.drawPegs(ctx, minX, maxX);
    this.drawWall(ctx);
    this.drawRope(ctx);
    this.drawTrail(ctx);
    this.drawPlayer(ctx);
    ctx.globalCompositeOperation = 'lighter';
    this.parts.draw(ctx, this.glow, minX, maxX);
    ctx.globalCompositeOperation = 'source-over';
    this.drawTutorial(ctx);
    this.pops.draw(ctx);

    // screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSpeedLines(ctx);
    this.drawOverdriveFrame(ctx);
    this.drawWallWarning(ctx);
    if (this.flash > 0.01) {
      ctx.globalAlpha = Math.min(1, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    this.bg.drawVignette(ctx);
    this.drawBanner(ctx);
    if (this.state === 'countdown') this.drawCountdown(ctx);
  }

  private drawStartPad(ctx: CanvasRenderingContext2D) {
    if (this.camX > C.START_X + 120) return;
    const x = C.START_X;
    const y = C.START_Y + 28;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(this.glow[P_CYAN], x - 110, y - 40, 220, 80);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#12052e';
    ctx.fillRect(x - 80, y, 130, 14);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(x - 80, y, 130, 3);
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const t = (this.time * 2) % 1;
    for (let i = 0; i < 3; i++) {
      const ox = x - 50 + i * 26 + t * 8;
      ctx.moveTo(ox, y + 18);
      ctx.lineTo(ox + 8, y + 26);
      ctx.lineTo(ox, y + 34);
    }
    ctx.stroke();
  }

  private drawNet(ctx: CanvasRenderingContext2D) {
    const s = this.sim;
    if (s.demo || this.camX > C.NET_END_X) return;
    const x0 = C.START_X - 500;
    const x1 = C.NET_END_X;
    const y = C.NET_Y + C.PLAYER_R;
    const g = ctx.createLinearGradient(x1 - 400, 0, x1, 0);
    g.addColorStop(0, 'rgba(60,242,255,0.55)');
    g.addColorStop(1, 'rgba(60,242,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -this.time * 30;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.moveTo(x0, y + 8);
    ctx.lineTo(x1, y + 8);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawPegs(ctx: CanvasRenderingContext2D, minX: number, maxX: number) {
    const s = this.sim;
    const R2 = C.GRAPPLE_RANGE * C.GRAPPLE_RANGE;
    for (let i = 0; i < s.pegs.length; i++) {
      const p = s.pegs[i];
      if (p.x < minX || p.x > maxX) continue;
      const isA = p === s.peg;
      const isT = p === this.target && !isA;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const inRange = s.alive && dx > -70 && dx * dx + dy * dy < R2;
      if (p.moveAmp > 0) {
        ctx.strokeStyle = 'rgba(167,123,255,0.28)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 7]);
        ctx.beginPath();
        ctx.moveTo(p.bx, p.by - p.moveAmp);
        ctx.lineTo(p.bx, p.by + p.moveAmp);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalCompositeOperation = 'lighter';
      const gs = (isA ? 78 : isT ? 66 : 50) * (1 + p.pulse * 0.7);
      ctx.globalAlpha = isA ? 1 : inRange ? 0.8 : 0.4;
      ctx.drawImage(this.glow[isA || isT ? P_CYAN : P_VIOLET], p.x - gs / 2, p.y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = isA ? '#ffffff' : isT ? '#bff9ff' : inRange ? '#cdb9ff' : '#6d54b0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9.5 + p.pulse * 6, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = isA ? COLORS.cyan : '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.6, 0, TAU);
      ctx.fill();
      if (isT) this.drawReticle(ctx, p.x, p.y);
    }
  }

  private drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const t = this.time;
    const r = 22 + Math.sin(t * 9) * 2.5;
    const rot = t * 2.4;
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      ctx.moveTo(x + Math.cos(a - 0.36) * r, y + Math.sin(a - 0.36) * r);
      ctx.arc(x, y, r, a - 0.36, a + 0.36);
    }
    ctx.stroke();
  }

  private drawGems(ctx: CanvasRenderingContext2D, minX: number, maxX: number) {
    const s = this.sim;
    const t = this.time;
    for (let i = 0; i < s.gems.length; i++) {
      const g = s.gems[i];
      if (g.x < minX || g.x > maxX) continue;
      const prism = g.kind === 1;
      const y = g.y + Math.sin(t * 3 + g.phase) * 4;
      const size = prism ? 16 : 11;
      ctx.globalCompositeOperation = 'lighter';
      const gs = prism ? 84 : 50;
      ctx.globalAlpha = prism ? 0.9 : 0.7;
      ctx.drawImage(this.glow[prism ? P_MAGENTA : P_GOLD], g.x - gs / 2, y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const spin = Math.cos(t * 4 + g.phase);
      const w = size * (0.3 + 0.7 * Math.abs(spin)) * 0.78;
      ctx.fillStyle = prism ? `hsl(${(t * 220 + g.phase * 60) % 360},100%,66%)` : COLORS.gold;
      ctx.beginPath();
      ctx.moveTo(g.x, y - size);
      ctx.lineTo(g.x + w, y);
      ctx.lineTo(g.x, y + size);
      ctx.lineTo(g.x - w, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(g.x, y - size * 0.62);
      ctx.lineTo(g.x + w * 0.45 * Math.sign(spin || 1), y - size * 0.05);
      ctx.lineTo(g.x, y + size * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  private strokeSegs(ctx: CanvasRenderingContext2D, L: Laser) {
    ctx.beginPath();
    for (let k = 0; k < L.segCount; k++) {
      const o = k * 4;
      ctx.moveTo(L.segs[o], L.segs[o + 1]);
      ctx.lineTo(L.segs[o + 2], L.segs[o + 3]);
    }
    ctx.stroke();
  }

  private drawLasers(ctx: CanvasRenderingContext2D, minX: number, maxX: number) {
    const s = this.sim;
    const od = s.overdrive > 0;
    const col = od ? '#b9a7ff' : COLORS.red;
    const t = this.time;
    for (let i = 0; i < s.lasers.length; i++) {
      const L = s.lasers[i];
      if (L.maxX < minX - 60 || L.minX > maxX + 60) continue;
      if (L.active) {
        const flick = 0.85 + 0.15 * Math.sin(t * 57 + L.phase * 10);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.2 * flick;
        ctx.lineWidth = 20;
        this.strokeSegs(ctx, L);
        ctx.globalAlpha = 0.55 * flick;
        ctx.lineWidth = 7.5;
        this.strokeSegs(ctx, L);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = od ? '#e8e0ff' : '#fff2f5';
        ctx.lineWidth = 2.6;
        this.strokeSegs(ctx, L);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.strokeStyle = col;
        if (L.warn) {
          ctx.globalAlpha = Math.sin(t * 38) > 0 ? 0.95 : 0.35;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([16, 10]);
          ctx.lineDashOffset = -t * 260;
        } else {
          ctx.globalAlpha = 0.18;
          ctx.lineWidth = 1.6;
          ctx.setLineDash([3, 12]);
          ctx.lineDashOffset = 0;
        }
        this.strokeSegs(ctx, L);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      // emitters
      ctx.fillStyle = '#1a0625';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      if (L.kind === L_ROTOR) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.8;
        ctx.drawImage(this.glow[P_RED], L.x - 30, L.y - 30, 60, 60);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath();
        ctx.arc(L.x, L.y, 10, 0, TAU);
        ctx.fill();
        ctx.stroke();
      } else if (L.kind === L_PULSE) {
        const by = L.bottom - 60;
        ctx.fillRect(L.x - 9, by - 8, 18, 30);
        ctx.strokeRect(L.x - 9, by - 8, 18, 30);
        if (L.active || L.warn) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = L.active ? 0.9 : 0.5;
          ctx.drawImage(this.glow[P_RED], L.x - 34, by - 34, 68, 68);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      } else {
        for (let e = 0; e < 2; e++) {
          const ex = L.segs[e * 2];
          const ey = L.segs[e * 2 + 1];
          ctx.beginPath();
          if (L.kind === L_SWEEP) ctx.rect(ex - 7, ey - (e === 0 ? 9 : 0), 14, 9);
          else if (L.kind === L_SLIDER) ctx.rect(ex - (e === 0 ? 9 : 0), ey - 7, 9, 14);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  private drawWall(ctx: CanvasRenderingContext2D) {
    const s = this.sim;
    if (s.demo) return;
    const wx = s.wallX;
    const left = this.camX - 80;
    if (wx < left) return;
    const top = this.camY - 80;
    const bottom = this.camY + this.viewH + 80;
    const band = 280;
    const g0 = Math.max(left, wx - band);
    if (wx - band > left) {
      ctx.fillStyle = 'rgba(40,0,14,0.6)';
      ctx.fillRect(left, top, wx - band - left, bottom - top);
    }
    const grd = ctx.createLinearGradient(wx - band, 0, wx, 0);
    grd.addColorStop(0, 'rgba(255,20,70,0.05)');
    grd.addColorStop(0.75, 'rgba(255,20,70,0.22)');
    grd.addColorStop(1, 'rgba(255,40,90,0.5)');
    ctx.fillStyle = grd;
    ctx.fillRect(g0, top, wx - g0, bottom - top);
    ctx.globalCompositeOperation = 'lighter';
    const f = Math.floor(this.time * 18);
    ctx.fillStyle = 'rgba(255,45,85,0.55)';
    for (let i = 0; i < 14; i++) {
      const r1 = hash(f * 31 + i * 7);
      const r2 = hash(f * 17 + i * 13);
      const r3 = hash(f * 5 + i * 3);
      const yy = top + r1 * (bottom - top);
      const hh = 3 + r2 * 14;
      const ww = 30 + r3 * 180;
      ctx.fillRect(wx - ww + r2 * 30, yy, ww, hh);
    }
    const jitter = (hash(f) - 0.5) * 6;
    ctx.strokeStyle = COLORS.red;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(wx + jitter, top);
    ctx.lineTo(wx + jitter, bottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffd0da';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawRope(ctx: CanvasRenderingContext2D) {
    const s = this.sim;
    ctx.lineCap = 'round';
    if (s.peg && s.alive) {
      const ax = s.peg.x;
      const ay = s.peg.y;
      const px = s.x;
      const py = s.y;
      const ext = Math.min(1, this.ropeT / 0.07);
      const ex = px + (ax - px) * ext;
      const ey = py + (ay - py) * ext;
      const wob = Math.max(0, 1 - this.ropeT / 0.35) * 10;
      const dx = ex - px;
      const dy = ey - py;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      if (wob > 0.3) {
        for (let i = 0; i <= 14; i++) {
          const t = i / 14;
          const o = Math.sin(t * Math.PI * 3 - this.ropeT * 40) * wob * Math.sin(t * Math.PI);
          const x = px + dx * t + nx * o;
          const y = py + dy * t + ny * o;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(px, py);
        ctx.lineTo(ex, ey);
      }
      ctx.strokeStyle = s.overdrive > 0 ? COLORS.gold : COLORS.cyan;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#eafeff';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      if (ext >= 1) {
        ctx.fillStyle = '#eafeff';
        ctx.beginPath();
        ctx.moveTo(ax, ay - 6);
        ctx.lineTo(ax + 6, ay);
        ctx.lineTo(ax, ay + 6);
        ctx.lineTo(ax - 6, ay);
        ctx.closePath();
        ctx.fill();
      }
    } else if (this.ropeRetract > 0 && s.alive) {
      const t = this.ropeRetract / 0.12;
      const ex = s.x + (this.retractX - s.x) * t;
      const ey = s.y + (this.retractY - s.y) * t;
      ctx.globalAlpha = t;
      ctx.strokeStyle = '#eafeff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.missT > 0 && s.alive && !s.peg) {
      const p = 1 - this.missT / 0.25;
      const reach = (p < 0.5 ? p * 2 : (1 - p) * 2) * C.GRAPPLE_RANGE * 0.75;
      const a = -0.9;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(a) * reach, s.y + Math.sin(a) * reach);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.lineCap = 'butt';
  }

  private drawTrail(ctx: CanvasRenderingContext2D) {
    const n = this.trailCount;
    if (n < 2 || !this.sim.alive) return;
    const od = this.sim.overdrive > 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const f = Math.floor(this.time * 20);
    for (let i = n - 1; i >= 1; i--) {
      const a = (this.trailHead - i + TRAIL) % TRAIL;
      const b = (this.trailHead - i + 1 + TRAIL) % TRAIL;
      const t = 1 - i / n;
      ctx.globalAlpha = t * (od ? 0.8 : 0.55);
      ctx.strokeStyle = od ? RAINBOW[(i + f) % RAINBOW.length] : COLORS.cyan;
      ctx.lineWidth = C.PLAYER_R * 1.6 * t + 1;
      ctx.beginPath();
      ctx.moveTo(this.trailX[a], this.trailY[a]);
      ctx.lineTo(this.trailX[b], this.trailY[b]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const s = this.sim;
    if (!s.alive) return;
    const x = s.x;
    const y = s.y;
    const od = s.overdrive > 0;
    const R = C.PLAYER_R;
    ctx.globalCompositeOperation = 'lighter';
    const gs = od ? 130 : 100;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.glow[od ? P_GOLD : P_CYAN], x - gs / 2, y - gs / 2, gs, gs);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const ang = Math.atan2(s.vy, s.vx);
    const st = 1 + Math.min(s.speed / 2600, 0.32);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(st, 1 / st);
    ctx.fillStyle = '#f0ffff';
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = od ? COLORS.gold : COLORS.cyan;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // revive shield
    if (s.invuln > 0) {
      const ending = s.invuln < 1 ? (Math.sin(this.time * 34) > 0 ? 0.35 : 1) : 1;
      const r = R + 11 + Math.sin(this.time * 6) * 2.5;
      ctx.globalAlpha = 0.85 * ending;
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.25 * ending;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.glow[P_CYAN], x - r * 1.9, y - r * 1.9, r * 3.8, r * 3.8);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // orbiting sparks
    const rot = this.time * 9;
    ctx.fillStyle = od ? COLORS.gold : '#bff9ff';
    for (let i = 0; i < 2; i++) {
      const a = rot + i * Math.PI;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (R + 5), y + Math.sin(a) * (R + 5), 2, 0, TAU);
      ctx.fill();
    }
    // "searching" pulse when holding with no target
    if (this.holds.size > 0 && !s.peg && this.state === 'playing' && !this.target) {
      const p = (this.time * 3) % 1;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, R + 6 + p * 30, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawTutorial(ctx: CanvasRenderingContext2D) {
    const s = this.sim;
    if (!this.tutorial || this.state !== 'playing' || !s.alive) return;
    let text = '';
    let x = 0;
    let y = 0;
    if (!s.grabbedOnce && this.target) {
      text = this.touchMode ? 'HOLD SCREEN' : 'HOLD SPACE';
      x = this.target.x;
      y = this.target.y - 44;
    } else if (s.grabbedOnce && !s.releasedOnce && s.peg && s.attachT > 0.25) {
      text = 'LET GO TO FLING';
      x = s.x;
      y = s.y - 44;
    } else return;
    const a = 0.65 + 0.35 * Math.sin(this.time * 8);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(Math.round(Math.max(15, 13 / this.k)), 800);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10,2,30,0.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
  }

  private drawSpeedLines(ctx: CanvasRenderingContext2D) {
    if (this.speedFx < 0.02 || this.quality === 0) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this.sim.overdrive > 0 ? 'rgba(255,220,120,1)' : 'rgba(190,245,255,1)';
    ctx.globalAlpha = this.speedFx * 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < SPEED_LINES; i++) {
      ctx.moveTo(this.slX[i], this.slY[i]);
      ctx.lineTo(this.slX[i] + this.slL[i] * (0.5 + this.speedFx), this.slY[i]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawOverdriveFrame(ctx: CanvasRenderingContext2D) {
    const s = this.sim;
    if (s.overdrive <= 0) return;
    const W = this.cssW;
    const H = this.cssH;
    const ending = s.overdrive < 1.5 ? (Math.sin(this.time * 30) > 0 ? 1 : 0.3) : 1;
    const a = (0.3 + 0.15 * Math.sin(this.time * 10)) * ending;
    const e = Math.min(W, H) * 0.09;
    ctx.globalCompositeOperation = 'lighter';
    let g = ctx.createLinearGradient(0, 0, 0, e);
    g.addColorStop(0, `rgba(255,210,63,${a})`);
    g.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, e);
    g = ctx.createLinearGradient(0, H, 0, H - e);
    g.addColorStop(0, `rgba(255,61,240,${a})`);
    g.addColorStop(1, 'rgba(255,61,240,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - e, W, e);
    g = ctx.createLinearGradient(0, 0, e, 0);
    g.addColorStop(0, `rgba(255,210,63,${a * 0.8})`);
    g.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, e, H);
    g = ctx.createLinearGradient(W, 0, W - e, 0);
    g.addColorStop(0, `rgba(255,210,63,${a * 0.8})`);
    g.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(W - e, 0, e, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawWallWarning(ctx: CanvasRenderingContext2D) {
    const s = this.sim;
    if (s.demo || !s.alive || (this.state !== 'playing' && this.state !== 'countdown')) return;
    const dist = s.x - s.wallX;
    const sx = (s.wallX - this.camX) * this.k;
    if (dist > 750 || sx > 0) return;
    const p = 1 - dist / 750;
    const a = p * (0.55 + 0.45 * Math.sin(this.time * 14));
    const w = 40 + p * 60;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `rgba(255,45,85,${a * 0.9})`);
    g.addColorStop(1, 'rgba(255,45,85,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, this.cssH);
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(18, this.cssH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(13, 800);
    ctx.fillStyle = '#ffd0da';
    ctx.fillText('◄ FIREWALL ◄', 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    if (this.bannerT <= 0 || this.state === 'menu') return;
    const W = this.cssW;
    const H = this.cssH;
    const age = 1.7 - this.bannerT;
    const sc = age < 0.14 ? 1.9 - (age / 0.14) * 0.9 : 1;
    const a = Math.min(1, this.bannerT / 0.35);
    const ui = clamp(Math.min(W / 900, H / 600), 0.6, 1.25);
    const y = H * 0.3;
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = font(Math.round(46 * ui * sc), 900);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(10,2,30,0.8)';
    ctx.strokeText(this.bannerText, W / 2, y);
    ctx.fillStyle = this.bannerColor;
    ctx.fillText(this.bannerText, W / 2, y);
    if (this.bannerSub) {
      ctx.font = font(Math.round(14 * ui), 700);
      ctx.lineWidth = 4;
      ctx.strokeText(this.bannerSub, W / 2, y + 40 * ui);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.bannerSub, W / 2, y + 40 * ui);
    }
    ctx.globalAlpha = 1;
  }

  private drawCountdown(ctx: CanvasRenderingContext2D) {
    const W = this.cssW;
    const H = this.cssH;
    const n = Math.max(1, Math.ceil(this.countdownT / 0.5));
    const frac = (this.countdownT % 0.5) / 0.5;
    const ui = clamp(Math.min(W / 900, H / 600), 0.6, 1.3);
    ctx.fillStyle = 'rgba(5,1,15,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.4 + frac * 0.6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(Math.round((90 + frac * 50) * ui), 900);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(10,2,30,0.8)';
    ctx.strokeText(String(n), W / 2, H / 2);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText(String(n), W / 2, H / 2);
    ctx.globalAlpha = 1;
    ctx.font = font(Math.round(13 * ui), 700);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.touchMode ? 'HOLD TO KEEP YOUR GRIP' : 'HOLD SPACE TO KEEP YOUR GRIP', W / 2, H / 2 + 90 * ui);
  }
}

