// Core game simulation + rendering.
//
// Modes:
//   solo  - one local player, authoritative
//   local - two local players (same keyboard / controllers), authoritative
//   host  - online host: local player 0, remote player 1, authoritative
//   guest - online guest: local player 1, remote player 0. Traps/boss state
//           come from the host's snapshots; the guest only predicts motion.
import { LEVELS, WORLDS, isBossLevel, isLastWorld, stageLabel, TILE, COLS, ROWS, W, H } from './levels.js';
import { drawText, drawTextCentered, textWidth } from './font.js';
import * as S from './sprites.js';
import { sfx } from './audio.js';
import { MAX_BULLETS } from './protocol.js';

const GRAV = 0.22, MAX_FALL = 4.5, RUN = 1.5;
const JUMP_V = -3.6, SPRING_V = -5.6, SPRING_HELD_V = -6.5, STOMP_V = -4.2;
const COYOTE = 6, BUFFER = 7, RESPAWN = 45;
const CONVEYOR_SPEED = 0.7;
const TOGGLE_PERIOD = 240; // on/off blocks: A solid [0,140), B solid [120,260) -> 20-frame overlaps
const LASER_PERIOD = 160; // off 80, warning 30, firing 50
const GATE_DELAY = 30; // frames a gate stays open after its plate is released
const TAUNTS = ['SKILL ISSUE', 'LOL', 'TRY AGAIN', 'SO CLOSE', 'BREATHE', 'RAGE QUIT?', 'OOPS', 'NOT LIKE THIS',
  'AGAIN?', 'WOW', 'CLASSIC', 'YOU GOT THIS (NO)', 'HAHA', 'UNLUCKY', 'TOTALLY FAIR'];

const ENTITY_CHARS = { C: 'crumble', H: 'hspike', X: 'fblock', V: 'fspike', S: 'saw', Z: 'vsaw', J: 'spring', D: 'door', M: 'rdoor', Q: 'fdoor', O: 'toggle', o: 'toggle', L: 'laser', l: 'laser', K: 'plate', k: 'plate', G: 'gate', g: 'gate' };
const isSolidTile = (c) => c === '#' || c === '=' || c === 'I' || c === '{' || c === '}';
const rect = (x, y, w, h) => ({ x, y, w, h });
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

class Player {
  constructor(idx, name) {
    this.idx = idx;
    this.name = name;
    this.w = 6; this.h = 8;
    this.deaths = 0;
    this.present = true;
    this.synced = false; // remote players: have we received a state for this level?
    this.reset(0, 0);
  }
  reset(x, y) {
    this.x = x; this.y = y; this.tx = x; this.ty = y;
    this.vx = 0; this.vy = 0; this.f = 1;
    this.onGround = false; this.coyote = 0; this.buffer = 0; this.canCut = false;
    this.dead = false; this.deadT = 0; this.anim = 0; this.animT = 0;
    this.prevBottom = y + this.h;
  }
  get rect() { return rect(this.x, this.y, this.w, this.h); }
}

export class World {
  constructor({ mode, names = [], onEvent, startLevel = 0, deaths = [0, 0], time = 0 }) {
    this.mode = mode;
    this.auth = mode !== 'guest';
    this.onEvent = onEvent || (() => {});
    const count = mode === 'solo' ? 1 : 2;
    this.players = [];
    for (let i = 0; i < count; i++) {
      const p = new Player(i, names[i] || `P${i + 1}`);
      p.deaths = deaths[i] || 0;
      this.players.push(p);
    }
    this.localIdx = mode === 'guest' ? [1] : mode === 'host' ? [0] : mode === 'local' ? [0, 1] : [0];
    this.particles = [];
    this.bullets = [];
    this.frame = 0;
    this.time = time;
    this.shake = 0;
    this.taunt = null;
    this.trans = null;
    this.won = false;
    this.snapSeq = 0;
    this.lastSnapSeq = -1;
    this.mismatch = 0;
    this.loadLevel(LEVELS[startLevel] ? startLevel : 0);
  }

  localDeaths() {
    return this.players.filter((p) => this.isLocal(p)).reduce((a, p) => a + p.deaths, 0);
  }

  isLocal(p) { return this.localIdx.includes(p.idx); }
  activePlayers() { return this.players.filter((p) => p.present); }
  alivePlayers() { return this.players.filter((p) => p.present && !p.dead && (this.isLocal(p) || p.synced)); }

  // ---------- level setup ----------
  loadLevel(n) {
    const L = LEVELS[n];
    if (!L) return;
    this.levelIndex = n;
    this.level = L;
    this.spawns = [null, null];
    this.grid = L.rows.map((row, y) => row.split('').map((c, x) => {
      if (c === 'P') { this.spawns[0] = { x, y }; return ' '; }
      if (c === 'p') { this.spawns[1] = { x, y }; return ' '; }
      if (ENTITY_CHARS[c] || c === 'N' || c === 'B') return ' ';
      return c;
    }));
    if (!this.spawns[1]) this.spawns[1] = { x: this.spawns[0].x + 1, y: this.spawns[0].y };
    this.revealed = new Set();
    this.worldClear = null;
    this.conveyors = [];
    this.grid.forEach((row, y) => row.forEach((c, x) => { if (c === '{' || c === '}') this.conveyors.push({ x, y, dir: c === '}' ? 1 : -1 }); }));
    this.levelCanvas = typeof document !== 'undefined' ? S.renderLevelCanvas(this.grid, n) : null;
    this.resetTraps();
    for (const p of this.players) {
      this.spawnPlayer(p);
      if (!this.isLocal(p)) p.synced = false;
    }
    this.levelDone = false;
    this.levelStartTime = this.time;
    this.levelStartDeaths = this.localDeaths();
    this.banner = 110;
    this.particles = [];
    this.lastSnapSeq = -1;
    this.mismatch = 0;
  }

