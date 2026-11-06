// All pixel art is defined in code (string sprites + procedural tiles), so
// the game ships with zero external image assets.
import { TILE, COLS, ROWS, W, H } from './levels.js';

export const PAL = {
  K: '#0a0610', W: '#f4f0ff', red: '#e8334a', yel: '#f5c542', org: '#f08a30',
  s0: '#4c4c68', s1: '#9a9ab8', s2: '#e8e8f4', cyan: '#4fc8e8', grn: '#5fd068',
};

// One colour theme per level: background shades + ground shades.
const THEMES = [
  { bg: ['#120a1a', '#1a1026', '#2a1c3a'], g: ['#2b1d3d', '#4a3566', '#6e4f8f', '#9a7bc0'] },
  { bg: ['#08141a', '#0e1e26', '#1a3440'], g: ['#13303a', '#1f4f5c', '#2f7484', '#56a8b4'] },
  { bg: ['#1a0e08', '#26160c', '#3c2416'], g: ['#3a2214', '#5e3a20', '#8a5a30', '#c08a4a'] },
  { bg: ['#0a160c', '#102214', '#1c3a22'], g: ['#16301a', '#25502a', '#3a7a3a', '#6ab45a'] },
  { bg: ['#0a0c1c', '#10142a', '#1c2446'], g: ['#1a2040', '#2a3466', '#3e4e94', '#6a7ec8'] },
  { bg: ['#1c0608', '#2a0a0e', '#46141a'], g: ['#3a0e14', '#621a22', '#8e2a30', '#c84a4a'] },
  // World 2: THE MACHINE (steel, rust and hazard orange)
  { bg: ['#0c0e12', '#14181e', '#222a34'], g: ['#1e242c', '#353f4c', '#566476', '#8a9aae'] },
  { bg: ['#120e0a', '#1c1610', '#2e2418'], g: ['#2a2018', '#4a3a28', '#6e5a3e', '#a88a5e'] },
  { bg: ['#140a0c', '#1e1014', '#30181e'], g: ['#2a1a20', '#463038', '#6a4a54', '#9a7480'] },
  { bg: ['#0a1012', '#10181c', '#1a2a30'], g: ['#18262c', '#2a4048', '#3e5e6a', '#6a94a2'] },
  { bg: ['#0a0a14', '#12121e', '#1e1e34'], g: ['#1a1a2c', '#2c2c4a', '#44446e', '#7070a8'] },
];
export const theme = (i) => THEMES[i % THEMES.length];

const BRICK = ['#3a1c22', '#7a3b3b', '#a8574a', '#d07a5a'];

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function sprite(rows, pal) {
  const c = canvas(rows[0].length, rows.length);
  const x = c.getContext('2d');
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const col = pal[row[i]];
      if (col) { x.fillStyle = col; x.fillRect(i, j, 1, 1); }
    }
  });
  return c;
}

function flip(src) {
  const c = canvas(src.width, src.height);
  const x = c.getContext('2d');
  x.translate(src.width, 0); x.scale(-1, 1); x.drawImage(src, 0, 0);
  return c;
}

const rot180 = (r) => r.slice().reverse().map((s) => [...s].reverse().join(''));
const rotCW = (r) => r[0].split('').map((_, x) => r.map((row) => row[x]).reverse().join(''));
const rotCCW = (r) => rotCW(rotCW(rotCW(r)));

export function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---- Player ----
const BODY = [
  '..KKKK..',
  '.KHRRRK.',
  'KRRRRRRK',
  'KRWKRWKK',
  'KRRRRRRK',
  'KRRKKKRK',
  '.KRRRRK.',
];
const PLAYER_FRAMES = [
  [...BODY, '.KK..KK.'],
  [...BODY, 'KK...KK.'],
  [...BODY, '..KK.KK.'],
  [...BODY.slice(0, 6), 'KRRRRRRK', 'K.K..K.K'],
  ['........', '........', '..KKKK..', '.KHRRRK.', 'KRKRRKRK', 'KRRKRRKK', 'KRKRRKRK', 'KKKKKKKK'],
];
const PLAYER_PALS = [
  { K: PAL.K, W: PAL.W, R: '#e8334a', H: '#ff8a9a' },
  { K: PAL.K, W: PAL.W, R: '#3cb4e0', H: '#a8e8ff' },
];
let playerSprites = null;
function getPlayerSprites() {
  if (!playerSprites) {
    playerSprites = PLAYER_PALS.map((pal) => PLAYER_FRAMES.map((f) => {
      const s = sprite(f, pal);
      return [s, flip(s)];
    }));
  }
  return playerSprites;
}
export const playerColor = (idx) => PLAYER_PALS[idx % 2].R;

