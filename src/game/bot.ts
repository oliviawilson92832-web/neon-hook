import type { Sim } from './sim';

/**
 * Tiny autopilot used for the attract-mode demo behind the title screen.
 * Returns whether the "button" should be held this frame.
 */
export function botThink(sim: Sim): boolean {
  const p = sim.peg;
  if (!p) {
    const t = sim.findTarget(null);
    if (!t) return false;
    if (sim.y > 480) return true; // falling too low — grab anything
    const dx = t.x - sim.x;
    const dy = t.y - sim.y;
    if (dx < 30) return false;
    return (dy < -70 && sim.vy > -260) || (sim.vy > 60 && dy < 40);
  }
  if (sim.attachT > 2.4) return false;
  const ang = Math.atan2(-sim.vy, sim.vx);
  const right = sim.x > p.x + 20;
  if (right && sim.vx > 200 && sim.vy < -120 && ang > 0.45 && ang < 1.1) return false;
  return true;
}
