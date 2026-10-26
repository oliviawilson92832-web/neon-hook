import { PALETTE } from './constants';
import { TAU } from './math';

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Pre-rendered soft radial glow (drawn with 'lighter' compositing — far cheaper than shadowBlur) */
export function makeGlowSprite(color: string, size = 96): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, rgba(color, 1));
  grd.addColorStop(0.18, rgba(color, 0.55));
  grd.addColorStop(0.45, rgba(color, 0.16));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

export const K_SPARK = 0;
export const K_DOT = 1;
export const K_RING = 2;
export const K_SQUARE = 3;

const MAXP = 900;

/** Struct-of-arrays particle pool: zero allocations per frame */
export class Particles {
  x = new Float32Array(MAXP);
  y = new Float32Array(MAXP);
  vx = new Float32Array(MAXP);
  vy = new Float32Array(MAXP);
  life = new Float32Array(MAXP);
  max = new Float32Array(MAXP);
  size = new Float32Array(MAXP);
  drag = new Float32Array(MAXP);
  grav = new Float32Array(MAXP);
  col = new Uint8Array(MAXP);
  kind = new Uint8Array(MAXP);
  n = 0;
  cap = MAXP;

  clear() {
    this.n = 0;
  }

  spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number, col: number, drag = 2, grav = 0) {
    let i = this.n;
    if (i >= this.cap) {
      // recycle a random old particle instead of dropping the new one
      i = (Math.random() * this.cap) | 0;
    } else this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.col[i] = col;
    this.kind[i] = kind;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  burst(x: number, y: number, count: number, sMin: number, sMax: number, col: number, life = 0.5, size = 2.5, kind = K_SPARK, grav = 0) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * TAU;
      const s = sMin + Math.random() * (sMax - sMin);
      this.spawn(kind, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), col, 3, grav);
    }
  }

  cone(x: number, y: number, count: number, ang: number, spread: number, sMin: number, sMax: number, col: number, life = 0.45, size = 2.5, grav = 0) {
    for (let k = 0; k < count; k++) {
      const a = ang + (Math.random() - 0.5) * spread;
      const s = sMin + Math.random() * (sMax - sMin);
      this.spawn(K_SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), col, 3, grav);
    }
  }

  ring(x: number, y: number, radius: number, col: number, life = 0.45) {
    this.spawn(K_RING, x, y, 0, 0, life, radius, col, 0, 0);
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      const l = this.life[i] - dt;
      if (l <= 0) {
        const last = --this.n;
        if (i !== last) {
          this.x[i] = this.x[last];
          this.y[i] = this.y[last];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.life[i] = this.life[last];
          this.max[i] = this.max[last];
          this.size[i] = this.size[last];
          this.col[i] = this.col[last];
          this.kind[i] = this.kind[last];
          this.drag[i] = this.drag[last];
          this.grav[i] = this.grav[last];
        }
        continue;
      }
      this.life[i] = l;
      const d = 1 - Math.min(1, this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }

  /** Assumes 'lighter' composite is already set. */
  draw(ctx: CanvasRenderingContext2D, sprites: HTMLCanvasElement[], minX: number, maxX: number) {
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i];
      if (x < minX || x > maxX) continue;
      const y = this.y[i];
      const t = this.life[i] / this.max[i];
      const c = this.col[i];
      switch (this.kind[i]) {
        case K_SPARK: {
          ctx.globalAlpha = t;
          ctx.strokeStyle = PALETTE[c];
          ctx.lineWidth = this.size[i] * (0.35 + 0.65 * t);
          ctx.beginPath();
          ctx.moveTo(x - this.vx[i] * 0.035, y - this.vy[i] * 0.035);
          ctx.lineTo(x, y);
          ctx.stroke();
          break;
        }
        case K_DOT: {
          const s = this.size[i] * (0.4 + 0.6 * t);
          ctx.globalAlpha = t;
          ctx.drawImage(sprites[c], x - s, y - s, s * 2, s * 2);
          break;
        }
        case K_RING: {
          const p = 1 - t;
          const r = this.size[i] * (1 - (1 - p) * (1 - p) * (1 - p));
          ctx.globalAlpha = t * t;
          ctx.strokeStyle = PALETTE[c];
          ctx.lineWidth = 1 + 4 * t;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
          ctx.stroke();
          break;
        }
        default: {
          const s = this.size[i] * t;
          ctx.globalAlpha = Math.min(1, t * 1.5);
          ctx.fillStyle = PALETTE[c];
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  max: number;
  active: boolean;
}

const FONT = '"Orbitron Variable", Orbitron, "Chakra Petch", system-ui, sans-serif';
const fontCache = new Map<number, string>();
export function font(size: number, weight = 800): string {
  const key = size * 1000 + weight;
  let f = fontCache.get(key);
  if (!f) {
    f = `${weight} ${size}px ${FONT}`;
    fontCache.set(key, f);
  }
  return f;
}

/** Floating world-space score text */
export class Popups {
  items: Popup[] = [];
  constructor(n = 28) {
    for (let i = 0; i < n; i++) this.items.push({ x: 0, y: 0, text: '', color: '#fff', size: 16, life: 0, max: 1, active: false });
  }
  clear() {
    for (const p of this.items) p.active = false;
  }
  spawn(x: number, y: number, text: string, color: string, size = 16, life = 0.9) {
    let slot = this.items[0];
    for (const p of this.items) {
      if (!p.active) {
        slot = p;
        break;
      }
      if (p.life < slot.life) slot = p;
    }
    slot.x = x;
    slot.y = y;
    slot.text = text;
    slot.color = color;
    slot.size = size;
    slot.life = life;
    slot.max = life;
    slot.active = true;
  }
  update(dt: number) {
    for (const p of this.items) {
      if (!p.active) continue;
      p.life -= dt;
      p.y -= (30 + 50 * (p.life / p.max)) * dt;
      if (p.life <= 0) p.active = false;
    }
  }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of this.items) {
      if (!p.active) continue;
      const age = 1 - p.life / p.max;
      const sc = age < 0.12 ? 1.7 - (age / 0.12) * 0.7 : 1;
      const a = p.life < 0.3 ? p.life / 0.3 : 1;
      ctx.globalAlpha = a;
      ctx.font = font(Math.round(p.size * sc));
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,2,30,0.85)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}
