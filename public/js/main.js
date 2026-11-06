// Boot, menus, main loop, and online wiring.
import { World } from './game.js';
import { W, H } from './levels.js';
import { Input } from './input.js';
import { initAudio, sfx, setMuted, isMuted } from './audio.js';
import { drawTextCentered } from './font.js';
import { PeerLink, Signaling } from './net.js';
import { PROTOCOL_VERSION, sanitizeName, encodeManual, decodeManual, ROOM_CODE_RE } from './protocol.js';
import { renderLevelCanvas } from './sprites.js';
import { LEVELS, WORLDS, MULTIPLAYER_START, isBossLevel, stageLabel as shortLabel } from './levels.js';
import * as Save from './save.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#screen');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
const input = new Input();

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let world = null;
let mode = null; // 'solo' | 'local' | 'host' | 'guest'
let paused = false;
let link = null;
let sig = null;
let partnerName = 'FRIEND';
let lastDoorMsg = 0;
let pingN = 0;
let save = Save.load();
let lvMode = 'solo';
let currentPanel = null;

// ---------- layout ----------
function fit() {
  const bar = $('#toolbar').hidden ? 0 : 44;
  const s = Math.min(window.innerWidth / W, (window.innerHeight - bar) / H);
  const scale = s >= 2 ? Math.floor(s) : s; // integer scaling when there is room, fit otherwise
  canvas.style.width = `${Math.floor(W * scale)}px`;
  canvas.style.height = `${Math.floor(H * scale)}px`;
  $('#app').style.setProperty('--game-w', `${Math.floor(W * scale)}px`);
}
window.addEventListener('resize', fit);
fit();

// ---------- menus ----------
const panels = ['menu-main', 'menu-levels', 'menu-online', 'menu-manual', 'menu-controls', 'menu-pause'];
input.bindTouch($('#touch'));

function show(id) {
  currentPanel = id;
  for (const p of panels) $(`#${p}`).hidden = p !== id;
  input.capture = id === null;
  $('#touch').hidden = id !== null;
  const barHidden = !world;
  if ($('#toolbar').hidden !== barHidden) { $('#toolbar').hidden = barHidden; fit(); }
  if (id === 'menu-main') refreshMain();
  if (id === 'menu-pause') refreshPause();
  if (id === null) { document.activeElement?.blur?.(); return; }
  const first = $(`#${id} button:not([hidden]):not(:disabled), #${id} input`);
  if (first) first.focus({ preventScroll: true });
}

// Arrow keys / D-pad move between buttons in menus; Enter / A presses.
function menuNav() {
  const panel = currentPanel && $(`#${currentPanel}`);
  if (!panel) return;
  const items = [...panel.querySelectorAll('button, input, textarea')].filter((el) => el.offsetParent !== null && !el.disabled);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const next = input.wasPressed('ArrowDown') || input.wasPressed('ArrowRight') || input.padPressed('down') || input.padPressed('right');
  const prev = input.wasPressed('ArrowUp') || input.wasPressed('ArrowLeft') || input.padPressed('up') || input.padPressed('left');
  if (next || prev) {
    const j = i < 0 ? 0 : (i + (next ? 1 : -1) + items.length) % items.length;
    items[j].focus();
  }
  if (input.padPressed('a') && i >= 0 && items[i].tagName === 'BUTTON') items[i].click();
  // In-game, Escape/Start is handled by the pause logic in step().
  if (!world && (input.wasPressed('Escape') || input.padPressed('back'))) {
    if (currentPanel === 'menu-manual') actions['back-online']();
    else if (currentPanel !== 'menu-main' && currentPanel !== 'menu-pause') actions.back();
  }
}

let toastTimer = 0;
function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg; // textContent only: never innerHTML
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function setStatus(id, msg, err = false) {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle('err', err);
}

