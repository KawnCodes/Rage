// Autosave + progress, stored in localStorage. Everything read back is
// treated as untrusted (it can be edited by hand or corrupted) and rebuilt
// field by field with clamped values, so a bad save can never break the game.
import { LEVELS, MULTIPLAYER_START } from './levels.js';

const KEY = 'rage-save-v1';
const N = LEVELS.length;

const int = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);

export function emptySave() {
  return {
    unlocked: 0, // highest stage index the player may pick
    run: null, // { mode, level, deaths: [p1, p2], time } or null
    best: Array.from({ length: N }, () => null), // { deaths, time } per stage
    totalDeaths: 0,
    wins: 0,
  };
}

export function clean(raw) {
  const s = emptySave();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
  s.unlocked = int(raw.unlocked, 0, N - 1, 0);
  s.totalDeaths = int(raw.totalDeaths, 0, 1e9, 0);
  s.wins = int(raw.wins, 0, 1e6, 0);
  const r = raw.run;
  if (r && typeof r === 'object' && (r.mode === 'solo' || r.mode === 'local')) {
    const d = Array.isArray(r.deaths) ? r.deaths : [];
    s.run = {
      mode: r.mode,
      level: int(r.level, 0, N - 1, 0),
      deaths: [int(d[0], 0, 1e9, 0), int(d[1], 0, 1e9, 0)],
      time: int(r.time, 0, 1e10, 0),
    };
    // Multiplayer runs only exist from World 2 on.
    if (s.run.mode === 'local' && s.run.level < MULTIPLAYER_START) s.run = null;
    else s.unlocked = Math.max(s.unlocked, s.run.level);
  }

  if (Array.isArray(raw.best)) {
    for (let i = 0; i < N; i++) {
      const b = raw.best[i];
      if (b && typeof b === 'object') {
        const deaths = int(b.deaths, 0, 1e9, null);
        const time = int(b.time, 1, 1e10, null);
        if (deaths !== null && time !== null) s.best[i] = { deaths, time };
      }
    }
  }
  // Saves from before World 2 existed: beating the boss means World 2 is open.
  if (s.wins > 0 || s.best[MULTIPLAYER_START - 1]) s.unlocked = Math.max(s.unlocked, MULTIPLAYER_START);
  return s;
}

export function load() {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt || txt.length > 20000) return emptySave();
    return clean(JSON.parse(txt));
  } catch {
    return emptySave();
  }
}

export function store(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); return true; } catch { return false; }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return emptySave();
}

// Record a finished stage: unlock the next one and keep personal bests.
export function recordClear(save, level, deaths, time) {
  if (level < 0 || level >= N) return;
  save.unlocked = Math.max(save.unlocked, Math.min(N - 1, level + 1));
  const b = save.best[level];
  if (!b) save.best[level] = { deaths, time };
  else save.best[level] = { deaths: Math.min(b.deaths, deaths), time: Math.min(b.time, time) };
}

export const multiplayerUnlocked = (save) => save.unlocked >= MULTIPLAYER_START;

export function formatTime(frames) {
  const secs = Math.floor(frames / 60);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}
