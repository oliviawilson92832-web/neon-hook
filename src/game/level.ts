import * as C from './constants';
import { clamp, lerp, TAU } from './math';
import { L_PULSE, L_ROTOR, L_SLIDER, L_SWEEP, type Gem, type Laser, type Peg } from './types';

const DEG = Math.PI / 180;

export function makePeg(x: number, y: number): Peg {
  return {
    x,
    y,
    bx: x,
    by: y,
    vx: 0,
    vy: 0,
    moveAmp: 0,
    moveSpeed: 0,
    movePhase: 0,
    moveAxis: 0,
    pulse: 0,
    visited: false,
  };
}

export function makeGem(x: number, y: number, kind: 0 | 1 = 0): Gem {
  return { x, y, baseY: y, kind, phase: Math.random() * TAU, taken: false, magnet: false };
}

export function makeLaser(kind: number, x: number, y: number): Laser {
  return {
    kind,
    x,
    y,
    len: 100,
    amp: 0,
    speed: 1,
    phase: 0,
    arms: 1,
    period: 2.5,
    onFrac: 0.45,
    top: 0,
    bottom: 0,
    active: true,
    warn: false,
    segs: new Float32Array(8),
    segCount: 1,
    cx: x,
    cy: y,
    minX: x,
    maxX: x,
    near: false,
    nearX: 0,
    nearY: 0,
    nearCd: 0,
    dead: false,
  };
}

export const difficultyAt = (x: number) => clamp((x - 2500) / 70000, 0, 1);

export class LevelGen {
  nextX = 0;
  lastY = 230;
  lastLaserX = 0;
  prev: Peg | null = null;
  rng: () => number = Math.random;
  private pegs: Peg[];
  private gems: Gem[];
  private lasers: Laser[];

  constructor(pegs: Peg[], gems: Gem[], lasers: Laser[]) {
    this.pegs = pegs;
    this.gems = gems;
    this.lasers = lasers;
  }

  reset(rng: () => number) {
    this.rng = rng;
    this.pegs.length = 0;
    this.gems.length = 0;
    this.lasers.length = 0;
    // Hand-tuned intro: generous pegs + lots of shiny gems so the first seconds feel great
    const intro: [number, number][] = [
      [330, 215],
      [600, 250],
      [870, 200],
      [1140, 250],
      [1410, 205],
      [1680, 245],
      [1950, 215],
    ];
    let prev: Peg | null = null;
    for (let i = 0; i < intro.length; i++) {
      const p = this.addPeg(intro[i][0], intro[i][1]);
      if (i === 0) this.gemArcUnder(p, 5, 168);
      else if (prev) {
        if (i === 3) this.gemLineHigh(prev, p);
        else this.gemArcUnder(p, 5, 160 + (i % 2) * 20);
      }
      prev = p;
    }
    this.prev = prev;
    this.nextX = intro[intro.length - 1][0];
    this.lastY = intro[intro.length - 1][1];
    this.lastLaserX = this.nextX;
  }

  ensure(untilX: number) {
    let guard = 0;
    while (this.nextX < untilX && guard++ < 60) this.step();
  }

  private addPeg(x: number, y: number): Peg {
    const p = makePeg(x, y);
    this.pegs.push(p);
    return p;
  }

  private addGem(x: number, y: number, kind: 0 | 1 = 0) {
    this.gems.push(makeGem(x, clamp(y, 40, C.VOID_Y - 42), kind));
  }

  private step() {
    const r = this.rng;
    const x0 = this.nextX;
    const diff = difficultyAt(x0);
    const gap = lerp(205, 240, diff) + r() * lerp(75, 110, diff);
    const x = x0 + gap;
    let y = this.lastY + (r() * 2 - 1) * 165;
    if (Math.abs(y - this.lastY) < 40) y += y < this.lastY ? -55 : 55;
    y = clamp(y, 140, 420);
    const peg = this.addPeg(x, y);
    if (diff > 0.08 && r() < 0.1 + 0.3 * diff) {
      peg.moveAxis = 0;
      peg.moveAmp = 40 + r() * 45;
      peg.moveSpeed = 1.1 + r() * 1.1;
      peg.movePhase = r() * TAU;
      peg.by = clamp(peg.by, 120 + peg.moveAmp, 440 - peg.moveAmp);
      peg.y = peg.by;
    }
    if (this.prev) this.decorate(this.prev, peg, diff);
    this.prev = peg;
    this.nextX = x;
    this.lastY = peg.by;
  }