function updateMuteLabel() {
  const label = `Sound: ${isMuted() ? 'off' : 'on'}`;
  $('#btn-mute').textContent = label;
  for (const b of document.querySelectorAll('.mute-btn')) b.textContent = label;
  $('#toolbar .tb-mute').classList.toggle('off', isMuted());
}
function toggleMute() { setMuted(!isMuted()); store.set('rage-muted', isMuted() ? '1' : '0'); updateMuteLabel(); }
setMuted(store.get('rage-muted') === '1');
updateMuteLabel();

$('#in-name').value = sanitizeName(store.get('rage-name') || '') === 'PLAYER' ? '' : sanitizeName(store.get('rage-name') || '');
function myName() {
  const n = sanitizeName($('#in-name').value);
  store.set('rage-name', n);
  return n;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-go]');
  if (!b) return;
  initAudio();
  sfx('select');
  // Don't leave focus on toolbar buttons, or Space (jump) would press them again.
  if (b.closest('#toolbar')) b.blur();
  actions[b.dataset.go]?.(b);
});
// Unlock audio on first gesture of any kind.
window.addEventListener('keydown', initAudio, { once: true });
window.addEventListener('pointerdown', initAudio, { once: true });

const actions = {
  continue: () => {
    const r = save.run;
    if (r) startGame(r.mode, { startLevel: r.level, deaths: r.deaths, time: r.time });
  },
  'new-solo': () => newRun('solo'),
  'new-local': () => { if (requireMultiplayer()) newRun('local', MULTIPLAYER_START); },
  levels: () => { renderLevels(); show('menu-levels'); },
  'lvmode-solo': () => { lvMode = 'solo'; renderLevels(); },
  'lvmode-local': () => { if (requireMultiplayer()) { lvMode = 'local'; renderLevels(); } },
  'reset-progress': () => {
    if (!window.confirm('Reset all progress, unlocks and best times?')) return;
    save = Save.wipe();
    renderLevels();
    toast('Progress reset');
  },
  online: () => { if (requireMultiplayer()) { show('menu-online'); checkServer(); } },
  controls: () => { show('menu-controls'); renderPads(); },
  mute: () => toggleMute(),
  home: () => goHome(),
  pause: () => setPaused(!paused),
  restart: () => { if (world) { world.localIdx.forEach((i) => world.restart(i)); setPaused(false); } },
  back: () => {
    if (world && paused) { show('menu-pause'); return; }
    cancelOnline();
    show('menu-main');
  },
  'back-online': () => { cancelOnline(); resetManualUi(); show('menu-online'); checkServer(); },
  host: () => hostRoom(),
  join: () => joinRoom(),
  manual: () => { cancelOnline(); resetManualUi(); show('menu-manual'); },
  'manual-host': () => manualHost(),
  'manual-guest': () => { cancelOnline(); resetManualUi(); $('#manual-guest').hidden = false; },
  'copy-offer': () => copy('#mh-offer'),
  'copy-answer': () => copy('#mg-answer'),
  'mh-connect': () => manualHostConnect(),
  'mg-make': () => manualGuestAnswer(),
  resume: () => setPaused(false),
  quit: () => quitToMenu(),
};

function renderPads() {
  input.poll();
  const ul = $('#pad-list');
  ul.replaceChildren();
  const names = input.padNames();
  if (!names.length) {
    const li = document.createElement('li');
    li.textContent = 'No controllers detected yet — press a button on one.';
    ul.append(li);
  }
  names.forEach((n, i) => {
    const li = document.createElement('li');
    li.textContent = `Controller ${i + 1}: ${n}`;
    ul.append(li);
  });
}
window.addEventListener('gamepadconnected', (e) => {
  toast(`Controller connected: ${String(e.gamepad.id).slice(0, 40)}`);
  if (!$('#menu-controls').hidden) renderPads();
});
window.addEventListener('gamepaddisconnected', () => {
  if (!$('#menu-controls').hidden) renderPads();
});

