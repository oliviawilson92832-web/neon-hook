export interface Peg {
  x: number;
  y: number;
  bx: number;
  by: number;
  vx: number;
  vy: number;
  moveAmp: number;
  moveSpeed: number;
  movePhase: number;
  moveAxis: 0 | 1; // 0 = vertical, 1 = horizontal
  pulse: number; // visual pulse 0..1
  visited: boolean;
}

export interface Gem {
  x: number;
  y: number;
  baseY: number;
  kind: 0 | 1; // 0 = energy gem, 1 = prism (rare, high value)
  phase: number;
  taken: boolean;
  magnet: boolean;
}

export const L_SWEEP = 0; // vertical beam, oscillates up / down
export const L_SLIDER = 1; // horizontal beam, oscillates up / down
export const L_ROTOR = 2; // rotating beam (1 or 2 arms)
export const L_PULSE = 3; // full-height gate that pulses on / off

export interface Laser {
  kind: number;
  x: number;
  y: number;
  len: number;
  amp: number;
  speed: number;
  phase: number;
  arms: number;
  period: number;
  onFrac: number;
  top: number;
  bottom: number;
  // runtime
  active: boolean;
  warn: boolean;
  segs: Float32Array; // up to 2 segments [ax, ay, bx, by, ...]
  segCount: number;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  near: boolean;
  nearX: number;
  nearY: number;
  nearCd: number;
  dead: boolean;
}

export type DeathCause = 'laser' | 'void' | 'wall';

export interface SimEvents {
  attach(peg: Peg, isNew: boolean): void;
  release(perfect: boolean, speed: number): void;
  miss(): void;
  gem(gem: Gem, value: number, streak: number): void;
  nearMiss(x: number, y: number, value: number): void;
  multUp(mult: number): void;
  comboLost(): void;
  overdrive(): void;
  overdriveEnd(): void;
  smash(x: number, y: number, value: number): void;
  bounce(x: number, y: number): void;
  milestone(meters: number): void;
  death(cause: DeathCause, x: number, y: number): void;
}