  private decorate(A: Peg, B: Peg, diff: number) {
    const r = this.rng;
    const gap = B.x - A.x;
    const spacing = lerp(1100, 520, diff);
    if (B.x > 2700 && gap >= 215 && B.x - this.lastLaserX > spacing && r() < 0.42 + 0.45 * diff) {
      this.placeLaser(A, B, diff);
      this.lastLaserX = B.x;
      if (r() < 0.45) this.gemArcUnder(A, 3, 150);
      return;
    }
    const roll = r();
    if (roll < 0.3) this.gemArcUnder(A, 5, 140 + r() * 50);
    else if (roll < 0.5) this.gemFlightArc(A, B);
    else if (roll < 0.62) this.gemLineHigh(A, B);
    else if (roll < 0.72) this.gemColumn(A, B);
    // else: breathing room
  }

  private gemArcUnder(P: Peg, n: number, radius: number) {
    const R = Math.min(radius, C.VOID_Y - 60 - P.by - P.moveAmp);
    if (R < 100) return;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const a = lerp(145, 35, t) * DEG;
      this.addGem(P.bx + Math.cos(a) * R, P.by + Math.sin(a) * R);
    }
  }

  private gemFlightArc(A: Peg, B: Peg) {
    const gap = B.x - A.x;
    const sx = A.x + gap * 0.25;
    const ex = B.x - gap * 0.25;
    const sy = A.by + 70;
    const ey = B.by + 70;
    const peak = Math.min(A.by, B.by) - 10;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const bx = lerp(sx, ex, t);
      const base = lerp(sy, ey, t);
      const hump = Math.max(0, base - peak) * 4 * t * (1 - t);
      this.addGem(bx, base - hump);
    }
  }

  private gemLineHigh(A: Peg, B: Peg) {
    const y = Math.min(A.by, B.by) - 85;
    const n = 4;
    for (let i = 0; i < n; i++) this.addGem(lerp(A.x + 45, B.x - 45, i / (n - 1)), y);
  }

  private gemColumn(A: Peg, B: Peg) {
    const x = (A.x + B.x) / 2;
    const y0 = Math.max(A.by, B.by) + 60;
    for (let i = 0; i < 3; i++) this.addGem(x, y0 + i * 46);
  }

  private placeLaser(A: Peg, B: Peg, diff: number) {
    const r = this.rng;
    const gap = B.x - A.x;
    const mid = (A.x + B.x) / 2;
    const spd = 1 + 0.75 * diff;
    const w = [3, diff > 0.03 ? 3 : 0, diff > 0.08 ? 2 : 0, diff > 0.12 && gap >= 235 ? 2.2 : 0, diff > 0.3 ? 2 : 0];
    let tot = 0;
    for (let i = 0; i < w.length; i++) tot += w[i];
    let pick = r() * tot;
    let k = 0;
    for (; k < w.length - 1; k++) {
      if (pick < w[k]) break;
      pick -= w[k];
    }
    if (w[k] === 0) k = 0;

    const prismChance = 0.3 + 0.25 * diff;
    let L: Laser;
    switch (k) {
      case 1:
      case 4: {
        const py = clamp(Math.max(A.by, B.by) + 105 + r() * 70, 260, 520);
        L = makeLaser(L_ROTOR, mid, py);
        L.len = Math.min(gap / 2 - 44, 90 + 55 * diff + r() * 25);
        L.speed = (1.1 + r() * 0.9) * spd * (r() < 0.5 ? -1 : 1);
        L.phase = r() * TAU;
        if (k === 4) {
          L.arms = 2;
          L.len *= 0.92;
          L.speed *= 0.8;
        }
        if (r() < prismChance) this.addGem(mid, py - L.len - 36, 1);
        break;
      }
      case 2: {
        L = makeLaser(L_SLIDER, mid, 365);
        L.len = Math.min(gap / 2 - 40, 70 + r() * 40);
        L.amp = 165 + r() * 30;
        L.speed = (1.0 + r() * 0.8) * spd;
        L.phase = r() * TAU;
        if (r() < prismChance) this.addGem(mid, 365, 1);
        break;
      }
      case 3: {
        L = makeLaser(L_PULSE, mid, 0);
        L.top = -3000;
        L.bottom = C.VOID_Y + 60;
        L.period = lerp(2.8, 2.15, diff) + r() * 0.3;
        L.onFrac = lerp(0.38, 0.5, diff);
        L.phase = r() * L.period;
        if (r() < prismChance) this.addGem(mid, (A.by + B.by) / 2 + 95, 1);
        break;
      }
      default: {
        L = makeLaser(L_SWEEP, mid, 380);
        L.len = 60 + 45 * diff + r() * 25;
        L.amp = 150 + r() * 50;
        L.speed = (1.2 + r() * 0.8) * spd;
        L.phase = r() * TAU;
        if (r() < prismChance) this.addGem(mid, 380, 1);
        break;
      }
    }
    this.lasers.push(L);
  }
}