async function copy(sel) {
  const el = $(sel);
  el.select();
  try { await navigator.clipboard.writeText(el.value); toast('Copied!', 1200); } catch { toast('Select the text and copy it manually', 2000); }
}

// ---------- game lifecycle ----------
function startGame(m, opts = {}) {
  mode = m;
  paused = false;
  const names = m === 'host' ? [myName(), partnerName] : m === 'guest' ? [partnerName, myName()] : ['P1', 'P2'];
  if (m === 'host' || m === 'guest') opts = { ...opts, startLevel: MULTIPLAYER_START }; // online play is World 2 onwards
  world = new World({ mode: m, names, onEvent, ...opts });
  autosave();
  show(null);
}

function newRun(m, startLevel = 0) {
  let lv = Math.min(startLevel, save.unlocked);
  if (m === 'local') {
    if (!Save.multiplayerUnlocked(save)) return;
    lv = Math.max(lv, MULTIPLAYER_START); // 2 player is World 2 onwards
  }
  startGame(m, { startLevel: lv });
}

function requireMultiplayer() {
  if (Save.multiplayerUnlocked(save)) return true;
  toast('2 player unlocks in World 2. Beat The Grudge first!', 3000);
  return false;
}

const savesRuns = () => mode === 'solo' || mode === 'local';

function autosave() {
  if (world && savesRuns() && !world.won) {
    save.run = {
      mode,
      level: world.trans ? world.trans.next : world.levelIndex,
      deaths: world.players.map((p) => p.deaths).concat(0).slice(0, 2),
      time: world.time,
    };
  }
  Save.store(save);
}

function setPaused(on) {
  if (!world || world.won) return;
  paused = on;
  if (on) autosave();
  show(on ? 'menu-pause' : null);
}

function goHome() {
  if (!world) return;
  if ((mode === 'host' || mode === 'guest') && !window.confirm('Leave the online game? Your partner will be disconnected.')) return;
  quitToMenu();
  if (savesRuns()) toast('Progress saved', 1500);
}

function quitToMenu() {
  autosave();
  if (link) { link.send({ t: 'bye' }, true); }
  cancelOnline();
  world = null;
  mode = null;
  paused = false;
  show('menu-main');
}

// ---------- menus: main / pause / level select ----------
function stageLabel(i) { return isBossLevel(i) ? `World ${LEVELS[i].world + 1} boss` : `Stage ${shortLabel(i)}`; }

function refreshMain() {
  const r = save.run;
  const btn = $('#btn-continue');
  btn.hidden = !r;
  if (r) {
    const deaths = r.mode === 'local' ? r.deaths[0] + r.deaths[1] : r.deaths[0];
    btn.textContent = `Continue: ${stageLabel(r.level)} ${r.mode === 'local' ? '(2P) ' : ''}· ${deaths} deaths`;
  }
  const mp = Save.multiplayerUnlocked(save);
  for (const [sel, label] of [['[data-go="new-local"]', 'Local 2 player'], ['[data-go="online"]', 'Online lobby']]) {
    const el = $(`#menu-main ${sel}`);
    el.textContent = mp ? label : `🔒 ${label}`;
    el.classList.toggle('locked-btn', !mp);
    el.title = mp ? '' : 'Unlocks in World 2';
  }
  $('#mp-note').hidden = mp;
  const bits = [`Lifetime deaths: ${save.totalDeaths}`];
  if (save.wins) bits.push(`Wins: ${save.wins}`);
  $('#stats-line').textContent = bits.join(' · ');
}

function refreshPause() {
  const online = mode === 'host' || mode === 'guest';
  for (const el of document.querySelectorAll('#menu-pause .offline-only')) el.hidden = online;
  if (world) {
    const b = save.best[world.levelIndex];
    $('#pause-info').textContent = `${stageLabel(world.levelIndex)}: ${world.level.name}` +
      (b ? ` · best ${b.deaths} deaths, ${Save.formatTime(b.time)}` : '') +
      (online ? ' · online game keeps running' : '');
  }
  updateMuteLabel();
}

