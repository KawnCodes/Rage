// Network protocol: everything that crosses the wire is validated here.
// Used by the browser (peer-to-peer game data + signaling) and by the
// Node lobby server (signaling relay). No DOM access in this file.
//
// Rules: never trust the peer. Every message is size-limited, parsed in a
// try/catch, checked against a whitelist of types, and rebuilt field by field
// with numbers clamped to sane ranges. Unknown fields are dropped. Nothing
// received is ever passed to innerHTML / eval / URLs.

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 8192;
export const MAX_SDP_LENGTH = 16000;
export const MAX_SIGNAL_BYTES = 20000;
export const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const PRINTABLE_RE = /^[\x20-\x7E]*$/;
const SDP_RE = /^[\x20-\x7E\r\n]+$/;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function num(v, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return clamp(v, lo, hi);
}

function int(v, lo, hi) {
  const n = num(v, lo, hi);
  return n === null ? null : Math.round(n);
}

function numArray(arr, len, ranges) {
  if (!Array.isArray(arr) || arr.length !== len) return null;
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const n = num(arr[i], ranges[i][0], ranges[i][1]);
    if (n === null) return null;
    out[i] = n;
  }
  return out;
}

export function sanitizeName(s) {
  if (typeof s !== 'string') return 'PLAYER';
  const clean = s.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return clean || 'PLAYER';
}

export function encode(msg) {
  return JSON.stringify(msg);
}

const POS = [-64, 400];
const VEL = [-12, 12];
const ENT_RANGES = [[-64, 400], [-64, 400], [0, 15], [-10000, 10000], [-12, 12]];
const BOSS_RANGES = [[-64, 400], [-64, 400], [0, 15], [0, 10], [0, 100000]];
const BULLET_RANGES = [[-64, 400], [-64, 400], [-8, 8], [-8, 8], [0, 3]];

export const MAX_ENTITIES = 256;
export const MAX_BULLETS = 64;

// Returns a clean message object or null.
export function decode(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_MESSAGE_BYTES) return null;
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return null;

  switch (m.t) {
    case 'hello': {
      const v = int(m.v, 0, 1000);
      if (v === null) return null;
      return { t: 'hello', v, name: sanitizeName(m.name) };
    }
    case 'p': {
      const x = num(m.x, ...POS), y = num(m.y, ...POS);
      const vx = num(m.vx, ...VEL), vy = num(m.vy, ...VEL);
      const a = int(m.a, 0, 15), lv = int(m.lv, 0, 99), dc = int(m.dc, 0, 999999);
      if ([x, y, vx, vy, a, lv, dc].includes(null)) return null;
      return { t: 'p', x, y, vx, vy, f: m.f === -1 ? -1 : 1, a, d: m.d === 1 ? 1 : 0, lv, dc };
    }
    case 'w': {
      const lv = int(m.lv, 0, 99), q = int(m.q, 0, 1e9);
      if (lv === null || q === null) return null;
      if (!Array.isArray(m.e) || m.e.length > MAX_ENTITIES) return null;
      const e = [];
      for (const it of m.e) {
        const a = numArray(it, 5, ENT_RANGES);
        if (!a) return null;
        a[2] = Math.round(a[2]); a[3] = Math.round(a[3]);
        e.push(a);
      }
      let b = null;
      if (m.b !== null && m.b !== undefined) {
        b = numArray(m.b, 5, BOSS_RANGES);
        if (!b) return null;
        b[2] = Math.round(b[2]); b[3] = Math.round(b[3]); b[4] = Math.round(b[4]);
      }
      if (!Array.isArray(m.bu) || m.bu.length > MAX_BULLETS) return null;
      const bu = [];
      for (const it of m.bu) {
        const a = numArray(it, 5, BULLET_RANGES);
        if (!a) return null;
        a[4] = Math.round(a[4]);
        bu.push(a);
      }
      return { t: 'w', lv, q, e, b, bu };
    }
    case 'lvl': {
      const lv = int(m.lv, 0, 99);
      return lv === null ? null : { t: 'lvl', lv };
    }
    case 'ping':
    case 'pong': {
      const n = int(m.n, 0, 1e9);
      return n === null ? null : { t: m.t, n };
    }
    case 'hit':
    case 'door':
    case 'win':
    case 'bye':
      return { t: m.t };
    default:
      return null;
  }
}

// ---- Signaling (SDP / ICE relayed by the lobby server or copy-paste) ----

export function validateSdp(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_SDP_LENGTH &&
    s.startsWith('v=0') && SDP_RE.test(s);
}

function validateCandidate(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  if (typeof c.candidate !== 'string' || c.candidate.length > 1024 || !PRINTABLE_RE.test(c.candidate)) return null;
  const out = { candidate: c.candidate };
  if (c.sdpMid !== undefined && c.sdpMid !== null) {
    if (typeof c.sdpMid !== 'string' || c.sdpMid.length > 32 || !PRINTABLE_RE.test(c.sdpMid)) return null;
    out.sdpMid = c.sdpMid;
  }
  if (c.sdpMLineIndex !== undefined && c.sdpMLineIndex !== null) {
    const i = int(c.sdpMLineIndex, 0, 15);
    if (i === null) return null;
    out.sdpMLineIndex = i;
  }
  if (c.usernameFragment !== undefined && c.usernameFragment !== null) {
    if (typeof c.usernameFragment !== 'string' || c.usernameFragment.length > 256 || !PRINTABLE_RE.test(c.usernameFragment)) return null;
    out.usernameFragment = c.usernameFragment;
  }
  return out;
}

// Returns a clean signal object or null.
export function validateSignal(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  switch (s.kind) {
    case 'offer':
    case 'answer':
      return validateSdp(s.sdp) ? { kind: s.kind, sdp: s.sdp } : null;
    case 'ice': {
      const c = validateCandidate(s.c);
      return c ? { kind: 'ice', c } : null;
    }
    case 'joined':
    case 'bye':
      return { kind: s.kind };
    default:
      return null;
  }
}

// ---- Manual (serverless) connection codes ----

const MANUAL_PREFIX = 'RAGE1-';

export function encodeManual(kind, sdp) {
  if ((kind !== 'o' && kind !== 'a') || !validateSdp(sdp)) throw new Error('bad sdp');
  // SDP is validated printable ASCII, so btoa is safe.
  return MANUAL_PREFIX + btoa(JSON.stringify({ k: kind, s: sdp }));
}

export function decodeManual(code, expectKind) {
  if (typeof code !== 'string') return null;
  const c = code.replace(/\s+/g, '');
  if (!c.startsWith(MANUAL_PREFIX) || c.length > MAX_SIGNAL_BYTES * 2) return null;
  let obj;
  try { obj = JSON.parse(atob(c.slice(MANUAL_PREFIX.length))); } catch { return null; }
  if (!obj || typeof obj !== 'object' || obj.k !== expectKind || !validateSdp(obj.s)) return null;
  return obj.s;
}

// ---- Rate limiting (token bucket) ----

export class RateLimiter {
  constructor(ratePerSec, burst) {
    this.rate = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = 0;
  }
  allow(now = Date.now()) {
    if (this.last === 0) this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
