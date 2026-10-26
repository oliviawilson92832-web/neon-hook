export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/** Small, fast seeded PRNG */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Closest point output (avoids allocations in hot loops)
export const closest = { x: 0, y: 0 };

/** Squared distance from point to segment; sets closest.x / closest.y */
export function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  closest.x = ax + abx * t;
  closest.y = ay + aby * t;
  const dx = px - closest.x;
  const dy = py - closest.y;
  return dx * dx + dy * dy;
}

/** Format integer with thousands separators (cheap, no Intl) */
export function fmt(n: number): string {
  const s = String(Math.floor(n));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

/** In-place array compaction — keeps items where keep() is true, no allocation */
export function compact<T>(arr: T[], keep: (item: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (keep(it)) arr[j++] = it;
  }
  arr.length = j;
}