function renderLevels() {
  const mp = Save.multiplayerUnlocked(save);
  if (!mp) lvMode = 'solo';
  $('#lvmode-solo').setAttribute('aria-checked', String(lvMode === 'solo'));
  $('#lvmode-local').setAttribute('aria-checked', String(lvMode === 'local'));
  $('#lvmode-local').textContent = mp ? 'Local 2P' : '🔒 Local 2P';
  const grid = $('#level-grid');
  grid.replaceChildren();
  LEVELS.forEach((L, i) => {
    if (L.stage === 0) {
      const w = WORLDS[L.world];
      const h = document.createElement('h3');
      h.className = 'world-head';
      const worldLocked = w.start > save.unlocked;
      h.textContent = `World ${L.world + 1}: ${w.name}` +
        (worldLocked ? ` · locked (beat World ${L.world} boss)` : '') +
        (!worldLocked && lvMode === 'local' && w.start < MULTIPLAYER_START ? ' · solo only' : '');
      grid.append(h);
    }
    const soloOnly = lvMode === 'local' && i < MULTIPLAYER_START;
    const locked = i > save.unlocked || soloOnly;
    const b = document.createElement('button');
    b.className = `level-card${locked ? ' locked' : ''}${isBossLevel(i) ? ' boss' : ''}`;
    b.disabled = locked;
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = soloOnly && i <= save.unlocked ? `${stageLabel(i)} · solo only` : locked ? `${stageLabel(i)} · locked` : stageLabel(i);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = i > save.unlocked ? '???' : L.name;
    const best = document.createElement('span');
    best.className = 'best';
    const bs = save.best[i];
    best.textContent = locked ? '' : bs ? `Best: ${bs.deaths} deaths · ${Save.formatTime(bs.time)}` : 'Not cleared yet';
    b.append(num, name, best);
    b.addEventListener('click', () => { initAudio(); sfx('select'); newRun(lvMode, i); });
    grid.append(b);
  });
}

// Toolbar info line, refreshed a few times a second.
let lastInfo = '';
function updateToolbar() {
  if (!world || world.frame % 15 !== 0) return;
  const parts = [WORLDS[world.level.world].name, stageLabel(world.levelIndex), `Run ${Save.formatTime(world.time)}`];
  const b = save.best[world.levelIndex];
  if (b) parts.push(`Best ${b.deaths}☠ ${Save.formatTime(b.time)}`);
  if (mode === 'host' || mode === 'guest') parts.push(`with ${partnerName}`);
  const txt = parts.join(' · ');
  if (txt !== lastInfo) { lastInfo = txt; $('#tb-info').textContent = txt; }
}

window.addEventListener('pagehide', () => { if (world) autosave(); });
// Another tab saved: pick up its progress (keeping our run if we're mid-game).
window.addEventListener('storage', (e) => {
  if (e.key !== null && e.key !== 'rage-save-v1') return;
  const fresh = Save.load();
  if (world && savesRuns()) fresh.run = save.run;
  save = fresh;
  if (currentPanel === 'menu-main') refreshMain();
  if (currentPanel === 'menu-levels') renderLevels();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && world) {
    autosave();
    if (world && !paused && savesRuns() && !world.won) setPaused(true);
  }
});

