// ───────────────────────── World / view ─────────────────────────
export const VIEW_H = 660; // world units visible vertically at zoom 1
export const MIN_VIEW_W = 560; // minimum world units visible horizontally (portrait phones)
export const VOID_Y = 640; // the neon "void" horizon — touching below it is death
export const DEATH_Y = VOID_Y + 20;

// ───────────────────────── Physics ─────────────────────────
export const GRAVITY = 1900;
export const AIR_DRAG = 0.05; // per second
export const PLAYER_R = 13;
export const GRAPPLE_RANGE = 440;
export const MIN_ROPE = 125;
export const REEL_SPEED = 70; // rope shortens while swinging (units / s)
export const SWING_BOOST = 460; // tangential "pump" acceleration while swinging
export const MAX_SPEED = 1800;
export const OD_MAX_SPEED = 2100;
export const SUBSTEP = 1 / 240;

// ───────────────────────── Launch / intro ─────────────────────────
export const START_X = 70;
export const START_Y = 470;
export const LAUNCH_VX = 720;
export const LAUNCH_VY = -560;
export const NET_END_X = 1900; // safety net only exists in the intro zone
export const NET_Y = 604;

// ───────────────────────── Pickups / hazards ─────────────────────────
export const GEM_R = 11;
export const PICKUP_R = PLAYER_R + GEM_R + 12;
export const MAGNET_R = 180;
export const LASER_HALF_W = 4.5;
export const NEAR_MISS = 34;

// ───────────────────────── Scoring ─────────────────────────
export const METER_VALUE = 1; // points per meter (× multiplier)
export const GEM_VALUE = 10;
export const PRISM_VALUE = 50;
export const NEAR_VALUE = 25;
export const SMASH_VALUE = 40;
export const RELEASE_KICK = 70; // speed added on a forward release
export const PERFECT_MUL = 1.12;
export const COMBO_TIME = 2.8;
export const MULT_THRESHOLDS = [0, 8, 20, 36, 56, 80, 110, 145];
export const OVERDRIVE_GEMS = 25;
export const OVERDRIVE_TIME = 6.5;
export const UNITS_PER_METER = 20;
export const MILESTONE_M = 500;

// ───────────────────────── Revive (rewarded ad) ─────────────────────────
export const REVIVE_INVULN = 2.8; // seconds of shielded flight after a revive
export const REVIVE_MIN_METERS = 120; // don't offer a revive on a trivial run
export const REVIVE_COOLDOWN_MS = 75000; // space out rewarded-ad offers
export const REVIVE_CLEAR_BACK = 400; // hazard sweep behind the revive point
export const REVIVE_CLEAR_FWD = 700; // …and ahead of it

// ───────────────────────── Palette ─────────────────────────
export const COLORS = {
  cyan: '#3cf2ff',
  magenta: '#ff3df0',
  gold: '#ffd23f',
  red: '#ff2d55',
  white: '#ffffff',
  violet: '#a77bff',
  green: '#5dff9d',
  orange: '#ff8a3d',
} as const;

// Particle palette (index based for pooled particles)
export const PALETTE = [
  COLORS.cyan,
  COLORS.magenta,
  COLORS.gold,
  COLORS.red,
  COLORS.white,
  COLORS.violet,
  COLORS.green,
  COLORS.orange,
];
export const P_CYAN = 0;
export const P_MAGENTA = 1;
export const P_GOLD = 2;
export const P_RED = 3;
export const P_WHITE = 4;
export const P_VIOLET = 5;
export const P_GREEN = 6;
export const P_ORANGE = 7;
