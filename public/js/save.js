// Autosave + progress, stored in localStorage. Everything read back is
// treated as untrusted (it can be edited by hand or corrupted) and rebuilt
// field by field with clamped values, so a bad save can never break the game.
import { LEVELS, MULTIPLAYER_START, isCoopLevel } from './levels.js';
import { sanitizeName } from './protocol.js';

const KEY = 'rage-save-v1'; // the solo profile
const TEAMS_KEY = 'rage-teams-v1'; // team profiles: { active, teams: { id: { names, save } } }
const MAX_TEAMS = 10;
const CODE_PREFIX = 'RAGESAVE1-';
const N = LEVELS.length;

const int = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);

export function emptySave() {
  return {
    unlocked: 0, // highest stage index the player may pick
    run: null, // { mode, level, deaths: [p1, p2], time } or null
    best: Array.from({ length: N }, () => null), // { deaths, time } per stage
    totalDeaths: 0,
    wins: 0,
    cheated: false,
  };
}

export function clean(raw) {
  const s = emptySave();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
  s.unlocked = int(raw.unlocked, 0, N - 1, 0);
  s.totalDeaths = int(raw.totalDeaths, 0, 1e9, 0);
  s.wins = int(raw.wins, 0, 1e6, 0);
  s.cheated = raw.cheated === true;
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
    // Co-op worlds can't be played solo.
    else if (s.run.mode === 'solo' && isCoopLevel(s.run.level)) { s.unlocked = Math.max(s.unlocked, s.run.level); s.run = null; }
    else s.unlocked = Math.max(s.unlocked, s.run.level);
  }

  if (Array.isArray(raw.best)) {
    for (let i = 0; i < N; i++) {
      const b = raw.best[i];
      if (b && typeof b === 'object') {
        // Out-of-range records are dropped, not clamped (no fake "0 deaths in 0:00").
        const ok = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
        if (ok(b.deaths, 0, 1e9) && ok(b.time, 1, 1e10)) s.best[i] = { deaths: Math.round(b.deaths), time: Math.round(b.time) };
      }
    }
  }
  // Saves from before World 2 existed: beating the boss means World 2 is open.
  if (s.wins > 0 || s.best[MULTIPLAYER_START - 1]) s.unlocked = Math.max(s.unlocked, MULTIPLAYER_START);
  return s;
}

// ---------- profiles ----------
// 'solo' is the personal save. A team profile ("ASIA & JULIAN") is a save two
// people share: it's what local co-op and online games with that partner use.

export function teamId(a, b) {
  return [sanitizeName(a), sanitizeName(b)].sort().join(' & ');
}
const TEAM_ID_RE = /^[A-Z0-9 _-]{1,12} & [A-Z0-9 _-]{1,12}$/;

function readTeams() {
  const out = { active: null, teams: {} };
  try {
    const txt = localStorage.getItem(TEAMS_KEY);
    if (!txt || txt.length > 200000) return out;
    const raw = JSON.parse(txt);
    if (!raw || typeof raw !== 'object' || !raw.teams || typeof raw.teams !== 'object') return out;
    for (const [id, t] of Object.entries(raw.teams).slice(0, MAX_TEAMS)) {
      if (!TEAM_ID_RE.test(id) || !t || typeof t !== 'object') continue;
      const names = Array.isArray(t.names) ? t.names.slice(0, 2).map(sanitizeName) : id.split(' & ');
      out.teams[id] = { names: names.length === 2 ? names : id.split(' & '), save: clean(t.save) };
    }
    if (typeof raw.active === 'string' && out.teams[raw.active]) out.active = raw.active;
  } catch { /* corrupted: start over */ }
  return out;
}

function writeTeams(t) {
  try { localStorage.setItem(TEAMS_KEY, JSON.stringify(t)); return true; } catch { return false; }
}

export function listTeams() {
  const t = readTeams();
  return Object.entries(t.teams).map(([id, v]) => ({ id, names: v.names, unlocked: v.save.unlocked }));
}

// 'solo' or a team id
export function activeProfile() {
  return readTeams().active || 'solo';
}

export function setActiveProfile(id) {
  const t = readTeams();
  t.active = id && id !== 'solo' && t.teams[id] ? id : null;
  writeTeams(t);
  return t.active || 'solo';
}

export function createTeam(a, b) {
  const id = teamId(a, b);
  const t = readTeams();
  if (!t.teams[id]) {
    if (Object.keys(t.teams).length >= MAX_TEAMS) return null;
    t.teams[id] = { names: [sanitizeName(a), sanitizeName(b)], save: emptySave() };
  }
  writeTeams(t);
  return id;
}

export function deleteTeam(id) {
  const t = readTeams();
  delete t.teams[id];
  if (t.active === id) t.active = null;
  writeTeams(t);
}