function onEvent(type, data) {
  if (type === 'death' && world && data && world.isLocal(data)) {
    save.totalDeaths++;
    autosave();
  }
  if (type === 'level-complete' && data && mode !== 'guest') {
    Save.recordClear(save, data.level, data.deaths, data.time);
    const b = save.best[data.level];
    if (b && b.time === data.time && b.deaths === data.deaths) toast('New personal best!', 1800);
    Save.store(save);
  }
  if (type === 'level-loaded') autosave();
  if (type === 'world-clear' && data) {
    const firstUnlock = data.world === 0 && !save.best[MULTIPLAYER_START];
    if (savesRuns()) {
      save.run = { mode, level: data.next, deaths: world.players.map((p) => p.deaths).concat(0).slice(0, 2), time: world.time };
      world.continueNext = mode === 'solo' || data.next >= MULTIPLAYER_START;
    }
    Save.store(save);
    toast(firstUnlock ? `World ${data.world + 2} unlocked! 2 player modes unlocked!` : `World ${data.world + 2} unlocked!`, 4000);
    if (mode === 'host' && link) link.send({ t: 'win' }, true);
  }
  if (type === 'victory') {
    save.wins++;
    if (savesRuns()) save.run = null;
    Save.store(save);
  }
  if (type === 'level-loaded' && mode === 'host' && link) link.send({ t: 'lvl', lv: world.levelIndex }, true);
  if (type === 'victory' && mode === 'host' && link) link.send({ t: 'win' }, true);
  if (type === 'guest-door' && link) {
    const now = performance.now();
    if (now - lastDoorMsg > 300) { lastDoorMsg = now; link.send({ t: 'door' }, true); }
  }
  if (type === 'guest-hit' && link) link.send({ t: 'hit' }, true);
}

// ---------- online: shared ----------
function cancelOnline() {
  if (sig) { sig.close(); sig = null; }
  if (link) { const l = link; link = null; l.onClose = () => {}; l.close(); }
  $('#room-display').hidden = true;
  setStatus('#online-status', '');
}

function attachLink(l, isHost) {
  link = l;
  l.onMessage = (m) => onNet(m, isHost);
  l.onOpen = () => {
    if (sig) { sig.close(); sig = null; }
    l.send({ t: 'hello', v: PROTOCOL_VERSION, name: myName() }, true);
    setStatus('#online-status', 'Connected! Saying hello…');
    setStatus('#manual-status', 'Connected! Saying hello…');
  };
  l.onClose = () => {
    const wasPlaying = !!world && (mode === 'host' || mode === 'guest');
    link = null;
    if (!wasPlaying) {
      setStatus('#online-status', 'Connection failed or closed.', true);
      setStatus('#manual-status', 'Connection failed or closed.', true);
      return;
    }
    if (mode === 'host') {
      toast('Partner left — carrying on solo', 4000);
      world.dropRemote(1);
      world.checkAllDead();
    } else {
      toast('Host left the game', 4000);
      quitToMenu();
    }
  };
}

function onNet(m, isHost) {
  if (m.t === 'hello') {
    if (m.v !== PROTOCOL_VERSION) { toast('Version mismatch — both players need the same version'); cancelOnline(); return; }
    if (world) return; // already started
    partnerName = m.name;
    startGame(isHost ? 'host' : 'guest');
    if (isHost) link.send({ t: 'lvl', lv: world.levelIndex }, true);
    toast(`Playing with ${partnerName}`);
    return;
  }
  if (!world) return;
  if (m.t === 'bye') { link && link.close(); return; }
  if (m.t === 'ping') { link.send({ t: 'pong', n: m.n }); return; }
  if (m.t === 'pong') return;
  if (isHost) {
    // The guest may only report its own player and make claims we verify.
    if (m.t === 'p') world.applyRemote(1, m);
    else if (m.t === 'door') world.tryRemoteDoor(1);
    else if (m.t === 'hit') world.tryRemoteHit(1);
  } else {
    if (m.t === 'p') world.applyRemote(0, m);
    else if (m.t === 'w') world.applySnapshot(m);
    else if (m.t === 'lvl') { if (m.lv !== world.levelIndex) world.startTransition(m.lv); }
    else if (m.t === 'win') world.showVictory();
  }
}

// ---------- online: lobby server ----------
let serverOk = null;
async function checkServer() {
  if (serverOk === null) serverOk = await Signaling.available();
  $('#server-box').hidden = !serverOk;
  $('#no-server').hidden = serverOk;
}