export function drawPlayer(ctx, p) {
  const frames = getPlayerSprites()[p.idx % 2];
  const f = frames[Math.min(frames.length - 1, Math.max(0, p.anim | 0))];
  ctx.drawImage(f[p.f < 0 ? 1 : 0], Math.round(p.x) - 1, Math.round(p.y));
}

// ---- Spikes ----
const SPIKE_UP = [
  '........',
  '........',
  '........',
  '.L...L..',
  '.LD..LD.',
  'LLDDLLDD',
  'LLDDLLDD',
  'SSSSSSSS',
];
const SPIKE_PAL = { L: PAL.s2, D: PAL.s1, S: PAL.s0 };
let spikes = null;
function getSpikes() {
  if (!spikes) {
    spikes = {
      '^': sprite(SPIKE_UP, SPIKE_PAL),
      v: sprite(rot180(SPIKE_UP), SPIKE_PAL),
      '>': sprite(rotCW(SPIKE_UP), SPIKE_PAL),
      '<': sprite(rotCCW(SPIKE_UP), SPIKE_PAL),
    };
  }
  return spikes;
}

// ---- Static tiles ----
function drawGround(ctx, grid, tx, ty, t) {
  const px = tx * TILE, py = ty * TILE;
  const g = t.g;
  ctx.fillStyle = g[1]; ctx.fillRect(px, py, 8, 8);
  for (let i = 0; i < 4; i++) {
    const r = hash(tx * 7 + i, ty * 13 + i);
    const sx = (r * 8) | 0, sy = (hash(tx + i * 3, ty - i) * 8) | 0;
    ctx.fillStyle = r > 0.5 ? g[0] : g[2];
    ctx.fillRect(px + sx, py + sy, 1, 1);
  }
  const solidish = (x, y) => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
    const c = grid[y][x];
    return c === '#' || c === 'F';
  };
  if (!solidish(tx, ty - 1)) {
    ctx.fillStyle = g[3]; ctx.fillRect(px, py, 8, 1);
    ctx.fillStyle = g[2]; ctx.fillRect(px, py + 1, 8, 1);
    if (hash(tx, ty) > 0.5) ctx.fillRect(px + ((hash(ty, tx) * 7) | 0), py + 2, 1, 1);
  }
  if (!solidish(tx - 1, ty)) { ctx.fillStyle = g[2]; ctx.fillRect(px, py, 1, 8); }
  if (!solidish(tx + 1, ty)) { ctx.fillStyle = g[0]; ctx.fillRect(px + 7, py, 1, 8); }
  if (!solidish(tx, ty + 1)) { ctx.fillStyle = g[0]; ctx.fillRect(px, py + 7, 8, 1); }
}

function drawBrick(ctx, tx, ty) {
  const px = tx * TILE, py = ty * TILE;
  ctx.fillStyle = BRICK[1]; ctx.fillRect(px, py, 8, 8);
  ctx.fillStyle = BRICK[2]; ctx.fillRect(px, py, 8, 1); ctx.fillRect(px, py + 4, 8, 1);
  ctx.fillStyle = BRICK[0];
  ctx.fillRect(px, py + 3, 8, 1); ctx.fillRect(px, py + 7, 8, 1);
  const o = ty % 2 ? 2 : 6;
  ctx.fillRect(px + o, py, 1, 3); ctx.fillRect(px + ((o + 4) % 8), py + 4, 1, 3);
}

