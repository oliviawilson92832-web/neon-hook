import * as C from './constants';
import { LevelGen, difficultyAt } from './level';
import { closest, compact, mulberry32, segDistSq } from './math';
import {
  L_PULSE,
  L_ROTOR,
  L_SLIDER,
  L_SWEEP,
  type DeathCause,
  type Gem,
  type Laser,
  type Peg,
  type SimEvents,
} from './types';

/**
 * Pure game simulation (no DOM). Rendering / audio / FX react to SimEvents.
 */
export class Sim {
  pegs: Peg[] = [];
  gems: Gem[] = [];
  lasers: Laser[] = [];
  gen: LevelGen;
  events: SimEvents;

  // player
  x = C.START_X;
  y = C.START_Y;
  vx = 0;
  vy = 0;
  peg: Peg | null = null;
  lastPeg: Peg | null = null;
  ropeLen = 0;
  attachT = 0;
  held = false;
  alive = true;
  demo = false;

  // run state
  time = 0;
  maxX = C.START_X;
  points = 0;
  gemsCollected = 0;
  nearMisses = 0;
  perfects = 0;
  combo = 0;
  comboT = 0;
  mult = 1;
  maxMult = 1;
  gemStreak = 0;
  gemStreakT = 0;
  energy = 0;
  overdrive = 0;
  wallX = C.START_X - 1100;
  invuln = 0;
  revives = 0;
  nextMilestone = C.MILESTONE_M;
  grabbedOnce = false;
  releasedOnce = false;
  deathCause: DeathCause = 'void';

  constructor(events: SimEvents) {
    this.events = events;
    this.gen = new LevelGen(this.pegs, this.gems, this.lasers);
  }

  reset(seed: number, demo = false) {
    this.demo = demo;
    this.gen.reset(mulberry32(seed));
    this.x = C.START_X;
    this.y = C.START_Y;
    this.vx = 0;
    this.vy = 0;
    this.peg = null;
    this.lastPeg = null;
    this.ropeLen = 0;
    this.attachT = 0;
    this.held = false;
    this.alive = true;
    this.time = 0;
    this.maxX = C.START_X;
    this.points = 0;
    this.gemsCollected = 0;
    this.nearMisses = 0;
    this.perfects = 0;
    this.combo = 0;
    this.comboT = 0;
    this.mult = 1;
    this.maxMult = 1;
    this.gemStreak = 0;
    this.gemStreakT = 0;
    this.energy = 0;
    this.overdrive = 0;
    this.wallX = C.START_X - 1100;
    this.invuln = 0;
    this.revives = 0;
    this.nextMilestone = C.MILESTONE_M;
    this.grabbedOnce = false;
    this.releasedOnce = false;
    this.gen.ensure(this.x + 2600);
    this.updateMovers(0);
  }

  launch() {
    this.vx = C.LAUNCH_VX;
    this.vy = C.LAUNCH_VY;
  }

  get score() {
    return Math.floor(this.points);
  }
  get meters() {
    return Math.max(0, Math.floor((this.maxX - C.START_X) / C.UNITS_PER_METER));
  }
  get difficulty() {
    return difficultyAt(this.maxX);
  }
  get speed() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  /** Best peg to grapple right now (forward + upward bias) */
  findTarget(exclude: Peg | null): Peg | null {
    let best: Peg | null = null;
    let bestS = Infinity;
    const R = C.GRAPPLE_RANGE;
    const R2 = R * R;
    for (let i = 0; i < this.pegs.length; i++) {
      const p = this.pegs[i];
      if (p === exclude) continue;
      const dx = p.x - this.x;
      if (dx < -70 || dx > R) continue;
      const dy = p.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      const d = Math.sqrt(d2);
      let s = d - dx * 0.5;
      if (dy > 0) s += dy * 1.2;
      if (s < bestS) {
        bestS = s;
        best = p;
      }
    }
    return best;
  }

  /** Called on a fresh press. Returns false if nothing was in range. */
  press(): boolean {
    if (!this.alive) return false;
    if (this.peg) return true;
    const t = this.findTarget(null);
    if (t) {
      this.attach(t);
      return true;
    }
    this.events.miss();
    return false;
  }

  private attach(peg: Peg) {
    this.peg = peg;
    const dx = this.x - peg.x;
    const dy = this.y - peg.y;
    this.ropeLen = Math.max(C.MIN_ROPE, Math.sqrt(dx * dx + dy * dy));
    this.attachT = 0;
    const isNew = peg !== this.lastPeg;
    this.lastPeg = peg;
    peg.pulse = 1;
    if (isNew) {
      peg.visited = true;
      this.addCombo(1);
    }
    this.grabbedOnce = true;
    this.events.attach(peg, isNew);
  }

