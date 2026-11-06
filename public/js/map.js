// Overworld map for picking a stage: a winding path of stage dots per world,
// a castle for the boss, and your character walking between them.
import { LEVELS, WORLDS, W, H, MULTIPLAYER_START, isBossLevel, isCoopLevel, stageLabel } from './levels.js';
import { drawText, drawTextCentered } from './font.js';
import * as S from './sprites.js';

const formatTime = (frames) => {
  const secs = Math.floor(frames / 60);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};

export class MapScreen {
  constructor() {
    this.world = 0;
    this.cursor = 0; // level index
    this.mode = 'solo'; // 'solo' | 'local'
    this.save = null;
    this.frame = 0;
    this.walk = null; // { from: {x,y}, to: {x,y}, t }
    this.bgCache = new Map();
  }

  open(save, mode, hint) {
    this.save = save;
    this.mode = mode;
    const start = Math.min(hint ?? save.unlocked, save.unlocked);
    this.jumpTo(this.firstPlayable(start));
  }

  // The latest stage you can actually play in this mode, at or before `i`.
  firstPlayable(i) {
    for (let j = i; j >= 0; j--) if (this.status(j) === 'ok') return j;
    for (let j = 0; j < LEVELS.length; j++) if (this.status(j) === 'ok') return j;
    return 0;
  }

  jumpTo(i) {
    this.cursor = i;
    this.world = LEVELS[i].world;
    this.walk = null;
  }

  maxWorld() {
    // You can look at every world up to the first one you haven't unlocked yet.
    const w = LEVELS[this.save.unlocked].world;
    return Math.min(WORLDS.length - 1, w + 1);
  }

  status(i) {
    if (i > this.save.unlocked) return 'locked';
    if (this.mode === 'local' && i < MULTIPLAYER_START) return 'solo-only';
    if (this.mode === 'solo' && isCoopLevel(i)) return 'needs-2';
    return 'ok';
  }

  cleared(i) { return !!this.save.best[i]; }

