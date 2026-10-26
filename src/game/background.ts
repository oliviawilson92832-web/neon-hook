import { mulberry32 } from './math';

/**
 * Synthwave parallax backdrop. Heavy layers are pre-rendered into tiles on resize,
 * so each frame is just a handful of drawImage calls + one stroked grid path.
 */
export class Background {
  private stars: HTMLCanvasElement | null = null;
  private far: HTMLCanvasElement | null = null;
  private near: HTMLCanvasElement | null = null;
  private sun: HTMLCanvasElement | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private w = 1;
  private h = 1;
  private unit = 1;
  private farW = 1;
  private nearW = 1;
  private farH = 1;
  private nearH = 1;
  private starW = 1;
  private starH = 1;
  private sunSize = 1;

  build(cssW: number, cssH: number, dpr: number, unit: number) {
    this.w = cssW;
    this.h = cssH;
    this.unit = unit;
    const res = Math.min(dpr, 1.25); // backgrounds don't need full retina resolution

    // stars
    this.starW = Math.max(600, cssW);
    this.starH = cssH;
    this.stars = this.canvas(this.starW * res, this.starH * res, (g) => {
      g.scale(res, res);
      const rnd = mulberry32(99);
      for (let i = 0; i < 170; i++) {
        const x = rnd() * this.starW;
        const y = rnd() * this.starH * 0.85;
        const s = rnd() < 0.08 ? 1.8 : rnd() < 0.3 ? 1.2 : 0.7;
        g.fillStyle = rnd() < 0.2 ? 'rgba(160,220,255,0.9)' : rnd() < 0.3 ? 'rgba(255,170,240,0.8)' : 'rgba(255,255,255,0.7)';
        g.fillRect(x, y, s, s);
      }
    });

    // synthwave sun
    this.sunSize = Math.round(340 * unit);
    const S = this.sunSize;
    this.sun = this.canvas(S * res, S * res, (g) => {
      g.scale(res, res);
      const r = S / 2;
      const grd = g.createLinearGradient(0, 0, 0, S);
      grd.addColorStop(0, '#fff27a');
      grd.addColorStop(0.45, '#ff9a3d');
      grd.addColorStop(0.75, '#ff3d9a');
      grd.addColorStop(1, '#b21aff');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(r, r, r * 0.92, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 9; i++) {
        const y = S * 0.5 + i * i * S * 0.0075 + i * S * 0.028;
        const hh = 1.5 + i * S * 0.0065;
        g.fillRect(0, y, S, hh);
      }
    });

    // skyline layers
    this.farW = Math.round(1200 * unit);
    this.farH = Math.round(210 * unit);
    this.far = this.canvas(this.farW * res, this.farH * res, (g) => {
      g.scale(res, res);
      this.skyline(g, this.farW, this.farH, unit, 7, '#180a3a', '#241052', 0.12, false);
      // fade building tops into the haze
      g.globalCompositeOperation = 'destination-in';
      const fade = g.createLinearGradient(0, 0, 0, this.farH);
      fade.addColorStop(0, 'rgba(0,0,0,0.25)');
      fade.addColorStop(0.55, 'rgba(0,0,0,0.9)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = fade;
      g.fillRect(0, 0, this.farW, this.farH);
    });
    this.nearW = Math.round(1500 * unit);
    this.nearH = Math.round(150 * unit);
    this.near = this.canvas(this.nearW * res, this.nearH * res, (g) => {
      g.scale(res, res);
      this.skyline(g, this.nearW, this.nearH, unit, 13, '#0c0421', '#15072e', 0.07, true);
    });

    // vignette
    const vw = Math.max(2, Math.round(cssW / 2));
    const vh = Math.max(2, Math.round(cssH / 2));
    this.vignette = this.canvas(vw, vh, (g) => {
      const grd = g.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.62);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(3,0,12,0.62)');
      g.fillStyle = grd;
      g.fillRect(0, 0, vw, vh);
    });
  }