  release() {
    if (!this.peg) return;
    this.peg = null;
    const speed = this.speed;
    const ang = Math.atan2(-this.vy, this.vx);
    let perfect = false;
    if (this.vx > 250 && ang > 0.44 && ang < 1.13 && speed > 600 && this.attachT > 0.2) {
      perfect = true;
      this.perfects++;
      const k = (speed * C.PERFECT_MUL + C.RELEASE_KICK) / speed;
      this.vx *= k;
      this.vy *= k;
      this.addCombo(1);
    } else if (this.vx > 0 && this.vy < 0 && speed > 1) {
      const k = (speed + C.RELEASE_KICK) / speed;
      this.vx *= k;
      this.vy *= k;
    }
    this.releasedOnce = true;
    this.events.release(perfect, speed);
  }

  /**
   * Second chance after a rewarded ad: keep the score, respawn mid-air at a
   * clean spot, wipe nearby hazards and grant brief invulnerability.
   */
  revive() {
    this.alive = true;
    this.revives++;
    this.peg = null;
    this.lastPeg = null;
    this.invuln = C.REVIVE_INVULN;

    // combo/overdrive are lost — the distance and points earned are kept
    this.combo = 0;
    this.comboT = 0;
    this.mult = 1;
    this.gemStreak = 0;
    this.gemStreakT = 0;
    this.overdrive = 0;
    this.energy = 0;

    // respawn high and moving forward so there is always time to aim a grapple
    this.x = Math.max(this.x, this.maxX);
    this.y = 300;
    this.vx = 780;
    this.vy = -240;
    this.wallX = this.x - 1500;

    for (let i = 0; i < this.lasers.length; i++) {
      const L = this.lasers[i];
      if (L.maxX > this.x - C.REVIVE_CLEAR_BACK && L.minX < this.x + C.REVIVE_CLEAR_FWD) L.dead = true;
    }
    this.gen.ensure(this.x + 2600);
    this.cleanup();
    this.updateMovers(0);
  }