  nodes(w = this.world) {
    const wd = WORLDS[w];
    const n = wd.end - wd.start + 1;
    const out = [];
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      out.push({ i: wd.start + k, x: Math.round(40 + t * 240), y: Math.round(108 + Math.sin(k * 1.9 + w * 1.3) * 26) });
    }
    return out;
  }

  nodeOf(i) { return this.nodes(LEVELS[i].world).find((n) => n.i === i); }

  move(dir) {
    if (this.walk) return false;
    const wd = WORLDS[this.world];
    const next = this.cursor + dir;
    if (next < wd.start || next > wd.end || next > this.save.unlocked) return false;
    this.walkTo(next);
    return true;
  }

  walkTo(i) {
    const a = this.nodeOf(this.cursor), b = this.nodeOf(i);
    if (!a || !b || a === b) { this.cursor = i; return; }
    this.walk = { from: a, to: b, t: 0, steps: Math.abs(i - this.cursor) };
    this.cursor = i;
  }

  switchWorld(d) {
    const w = this.world + d;
    if (w < 0 || w > this.maxWorld()) return false;
    this.world = w;
    const wd = WORLDS[w];
    // stand on the furthest stage you've reached in that world
    let pick = wd.start;
    for (let i = wd.start; i <= wd.end; i++) if (i <= this.save.unlocked) pick = i;
    this.cursor = pick;
    this.walk = null;
    return true;
  }

  worldLocked(w = this.world) { return WORLDS[w].start > this.save.unlocked; }

  // Canvas coordinates -> what was clicked.
  hit(x, y) {
    if (x < 22 && this.world > 0) return { type: 'world', d: -1 };
    if (x > W - 22 && this.world < this.maxWorld()) return { type: 'world', d: 1 };
    for (const n of this.nodes()) {
      if (Math.abs(x - n.x) <= 11 && Math.abs(y - n.y) <= 11) return { type: 'node', i: n.i };
    }
    return null;
  }

  update() {
    this.frame++;
    if (this.walk) {
      this.walk.t += 0.08 / Math.max(1, this.walk.steps * 0.6);
      if (this.walk.t >= 1) this.walk = null;
    }
  }

  // ---------- drawing ----------
  background(w) {
    if (this.bgCache.has(w)) return this.bgCache.get(w);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const t = S.theme(WORLDS[w].start);
    x.fillStyle = t.bg[0]; x.fillRect(0, 0, W, H);
    // distant specks / stars
    for (let i = 0; i < 70; i++) {
      x.fillStyle = S.hash(i, w * 7) > 0.7 ? t.bg[2] : t.bg[1];
      x.fillRect((S.hash(i, 11 + w) * W) | 0, (S.hash(i, 23 + w) * 70) | 0, 1, 1);
    }
    // the island the path sits on
    for (let y = 58; y < H; y++) {
      const wob = Math.sin(y * 0.3 + w) * 3;
      const inset = Math.max(0, 70 - y) * 4 + 6 + wob;
      x.fillStyle = y < 62 ? t.g[3] : y < 66 ? t.g[2] : t.g[1];
      x.fillRect(Math.round(inset), y, Math.round(W - inset * 2), 1);
    }
    for (let i = 0; i < 140; i++) {
      const px = (S.hash(i, 31 + w) * W) | 0, py = 66 + ((S.hash(i, 37 + w) * (H - 66)) | 0);
      x.fillStyle = S.hash(i, 41) > 0.5 ? t.g[0] : t.g[2];
      x.fillRect(px, py, 1, 1);
    }
    this.decorate(x, w, t);
    this.bgCache.set(w, c);
    return c;
  }

  decorate(x, w, t) {
    const spots = [];
    for (let i = 0; i < 9; i++) spots.push([20 + ((S.hash(i, 50 + w) * 280) | 0), 74 + ((S.hash(i, 60 + w) * 90) | 0)]);
    const nearPath = (px, py) => this.nodes(w).some((n) => Math.abs(n.x - px) < 18 && Math.abs(n.y - py) < 16);
    for (const [px, py] of spots) {
      if (nearPath(px, py)) continue;
      switch (w) {
        case 0: // rocky spikes
          x.fillStyle = t.g[0]; x.fillRect(px, py, 7, 4);
          x.fillStyle = PALS.steel; x.fillRect(px + 1, py - 3, 1, 3); x.fillRect(px + 4, py - 4, 1, 4);
          break;
        case 1: // gears
          x.fillStyle = PALS.steel; x.fillRect(px, py, 6, 6); x.fillRect(px - 1, py + 2, 8, 2); x.fillRect(px + 2, py - 1, 2, 8);
          x.fillStyle = t.g[0]; x.fillRect(px + 2, py + 2, 2, 2);
          break;
        case 2: // trees
          x.fillStyle = '#5a3a1e'; x.fillRect(px + 2, py + 3, 2, 4);
          x.fillStyle = '#3e7a3a'; x.fillRect(px, py - 3, 6, 6);
          x.fillStyle = '#6ab45a'; x.fillRect(px + 1, py - 3, 3, 2);
          break;
        case 3: // snowy pines
          x.fillStyle = '#2a5a4a';
          for (let r = 0; r < 6; r++) x.fillRect(px + 3 - (r >> 1), py - 6 + r, 1 + (r >> 1) * 2, 1);
          x.fillStyle = '#ffffff'; x.fillRect(px + 2, py - 6, 2, 1); x.fillRect(px + 1, py - 3, 1, 1);
          x.fillStyle = '#5a3a1e'; x.fillRect(px + 2, py, 2, 2);
          break;
        case 4: // floating void rocks
          x.fillStyle = t.g[2]; x.fillRect(px, py - 10, 6, 3);
          x.fillStyle = t.g[3]; x.fillRect(px + 1, py - 10, 3, 1);
          x.fillStyle = t.g[0]; x.fillRect(px + 1, py - 7, 4, 1);
          break;
        default: // lava pools
          x.fillStyle = '#ff7a2a'; x.fillRect(px, py, 8, 3);
          x.fillStyle = '#f5c542'; x.fillRect(px + 2, py + 1, 2, 1);
      }
    }
  }

  drawCastle(ctx, x, y, cleared) {
    const t = S.theme(WORLDS[this.world].start);
    ctx.fillStyle = '#2a1c2a'; ctx.fillRect(x - 9, y - 10, 18, 14);
    ctx.fillStyle = '#7a3b3b'; ctx.fillRect(x - 8, y - 9, 16, 12);
    ctx.fillStyle = '#a8574a'; ctx.fillRect(x - 8, y - 9, 16, 1);
    for (const bx of [-8, -4, 0, 4]) { ctx.fillStyle = '#7a3b3b'; ctx.fillRect(x + bx, y - 12, 3, 3); }
    ctx.fillStyle = '#0a0610'; ctx.fillRect(x - 2, y - 2, 4, 5);
    ctx.fillStyle = t.g[3]; ctx.fillRect(x - 1, y - 18, 1, 7);
    ctx.fillStyle = cleared ? '#5fd068' : '#e8334a';
    ctx.fillRect(x, y - 18, 4, 3);
  }

  draw(ctx) {
    this.update();
    const w = this.world;
    ctx.drawImage(this.background(w), 0, 0);
    const nodes = this.nodes();

    // path dots
    for (let k = 0; k < nodes.length - 1; k++) {
      const a = nodes[k], b = nodes[k + 1];
      const done = this.cleared(a.i);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 6; d < len - 6; d += 4) {
        const px = Math.round(a.x + ((b.x - a.x) * d) / len), py = Math.round(a.y + ((b.y - a.y) * d) / len);
        ctx.fillStyle = '#0a0610'; ctx.fillRect(px, py + 1, 2, 2);
        ctx.fillStyle = done ? '#f5c542' : b.i <= this.save.unlocked ? '#e8e0f0' : '#5a4a6a';
        ctx.fillRect(px, py, 2, 2);
      }
    }

    // stage nodes
    for (const n of nodes) {
      const st = this.status(n.i);
      const done = this.cleared(n.i);
      if (isBossLevel(n.i)) {
        this.drawCastle(ctx, n.x, n.y, done);
        if (st !== 'ok') this.lockBadge(ctx, n.x, n.y + 5, st);
        continue;
      }
      const col = st === 'locked' ? '#3a3046' : st !== 'ok' ? '#7a2a3a' : done ? '#5fd068' : '#f5c542';
      ctx.fillStyle = '#0a0610'; ctx.fillRect(n.x - 6, n.y - 3, 13, 9);
      ctx.fillStyle = col; ctx.fillRect(n.x - 6, n.y - 4, 12, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(n.x - 5, n.y - 4, 10, 1);
      const label = st === 'locked' ? '' : String(LEVELS[n.i].stage + 1);
      if (label) drawTextCentered(ctx, label, n.x, n.y - 2, '#0a0610', 1, null);
      if (done) { // little flag
        ctx.fillStyle = '#e8e0f0'; ctx.fillRect(n.x + 4, n.y - 11, 1, 7);
        ctx.fillStyle = '#e8334a'; ctx.fillRect(n.x + 5, n.y - 11, 3, 2);
      }
      if (st !== 'ok') this.lockBadge(ctx, n.x, n.y - 2, st);
    }

    // the walker(s)
    let pos = this.nodeOf(this.cursor);
    if (this.walk) {
      const t = this.walk.t, e = t * t * (3 - 2 * t);
      pos = { x: this.walk.from.x + (this.walk.to.x - this.walk.from.x) * e, y: this.walk.from.y + (this.walk.to.y - this.walk.from.y) * e };
    }
    if (pos && LEVELS[this.cursor].world === w && !this.worldLocked()) {
      const bob = this.walk ? ((this.frame >> 2) & 1) : Math.round(Math.sin(this.frame * 0.1));
      const facing = this.walk && this.walk.to.x < this.walk.from.x ? -1 : 1;
      const anim = this.walk ? 1 + ((this.frame >> 3) & 1) : 0;
      const yOff = isBossLevel(this.cursor) ? 20 : 12;
      const players = this.mode === 'local' ? [0, 1] : [0];
      const looks = this.looks || [];
      players.forEach((idx, k) => {
        const off = players.length > 1 ? (k === 0 ? -5 : 5) : 0;
        S.drawPlayer(ctx, { idx, look: looks[idx], anim, f: facing, x: pos.x - 3 + off, y: pos.y - yOff - bob });
      });
    }

    // header
    drawTextCentered(ctx, `WORLD ${w + 1}`, W / 2, 6, '#f5c542', 1);
    drawTextCentered(ctx, WORLDS[w].name + (WORLDS[w].coop ? ' (CO-OP)' : ''), W / 2, 14, '#ffffff', 2);

    // world arrows
    const blink = (this.frame >> 4) & 1;
    if (w > 0) drawText(ctx, '<', 6, 88, blink ? '#f5c542' : '#ffffff', 2);
    if (w < this.maxWorld()) drawText(ctx, '>', W - 12, 88, blink ? '#f5c542' : '#ffffff', 2);

    // info box
    ctx.fillStyle = 'rgba(10,6,16,0.8)'; ctx.fillRect(60, 142, 200, 24);
    ctx.fillStyle = '#4a3566'; ctx.fillRect(60, 142, 200, 1); ctx.fillRect(60, 165, 200, 1);
    const i = this.cursor;
    const L = LEVELS[i];
    const st = this.status(i);
    const b = this.save.best[i];
    drawTextCentered(ctx, st === 'locked' ? `${stageLabel(i)}: ???` : `${stageLabel(i)}: ${L.name}`, W / 2, 146, '#ffffff', 1);
    const info = st === 'locked' ? 'LOCKED' : st === 'solo-only' ? 'SOLO ONLY: SWITCH TO SOLO' : st === 'needs-2' ? 'CO-OP ONLY: SWITCH TO LOCAL 2P'
      : b ? `BEST: ${b.deaths} DEATHS  ${formatTime(b.time)}` : 'NOT CLEARED YET';
    drawTextCentered(ctx, info, W / 2, 156, st === 'ok' ? (b ? '#5fd068' : '#c8c0d8') : '#e8334a', 1);

    if (this.worldLocked()) {
      ctx.fillStyle = 'rgba(10,6,16,0.6)'; ctx.fillRect(0, 30, W, 110);
      drawTextCentered(ctx, 'LOCKED', W / 2, 70, '#e8334a', 3);
      drawTextCentered(ctx, `BEAT WORLD ${w} TO OPEN IT`, W / 2, 92, '#ffffff', 1);
    }
  }

  lockBadge(ctx, x, y, st) {
    if (st === 'locked') {
      ctx.fillStyle = '#c8c0d8'; ctx.fillRect(x - 2, y - 1, 5, 4);
      ctx.fillStyle = '#c8c0d8'; ctx.fillRect(x - 1, y - 3, 1, 2); ctx.fillRect(x + 1, y - 3, 1, 2); ctx.fillRect(x - 1, y - 3, 3, 1);
    } else {
      drawTextCentered(ctx, st === 'needs-2' ? '2P' : '1P', x, y - 9, '#e8334a', 1);
    }
  }
}

const PALS = { steel: '#9a9ab8' };