async function hostRoom() {
  cancelOnline();
  setStatus('#online-status', 'Creating room…');
  const s = new Signaling();
  sig = s;
  const l = new PeerLink(true);
  attachLink(l, true);
  l.onIce = (c) => s.send({ kind: 'ice', c }).catch(() => {});
  s.onError = (e) => setStatus('#online-status', `Lobby error: ${e.message}`, true);
  s.onSignal = async (m) => {
    try {
      if (m.kind === 'joined') {
        setStatus('#online-status', 'Friend joined — connecting…');
        await s.send({ kind: 'offer', sdp: await l.createOffer() });
      } else if (m.kind === 'answer') await l.acceptAnswer(m.sdp);
      else if (m.kind === 'ice') l.addIce(m.c);
      else if (m.kind === 'bye' && !l.open) { setStatus('#online-status', 'Room closed.', true); cancelOnline(); }
    } catch { setStatus('#online-status', 'Handshake failed.', true); }
  };
  try {
    await s.create();
    const rd = $('#room-display');
    rd.textContent = s.code;
    rd.hidden = false;
    setStatus('#online-status', 'Share this code. Waiting for a friend…');
  } catch (e) {
    setStatus('#online-status', `Could not create room: ${e.message}`, true);
    cancelOnline();
  }
}