// Pre-render background + all static tiles of a level into one canvas.
export function renderLevelCanvas(grid, levelIndex) {
  const t = theme(levelIndex);
  const c = canvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = t.bg[0]; x.fillRect(0, 0, W, H);
  // faint background brickwork
  x.fillStyle = t.bg[1];
  for (let y = 0; y < H; y += 8) {
    x.fillRect(0, y, W, 1);
    for (let i = ((y / 8) % 2) * 8; i < W; i += 16) x.fillRect(i, y, 1, 8);
  }
  // dust specks
  for (let i = 0; i < 90; i++) {
    x.fillStyle = hash(i, 99) > 0.6 ? t.bg[2] : t.bg[1];
    x.fillRect((hash(i, 1) * W) | 0, (hash(i, 2) * H) | 0, 1, 1);
  }
  const sp = getSpikes();
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const ch = grid[ty][tx];
      if (ch === '#' || ch === 'F') drawGround(x, grid, tx, ty, t);
      else if (ch === '=') drawBrick(x, tx, ty);
      else if (sp[ch]) x.drawImage(sp[ch], tx * TILE, ty * TILE);
    }
  }
  return c;
}

export function drawRevealed(ctx, tx, ty, levelIndex) {
  const g = theme(levelIndex).g;
  const px = tx * TILE, py = ty * TILE;
  ctx.fillStyle = g[0]; ctx.fillRect(px, py, 8, 8);
  ctx.fillStyle = g[3];
  for (let i = 0; i < 8; i += 2) {
    ctx.fillRect(px + i, py, 1, 1); ctx.fillRect(px + i + 1, py + 7, 1, 1);
    ctx.fillRect(px, py + i + 1, 1, 1); ctx.fillRect(px + 7, py + i, 1, 1);
  }
  ctx.fillRect(px + 3, py + 2, 2, 1); ctx.fillRect(px + 4, py + 3, 1, 1); ctx.fillRect(px + 3, py + 5, 1, 1);
}

// ---- Entities ----
const SAW_A = ['...SS...', '.SLLLLS.', '.LLDDLL.', 'SLDRRDLS', 'SLDRRDLS', '.LLDDLL.', '.SLLLLS.', '...SS...'];
const SAW_B = ['S......S', '.LLLLLL.', '.LLDDLL.', '.LDRRDL.', '.LDRRDL.', '.LLDDLL.', '.LLLLLL.', 'S......S'];
const DOOR = [
  '.KKKKKK.', 'KOOOOOOK', 'KONNNNOK', 'KONWWNOK', 'KONNNNOK', 'KONNNYOK',
  'KONNNNOK', 'KONNNNOK', 'KONWWNOK', 'KONNNNOK', 'KONNNNOK', 'KKKKKKKK',
];
let ent = null;
function getEnt() {
  if (!ent) {
    const sawPal = { S: PAL.s1, L: PAL.s2, D: PAL.s0, R: PAL.red };
    ent = {
      saw: [sprite(SAW_A, sawPal), sprite(SAW_B, sawPal)],
      door: sprite(DOOR, { K: PAL.K, O: '#c08a3a', N: '#6a3e1e', W: '#8a5a2e', Y: PAL.yel }),
      spikeUp: getSpikes()['^'],
      spikeDown: getSpikes().v,
    };
  }
  return ent;
}

