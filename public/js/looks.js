// Character looks: body colour + face + hat, or a hand-painted 8x7 body.
//
// A look is tiny and safe to send over the network:
//   { c: 0-11, f: 0-5, h: 0-6, px?: 56 hex digits }
// Every colour comes from the fixed palette below, so a peer can never inject
// arbitrary colours, text or markup through their look. No DOM in this file
// (the server's protocol validation imports it too).

// Paint palette: index 0 is transparent. Hex digit = index.
export const PAINT = [
  null, '#0a0610', '#f4f0ff', '#e8334a', '#ff8a9a', '#3cb4e0', '#a8e8ff', '#5fd068',
  '#f5c542', '#f08a30', '#9a5ae0', '#ff6ad0', '#8a5a2e', '#9a9ab8', '#4a4a5a', '#2a8a4a',
];

// Body colours: [body, highlight] as paint indices or hex.
export const COLORS = [
  { name: 'Red', body: '#e8334a', hi: '#ff8a9a' },
  { name: 'Blue', body: '#3cb4e0', hi: '#a8e8ff' },
  { name: 'Green', body: '#4cba5a', hi: '#a0f0a0' },
  { name: 'Yellow', body: '#f5c542', hi: '#fff0a0' },
  { name: 'Orange', body: '#f08a30', hi: '#ffc080' },
  { name: 'Purple', body: '#9a5ae0', hi: '#d0a8ff' },
  { name: 'Pink', body: '#ff6ad0', hi: '#ffb8ec' },
  { name: 'Teal', body: '#2aa8a0', hi: '#80e8e0' },
  { name: 'White', body: '#d8d8e8', hi: '#ffffff' },
  { name: 'Charcoal', body: '#4a4a5a', hi: '#8a8a9a' },
  { name: 'Brown', body: '#8a5a2e', hi: '#c08a5a' },
  { name: 'Lime', body: '#b0e030', hi: '#e8ffa0' },
];

export const FACES = ['Angry', 'Happy', 'Cool', 'Surprised', 'Cyclops', 'Sleepy'];
export const HATS = ['None', 'Cap', 'Crown', 'Horns', 'Bow', 'Party hat', 'Antenna'];

const HAT_ROWS = 3; // rows above the head reserved for hats
export const SPRITE_H = 8 + HAT_ROWS;

export const DEFAULT_LOOKS = [{ c: 0, f: 0, h: 0 }, { c: 1, f: 0, h: 0 }];

const PX_RE = /^[0-9a-f]{56}$/;

function int(v, lo, hi) {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

// Rebuild a look from untrusted data; anything invalid falls back to the default.
export function cleanLook(raw, fallback = DEFAULT_LOOKS[0]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...fallback };
  const c = int(raw.c, 0, COLORS.length - 1);
  const f = int(raw.f, 0, FACES.length - 1);
  const h = int(raw.h, 0, HATS.length - 1);
  const out = { c: c ?? fallback.c, f: f ?? fallback.f, h: h ?? fallback.h };
  if (typeof raw.px === 'string' && PX_RE.test(raw.px)) out.px = raw.px;
  return out;
}

export const sameLook = (a, b) => a.c === b.c && a.f === b.f && a.h === b.h && (a.px || '') === (b.px || '');
export const lookKey = (l) => `${l.c}.${l.f}.${l.h}.${l.px || ''}`;

// ---- building the pixels ----
// Body rows 0-6 use chars: K outline, R body, H highlight, W white, . empty
const BASE = [
  '..KKKK..',
  '.KHRRRK.',
  'KRRRRRRK',
  'KRRRRRRK',
  'KRRRRRRK',
  'KRRRRRRK',
  '.KRRRRK.',
];

// [x, y, char] overlays per face
const FACE_PIXELS = [
  [[2, 3, 'W'], [3, 3, 'K'], [5, 3, 'W'], [6, 3, 'K'], [3, 5, 'K'], [4, 5, 'K'], [5, 5, 'K']], // angry
  [[2, 2, 'K'], [5, 2, 'K'], [2, 4, 'K'], [5, 4, 'K'], [3, 5, 'K'], [4, 5, 'K']], // happy
  [[1, 3, 'K'], [2, 3, 'W'], [3, 3, 'K'], [4, 3, 'K'], [5, 3, 'W'], [6, 3, 'K'], [3, 5, 'K'], [4, 5, 'K']], // cool
  [[2, 2, 'W'], [2, 3, 'K'], [5, 2, 'W'], [5, 3, 'K'], [3, 5, 'K'], [4, 5, 'K'], [3, 4, 'K'], [4, 4, 'K']], // surprised
  [[3, 2, 'W'], [4, 2, 'W'], [3, 3, 'W'], [4, 3, 'K'], [2, 5, 'K'], [3, 5, 'K'], [4, 5, 'K'], [5, 5, 'K']], // cyclops
  [[2, 3, 'K'], [3, 3, 'K'], [5, 3, 'K'], [6, 3, 'K'], [4, 5, 'K']], // sleepy
];