async function joinRoom() {
  const code = $('#in-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ROOM_CODE_RE.test(code)) { setStatus('#online-status', 'Room codes are 6 letters/numbers.', true); return; }
  cancelOnline();
  setStatus('#online-status', 'Joining…');
  const s = new Signaling();
  sig = s;
  const l = new PeerLink(false);
  attachLink(l, false);
  l.onIce = (c) => s.send({ kind: 'ice', c }).catch(() => {});
  s.onError = (e) => setStatus('#online-status', `Lobby error: ${e.message}`, true);
  s.onSignal = async (m) => {
    try {
      if (m.kind === 'offer') await s.send({ kind: 'answer', sdp: await l.acceptOffer(m.sdp) });
      else if (m.kind === 'ice') l.addIce(m.c);
      else if (m.kind === 'bye' && !l.open) { setStatus('#online-status', 'Host closed the room.', true); cancelOnline(); }
    } catch { setStatus('#online-status', 'Handshake failed.', true); }
  };
  try {
    await s.join(code);
    setStatus('#online-status', 'Joined room — connecting…');
  } catch (e) {
    setStatus('#online-status', `Could not join: ${e.message}`, true);
    cancelOnline();
  }
}

// ---------- online: manual copy/paste ----------
function resetManualUi() {
  $('#manual-host').hidden = true;
  $('#manual-guest').hidden = true;
  for (const id of ['#mh-offer', '#mh-answer', '#mg-offer', '#mg-answer']) $(id).value = '';
  setStatus('#manual-status', '');
}

async function manualHost() {
  cancelOnline();
  resetManualUi();
  $('#manual-host').hidden = false;
  setStatus('#manual-status', 'Generating code…');
  const l = new PeerLink(true);
  attachLink(l, true);
  try {
    await l.createOffer();
    const sdp = await l.waitIceComplete();
    $('#mh-offer').value = encodeManual('o', sdp);
    setStatus('#manual-status', 'Send the code, then paste their reply.');
  } catch { setStatus('#manual-status', 'Could not create a code.', true); }
}

async function manualHostConnect() {
  if (!link) { setStatus('#manual-status', 'Start hosting first.', true); return; }
  const sdp = decodeManual($('#mh-answer').value, 'a');
  if (!sdp) { setStatus('#manual-status', 'That reply code is not valid.', true); return; }
  try {
    await link.acceptAnswer(sdp);
    setStatus('#manual-status', 'Connecting…');
  } catch { setStatus('#manual-status', 'Could not use that reply code.', true); }
}

async function manualGuestAnswer() {
  const sdp = decodeManual($('#mg-offer').value, 'o');
  if (!sdp) { setStatus('#manual-status', 'That host code is not valid.', true); return; }
  cancelOnline();
  const l = new PeerLink(false);
  attachLink(l, false);
  setStatus('#manual-status', 'Generating reply…');
  try {
    await l.acceptOffer(sdp);
    const ans = await l.waitIceComplete();
    $('#mg-answer').value = encodeManual('a', ans);
    setStatus('#manual-status', 'Send the reply code to the host. Waiting…');
  } catch { setStatus('#manual-status', 'Could not use that host code.', true); }
}

// ---------- main loop ----------
function inputsFor() {
  const pads = input.pads.length;
  if (mode === 'local') {
    return [
      input.player(0, 'p1', pads >= 2 ? 0 : null),
      input.player(1, 'p2', pads >= 2 ? 1 : pads === 1 ? 0 : null),
    ];
  }
  const me = input.player(0, 'all', 0);
  return mode === 'guest' ? [null, me] : [me];
}

const NEUTRAL = { left: false, right: false, jump: false, jumpPressed: false };

function step() {
  input.poll();
  if (currentPanel) menuNav();
  if (world) {
    const online = mode === 'host' || mode === 'guest';
    if ((input.wasPressed('Escape') || input.padPressed('start')) && !world.won) {
      if (paused && currentPanel !== 'menu-pause') show('menu-pause');
      else setPaused(!paused);
    }
    if (input.wasPressed('KeyM')) toggleMute();
    if (input.wasPressed('KeyH') && !currentPanel) { goHome(); input.endFrame(); return; }
    if (world.frame % 300 === 0 && savesRuns()) autosave();
    updateToolbar();
    if (world.won && (input.wasPressed('Enter') || input.wasPressed('TouchJump') || input.wasPressed('Space') || input.padPressed('jump'))) {
      if (world.worldClear && world.continueNext && save.run) {
        const r = save.run;
        startGame(r.mode, { startLevel: r.level, deaths: r.deaths, time: r.time });
      } else quitToMenu();
    } else if (!paused || online) {
      let inputs = inputsFor();
      if (paused) inputs = inputs.map((i) => (i ? NEUTRAL : i));
      if (!paused && input.wasPressed('KeyR')) world.localIdx.forEach((i) => world.restart(i));
      world.update(inputs);
      if (link && link.open) netTick();
    }
  }
  input.endFrame();
}

function netTick() {
  const f = world.frame;
  if (mode === 'host') {
    if (f % 2 === 0) link.send(world.playerState(0));
    if (f % 3 === 0) link.send(world.snapshot());
  } else if (mode === 'guest') {
    if (f % 2 === 0) link.send(world.playerState(1));
  }
  if (f % 120 === 0) link.send({ t: 'ping', n: ++pingN }, true);
}

// Title screen background: a slowly scrolling level preview.
let titleCanvas = null;
let titleT = 0;
function drawTitle() {
  if (!titleCanvas) {
    const L = LEVELS[0];
    titleCanvas = renderLevelCanvas(L.rows.map((r) => r.replace(/[A-Za-z]/g, ' ').split('')), 0);
  }
  titleT++;
  ctx.drawImage(titleCanvas, 0, 0);
  ctx.fillStyle = 'rgba(10,6,16,0.55)';
  ctx.fillRect(0, 0, W, H);
  if ((titleT >> 5) % 2) drawTextCentered(ctx, 'v1 - NO REFUNDS', W / 2, H - 10, '#4a3566');
}

let last = performance.now();
let acc = 0;
const DT = 1000 / 60;
function frame(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= DT) { step(); acc -= DT; }
  if (world) world.render(ctx); else drawTitle();
  requestAnimationFrame(frame);
}

show('menu-main');
requestAnimationFrame(frame);