export function drawEntity(ctx, e, frame, levelIndex) {
  const E = getEnt();
  const x = Math.round(e.x), y = Math.round(e.y);
  switch (e.type) {
    case 'crumble': {
      if (e.s >= 3) return;
      const g = theme(levelIndex).g;
      const sx = e.s === 1 ? (frame % 4 < 2 ? -1 : 1) : 0;
      ctx.fillStyle = g[2]; ctx.fillRect(x + sx, y, 8, 8);
      ctx.fillStyle = g[3]; ctx.fillRect(x + sx, y, 8, 1);
      ctx.fillStyle = g[0];
      ctx.fillRect(x + sx + 2, y + 2, 1, 3); ctx.fillRect(x + sx + 3, y + 4, 2, 1);
      ctx.fillRect(x + sx + 5, y + 5, 1, 2); ctx.fillRect(x + sx, y + 7, 8, 1);
      return;
    }
    case 'hspike': {
      if (e.s === 0) return;
      const hh = e.s === 2 ? 5 : Math.min(5, e.k + 1);
      ctx.drawImage(E.spikeUp, 0, 3, 8, hh, x, y + 8 - hh, 8, hh);
      return;
    }
    case 'fblock': {
      const sx = e.s === 1 ? (frame % 2 ? 1 : -1) : 0;
      ctx.fillStyle = PAL.s0; ctx.fillRect(x + sx, y, 8, 8);
      ctx.fillStyle = PAL.s1; ctx.fillRect(x + sx + 1, y + 1, 6, 6);
      ctx.fillStyle = PAL.s2; ctx.fillRect(x + sx + 1, y + 1, 6, 1);
      ctx.fillStyle = PAL.s0;
      ctx.fillRect(x + sx + 2, y + 3, 1, 1); ctx.fillRect(x + sx + 5, y + 3, 1, 1);
      ctx.fillRect(x + sx + 2, y + 5, 4, 1);
      return;
    }
    case 'fspike': {
      if (e.s >= 4) return;
      const sx = e.s === 1 ? (frame % 2 ? 1 : -1) : 0;
      ctx.drawImage(E.spikeDown, x + sx, y);
      return;
    }
    case 'saw':
    case 'vsaw':
      ctx.drawImage(E.saw[(frame >> 2) & 1], x, y);
      return;
    case 'spring': {
      const plate = e.k > 6 ? y + 1 : e.k > 0 ? y + 5 : y + 4;
      ctx.fillStyle = PAL.s1;
      for (let yy = plate + 1; yy < y + 7; yy++) ctx.fillRect(x + ((yy % 2) ? 2 : 4), yy, 2, 1);
      ctx.fillStyle = PAL.org; ctx.fillRect(x, plate, 8, 1);
      ctx.fillStyle = PAL.yel; ctx.fillRect(x + 1, plate, 6, 1);
      ctx.fillStyle = PAL.s0; ctx.fillRect(x, y + 7, 8, 1);
      return;
    }
    case 'door':
    case 'rdoor':
      ctx.drawImage(E.door, x, y - 4);
      return;
    case 'toggle':
      drawToggle(ctx, e, frame);
      return;
    case 'laser':
      drawLaser(ctx, e, frame);
      return;
    case 'fdoor':
      ctx.drawImage(E.door, x, y - 4);
      if (e.s === 1) {
        ctx.fillStyle = PAL.s2;
        for (let i = -1; i < 10; i += 2) { ctx.fillRect(x - 2, y - 4 + i, 2, 1); ctx.fillRect(x + 8, y - 4 + i, 2, 1); }
        ctx.fillRect(x + 1, y - 7, 1, 3); ctx.fillRect(x + 4, y - 8, 1, 4); ctx.fillRect(x + 6, y - 7, 1, 3);
      }
      return;
    default:
  }
}

// ---- World 2 tiles ----
export function drawConveyor(ctx, tx, ty, dir, frame) {
  const px = tx * TILE, py = ty * TILE;
  ctx.fillStyle = '#2a2e36'; ctx.fillRect(px, py, 8, 8);
  ctx.fillStyle = '#4a505c'; ctx.fillRect(px, py, 8, 2);
  ctx.fillStyle = '#16181e'; ctx.fillRect(px, py + 7, 8, 1);
  // moving chevrons on the belt surface
  const off = ((frame >> 2) * dir) & 7;
  ctx.fillStyle = PAL.yel;
  for (let i = -8; i < 16; i += 4) {
    const x = px + ((i + off) & 7);
    ctx.fillRect(x, py, 1, 1);
    ctx.fillRect(x + (dir > 0 ? 1 : -1), py + 1, 1, 1);
  }
  ctx.fillStyle = '#6a7080';
  ctx.fillRect(px + 2, py + 4, 1, 1); ctx.fillRect(px + 5, py + 4, 1, 1);
}