  update(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    this.updateMovers(dt);
    if (!this.alive) return;

    if (this.held && !this.peg) {
      const t = this.findTarget(null);
      if (t) this.attach(t);
    }

    const n = Math.max(1, Math.ceil(dt / C.SUBSTEP - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.physics(h);

    if (!this.held && this.peg && this.attachT > 0) this.release();

    this.collide(dt);
    if (!this.alive) return;
    this.progress(dt);
    this.gen.ensure(this.x + 2600);
    this.cleanup();
  }

  private physics(h: number) {
    this.vy += C.GRAVITY * h;
    const drag = 1 - C.AIR_DRAG * h;
    this.vx *= drag;
    this.vy *= drag;
    const peg = this.peg;
    if (peg) {
      this.attachT += h;
      const dx = this.x - peg.x;
      const dy = this.y - peg.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
      const nx = dx / d;
      const ny = dy / d;
      // tangential "pump" in the direction of motion keeps swings lively
      const rvx = this.vx - peg.vx;
      const rvy = this.vy - peg.vy;
      const vt = -ny * rvx + nx * rvy;
      if (d >= this.ropeLen - 2 && (vt > 40 || vt < -40)) {
        // only pump when swinging forward → natural forward flow
        const sgn = vt > 0 ? 1 : -1;
        const tx = -ny * sgn;
        if (tx > 0.05) {
          const s = C.SWING_BOOST * sgn;
          this.vx += -ny * s * h;
          this.vy += nx * s * h;
        }
      }
      this.ropeLen = Math.max(C.MIN_ROPE, this.ropeLen - C.REEL_SPEED * h);
    }

    this.x += this.vx * h;
    this.y += this.vy * h;

    if (peg) {
      const dx = this.x - peg.x;
      const dy = this.y - peg.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
      // ratchet: the line auto-retracts so it's always taut → lossless catches
      if (d < this.ropeLen) this.ropeLen = Math.max(C.MIN_ROPE, d);
      if (d > this.ropeLen) {
        const nx = dx / d;
        const ny = dy / d;
        this.x = peg.x + nx * this.ropeLen;
        this.y = peg.y + ny * this.ropeLen;
        const vr = (this.vx - peg.vx) * nx + (this.vy - peg.vy) * ny;
        if (vr > 0) {
          this.vx -= nx * vr;
          this.vy -= ny * vr;
        }
      }
    }

    const max = this.overdrive > 0 ? C.OD_MAX_SPEED : C.MAX_SPEED;
    const sp2 = this.vx * this.vx + this.vy * this.vy;
    if (sp2 > max * max) {
      const s = max / Math.sqrt(sp2);
      this.vx *= s;
      this.vy *= s;
    }
  }

  private collide(dt: number) {
    const px = this.x;
    const py = this.y;
    const od = this.overdrive > 0;

    // gems
    const pr2 = C.PICKUP_R * C.PICKUP_R;
    const mr2 = C.MAGNET_R * C.MAGNET_R;
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i];
      if (g.taken) continue;
      let dx = g.x - px;
      if (dx > 420 || dx < -420) continue;
      let dy = g.y - py;
      let d2 = dx * dx + dy * dy;
      if (od && d2 < mr2) g.magnet = true;
      if (g.magnet) {
        const d = Math.sqrt(d2) || 1;
        const pull = Math.min(d, (1000 + this.speed) * dt);
        g.x -= (dx / d) * pull;
        g.y -= (dy / d) * pull;
        g.baseY = g.y;
        dx = g.x - px;
        dy = g.y - py;
        d2 = dx * dx + dy * dy;
      }
      if (d2 < pr2) this.collectGem(g);
    }

    // lasers
    const hitR = C.PLAYER_R + C.LASER_HALF_W - 1.5;
    const nearR = C.PLAYER_R + C.NEAR_MISS;
    for (let i = 0; i < this.lasers.length; i++) {
      const L = this.lasers[i];
      if (L.dead) continue;
      if (px < L.minX - 120 || px > L.maxX + 120 || !L.active) {
        L.near = false;
        continue;
      }
      let best = Infinity;
      let bx = 0;
      let by = 0;
      for (let s = 0; s < L.segCount; s++) {
        const o = s * 4;
        const d2 = segDistSq(px, py, L.segs[o], L.segs[o + 1], L.segs[o + 2], L.segs[o + 3]);
        if (d2 < best) {
          best = d2;
          bx = closest.x;
          by = closest.y;
        }
      }
      const d = Math.sqrt(best);
      if (d < hitR) {
        if (this.invuln > 0) continue;
        if (od) {
          L.dead = true;
          const v = C.SMASH_VALUE * this.mult;
          this.points += v;
          this.addCombo(2);
          this.events.smash(bx, by, v);
          continue;
        }
        if (this.demo) continue;
        this.die('laser', bx, by);
        return;
      }
      if (d < nearR) {
        L.near = true;
        L.nearX = bx;
        L.nearY = by;
      } else if (L.near && d > nearR + 6) {
        L.near = false;
        if (L.nearCd <= 0 && !od && this.invuln <= 0) {
          L.nearCd = 1.0;
          this.nearMisses++;
          const v = C.NEAR_VALUE * this.mult;
          this.points += v;
          this.addCombo(2);
          this.events.nearMiss(L.nearX, L.nearY, v);
        }
      }
    }

    // safety net (intro zone only)
    if (!this.demo && this.x < C.NET_END_X && this.y > C.NET_Y && this.vy > 0) {
      if (this.peg) this.release();
      this.y = C.NET_Y;
      this.vy = -Math.max(980, this.vy * 0.85);
      if (this.vx < 380) this.vx = 380;
      this.events.bounce(this.x, C.NET_Y);
    }

    if (this.y > C.DEATH_Y) {
      this.die('void', this.x, C.VOID_Y);
      return;
    }
    if (!this.demo && this.invuln <= 0 && this.x - C.PLAYER_R < this.wallX) this.die('wall', this.wallX, this.y);
  }

  private collectGem(g: Gem) {
    g.taken = true;
    this.gemsCollected++;
    const od = this.overdrive > 0;
    const base = g.kind === 1 ? C.PRISM_VALUE : C.GEM_VALUE;
    this.addCombo(g.kind === 1 ? 3 : 1);
    const v = base * this.mult * (od ? 2 : 1);
    this.points += v;
    this.gemStreak++;
    this.gemStreakT = 1.3;
    if (!od) {
      this.energy += g.kind === 1 ? 3 : 1;
      if (this.energy >= C.OVERDRIVE_GEMS) {
        this.overdrive = C.OVERDRIVE_TIME;
        this.energy = C.OVERDRIVE_GEMS;
        this.events.overdrive();
      }
    }
    this.events.gem(g, v, this.gemStreak);
  }

  private addCombo(n: number) {
    this.combo += n;
    this.comboT = C.COMBO_TIME;
    const T = C.MULT_THRESHOLDS;
    let m = 1;
    for (let i = T.length - 1; i >= 0; i--) {
      if (this.combo >= T[i]) {
        m = i + 1;
        break;
      }
    }
    if (m > this.mult) {
      this.mult = m;
      if (m > this.maxMult) this.maxMult = m;
      this.events.multUp(m);
    }
  }

