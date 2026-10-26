export interface ScoreEntry {
  name: string;
  score: number;
  meters: number;
  gems: number;
  date: number;
}

export interface Settings {
  sfx: boolean;
  music: boolean;
  shake: boolean;
  name: string;
}

const SCORE_KEY = 'neonhook.scores.v1';
const SETTINGS_KEY = 'neonhook.settings.v1';
export const MAX_SCORES = 10;

const DEFAULT_SETTINGS: Settings = { sfx: true, music: true, shake: true, name: 'PILOT' };

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked */
  }
}

export function sanitizeName(name: string): string {
  const clean = name
    .toUpperCase()
    .replace(/[^A-Z0-9 _\-.]/g, '')
    .trim()
    .slice(0, 10);
  return clean || 'PILOT';
}

export function loadScores(): ScoreEntry[] {
  const raw = safeGet(SCORE_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as ScoreEntry[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && typeof e.score === 'number' && typeof e.name === 'string')
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch {
    return [];
  }
}

/** Inserts a score. Returns updated list + 0-based rank (or -1 if it didn't make the table). */
export function addScore(entry: ScoreEntry): { scores: ScoreEntry[]; rank: number } {
  const scores = loadScores();
  let rank = scores.findIndex((s) => entry.score > s.score);
  if (rank === -1) rank = scores.length;
  if (rank >= MAX_SCORES || entry.score <= 0) return { scores, rank: -1 };
  scores.splice(rank, 0, entry);
  const trimmed = scores.slice(0, MAX_SCORES);
  safeSet(SCORE_KEY, JSON.stringify(trimmed));
  return { scores: trimmed, rank };
}

/**
 * Removes a single entry by its timestamp. Used when a player revives via a
 * rewarded ad: the run's score was already banked on death and must be
 * withdrawn so the continued run is recorded only once, at its true end.
 */
export function removeScore(stamp: number): ScoreEntry[] {
  const scores = loadScores().filter((s) => s.date !== stamp);
  safeSet(SCORE_KEY, JSON.stringify(scores));
  return scores;
}

export function clearScores() {
  safeSet(SCORE_KEY, '[]');
}

export function loadSettings(): Settings {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      sfx: s.sfx ?? true,
      music: s.music ?? true,
      shake: s.shake ?? true,
      name: sanitizeName(s.name ?? 'PILOT'),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  safeSet(SETTINGS_KEY, JSON.stringify(s));
}