function drawToggle(ctx, e, frame) {
  const x = Math.round(e.x), y = Math.round(e.y);
  const col = e.g === 0 ? [PAL.org, '#ffb070', '#8a4410'] : [PAL.cyan, '#a8e8ff', '#1a5a78'];
  if (e.s === 2 || (e.s === 1 && frame % 8 < 4)) {
    ctx.fillStyle = col[2];
    for (let i = 0; i < 8; i += 2) { ctx.fillRect(x + i, y, 1, 1); ctx.fillRect(x + i + 1, y + 7, 1, 1); ctx.fillRect(x, y + i + 1, 1, 1); ctx.fillRect(x + 7, y + i, 1, 1); }
    return;
  }
  ctx.fillStyle = col[2]; ctx.fillRect(x, y, 8, 8);
  ctx.fillStyle = col[0]; ctx.fillRect(x + 1, y + 1, 6, 6);
  ctx.fillStyle = col[1]; ctx.fillRect(x + 1, y + 1, 6, 1);
  ctx.fillStyle = col[2];
  if (e.g === 0) { ctx.fillRect(x + 3, y + 3, 2, 2); } else { ctx.fillRect(x + 2, y + 4, 4, 1); }
}

function drawLaser(ctx, e, frame) {
  const x = Math.round(e.x), y = Math.round(e.y);
  ctx.fillStyle = PAL.s0; ctx.fillRect(x, y, 8, 6);
  ctx.fillStyle = PAL.s1; ctx.fillRect(x, y, 8, 1);
  ctx.fillStyle = e.s === 0 ? '#5a1a20' : PAL.red; ctx.fillRect(x + 2, y + 5, 4, 3);
  if (e.s === 1 && frame % 6 < 3) {
    ctx.fillStyle = 'rgba(232,51,74,0.5)';
    ctx.fillRect(x + 3, y + 8, 2, e.len);
  } else if (e.s === 2) {
    ctx.fillStyle = PAL.red; ctx.fillRect(x + 2, y + 8, 4, e.len);
    ctx.fillStyle = frame % 4 < 2 ? '#ffd0d8' : PAL.W; ctx.fillRect(x + 3, y + 8, 2, e.len);
    ctx.fillStyle = PAL.yel; ctx.fillRect(x + 1 + (frame % 3) * 2, y + 8 + e.len - 2, 2, 2);
  }
}