export function load(profile = activeProfile()) {
  if (profile !== 'solo') {
    const t = readTeams();
    return t.teams[profile] ? t.teams[profile].save : emptySave();
  }
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt || txt.length > 20000) return emptySave();
    return clean(JSON.parse(txt));
  } catch {
    return emptySave();
  }
}

export function store(save, profile = activeProfile()) {
  if (profile !== 'solo') {
    const t = readTeams();
    if (!t.teams[profile]) return false;
    t.teams[profile].save = save;
    const ok = writeTeams(t);
    refreshMyCode(save, profile);
    return ok;
  }
  refreshMyCode(save, profile);
  try { localStorage.setItem(KEY, JSON.stringify(save)); return true; } catch { return false; }
}

export function wipe(profile = activeProfile()) {
  if (profile !== 'solo') {
    store(emptySave(), profile);
    return emptySave();
  }
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return emptySave();
}

// Combine two saves of the same profile: furthest unlock and best records win.
export function merge(a, b) {
  const s = clean(a);
  const o = clean(b);
  s.unlocked = Math.max(s.unlocked, o.unlocked);
  s.totalDeaths = Math.max(s.totalDeaths, o.totalDeaths);
  s.wins = Math.max(s.wins, o.wins);
  s.cheated = s.cheated || o.cheated;
  for (let i = 0; i < N; i++) {
    const x = s.best[i], y = o.best[i];
    if (!x) s.best[i] = y;
    else if (y) s.best[i] = { deaths: Math.min(x.deaths, y.deaths), time: Math.min(x.time, y.time) };
  }
  return s;
}

// ---------- sharing progress ----------
// Compact form sent to an online partner (no run, just unlocks and records).
export function toWire(save) {
  return { u: save.unlocked, w: save.wins, b: save.best.map((b) => (b ? [b.deaths, b.time] : null)) };
}
export function fromWire(m) {
  return clean({ unlocked: m.u, wins: m.w, best: (m.b || []).map((b) => (b ? { deaths: b[0], time: b[1] } : null)) });
}

// ---------- codes kept on this device ----------
// Your own code per profile is refreshed every time progress is saved, so it's
// always ready to share. Codes other people send you go in an inbox to load now or later.
const MYCODES_KEY = 'rage-mycodes-v1';
const INBOX_KEY = 'rage-inbox-v1';
const INBOX_MAX = 10;

function readJson(key, fallback) {
  try {
    const txt = localStorage.getItem(key);
    if (!txt || txt.length > 100000) return fallback;
    const v = JSON.parse(txt);
    return v && typeof v === 'object' ? v : fallback;
  } catch { return fallback; }
}
function writeJson(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked */ }
}

export function myCode(profile = activeProfile()) {
  const codes = readJson(MYCODES_KEY, {});
  const c = codes[profile];
  if (typeof c === 'string' && importCode(c)) return c;
  return exportCode(load(profile), profile === 'solo' ? null : profile.split(' & '));
}

function refreshMyCode(save, profile) {
  const codes = readJson(MYCODES_KEY, {});
  codes[profile] = exportCode(save, profile === 'solo' ? null : profile.split(' & '));
  writeJson(MYCODES_KEY, codes);
}

// What a code unlocks, for showing in lists: e.g. "World 4, 4-2"
export function describeCode(code) {
  const got = importCode(code);
  if (!got) return null;
  const u = got.save.unlocked;
  return { names: got.names, unlocked: u, world: LEVELS[u].world, cleared: got.save.best.filter(Boolean).length };
}

export function inbox() {
  const list = readJson(INBOX_KEY, []);
  return Array.isArray(list)
    ? list.filter((e) => e && typeof e.code === 'string' && importCode(e.code)).slice(0, INBOX_MAX)
      .map((e) => ({ id: String(e.id).slice(0, 20), from: sanitizeName(e.from), code: e.code, at: Number(e.at) || 0 }))
    : [];
}

export function addToInbox(from, code) {
  if (!importCode(code)) return null;
  const list = inbox().filter((e) => !(e.from === sanitizeName(from) && e.code === code));
  const entry = { id: Math.random().toString(36).slice(2, 10), from: sanitizeName(from), code, at: Date.now() };
  list.unshift(entry);
  writeJson(INBOX_KEY, list.slice(0, INBOX_MAX));
  return entry;
}

export function removeFromInbox(id) {
  writeJson(INBOX_KEY, inbox().filter((e) => e.id !== id));
}

// A copy/paste "progress code" to move a profile between devices.
export function exportCode(save, names) {
  const body = { n: names || null, ...toWire(save) };
  return CODE_PREFIX + btoa(JSON.stringify(body));
}

export function importCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.replace(/\s+/g, '');
  if (!c.startsWith(CODE_PREFIX) || c.length > 20000) return null;
  let raw;
  try { raw = JSON.parse(atob(c.slice(CODE_PREFIX.length))); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const names = Array.isArray(raw.n) && raw.n.length === 2 ? raw.n.map(sanitizeName) : null;
  return { names, save: fromWire(raw) };
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