  private die(cause: DeathCause, x: number, y: number) {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = cause;
    this.peg = null;
    this.events.death(cause, x, y);
  }

  private progress(dt: number) {
    if (this.x > this.maxX) {
      const d = this.x - this.maxX;
      this.maxX = this.x;
      this.points += (d / C.UNITS_PER_METER) * C.METER_VALUE * this.mult;
    }
    const m = this.meters;
    if (m >= this.nextMilestone) {
      this.events.milestone(this.nextMilestone);
      this.nextMilestone += C.MILESTONE_M;
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.comboT = 0;
        if (this.mult > 1) this.events.comboLost();
        this.combo = 0;
        this.mult = 1;
      }
    }
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.gemStreakT > 0) {
      this.gemStreakT -= dt;
      if (this.gemStreakT <= 0) this.gemStreak = 0;
    }
    if (this.overdrive > 0) {
      this.overdrive -= dt;
      this.energy = (C.OVERDRIVE_GEMS * Math.max(0, this.overdrive)) / C.OVERDRIVE_TIME;
      if (this.overdrive <= 0) {
        this.overdrive = 0;
        this.energy = 0;
        this.events.overdriveEnd();
      }
    }
    if (!this.demo && this.time > 1.2) {
      const spd = 210 + 330 * this.difficulty;
      this.wallX += spd * dt;
      if (this.wallX < this.x - 1200) this.wallX = this.x - 1200;
    }
  }

  private updateMovers(dt: number) {
    const t = this.time;
    for (let i = 0; i < this.pegs.length; i++) {
      const p = this.pegs[i];
      if (p.pulse > 0) p.pulse = Math.max(0, p.pulse - dt * 3);
      if (p.moveAmp > 0) {
        const ph = t * p.moveSpeed + p.movePhase;
        p.y = p.by + Math.sin(ph) * p.moveAmp;
        p.vy = Math.cos(ph) * p.moveAmp * p.moveSpeed;
      }
    }
    for (let i = 0; i < this.lasers.length; i++) {
      const L = this.lasers[i];
      if (L.dead) continue;
      if (L.nearCd > 0) L.nearCd -= dt;
      const s = L.segs;
      switch (L.kind) {
        case L_SWEEP: {
          const cy = L.y + Math.sin(t * L.speed + L.phase) * L.amp;
          L.cx = L.x;
          L.cy = cy;
          s[0] = L.x;
          s[1] = cy - L.len;
          s[2] = L.x;
          s[3] = cy + L.len;
          L.segCount = 1;
          L.active = true;
          L.minX = L.x;
          L.maxX = L.x;
          break;
        }
        case L_SLIDER: {
          const cy = L.y + Math.sin(t * L.speed + L.phase) * L.amp;
          L.cx = L.x;
          L.cy = cy;
          s[0] = L.x - L.len;
          s[1] = cy;
          s[2] = L.x + L.len;
          s[3] = cy;
          L.segCount = 1;
          L.active = true;
          L.minX = L.x - L.len;
          L.maxX = L.x + L.len;
          break;
        }
        case L_ROTOR: {
          const a = L.phase + t * L.speed;
          L.segCount = L.arms;
          for (let k = 0; k < L.arms; k++) {
            const ang = a + (k * Math.PI) / 2;
            const c = Math.cos(ang) * L.len;
            const sn = Math.sin(ang) * L.len;
            const o = k * 4;
            s[o] = L.x - c;
            s[o + 1] = L.y - sn;
            s[o + 2] = L.x + c;
            s[o + 3] = L.y + sn;
          }
          L.cx = L.x;
          L.cy = L.y;
          L.active = true;
          L.minX = L.x - L.len;
          L.maxX = L.x + L.len;
          break;
        }
        case L_PULSE: {
          const c = ((t + L.phase) % L.period) / L.period;
          L.active = c < L.onFrac;
          L.warn = !L.active && c > 1 - 0.55 / L.period;
          s[0] = L.x;
          s[1] = L.top;
          s[2] = L.x;
          s[3] = L.bottom;
          L.segCount = 1;
          L.cx = L.x;
          L.cy = L.bottom;
          L.minX = L.x;
          L.maxX = L.x;
          break;
        }
      }
    }
  }

  private cleanup() {
    const cut = Math.max(this.wallX, this.x - 1500) - 250;
    const cur = this.peg;
    compact(this.pegs, (p) => p.x > cut || p === cur);
    compact(this.gems, (g) => !g.taken && g.x > cut);
    compact(this.lasers, (L) => !L.dead && L.maxX > cut);
  }
}