// ---- Boss (24x24, procedural) ----
let bossFrames = null;
const BOSS_COLORS = [
  { body: '#8a2a9a', dark: '#5a1468', lite: '#c05ad0', eye: PAL.red }, // The Grudge
  { body: '#3a6a8a', dark: '#1e3a52', lite: '#7ac0e0', eye: PAL.yel }, // The Overclock
];
function makeBoss(variant, kind) {
  const c = canvas(24, 24);
  const x = c.getContext('2d');
  const C = BOSS_COLORS[kind];
  const body = variant === 'flash' ? '#ffffff' : variant === 'rage' ? '#c0283a' : C.body;
  const dark = variant === 'flash' ? '#d0d0e0' : variant === 'rage' ? '#7a1020' : C.dark;
  const lite = variant === 'flash' ? '#ffffff' : variant === 'rage' ? '#ff6a6a' : C.lite;
  const inside = (i, j) => {
    const dx = (i + 0.5 - 12) / 11.5, dy = (j + 0.5 - 13.5) / 10.5;
    return dx * dx + dy * dy <= 1;
  };
  for (let j = 0; j < 24; j++) {
    for (let i = 0; i < 24; i++) {
      if (!inside(i, j)) continue;
      const edge = !inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1);
      x.fillStyle = edge ? PAL.K : j > 18 ? dark : j < 7 ? lite : body;
      x.fillRect(i, j, 1, 1);
    }
  }
  if (kind === 1) {
    // antenna + bolts instead of horns
    x.fillStyle = PAL.K; x.fillRect(11, 0, 2, 4);
    x.fillStyle = PAL.yel; x.fillRect(11, 0, 2, 1);
    x.fillStyle = PAL.s1; x.fillRect(1, 13, 2, 2); x.fillRect(21, 13, 2, 2);
  } else {
    x.fillStyle = PAL.K;
    x.fillRect(3, 1, 2, 4); x.fillRect(19, 1, 2, 4);
    x.fillStyle = '#e8e0c8';
    x.fillRect(3, 0, 1, 3); x.fillRect(20, 0, 1, 3);
  }
  if (variant === 'dizzy') {
    x.fillStyle = PAL.K;
    for (const ox of [6, 14]) {
      x.fillRect(ox, 9, 1, 1); x.fillRect(ox + 1, 10, 1, 1); x.fillRect(ox + 2, 11, 1, 1);
      x.fillRect(ox + 2, 9, 1, 1); x.fillRect(ox, 11, 1, 1);
    }
    x.fillRect(8, 17, 2, 1); x.fillRect(10, 16, 2, 1); x.fillRect(12, 17, 2, 1); x.fillRect(14, 16, 2, 1);
  } else {
    x.fillStyle = PAL.W; x.fillRect(5, 9, 5, 3); x.fillRect(14, 9, 5, 3);
    x.fillStyle = variant === 'rage' ? PAL.yel : C.eye; x.fillRect(7, 10, 2, 2); x.fillRect(15, 10, 2, 2);
    x.fillStyle = PAL.K;
    x.fillRect(4, 7, 2, 1); x.fillRect(6, 8, 3, 1); x.fillRect(18, 7, 2, 1); x.fillRect(15, 8, 3, 1);
    x.fillRect(6, 15, 12, 5);
    x.fillStyle = PAL.W;
    for (let i = 7; i < 17; i += 2) { x.fillRect(i, 15, 1, 2); x.fillRect(i + 1, 18, 1, 2); }
  }
  return c;
}
function getBoss(kind) {
  if (!bossFrames) bossFrames = [];
  const k = kind === 1 ? 1 : 0;
  if (!bossFrames[k]) {
    bossFrames[k] = { normal: makeBoss('normal', k), flash: makeBoss('flash', k), rage: makeBoss('rage', k), dizzy: makeBoss('dizzy', k) };
  }
  return bossFrames[k];
}

export function drawBoss(ctx, b, frame) {
  const B = getBoss(b.kind);
  let img = B.normal, sx = 0;
  if (b.hurt > 0 && frame % 4 < 2) img = B.flash;
  else if (b.s === 2) { img = B.rage; sx = frame % 2 ? 1 : -1; }
  else if (b.s === 3) img = B.rage;
  else if (b.s === 4) img = B.dizzy;
  const x = Math.round(b.x) + sx, y = Math.round(b.y);
  ctx.drawImage(img, x, y);
  if (b.s === 4) {
    // glowing weak spot + dizzy stars
    ctx.fillStyle = frame % 16 < 8 ? PAL.yel : PAL.org;
    ctx.fillRect(x + 8, y + 2, 8, 2);
    for (let i = 0; i < 3; i++) {
      const a = frame * 0.12 + i * 2.1;
      ctx.fillStyle = PAL.yel;
      ctx.fillRect(Math.round(x + 12 + Math.cos(a) * 10), Math.round(y - 4 + Math.sin(a) * 3), 1, 1);
    }
  }
}

export function drawBullet(ctx, b, frame) {
  const x = Math.round(b.x), y = Math.round(b.y);
  if (b.kind === 2) {
    ctx.fillStyle = PAL.s2; ctx.fillRect(x, y, 3, 3);
    ctx.fillStyle = PAL.s1; ctx.fillRect(x + 1, y + 3, 1, 2);
  } else if (b.kind === 1) {
    ctx.fillStyle = frame % 4 < 2 ? PAL.org : PAL.yel;
    ctx.fillRect(x, y + 2, 5, 4); ctx.fillRect(x + 1, y, 3, 2);
  } else {
    ctx.fillStyle = frame % 4 < 2 ? PAL.red : PAL.W;
    ctx.fillRect(x, y, 3, 3);
  }
}