  private canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const g = c.getContext('2d')!;
    draw(g);
    return c;
  }

  private skyline(g: CanvasRenderingContext2D, W: number, H: number, unit: number, seed: number, body: string, edge: string, winDensity: number, neon: boolean) {
    const rnd = mulberry32(seed);
    let x = 0;
    while (x < W) {
      const bw = (40 + rnd() * 90) * unit;
      const bh = (neon ? 36 + rnd() * 100 : 60 + rnd() * 140) * unit;
      const w = Math.min(bw, W - x);
      const top = H - bh;
      g.fillStyle = body;
      g.fillRect(x, top, w, bh);
      g.fillStyle = edge;
      g.fillRect(x, top, w, 2 * unit);
      // windows
      const ws = 5 * unit;
      for (let wy = top + 10 * unit; wy < H - 6 * unit; wy += ws * 2.2) {
        for (let wx = x + 5 * unit; wx < x + w - 6 * unit; wx += ws * 1.9) {
          if (rnd() < winDensity) {
            const r = rnd();
            g.fillStyle = r < 0.5 ? 'rgba(255,61,240,0.42)' : r < 0.85 ? 'rgba(60,242,255,0.38)' : 'rgba(167,123,255,0.45)';
            g.fillRect(wx, wy, ws * 0.8, ws);
          }
        }
      }
      if (neon && rnd() < 0.45) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(60,242,255,0.8)' : 'rgba(255,61,240,0.8)';
        g.fillRect(x + 2 * unit, top - 1 * unit, w - 4 * unit, 1.5 * unit);
        if (rnd() < 0.5) {
          const ax = x + w * (0.3 + rnd() * 0.4);
          g.fillStyle = body;
          g.fillRect(ax, top - 26 * unit, 2 * unit, 26 * unit);
          g.fillStyle = 'rgba(255,45,85,0.95)';
          g.fillRect(ax - 1.5 * unit, top - 29 * unit, 5 * unit, 4 * unit);
        }
      }
      x += w + (rnd() < 0.25 ? 8 * unit : 0);
    }
  }

  /** Sky, stars, sun and skyline — everything above the horizon. Screen space (css px). */
  drawSky(ctx: CanvasRenderingContext2D, camX: number, hy: number, time: number) {
    const W = this.w;
    const H = this.h;
    const u = this.unit;
    const grd = ctx.createLinearGradient(0, hy - 720 * u, 0, hy);
    grd.addColorStop(0, '#05010f');
    grd.addColorStop(0.55, '#170536');
    grd.addColorStop(0.85, '#360a5a');
    grd.addColorStop(1, '#5a0f6e');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, Math.min(H, hy + 1));

    if (this.stars) {
      const off = -((camX * u * 0.03) % this.starW);
      const sy = hy - this.starH * 0.95;
      ctx.globalAlpha = 0.8 + Math.sin(time * 1.3) * 0.12;
      for (let x = off; x < W; x += this.starW) ctx.drawImage(this.stars, x, sy, this.starW, this.starH);
      ctx.globalAlpha = 1;
    }

    if (this.sun) {
      const S = this.sunSize;
      const sx = W * 0.7 - S / 2;
      const sy = hy - S * 0.78;
      // halo
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(sx + S / 2, sy + S / 2, S * 0.2, sx + S / 2, sy + S / 2, S * 0.95);
      halo.addColorStop(0, 'rgba(255,80,180,0.25)');
      halo.addColorStop(1, 'rgba(255,80,180,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(sx - S * 0.5, sy - S * 0.5, S * 2, S * 1.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.sun, sx, sy, S, S);
    }

    if (this.far) {
      const off = -((camX * u * 0.1) % this.farW);
      for (let x = off; x < W; x += this.farW) ctx.drawImage(this.far, x, hy - this.farH, this.farW, this.farH);
    }
    // haze between layers
    const haze = ctx.createLinearGradient(0, hy - 140 * u, 0, hy);
    haze.addColorStop(0, 'rgba(255,61,240,0)');
    haze.addColorStop(1, 'rgba(255,61,240,0.16)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, hy - 140 * u, W, 140 * u);
    if (this.near) {
      const off = -((camX * u * 0.24) % this.nearW);
      for (let x = off; x < W; x += this.nearW) ctx.drawImage(this.near, x, hy - this.nearH, this.nearW, this.nearH);
    }
  }

  /** The neon void floor below the horizon. danger 0..1 makes it flare. */
  drawFloor(ctx: CanvasRenderingContext2D, camX: number, hy: number, time: number, danger: number, k: number) {
    const W = this.w;
    const H = this.h;
    if (hy >= H) return;
    const floorH = H - hy;
    const bg = ctx.createLinearGradient(0, hy, 0, H);
    bg.addColorStop(0, '#2a0548');
    bg.addColorStop(0.25, '#12022a');
    bg.addColorStop(1, '#050010');
    ctx.fillStyle = bg;
    ctx.fillRect(0, hy, W, floorH);

    // perspective grid — single path, single stroke (gradient handles depth fade)
    const depth = Math.max(floorH, 200 * this.unit);
    const grad = ctx.createLinearGradient(0, hy, 0, hy + depth);
    grad.addColorStop(0, `rgba(255,61,240,${0.12 + danger * 0.2})`);
    grad.addColorStop(1, `rgba(255,61,240,${0.75 + danger * 0.25})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const vpX = W * 0.5;
    const sB = k * 2.2;
    const sT = k * 0.3;
    const S = 110;
    const off = camX % S;
    const bottom = hy + depth;
    const need = Math.ceil((W * 0.5) / (S * sT)) + 2;
    for (let i = -need; i <= need; i++) {
      const wx = i * S - off;
      const xt = vpX + wx * sT;
      const xb = vpX + wx * sB;
      ctx.moveTo(xt, hy);
      ctx.lineTo(xb, bottom);
    }
    const t = (time * 0.35) % 1;
    for (let i = 0; i < 11; i++) {
      const z = (i + t) / 11;
      const y = hy + depth * z * z * z;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    // horizon glow line
    ctx.globalCompositeOperation = 'lighter';
    const glowH = (26 + danger * 50) * this.unit;
    const g2 = ctx.createLinearGradient(0, hy - glowH, 0, hy + glowH * 0.6);
    g2.addColorStop(0, 'rgba(255,61,240,0)');
    g2.addColorStop(0.62, `rgba(255,61,240,${0.35 + danger * 0.4})`);
    g2.addColorStop(1, 'rgba(255,61,240,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, hy - glowH, W, glowH * 1.6);
    ctx.fillStyle = `rgba(255,190,250,${0.75 + danger * 0.25})`;
    ctx.fillRect(0, hy - 1, W, 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  drawVignette(ctx: CanvasRenderingContext2D) {
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, this.w, this.h);
  }
}