// Hats: rows -3..0 relative to the head (0 = top row of the head). Chars map to HAT_COLORS.
const HAT_PIXELS = [
  [],
  ['........', '........', '..CCCC..', '.CCCCCC.'], // cap (row 0 overrides the head top)
  ['........', '.Y.Y.Y..', '.YYYYY..', '.YRYYY..'].map((r) => r.replace(/R/g, 'r')), // crown
  ['........', 'W......W', 'KW....WK', '.K....K.'], // horns
  ['........', '........', '..P..P..', '..PPPP..'], // bow
  ['...Y....', '...S....', '..SPS...', '.SPSPS..'], // party hat
  ['...Y....', '...K....', '...K....', '........'], // antenna
];
const HAT_COLORS = { C: '#3060c0', Y: '#f5c542', r: '#e8334a', W: '#f4f0ff', K: '#0a0610', P: '#ff6ad0', S: '#5fd068' };

const LEGS = ['.KK..KK.', 'KK...KK.', '..KK.KK.', 'K.K..K.K'];

// Returns 5 frames (idle, run1, run2, jump, dead), each SPRITE_H rows of colour strings (null = clear).
export function lookFrames(look) {
  const L = cleanLook(look);
  const col = COLORS[L.c];
  const map = { K: PAINT[1], W: PAINT[2], R: col.body, H: col.hi };
  let body;
  if (L.px) {
    body = [];
    for (let y = 0; y < 7; y++) {
      const row = [];
      for (let x = 0; x < 8; x++) row.push(PAINT[parseInt(L.px[y * 8 + x], 16)]);
      body.push(row);
    }
  } else {
    const grid = BASE.map((r) => r.split(''));
    for (const [x, y, ch] of FACE_PIXELS[L.f]) grid[y][x] = ch;
    body = grid.map((r) => r.map((ch) => (ch === '.' ? null : map[ch])));
  }
  // hat rows (3 above the head, plus an optional override of head row 0)
  const hat = HAT_PIXELS[L.h];
  const top = [[], [], []].map(() => Array(8).fill(null));
  if (hat.length) {
    for (let y = 0; y < 3; y++) for (let x = 0; x < 8; x++) { const ch = hat[y][x]; if (ch !== '.') top[y][x] = HAT_COLORS[ch]; }
    body = body.map((r) => r.slice());
    for (let x = 0; x < 8; x++) { const ch = hat[3][x]; if (ch !== '.') body[0][x] = HAT_COLORS[ch]; }
  }
  const legs = (s) => s.split('').map((ch) => (ch === 'K' ? PAINT[1] : null));
  const frame = (i) => [...top, ...body, legs(LEGS[i])];
  const jump = [...top, ...body.slice(0, 6), body[5].map((c, x) => (x === 0 || x === 7 ? PAINT[1] : c)), legs(LEGS[3])];
  const dead = [...top, Array(8).fill(null), ...body.slice(0, 6), Array(8).fill(PAINT[1])];
  return [frame(0), frame(1), frame(2), jump, dead];
}

// Main colour of a look (for name tags and map markers).
export function lookColor(look) {
  const L = cleanLook(look);
  if (!L.px) return COLORS[L.c].body;
  const counts = new Map();
  for (const ch of L.px) if (ch !== '0' && ch !== '1' && ch !== '2') counts.set(ch, (counts.get(ch) || 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best ? PAINT[parseInt(best, 16)] : COLORS[L.c].body;
}

// The 8x7 paint grid for a preset look (to start painting from it).
export function presetToPx(look) {
  const L = cleanLook(look);
  const grid = BASE.map((r) => r.split(''));
  for (const [x, y, ch] of FACE_PIXELS[L.f]) grid[y][x] = ch;
  const nearest = (hex) => {
    // closest paint colour to a hex value
    const v = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = v(hex);
    let bi = 1, bd = Infinity;
    for (let i = 1; i < PAINT.length; i++) {
      const b = v(PAINT[i]);
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi.toString(16);
  };
  const col = COLORS[L.c];
  const map = { '.': '0', K: '1', W: '2', R: nearest(col.body), H: nearest(col.hi) };
  return grid.map((r) => r.map((ch) => map[ch]).join('')).join('');
}

export function randomLook() {
  const r = (n) => Math.floor(Math.random() * n);
  return { c: r(COLORS.length), f: r(FACES.length), h: r(HATS.length) };
}