  parseEntities() {
    const rows = this.level.rows;
    const ents = [];
    let target = null;
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'N') target = { x: x * TILE, y: y * TILE }; }));
    let id = 0;
    let boss = null;
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      const type = ENTITY_CHARS[c];
      if (type) {
        const e = { id: id++, type, x: x * TILE, y: y * TILE, ox: x * TILE, oy: y * TILE, s: 0, k: 0, v: 0 };
        if (type === 'saw' || type === 'vsaw') e.v = 1;
        if (type === 'rdoor') { e.tx = target ? target.x : e.x; e.ty = target ? target.y : e.y; }
        if (type === 'toggle') e.g = c === 'O' ? 0 : 1;
        if (type === 'plate' || type === 'gate') e.ch = c === 'K' || c === 'G' ? 0 : 1;
        if (type === 'laser') {
          e.off = c === 'L' ? 0 : LASER_PERIOD / 2;
          let len = 0;
          while (y + 1 + len < ROWS && !isSolidTile(rows[y + 1 + len][x])) len++;
          e.len = len * TILE;
        }
        ents.push(e);
      }
      if (c === 'B') {
        const cfg = this.level.boss || { kind: 0, hp: 4 };
        boss = { x: x * TILE, y: -30, s: 0, hp: cfg.hp, maxHp: cfg.hp, kind: cfg.kind, shield: !!cfg.shield, k: 0, vy: 0, hurt: 0, cool: 60 };
      }
    }));
    return { ents, boss };
  }

  resetTraps() {
    const { ents, boss } = this.parseEntities();
    this.entities = ents;
    this.boss = boss;
    this.bullets = [];
    this.resetPending = false;
    this.clock = 0;
    this.updateTimers(true);
  }

  spawnPlayer(p) {
    const s = this.spawns[p.idx] || this.spawns[0];
    p.reset(s.x * TILE + 1, s.y * TILE);
  }

  // ---------- collision helpers ----------
  tileAt(px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (tx < 0 || tx >= COLS || ty < 0) return '#';
    if (ty >= ROWS) return ' ';
    return this.grid[ty][tx];
  }
  tileSolidAt(px, py) { return isSolidTile(this.tileAt(px, py)); }

  entSolid(e) {
    if (e.type === 'crumble' && e.s < 2) return rect(e.ox, e.oy, 8, 8);
    if (e.type === 'fblock' && e.s === 3) return rect(e.x, e.y, 8, 8);
    if (e.type === 'toggle' && e.s < 2) return rect(e.x, e.y, 8, 8);
    if (e.type === 'gate' && e.s === 0) return rect(e.x, e.y, 8, 8);
    return null;
  }

  collides(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || tx >= COLS || ty < 0) return true;
        if (ty >= ROWS) continue;
        if (isSolidTile(this.grid[ty][tx])) return true;
      }
    }
    const me = rect(x, y, w, h);
    for (const e of this.entities) {
      const r = this.entSolid(e);
      if (r && overlap(me, r)) return true;
    }
    return false;
  }

  revealAround(p, dx, dy) {
    const probe = dy < 0 ? [p.y - 1] : dy > 0 ? [p.y + p.h] : [p.y, p.y + p.h - 1];
    const xs = dx < 0 ? [p.x - 1] : dx > 0 ? [p.x + p.w] : [p.x, p.x + p.w - 0.001];
    for (const py of probe) {
      for (const px of xs) {
        const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
        if (ty >= 0 && ty < ROWS && tx >= 0 && tx < COLS && this.grid[ty][tx] === 'I') {
          const key = ty * COLS + tx;
          if (!this.revealed.has(key)) {
            this.revealed.add(key);
            this.burst(tx * TILE + 4, ty * TILE + 4, '#ffffff', 6);
          }
        }
      }
    }
  }

  moveX(p, dx) {
    let rem = dx;
    while (rem !== 0) {
      const step = Math.abs(rem) > 1 ? Math.sign(rem) : rem;
      if (this.collides(p.x + step, p.y, p.w, p.h)) {
        const snap = step > 0 ? Math.floor((p.x + p.w + step) / TILE) * TILE - p.w : Math.ceil((p.x + step) / TILE) * TILE;
        if ((step > 0 ? snap > p.x : snap < p.x) && !this.collides(snap, p.y, p.w, p.h)) p.x = snap;
        this.revealAround(p, Math.sign(step), 0);
        p.vx = 0;
        return true;
      }
      p.x += step; rem -= step;
    }
    return false;
  }

  // Players can stand on each other's heads (one-way, from above).
  playerBelow(p, step) {
    for (const o of this.players) {
      if (o === p || !o.present || o.dead || (!this.isLocal(o) && !o.synced)) continue;
      if (p.x + p.w > o.x + 1 && p.x < o.x + o.w - 1 && p.y + p.h <= o.y + 0.5 && p.y + p.h + step > o.y) return o;
    }
    return null;
  }

  moveY(p, dy) {
    let rem = dy;
    while (rem !== 0) {
      const step = Math.abs(rem) > 1 ? Math.sign(rem) : rem;
      if (step > 0 && p.idx !== undefined) {
        const o = this.playerBelow(p, step);
        if (o) { p.y = o.y - p.h; p.onGround = true; p.standOn = o; p.vy = 0; return true; }
      }
      if (this.collides(p.x, p.y + step, p.w, p.h)) {
        const snap = step > 0 ? Math.floor((p.y + p.h + step) / TILE) * TILE - p.h : Math.ceil((p.y + step) / TILE) * TILE;
        if ((step > 0 ? snap > p.y : snap < p.y) && !this.collides(p.x, snap, p.w, p.h)) p.y = snap;
        if (step > 0) p.onGround = true;
        else if (p.vy < -0.5) sfx('bonk');
        this.revealAround(p, 0, Math.sign(step));
        p.vy = 0;
        return true;
      }
      p.y += step; rem -= step;
    }
    return false;
  }

  // ---------- update ----------
  // inputs: array indexed by player idx for local players
  update(inputs) {
    this.frame++;
    if (this.shake > 0) this.shake--;
    if (this.taunt && --this.taunt.t <= 0) this.taunt = null;
    if (this.cheer > 0) this.cheer--;
    if (this.banner > 0) this.banner--;
    this.updateParticles();

    if (this.trans) {
      this.trans.t++;
      if (this.trans.t === 20) {
        this.loadLevel(this.trans.next);
        this.onEvent('level-loaded', this.levelIndex);
      }
      if (this.trans.t >= 40) this.trans = null;
      return;
    }
    if (this.won) return;
    this.time++;

    for (const p of this.players) {
      if (!p.present) continue;
      if (this.isLocal(p)) this.updatePlayer(p, inputs[p.idx] || {});
      else this.updateRemote(p);
    }
    this.updateEntities();
    this.updateBoss();
    this.updateBullets();
    if (this.level.coop) this.checkCoopDoor();
  }

  // Co-op stages only finish when every player is standing at the exit.
  checkCoopDoor() {
    const doors = this.doorRects();
    const ps = this.activePlayers();
    this.atDoor = ps.filter((p) => !p.dead && (this.isLocal(p) || p.synced) && doors.some((d) => overlap(p.rect, d)));
    if (this.auth && !this.levelDone && ps.length >= 2 && this.atDoor.length === ps.length) this.completeLevel();
  }

  updatePlayer(p, inp) {
    if (p.dead) {
      if (--p.deadT <= 0) this.respawn(p);
      return;
    }
    if (this.collides(p.x, p.y, p.w, p.h)) { this.kill(p); return; } // a block appeared on top of you
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const target = dir * RUN;
    const acc = p.onGround ? 0.3 : 0.18;
    if (p.vx < target) p.vx = Math.min(target, p.vx + acc);
    else if (p.vx > target) p.vx = Math.max(target, p.vx - acc);
    if (dir) p.f = dir;

    if (inp.jumpPressed) p.buffer = BUFFER; else if (p.buffer > 0) p.buffer--;
    if (p.onGround) p.coyote = COYOTE; else if (p.coyote > 0) p.coyote--;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V; p.buffer = 0; p.coyote = 0; p.canCut = true; p.onGround = false;
      sfx('jump');
      this.dust(p.x + 3, p.y + p.h);
    }
    if (p.canCut && !inp.jump && p.vy < -1) { p.vy *= 0.5; p.canCut = false; }
    if (p.vy >= 0) p.canCut = false;
    p.vy = Math.min(MAX_FALL, p.vy + GRAV);

    p.prevBottom = p.y + p.h;
    const ride = p.standOn;
    p.standOn = null;
    this.moveX(p, p.vx);
    if (ride && ride.present && !ride.dead) this.moveX(p, ride.vx); // carried by the player below
    const wasGround = p.onGround;
    p.onGround = false;
    this.moveY(p, p.vy);
    if (p.onGround && !wasGround && p.prevBottom < p.y + p.h - 1) this.dust(p.x + 3, p.y + p.h);

    for (const e of this.entities) {
      if (e.type === 'spring' && p.vy >= 0 && p.x + p.w > e.x + 1 && p.x < e.x + 7 &&
          p.y + p.h >= e.y + 4 && p.y + p.h <= e.y + 9) {
        p.vy = inp.jump ? SPRING_HELD_V : SPRING_V;
        p.canCut = false; p.onGround = false; p.coyote = 0;
        e.k = 10;
        sfx('boing');
      }
    }
    if (p.onGround) {
      const under = [this.tileAt(p.x + 1, p.y + p.h + 1), this.tileAt(p.x + p.w - 1, p.y + p.h + 1)];
      const push = under.includes('}') ? CONVEYOR_SPEED : under.includes('{') ? -CONVEYOR_SPEED : 0;
      if (push) this.moveX(p, push);
    }
    this.checkBossStomp(p);

    if (p.dead) return;
    if (!p.onGround) p.anim = 3;
    else if (Math.abs(p.vx) > 0.2) { p.animT++; p.anim = 1 + ((p.animT >> 3) & 1); }
    else { p.anim = 0; p.animT = 0; }

    if (this.hazardHit(p)) { this.kill(p); return; }
    this.checkDoor(p);
  }

  updateRemote(p) {
    if (!p.synced) return;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    if (Math.abs(dx) > 24 || Math.abs(dy) > 24) { p.x = p.tx; p.y = p.ty; }
    else { p.x += dx * 0.5; p.y += dy * 0.5; }
  }

  respawn(p) {
    if (this.auth && this.resetPending) this.resetTraps();
    if (!this.auth) for (const e of this.entities) if (e.type === 'fdoor') e.s = 0;
    this.spawnPlayer(p);
  }

  kill(p) {
    if (p.dead) return;
    p.dead = true;
    p.deadT = RESPAWN;
    p.anim = 4;
    p.deaths++;
    this.shake = 8;
    sfx('die');
    this.burst(p.x + 3, p.y + 4, S.playerColor(p.idx), 18);
    this.burst(p.x + 3, p.y + 4, '#f4f0ff', 6);
    if (this.isLocal(p)) this.taunt = { text: TAUNTS[(Math.random() * TAUNTS.length) | 0], t: 60, idx: p.idx };
    this.banner = 0;
    this.onEvent('death', p);
    this.checkAllDead();
  }

  checkAllDead() {
    if (this.auth && this.activePlayers().every((q) => q.dead || (!this.isLocal(q) && !q.synced))) this.resetPending = true;
  }

  // Player pressed restart: counts as a death, obviously.
  restart(idx) {
    const p = this.players[idx];
    if (p && p.present && !p.dead && !this.trans && !this.won) this.kill(p);
  }

  hazardHit(p) {
    if (p.y > H + 4) return true;
    const r = p.rect;
    const x0 = Math.floor(r.x / TILE), x1 = Math.floor((r.x + r.w - 0.001) / TILE);
    const y0 = Math.floor(r.y / TILE), y1 = Math.floor((r.y + r.h - 0.001) / TILE);
    for (let ty = Math.max(0, y0); ty <= Math.min(ROWS - 1, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(COLS - 1, x1); tx++) {
        const c = this.grid[ty][tx];
        const px = tx * TILE, py = ty * TILE;
        let hz = null;
        if (c === '^') hz = rect(px + 1, py + 3, 6, 5);
        else if (c === 'v') hz = rect(px + 1, py, 6, 5);
        else if (c === '>') hz = rect(px, py + 1, 5, 6);
        else if (c === '<') hz = rect(px + 3, py + 1, 5, 6);
        if (hz && overlap(r, hz)) return true;
      }
    }
    for (const e of this.entities) {
      const hz = this.entHazard(e);
      if (hz && overlap(r, hz)) {
        if (e.type === 'fdoor' && e.s === 0) { e.s = 1; sfx('lol'); }
        return true;
      }
    }
    const b = this.boss;
    if (b && (b.s === 0 || b.s === 1 || b.s === 2 || b.s === 3) && b.hurt <= 0 && overlap(r, rect(b.x + 3, b.y + 3, 18, 19))) return true;
    for (const bu of this.bullets) {
      const hz = bu.kind === 1 ? rect(bu.x, bu.y, 5, 6) : bu.kind === 2 ? rect(bu.x, bu.y, 3, 5) : rect(bu.x, bu.y, 3, 3);
      if (overlap(r, hz)) return true;
    }
    return false;
  }

  entHazard(e) {
    switch (e.type) {
      case 'hspike': {
        if (e.s === 0) return null;
        const hh = e.s === 2 ? 5 : Math.min(5, e.k + 1);
        return rect(e.x + 1, e.y + 8 - hh, 6, hh);
      }
      case 'fblock': return e.s === 2 ? rect(e.x, e.y, 8, 8) : null;
      case 'fspike': return e.s === 2 ? rect(e.x + 1, e.y + 1, 6, 7) : null;
      case 'saw':
      case 'vsaw': return rect(e.x + 1, e.y + 1, 6, 6);
      case 'fdoor': return rect(e.x + 1, e.y - 4, 6, 12);
      case 'laser': return e.s === 2 ? rect(e.x + 2, e.y + 8, 4, e.len) : null;
      default: return null;
    }
  }

  doorRects() {
    const out = [];
    for (const e of this.entities) {
      if (e.type === 'door' || (e.type === 'rdoor' && e.s !== 1)) out.push(rect(e.x + 1, e.y - 2, 6, 10));
    }
    if (this.boss && this.boss.s === 7) out.push(rect(W / 2 - 3, 20 * TILE - 10, 6, 10));
    return out;
  }

  checkDoor(p) {
    if (this.levelDone || this.level.coop) return; // co-op exits need everyone: see checkCoopDoor

    if (!this.doorRects().some((d) => overlap(p.rect, d))) return;
    if (this.auth) this.completeLevel();
    else this.onEvent('guest-door');
  }

  completeLevel() {
    if (this.levelDone) return;
    this.levelDone = true;
    sfx('door');
    this.onEvent('level-complete', {
      level: this.levelIndex,
      deaths: this.localDeaths() - this.levelStartDeaths,
      time: Math.max(1, this.time - this.levelStartTime),
    });
    if (isBossLevel(this.levelIndex)) {
      this.won = true;
      this.cheer = 70;
      const w = this.level.world;
      if (isLastWorld(w)) this.onEvent('victory');
      else {
        this.worldClear = { world: w, next: WORLDS[w + 1].start, nextCoop: WORLDS[w + 1].coop };
        this.onEvent('world-clear', this.worldClear);
      }
    } else {
      this.startTransition(this.levelIndex + 1);
    }
  }

  startTransition(next) {
    if (!LEVELS[next] || this.trans) return;
    this.trans = { t: 0, next };
    this.cheer = 70; // HUZZAR!!
  }

  showVictory() { this.won = true; this.levelDone = true; this.cheer = 70; sfx('win'); }

  // Host-side validation of a remote player's claims.
  tryRemoteDoor(idx) {
    const p = this.players[idx];
    if (!p || !p.present || p.dead || !p.synced) return;
    const pr = rect(p.tx - 4, p.ty - 4, p.w + 8, p.h + 8);
    if (this.doorRects().some((d) => overlap(pr, d))) this.completeLevel();
  }

  tryRemoteHit(idx) {
    const p = this.players[idx];
    const b = this.boss;
    if (!p || !p.present || p.dead || !p.synced || !b || b.s !== 4) return;
    const bottom = p.ty + p.h;
    if (p.tx + p.w > b.x - 6 && p.tx < b.x + 30 && bottom >= b.y - 16 && bottom <= b.y + 12) this.hitBoss();
  }

  // ---------- entities ----------
  standingOn(p, x, y) {
    return p.x + p.w > x && p.x < x + 8 && Math.abs(p.y + p.h - y) < 1.5;
  }

  // On/off blocks and lasers run on a shared level clock so they stay in step.
  updateTimers(force = false) {
    if (!this.auth && !force) return;
    const t = this.clock;
    for (const e of this.entities) {
      if (e.type === 'toggle') {
        const m = t % TOGGLE_PERIOD;
        const on = e.g === 0 ? m < 140 : (m >= 120 || m < 20);
        const warn = e.g === 0 ? m >= 100 && m < 140 : (m >= 220 || m < 20);
        e.s = on ? (warn ? 1 : 0) : 2;
        e.k = m;
      } else if (e.type === 'laser') {
        const m = (t + e.off) % LASER_PERIOD;
        const s = m < 80 ? 0 : m < 110 ? 1 : 2;
        if (s === 2 && e.s !== 2) sfx('zap');
        e.s = s;
        e.k = m;
      }
    }
  }

  updatePlatesAndGates(alive) {
    const pressed = [false, false];
    for (const e of this.entities) {
      if (e.type !== 'plate') continue;
      const on = alive.some((p) => this.standingOn(p, e.x, e.y + 8));
      if (on && e.s === 0) sfx('select');
      e.s = on ? 1 : 0;
      if (on) pressed[e.ch] = true;
    }
    for (const e of this.entities) {
      if (e.type !== 'gate') continue;
      if (pressed[e.ch]) { if (e.s === 0) sfx('gate'); e.s = 1; e.k = GATE_DELAY; }
      else if (e.s === 1 && --e.k <= 0) { e.s = 0; sfx('gate'); }
    }
  }

  shieldDown() {
    return this.entities.some((e) => e.type === 'plate' && e.s === 1);
  }

  updateEntities() {
    if (this.auth) { this.clock++; this.updateTimers(); }
    const alive = this.alivePlayers();
    if (this.auth) this.updatePlatesAndGates(alive);
    for (const e of this.entities) {
      switch (e.type) {
        case 'crumble':
          if (e.s === 0) {
            if (this.auth && alive.some((p) => this.standingOn(p, e.ox, e.oy))) { e.s = 1; e.k = 0; sfx('crack'); }
          } else if (e.s === 1) {
            if (++e.k >= 24) { e.s = 2; e.v = 0; }
          } else if (e.s === 2) {
            e.v = Math.min(5, e.v + 0.3); e.y += e.v;
            if (e.y > H) e.s = 3;
          }
          break;
        case 'hspike':
          if (e.s === 0) {
            if (this.auth && alive.some((p) => Math.abs(p.x + p.w / 2 - (e.x + 4)) < 12 && Math.abs(p.y + p.h - (e.y + 8)) < 14)) {
              e.s = 1; e.k = 0; sfx('spike');
            }
          } else if (e.s === 1) {
            if (++e.k >= 4) e.s = 2;
          }
          break;
        case 'fblock':
        case 'fspike':
          if (e.s === 0) {
            if (this.auth && alive.some((p) => p.x + p.w > e.x - 10 && p.x < e.x + 18 && p.y > e.y)) { e.s = 1; e.k = 0; }
          } else if (e.s === 1) {
            if (++e.k >= 8) { e.s = 2; e.v = 0; sfx('fall'); }
          } else if (e.s === 2) {
            e.v = Math.min(6, e.v + 0.35);
            let ny = e.y + e.v;
            const blocked = this.tileSolidAt(e.x + 1, ny + 8) || this.tileSolidAt(e.x + 6, ny + 8) ||
              this.entities.some((o) => o !== e && o.type === 'fblock' && o.s === 3 && Math.abs(o.x - e.x) < 8 && ny + 8 > o.y && e.y + 8 <= o.y);
            if (blocked) {
              ny = Math.floor((ny + 8) / TILE) * TILE - 8;
              if (e.type === 'fblock') { e.s = 3; this.shake = Math.max(this.shake, 4); this.dust(e.x + 4, ny + 8); }
              else { e.s = 4; this.burst(e.x + 4, ny + 6, '#e8e8f4', 8); }
            }
            e.y = ny;
            if (e.y > H) e.s = 4;
          }
          break;
        case 'saw': {
          const nx = e.x + e.v;
          const probe = e.v > 0 ? nx + 8 : nx;
          if (this.tileSolidAt(probe, e.y + 4)) e.v = -e.v; else e.x = nx;
          break;
        }
        case 'vsaw': {
          const ny = e.y + e.v * 1.2;
          const probe = e.v > 0 ? ny + 8 : ny;
          if (this.tileSolidAt(e.x + 4, probe)) e.v = -e.v; else e.y = ny;
          break;
        }
        case 'spring':
          if (e.k > 0) e.k--;
          break;
        case 'rdoor':
          if (e.s === 0) {
            if (this.auth && alive.some((p) => Math.abs(p.x + 3 - (e.x + 4)) < 28 && Math.abs(p.y + p.h - (e.y + 8)) < 20)) {
              e.s = 1; e.k = 0; sfx('whoosh');
            }
          } else if (e.s === 1) {
            e.k++;
            const t = Math.min(1, e.k / 40);
            const ease = t * t * (3 - 2 * t);
            e.x = e.ox + (e.tx - e.ox) * ease;
            e.y = e.oy + (e.ty - e.oy) * ease;
            if (t >= 1) e.s = 2;
          }
          break;
        default:
      }
    }
  }

  // ---------- boss ----------
  bossTarget() {
    const alive = this.alivePlayers();
    if (!alive.length) return null;
    const b = this.boss;
    return alive.reduce((a, p) => (Math.abs(p.x - b.x - 12) < Math.abs(a.x - b.x - 12) ? p : a));
  }

  updateBoss() {
    const b = this.boss;
    if (!b) return;
    if (b.hurt > 0) b.hurt--;
    if (!this.auth) return;
    // 0..3, how angry it is. Scales with damage taken, whatever its max HP.
    const phase = Math.min(3, Math.floor(((b.maxHp - b.hp) * 4) / b.maxHp));
    const hard = b.kind === 1;
    const target = this.bossTarget();
    b.k++;
    switch (b.s) {
      case 0: // entrance
        b.y += (32 - b.y) * 0.05;
        if (b.k > 90) { b.s = 1; b.k = 0; }
        break;
      case 1: { // hover + shoot
        if (target) {
          const tx = clamp(target.x + 3 - 12, 66, 230);
          const sp = Math.min(1.3, 0.8 + phase * 0.2 + (hard ? 0.2 : 0)); // always slower than the player (1.5)
          b.x += clamp(tx - b.x, -sp, sp);
        }
        b.y = 32 + Math.sin(this.frame * 0.08) * 3;
        if (--b.cool <= 0 && target) {
          const alive = this.alivePlayers();
          // The Warden spreads its attention: it alternates between players (so the switch-holder isn't safe).
          const shotAt = b.kind === 2 && alive.length ? alive[(this.bossTurn = (this.bossTurn || 0) + 1) % alive.length] : target;
          this.bossShoot(b, shotAt, phase); b.cool = 80 - phase * 15 - (hard ? 12 : 0); }
        if (b.k > 170 - phase * 20) { b.s = 2; b.k = 0; }
        break;
      }
      case 2: // telegraph
        if (b.k >= 36) { b.s = 3; b.k = 0; b.vy = 0; sfx('fall'); }
        break;
      case 3: // slam
        b.vy = Math.min(7, b.vy + 0.5);
        b.y += b.vy;
        if (b.y >= 136) {
          b.y = 136; b.s = 4; b.k = 0;
          this.shake = 12;
          sfx('slam');
          this.dust(b.x + 4, 160); this.dust(b.x + 20, 160);
          if (phase >= 1 || hard) {
            this.addBullet(b.x - 5, 154, -1.6, 0, 1);
            this.addBullet(b.x + 24, 154, 1.6, 0, 1);
          }
          if (hard) {
            // ceiling shards rain down, roughly where the players are
            const alive = this.alivePlayers();
            for (let i = 0; i < 2 + phase; i++) {
              const p = alive[i % Math.max(1, alive.length)];
              const x = clamp((p ? p.x : 160) + (Math.random() - 0.5) * 120, 12, W - 16);
              this.addBullet(x, 10 - i * 18, 0, 1.6, 2);
            }
          }
        }
        break;
      case 4: // stunned: stomp it!
        if (b.k >= 150 - phase * 15 - (hard ? 15 : 0)) { b.s = 5; b.k = 0; }
        break;
      case 5: // rise
        b.y -= 1.5;
        if (b.y <= 32) { b.y = 32; b.s = 1; b.k = 0; b.cool = 40; }
        break;
      case 6: // dying
        if (b.k % 6 === 0) {
          this.burst(b.x + Math.random() * 24, b.y + Math.random() * 24, Math.random() > 0.5 ? '#f5c542' : '#e8334a', 10);
          sfx('crack');
          this.shake = 4;
        }
        if (b.k >= 120) { b.s = 7; b.k = 0; sfx('win'); this.burst(b.x + 12, b.y + 12, '#c05ad0', 40); }
        break;
      default:
    }
  }

  bossShoot(b, t, phase) {
    const cx = b.x + 12, cy = b.y + 18;
    const ang = Math.atan2(t.y + 4 - cy, t.x + 3 - cx);
    const sp = 1.3 + phase * 0.2;
    const spread = phase >= 2 ? [-0.35, 0, 0.35] : [0];
    for (const d of spread) this.addBullet(cx - 1, cy, Math.cos(ang + d) * sp, Math.sin(ang + d) * sp, 0);
    sfx('shoot');
  }

  addBullet(x, y, vx, vy, kind) {
    if (this.bullets.length < MAX_BULLETS) this.bullets.push({ x, y, vx, vy, kind });
  }

  updateBullets() {
    this.bullets = this.bullets.filter((bu) => {
      bu.x += bu.vx; bu.y += bu.vy;
      if (bu.x < -8 || bu.x > W + 8 || bu.y < -8 || bu.y > H + 8) return false;
      if ((bu.kind === 0 || bu.kind === 2) && this.tileSolidAt(bu.x + 1, bu.y + (bu.kind === 2 ? 5 : 1))) return false;
      if (bu.kind === 1 && (this.tileSolidAt(bu.x + (bu.vx > 0 ? 5 : 0), bu.y + 3))) return false;
      return true;
    });
  }

  checkBossStomp(p) {
    const b = this.boss;
    if (!b || b.s !== 4 || p.vy <= 0) return;
    if (p.x + p.w > b.x + 2 && p.x < b.x + 22 && p.prevBottom <= b.y + 8 && p.y + p.h >= b.y) {
      p.y = b.y - p.h;
      p.vy = STOMP_V;
      p.canCut = false;
      p.vx = p.x + 3 < b.x + 12 ? -1.5 : 1.5;
      if (this.auth) this.hitBoss();
      else if (b.shield && !this.shieldDown()) this.clank(b);
      else { b.hurt = 20; sfx('hit'); this.onEvent('guest-hit'); }
    }
  }

  clank(b) {
    sfx('clank');
    this.burst(b.x + 12, b.y + 2, '#4fc8e8', 10);
  }

  hitBoss() {
    const b = this.boss;
    if (!b || b.s !== 4) return;
    if (b.shield && !this.shieldDown()) { this.clank(b); return; }
    b.hp--;
    b.hurt = 30;
    this.shake = 8;
    sfx('hit');
    this.burst(b.x + 12, b.y + 2, '#f5c542', 14);
    if (b.hp <= 0) { b.s = 6; b.k = 0; this.bullets = []; }
    else { b.s = 5; b.k = 0; }
  }

  // ---------- networking ----------
  playerState(idx) {
    const p = this.players[idx];
    return {
      t: 'p', x: +p.x.toFixed(2), y: +p.y.toFixed(2), vx: +p.vx.toFixed(2), vy: +p.vy.toFixed(2),
      f: p.f < 0 ? -1 : 1, a: p.anim | 0, d: p.dead ? 1 : 0, lv: this.levelIndex, dc: p.deaths,
    };
  }

  applyRemote(idx, m) {
    const p = this.players[idx];
    if (!p || this.isLocal(p) || !p.present) return;
    if (m.lv !== this.levelIndex || this.trans) { p.synced = false; return; }
    const wasDead = p.dead;
    p.tx = m.x; p.ty = m.y; p.vx = m.vx; p.vy = m.vy; p.f = m.f; p.anim = m.a; p.deaths = m.dc;
    p.dead = m.d === 1;
    if (!p.synced || (wasDead && !p.dead)) { p.x = m.x; p.y = m.y; }
    p.synced = true;
    if (!wasDead && p.dead) {
      this.burst(p.x + 3, p.y + 4, S.playerColor(p.idx), 18);
      sfx('die');
      this.checkAllDead();
    }
  }

  snapshot() {
    const r = (n) => Math.round(n * 100) / 100;
    const b = this.boss;
    return {
      t: 'w', lv: this.levelIndex, q: ++this.snapSeq,
      e: this.entities.map((e) => [r(e.x), r(e.y), e.s, e.k, r(e.v)]),
      b: b ? [r(b.x), r(b.y), b.s, b.hp, b.k] : null,
      bu: this.bullets.map((u) => [r(u.x), r(u.y), r(u.vx), r(u.vy), u.kind]),
    };
  }

  applySnapshot(m) {
    if (this.trans || this.won) return;
    if (m.lv !== this.levelIndex) {
      // Missed a level change? Catch up after a short grace period.
      if (++this.mismatch > 40) this.startTransition(m.lv);
      return;
    }
    this.mismatch = 0;
    if (m.q <= this.lastSnapSeq) return; // unordered channel: drop stale snapshots
    this.lastSnapSeq = m.q;
    if (m.e.length !== this.entities.length) return;
    m.e.forEach((a, i) => {
      const e = this.entities[i];
      if (e.type === 'fdoor' && e.s === 1) return; // locally triggered, keep the LOL
      e.x = a[0]; e.y = a[1]; e.s = a[2]; e.k = a[3]; e.v = a[4];
    });
    if (this.boss && m.b) {
      const b = this.boss;
      if (m.b[3] > b.maxHp) return;
      if (m.b[3] < b.hp) { b.hurt = 30; sfx('hit'); this.burst(m.b[0] + 12, m.b[1] + 2, '#f5c542', 14); }
      if (m.b[2] === 4 && b.s !== 4) { this.shake = 12; sfx('slam'); }
      b.x = m.b[0]; b.y = m.b[1]; b.s = m.b[2]; b.hp = m.b[3]; b.k = m.b[4];
    }
    this.bullets = m.bu.map((a) => ({ x: a[0], y: a[1], vx: a[2], vy: a[3], kind: a[4] }));
  }

  dropRemote(idx) {
    const p = this.players[idx];
    if (p) { p.present = false; p.dead = true; }
  }

  // ---------- particles ----------
  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random() * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 30 + Math.random() * 20, color, g: 0.12 });
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  }

  dust(x, y) {
    for (let i = 0; i < 4; i++) {
      this.particles.push({ x, y: y - 1, vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 0.4, life: 14, color: '#9a8aa8', g: 0 });
    }
  }

  updateParticles() {
    for (const q of this.particles) { q.x += q.vx; q.y += q.vy; q.vy += q.g; q.life--; }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  // ---------- render ----------
  render(ctx) {
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * this.shake * 0.6), Math.round((Math.random() - 0.5) * this.shake * 0.6));
    ctx.drawImage(this.levelCanvas, 0, 0);
    for (const c of this.conveyors) S.drawConveyor(ctx, c.x, c.y, c.dir, this.frame);

    for (const key of this.revealed) S.drawRevealed(ctx, key % COLS, Math.floor(key / COLS), this.levelIndex);

    if (this.level.sign) {
      drawTextCentered(ctx, this.level.sign, W / 2, 16, '#ffffff', 1, '#0a0610');
    }

    for (const e of this.entities) S.drawEntity(ctx, e, this.frame, this.levelIndex);
    for (const e of this.entities) {
      if (e.type === 'fdoor' && e.s === 1) drawTextCentered(ctx, 'LOL', e.x + 4, e.y - 16, '#f5c542');
    }

    const b = this.boss;
    if (b) {
      if (b.s < 7 && !(b.s === 6 && this.frame % 4 < 2)) S.drawBoss(ctx, b, this.frame);
      if (b.s === 7) {
        S.drawEntity(ctx, { type: 'door', x: W / 2 - 4, y: 20 * TILE - 8 }, this.frame, this.levelIndex);
        drawTextCentered(ctx, 'FREEDOM', W / 2, 20 * TILE - 22, '#5fd068');
      }
      if (b.shield && b.s < 6 && !this.shieldDown()) S.drawShield(ctx, b, this.frame);
      if (b.s === 4 && b.shield && !this.shieldDown()) drawTextCentered(ctx, 'SHIELDED', b.x + 12, b.y - 12, '#4fc8e8');
      if (b.s === 4 && b.hp === b.maxHp && b.kind === 0) drawTextCentered(ctx, 'STOMP!', b.x + 12, b.y - 12, '#f5c542');
    }
    for (const bu of this.bullets) S.drawBullet(ctx, bu, this.frame);

    if (this.level.coop && !this.levelDone) {
      const d = this.doorRects()[0];
      const ps = this.activePlayers();
      if (d && ps.length < 2) drawTextCentered(ctx, 'NEEDS 2 PLAYERS', d.x + 3, d.y - 12, '#e8334a');
      else if (d && this.atDoor && this.atDoor.length === 1) {
        const other = ps.find((p) => p !== this.atDoor[0]);
        drawTextCentered(ctx, `WAITING FOR ${other ? other.name.slice(0, 8) : '...'}`, Math.min(W - 40, d.x + 3), d.y - 12, '#f5c542');
      }
    }

    for (const p of this.players) {
      if (!p.present || p.dead) continue;
      if (!this.isLocal(p) && !p.synced) continue;
      S.drawPlayer(ctx, p);
      if (this.players.length > 1) {
        const other = this.players[1 - p.idx];
        const crowded = other && other.present && !other.dead && Math.abs(other.x - p.x) < 28 && Math.abs(other.y - p.y) < 12;
        const lift = crowded && p.idx === 1 ? 7 : 0;
        drawTextCentered(ctx, p.name.slice(0, 8), p.x + 3, p.y - 7 - lift, S.playerColor(p.idx));
      }
    }

    for (const q of this.particles) {
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
    }
    ctx.restore();

    this.renderHud(ctx);
  }

  renderHud(ctx) {
    drawText(ctx, `${stageLabel(this.levelIndex)}: ${this.level.name}`, 3, 2, '#c8c0d8');
    const deaths = this.players.length === 1
      ? `DEATHS ${this.players[0].deaths}`
      : this.players.map((p) => `P${p.idx + 1} ${p.present ? p.deaths : '-'}`).join('  ');
    drawText(ctx, deaths, W - 3 - textWidth(deaths), 2, '#e8334a');

    const b = this.boss;
    if (b && b.s >= 1 && b.s < 7) {
      const bw = 60, bx = W / 2 - bw / 2;
      ctx.fillStyle = '#0a0610'; ctx.fillRect(bx - 1, 9, bw + 2, 5);
      const seg = bw / b.maxHp;
      for (let i = 0; i < b.maxHp; i++) {
        ctx.fillStyle = i < b.hp ? ['#c05ad0', '#4fc8e8', '#8ac06a'][b.kind] || '#c05ad0' : '#2a1c3a';
        ctx.fillRect(Math.round(bx + i * seg), 10, Math.round(seg) - 1, 3);
      }
    }

    if (this.banner > 0 && !this.trans && !(this.cheer > 0)) {
      const L = this.level;
      const t = L.boss ? (isLastWorld(L.world) ? 'FINAL BOSS' : `WORLD ${L.world + 1} BOSS`)
        : L.stage === 0 ? `WORLD ${L.world + 1}: ${WORLDS[L.world].name}` : `STAGE ${stageLabel(this.levelIndex)}`;
      drawTextCentered(ctx, t, W / 2, 60, '#f5c542', 2);
      drawTextCentered(ctx, this.level.name, W / 2, 76, '#ffffff', 3);
    }

    if (this.taunt) {
      const y = 70 - Math.max(0, 10 - (60 - this.taunt.t));
      drawTextCentered(ctx, this.taunt.text, W / 2, y, '#e8334a', 3);
    }

    if (this.trans) {
      const a = this.trans.t < 20 ? this.trans.t / 20 : 1 - (this.trans.t - 20) / 20;
      ctx.fillStyle = `rgba(10,6,16,${a.toFixed(2)})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (this.cheer > 0 && !this.won) {
      const bounce = Math.round(Math.abs(Math.sin(this.cheer * 0.25)) * 6);
      drawTextCentered(ctx, 'HUZZAR!!', W / 2, 64 - bounce, this.frame % 8 < 4 ? '#f5c542' : '#5fd068', 5);
    }

    if (this.won) {
      ctx.fillStyle = 'rgba(10,6,16,0.82)';
      ctx.fillRect(0, 0, W, H);
      drawTextCentered(ctx, 'HUZZAR!!', W / 2, 8, this.frame % 16 < 8 ? '#f5c542' : '#5fd068', 3);
      drawTextCentered(ctx, `YOU BEAT ${this.level.name}`, W / 2, 30, '#f5c542', 2);
      if (this.worldClear) {
        drawTextCentered(ctx, `WORLD ${this.worldClear.world + 2} UNLOCKED: ${WORLDS[this.worldClear.world + 1].name}`, W / 2, 52, '#5fd068', 1);
        if (this.worldClear.world === 0) drawTextCentered(ctx, '2 PLAYER MODES UNLOCKED', W / 2, 60, '#4fc8e8', 1);
        if (this.worldClear.nextCoop) drawTextCentered(ctx, 'IT IS CO-OP ONLY: GRAB A FRIEND', W / 2, 60, '#4fc8e8', 1);
      }
      const secs = Math.floor(this.time / 60);
      drawTextCentered(ctx, `TIME ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, W / 2, 74, '#ffffff', 2);
      this.players.forEach((p, i) => {
        drawTextCentered(ctx, `${p.name}: ${p.deaths} DEATHS`, W / 2, 96 + i * 14, S.playerColor(p.idx), 2);
      });
      drawTextCentered(ctx, this.worldClear ? 'IT GETS WORSE.' : 'WORTH IT?', W / 2, 132, '#c8c0d8', 1);
      drawTextCentered(ctx, this.worldClear && this.continueNext ? `PRESS ENTER FOR WORLD ${this.worldClear.world + 2}` : 'PRESS ENTER', W / 2, 150, '#5fd068', 1);
    }
  }
}
