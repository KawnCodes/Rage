// Boot, menus, main loop, and online wiring.
import { World } from './game.js';
import { W, H } from './levels.js';
import { Input, TouchPad } from './input.js';
import { initAudio, sfx, setMuted, isMuted } from './audio.js';
import { drawTextCentered } from './font.js';
import { PeerLink, Signaling } from './net.js';
import { PROTOCOL_VERSION, sanitizeName, encodeManual, decodeManual, ROOM_CODE_RE } from './protocol.js';
import { renderLevelCanvas } from './sprites.js';
import { LEVELS, WORLDS, MULTIPLAYER_START, COOP_START, isBossLevel, isCoopLevel, stageLabel as shortLabel } from './levels.js';
import * as Save from './save.js';
import { MapScreen } from './map.js';

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
let profile = Save.activeProfile(); // 'solo' or a team id like 'ASIA & JULIAN'
let save = Save.load(profile);
const map = new MapScreen();
let lvMode = 'solo';
let currentPanel = null;

// ---------- layout ----------
function fit() {
  // On touch devices the game fills the screen and the toolbar floats over it.
  const overlay = document.body.classList.contains('touch-on');
  const bar = $('#toolbar').hidden || overlay ? 0 : 44;
  const s = Math.min(window.innerWidth / W, (window.innerHeight - bar) / H);
  const scale = s >= 2 && !overlay ? Math.floor(s) : s; // crisp integer scaling on desktop, fill the screen on touch
  canvas.style.width = `${Math.floor(W * scale)}px`;
  canvas.style.height = `${Math.floor(H * scale)}px`;
  // Room beside the game for the floating buttons? (phones held sideways)
  document.body.classList.toggle('tb-side', overlay && (window.innerWidth - W * scale) / 2 >= 52);
  $('#app').style.setProperty('--game-w', `${Math.floor(W * scale)}px`);
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 150));
fit();

// ---------- menus ----------
const panels = ['menu-main', 'menu-levels', 'menu-room', 'menu-profiles', 'menu-online', 'menu-manual', 'menu-controls', 'menu-cheats', 'menu-pause'];
const touchPad = new TouchPad($('#touch'), input);

// ---------- touch controls ----------
// 'auto' shows them on phones/tablets; 'on'/'off' force it (e.g. a tablet with a keyboard).
const TOUCH_MODES = ['auto', 'on', 'off'];
let touchMode = TOUCH_MODES.includes(store.get('rage-touch')) ? store.get('rage-touch') : 'auto';
const isTouchDevice = () => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches ||
      (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  } catch { return false; }
};
const touchActive = () => touchMode === 'on' || (touchMode === 'auto' && isTouchDevice());
function updateTouchUi() {
  const label = `Touch controls: ${touchMode}${touchMode === 'auto' ? (isTouchDevice() ? ' (on)' : ' (off)') : ''}`;
  for (const b of document.querySelectorAll('.touch-btn')) b.textContent = label;
  const t = $('#touch');
  const hide = currentPanel !== null || !world || !touchActive();
  if (hide !== t.hidden) { t.hidden = hide; touchPad.clear(); } // never carry a held button into/out of a menu
  t.dataset.layout = mode === 'local' ? 'two' : 'one';
  touchPad.setLayout(t.dataset.layout);
  const was = document.body.classList.contains('touch-on');
  document.body.classList.toggle('touch-on', touchActive());
  document.body.classList.toggle('playing', !!world && currentPanel === null);
  if (was !== touchActive()) fit();
}

// ---------- full screen ----------
const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const isStandalone = () => {
  try { return window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; }
};
async function enterFullscreen() {
  if (isFullscreen() || !fsSupported()) return;
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    // Phones: try to stay sideways (Android only; ignored elsewhere).
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
  } catch { /* the browser said no: carry on windowed */ }
}
async function toggleFullscreen() {
  if (isFullscreen()) {
    try { await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); } catch { /* ignore */ }
  } else if (fsSupported()) {
    await enterFullscreen();
  } else {
    toast(isStandalone() ? 'Already full screen' : 'On iPhone: tap Share, then Add to Home Screen for full screen', 4000);
  }
}
function updateFullscreenUi() {
  for (const b of document.querySelectorAll('.fs-btn')) {
    const on = isFullscreen() || isStandalone();
    b.textContent = b.closest('#toolbar') ? '⛶' : on ? 'Exit full screen' : 'Full screen';
    b.hidden = !fsSupported() && !b.closest('#toolbar') && isStandalone();
  }
  $('#ios-fs-note').hidden = fsSupported() || isStandalone() || !isTouchDevice();
}
document.addEventListener('fullscreenchange', () => { updateFullscreenUi(); fit(); });
document.addEventListener('webkitfullscreenchange', () => { updateFullscreenUi(); fit(); });
// A first touch anywhere on a device we didn't detect switches 'auto' on.
window.addEventListener('touchstart', () => { if (touchMode === 'auto') updateTouchUi(); }, { passive: true });

function show(id) {
  currentPanel = id;
  for (const p of panels) $(`#${p}`).hidden = p !== id;
  input.capture = id === null;
  updateTouchUi();
  const barHidden = !world;
  if ($('#toolbar').hidden !== barHidden) { $('#toolbar').hidden = barHidden; fit(); }
  if (id === 'menu-main') refreshMain();
  if (id === 'menu-pause') refreshPause();
  if (id === null) { document.activeElement?.blur?.(); return; }
  if (touchActive() || id === 'menu-levels') return; // no focus rings / pop-up keyboards on phones; the map uses the keys itself
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
  if (b.closest('#toolbar') || b.closest('.mapbar')) b.blur();
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
  levels: () => openMap(),
  'lvmode-solo': () => setLvMode('solo'),
  'lvmode-local': () => { if (requireMultiplayer()) setLvMode('local'); },
  'map-play': () => mapPlay(),
  profiles: () => { renderProfiles(); show('menu-profiles'); },
  'team-create': () => createTeamFromForm(),
  'code-copy': () => copy('#code-out'),
  'code-import': () => importProgressCode(),
  'reset-progress': () => {
    if (!window.confirm('Reset all progress, unlocks and best times?')) return;
    save = Save.wipe(profile);
    openMap();
    toast('Progress reset');
  },
  online: () => { if (requireMultiplayer()) { show('menu-online'); checkServer(); } },
  'share-progress': () => shareProgress(),
  'room-start': () => startFromRoom(),
  'room-leave': () => { if (link) link.send({ t: 'bye' }, true); cancelOnline(); show('menu-online'); },
  controls: () => { show('menu-controls'); renderPads(); },
  mute: () => toggleMute(),
  fullscreen: () => toggleFullscreen(),
  cheats: () => { $('#in-cheat').value = ''; setStatus('#cheat-status', ''); show('menu-cheats'); },
  'cheat-submit': () => enterCheat($('#in-cheat').value),
  'touch-mode': () => {
    touchMode = TOUCH_MODES[(TOUCH_MODES.indexOf(touchMode) + 1) % TOUCH_MODES.length];
    store.set('rage-touch', touchMode);
    updateTouchUi();
  },
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
  if (m === 'guest') { // the host decides; anything odd falls back to World 2
    const lv = Number(opts.startLevel);
    opts = { ...opts, startLevel: Number.isInteger(lv) && LEVELS[lv] && lv >= MULTIPLAYER_START ? lv : MULTIPLAYER_START };
  }
  if (m === 'host') opts = { ...opts, startLevel: hostStartLevel() }; // online play is World 2 onwards
  world = new World({ mode: m, names, onEvent, ...opts });
  autosave();
  if (touchActive()) enterFullscreen(); // started by a tap, so the browser allows it
  show(null);
}

function newRun(m, startLevel = 0) {
  let lv = Math.min(startLevel, save.unlocked);
  if (m === 'solo' && isCoopLevel(lv)) { toast('World 3 is co-op only: play it in Local 2 player or Online', 3000); return; }
  if (m === 'local') {
    if (!Save.multiplayerUnlocked(save)) return;
    lv = Math.max(lv, MULTIPLAYER_START); // 2 player is World 2 onwards
  }
  startGame(m, { startLevel: lv });
}

// ---------- cheat codes ----------
// Codes are stored only as salted hashes, so they can't be read from the source.
function cheatHash(str, seed = 0x5241) { // cyrb53 (public domain)
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const unlockAll = (s) => { s.unlocked = LEVELS.length - 1; };
const CHEATS = {
  '2fzw1xhxgmj': {
    msg: () => 'Multiplayer unlocked! World 2, Local 2 player and Online are open.',
    apply: (s) => { s.unlocked = Math.max(s.unlocked, MULTIPLAYER_START); },
  },
  '17fhowd5710': { msg: () => 'Every world and stage is unlocked!', apply: unlockAll },
  pva0ezqt6: {
    msg: (code) => `Hi ${code[0]}${code.slice(1).toLowerCase()}! Everything is unlocked, just for you.`,
    apply: unlockAll,
  },
};

function enterCheat(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const c = code ? CHEATS[cheatHash(`rage:${code}`)] : null;
  if (!c) {
    sfx('die');
    setStatus('#cheat-status', code ? 'Nope. That is not a code.' : 'Type a code first.', true);
    return;
  }
  c.apply(save);
  save.cheated = true;
  Save.store(save, profile);
  sfx('huzzar');
  setStatus('#cheat-status', c.msg(code));
  $('#in-cheat').value = '';
}
$('#in-cheat').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enterCheat(e.target.value); } });

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
  Save.store(save, profile);
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
  $('#btn-profile').textContent = `Profile: ${profileName()} ▸`;
  const mp = Save.multiplayerUnlocked(save);
  for (const [sel, label] of [['[data-go="new-local"]', 'Local 2 player'], ['[data-go="online"]', 'Online lobby']]) {
    const el = $(`#menu-main ${sel}`);
    el.textContent = mp ? label : `🔒 ${label}`;
    el.classList.toggle('locked-btn', !mp);
    el.title = mp ? '' : 'Unlocks in World 2';
  }
  $('#mp-note').hidden = mp;
  $('#coop-note').hidden = save.unlocked < COOP_START;
  const bits = [`Lifetime deaths: ${save.totalDeaths}`];
  if (save.wins) bits.push(`Wins: ${save.wins}`);
  if (save.cheated) bits.push('cheats used 😏');
  $('#stats-line').textContent = bits.join(' · ');
}

function refreshPause() {
  const online = mode === 'host' || mode === 'guest';
  for (const el of document.querySelectorAll('#menu-pause .offline-only')) el.hidden = online;
  for (const el of document.querySelectorAll('#menu-pause .online-only')) el.hidden = !online || !link;
  if (world) {
    const b = save.best[world.levelIndex];
    $('#pause-info').textContent = `${stageLabel(world.levelIndex)}: ${world.level.name}` +
      (b ? ` · best ${b.deaths} deaths, ${Save.formatTime(b.time)}` : '') +
      (online ? ' · online game keeps running' : '');
  }
  updateMuteLabel();
}

// ---------- overworld map (level select) ----------
function openMap() {
  if (!Save.multiplayerUnlocked(save)) lvMode = 'solo';
  const hint = world ? world.levelIndex : save.run ? save.run.level : save.unlocked;
  map.open(save, lvMode, hint);
  setLvMode(lvMode);
  show('menu-levels');
}

function setLvMode(m) {
  lvMode = m;
  map.mode = m;
  map.save = save;
  $('#lvmode-solo').setAttribute('aria-checked', String(m === 'solo'));
  $('#lvmode-local').setAttribute('aria-checked', String(m === 'local'));
  $('#lvmode-local').textContent = Save.multiplayerUnlocked(save) ? '2P' : '🔒 2P';
}

function mapPlay() {
  const i = map.cursor;
  const st = map.status(i);
  if (st === 'ok') { newRun(lvMode, i); return; }
  sfx('bonk');
  toast(st === 'locked' ? 'Locked: beat the stage before it first'
    : st === 'solo-only' ? 'World 1 is solo only: switch to Solo' : 'This world is co-op: switch to 2P', 2500);
}

function mapInput() {
  const pressed = (...codes) => codes.some((c) => input.wasPressed(c));
  if (pressed('ArrowLeft', 'KeyA') || input.padPressed('left')) map.move(-1) && sfx('select');
  if (pressed('ArrowRight', 'KeyD') || input.padPressed('right')) map.move(1) && sfx('select');
  if (pressed('ArrowUp', 'KeyW', 'KeyE', 'PageUp') || input.padPressed('up')) map.switchWorld(1) && sfx('select');
  if (pressed('ArrowDown', 'KeyS', 'KeyQ', 'PageDown') || input.padPressed('down')) map.switchWorld(-1) && sfx('select');
  if (pressed('Enter', 'Space') || input.padPressed('a')) mapPlay();
  if (!world && (pressed('Escape') || input.padPressed('back'))) actions.back();
}

// Click / tap on the map: tap a stage to walk there, tap it again to play.
canvas.addEventListener('pointerdown', (e) => {
  if (currentPanel !== 'menu-levels') return;
  initAudio();
  const r = canvas.getBoundingClientRect();
  const hit = map.hit(((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height);
  if (!hit) return;
  if (hit.type === 'world') { if (map.switchWorld(hit.d)) sfx('select'); return; }
  if (hit.i === map.cursor && !map.walk) mapPlay();
  else if (hit.i <= save.unlocked) { map.walkTo(hit.i); sfx('select'); }
  else { sfx('bonk'); toast('Locked: beat the stage before it first', 2000); }
});

// ---------- profiles / shared progress ----------
const profileName = () => (profile === 'solo' ? 'Solo' : `Team ${profile}`);

function switchProfile(id) {
  if (world) autosave();
  profile = Save.setActiveProfile(id);
  save = Save.load(profile);
  map.save = save;
}

function renderProfiles() {
  const list = $('#profile-list');
  list.replaceChildren();
  const furthest = (u) => `World ${LEVELS[u].world + 1}, ${shortLabel(u)}`;
  const entries = [{ id: 'solo', label: 'Solo', unlocked: Save.load('solo').unlocked }, ...Save.listTeams().map((t) => ({ id: t.id, label: `Team ${t.id}`, unlocked: t.unlocked }))];
  for (const en of entries) {
    const row = document.createElement('div');
    row.className = 'prow';
    const pick = document.createElement('button');
    pick.className = 'pick';
    pick.setAttribute('role', 'radio');
    pick.setAttribute('aria-checked', String(en.id === profile));
    pick.textContent = `${en.id === profile ? '● ' : ''}${en.label} · ${furthest(en.unlocked)}`;
    pick.addEventListener('click', () => { sfx('select'); switchProfile(en.id); renderProfiles(); setStatus('#profile-status', `Now playing as ${profileName()}`); });
    row.append(pick);
    if (en.id !== 'solo') {
      const del = document.createElement('button');
      del.className = 'del danger';
      del.textContent = '✕';
      del.title = `Delete ${en.label}`;
      del.addEventListener('click', () => {
        if (!window.confirm(`Delete ${en.label} and its progress?`)) return;
        Save.deleteTeam(en.id);
        if (profile === en.id) switchProfile('solo');
        renderProfiles();
      });
      row.append(del);
    }
    list.append(row);
  }
  $('#code-out').value = Save.myCode(profile);
  renderInbox($('#profile-inbox'));
}

function createTeamFromForm() {
  const a = sanitizeName($('#in-team-a').value), b = sanitizeName($('#in-team-b').value);
  if (!$('#in-team-a').value.trim() || !$('#in-team-b').value.trim()) { setStatus('#profile-status', 'Type both names first.', true); return; }
  if (a === b) { setStatus('#profile-status', 'Use two different names.', true); return; }
  const id = ensureTeam(a, b);
  if (!id) { setStatus('#profile-status', 'Too many teams: delete one first.', true); return; }
  switchProfile(id);
  $('#in-team-a').value = ''; $('#in-team-b').value = '';
  renderProfiles();
  setStatus('#profile-status', `Team ${id} created. You're playing as the team now.`);
}

// A team's worlds are open as far as either player has got on their own (each device adds
// its solo progress; online, the two are then combined), and always at least World 2,
// since World 1 is solo-only and that's where co-op begins.
function ensureTeam(a, b) {
  const id = Save.createTeam(a, b);
  if (!id) return null;
  const s = Save.load(id);
  const solo = Save.load('solo');
  const want = Math.max(MULTIPLAYER_START, solo.unlocked);
  if (s.unlocked < want) { s.unlocked = want; Save.store(s, id); }
  return id;
}

function importProgressCode() {
  const got = Save.importCode($('#code-in').value);
  if (!got) { setStatus('#profile-status', 'That progress code is not valid.', true); return; }
  let target = 'solo';
  if (got.names) {
    target = ensureTeam(got.names[0], got.names[1]);
    if (!target) { setStatus('#profile-status', 'Too many teams: delete one first.', true); return; }
  }
  const merged = Save.merge(Save.load(target), got.save);
  merged.run = Save.load(target).run;
  Save.store(merged, target);
  switchProfile(target);
  $('#code-in').value = '';
  renderProfiles();
  setStatus('#profile-status', `Progress loaded into ${profileName()} (combined with what was already here).`);
}

// Online: both players use (and keep in sync) the team profile for the two of them.
function joinTeamWith(partner) {
  const id = ensureTeam(myName(), partner);
  if (!id) return;
  if (profile !== id) switchProfile(id);
  toast(`Playing as Team ${id}: progress is shared`, 3500);
}

function sendProgress() {
  if (link && profile !== 'solo') link.send({ t: 'prog', ...Save.toWire(save) }, true);
}

function receiveProgress(m) {
  if (profile === 'solo') return;
  const run = save.run;
  save = Save.merge(save, Save.fromWire(m));
  save.run = run;
  map.save = save;
  Save.store(save, profile);
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
  if (e.key !== null && e.key !== 'rage-save-v1' && e.key !== 'rage-teams-v1') return;
  const fresh = Save.load(profile);
  if (world && savesRuns()) fresh.run = save.run;
  save = fresh;
  if (currentPanel === 'menu-main') refreshMain();
  map.save = save;
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
    Save.store(save, profile);
    if (mode === 'host') sendProgress();
  }
  if (type === 'level-loaded') autosave();
  if (type === 'world-clear' && data) {
    const firstUnlock = data.world === 0 && !save.best[MULTIPLAYER_START];
    save.unlocked = Math.max(save.unlocked, data.next); // solo players skip the co-op world
    if (savesRuns()) {
      const canGoOn = !(mode === 'solo' && data.nextCoop);
      save.run = canGoOn ? { mode, level: data.next, deaths: world.players.map((p) => p.deaths).concat(0).slice(0, 2), time: world.time } : null;
      world.continueNext = canGoOn;
    }
    Save.store(save, profile);
    const nw = data.nextWorld + 1;
    toast(firstUnlock ? `World ${nw} unlocked! 2 player modes unlocked!`
      : data.nextCoop ? `World ${nw} unlocked! It's co-op: grab a friend.`
      : data.skipped >= 0 ? `World ${nw} unlocked! (World ${data.skipped + 1} is co-op: play it with a friend)` : `World ${nw} unlocked!`, 4500);
    if (mode === 'host') sendProgress();
    if (mode === 'host' && link) link.send({ t: 'win' }, true);
  }
  if (type === 'victory') {
    save.wins++;
    if (savesRuns()) save.run = null;
    Save.store(save, profile);
    if (mode === 'host') sendProgress();
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
    if (!wasPlaying && currentPanel === 'menu-room') {
      toast(`${partnerName} left the room`, 3500);
      show('menu-online');
      return;
    }
    if (!wasPlaying) {
      setStatus('#online-status', 'Connection failed or closed.', true);
      setStatus('#manual-status', 'Connection failed or closed.', true);
      return;
    }
    if (mode === 'host' && world.level.coop) {
      toast('Partner left. World 3 needs 2 players, so the game ended.', 5000);
      quitToMenu();
    } else if (mode === 'host') {
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
    if (world || currentPanel === 'menu-room') return; // already together
    partnerName = m.name;
    roomIsHost = isHost;
    joinTeamWith(partnerName);
    sendProgress();
    openRoom();
    return;
  }
  if (m.t === 'bye') { link && link.close(); return; }
  if (m.t === 'share') { receiveShare(m.code); return; }
  if (m.t === 'prog') { receiveProgress(m); if (currentPanel === 'menu-room') renderRoom(); return; }
  if (!world) {
    if (m.t === 'start' && !isHost && currentPanel === 'menu-room') {
      startGame('guest', { startLevel: m.lv });
      toast(`Playing with ${partnerName}`);
    }
    return;
  }
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

function hostStartLevel() {
  const v = Number($('#room-world').value);
  const w = WORLDS.find((x) => x.start === v);
  return w && w.start >= MULTIPLAYER_START && w.start <= save.unlocked ? w.start : MULTIPLAYER_START;
}

function renderWorldPick() {
  const sel = $('#room-world');
  const prev = sel.value;
  sel.replaceChildren();
  for (const [i, w] of WORLDS.entries()) {
    if (w.start < MULTIPLAYER_START || w.start > save.unlocked) continue;
    const o = document.createElement('option');
    o.value = String(w.start);
    o.textContent = `World ${i + 1}: ${w.name}${w.coop ? ' (co-op)' : ''}`;
    sel.append(o);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  $('#room-world-label').hidden = sel.options.length < 2;
}

// ---------- the room (after connecting, before the game) ----------
let roomIsHost = false;
let lastShare = -Infinity;

function openRoom() {
  setStatus('#room-status', '');
  renderRoom();
  show('menu-room');
}

function renderRoom() {
  $('#room-who').textContent = `${myName()} + ${partnerName} · connected`;
  const u = save.unlocked;
  $('#room-progress').textContent = `${profileName()}: up to World ${LEVELS[u].world + 1} (${shortLabel(u)})`;
  renderWorldPick();
  $('#room-world-label').hidden = !roomIsHost || $('#room-world').options.length < 2;
  $('#btn-room-start').hidden = !roomIsHost;
  $('#room-wait').textContent = roomIsHost ? '' : `Waiting for ${partnerName} to start the game…`;
  renderInbox($('#room-inbox'), partnerName);
}

function startFromRoom() {
  if (!link || !link.open || !roomIsHost) return;
  startGame('host');
  link.send({ t: 'start', lv: world.levelIndex }, true);
  link.send({ t: 'lvl', lv: world.levelIndex }, true);
  toast(`Playing with ${partnerName}`);
}

// One press: send your own progress code to your partner.
function shareProgress() {
  if (!link || !link.open) { toast('Share works when you are connected to someone', 2500); return; }
  const now = performance.now();
  if (now - lastShare < 2000) return;
  lastShare = now;
  link.send({ t: 'share', code: Save.myCode('solo') }, true);
  sfx('select');
  const d = Save.describeCode(Save.myCode('solo'));
  const msg = `Sent your progress (World ${d.world + 1}, ${shortLabel(d.unlocked)}) to ${partnerName}`;
  setStatus('#room-status', msg);
  toast(msg, 2500);
}

function receiveShare(code) {
  const entry = Save.addToInbox(partnerName, code);
  if (!entry) return;
  const d = Save.describeCode(code);
  sfx('huzzar');
  toast(`${partnerName} shared progress: World ${d.world + 1}. It's in Received progress.`, 4000);
  if (currentPanel === 'menu-room') renderRoom();
  if (currentPanel === 'menu-profiles') renderProfiles();
}

// List of received codes with "add" and "delete" buttons. Kept on this device.
function renderInbox(container, onlyFrom) {
  container.replaceChildren();
  const list = Save.inbox().filter((e) => !onlyFrom || e.from === sanitizeName(onlyFrom));
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'inbox-empty';
    p.textContent = onlyFrom ? `Nothing from ${onlyFrom} yet.` : 'Nothing received yet.';
    container.append(p);
    return;
  }
  for (const e of list) {
    const d = Save.describeCode(e.code);
    const row = document.createElement('div');
    row.className = 'inbox-row';
    const what = document.createElement('span');
    what.className = 'what';
    const when = new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    what.textContent = `From ${e.from} · up to World ${d.world + 1} (${shortLabel(d.unlocked)}) · ${d.cleared} stages cleared · ${when}`;
    const add = document.createElement('button');
    add.textContent = `Add to ${profile === 'solo' ? 'my solo' : 'team'}`;
    add.addEventListener('click', () => {
      const got = Save.importCode(e.code);
      if (!got) return;
      const run = save.run;
      save = Save.merge(save, got.save);
      save.run = run;
      map.save = save;
      Save.store(save, profile);
      if (link && profile !== 'solo') sendProgress(); // keep the team in sync on both devices
      sfx('huzzar');
      toast(`Added to ${profileName()}: now up to World ${LEVELS[save.unlocked].world + 1}`, 3000);
      if (currentPanel === 'menu-room') renderRoom(); else renderProfiles();
    });
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '✕';
    del.title = 'Remove';
    del.addEventListener('click', () => { Save.removeFromInbox(e.id); renderInbox(container, onlyFrom); });
    row.append(what, add, del);
    container.append(row);
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
  if (currentPanel === 'menu-levels') mapInput();
  else if (currentPanel) menuNav();
  if (world) {
    const online = mode === 'host' || mode === 'guest';
    if ((input.wasPressed('Escape') || input.padPressed('start')) && !world.won) {
      if (paused && currentPanel !== 'menu-pause') show('menu-pause');
      else setPaused(!paused);
    }
    if (input.wasPressed('KeyM')) toggleMute();
    if (input.wasPressed('KeyF')) toggleFullscreen();
    if (input.wasPressed('KeyH') && !currentPanel) { goHome(); input.endFrame(); return; }
    if (world.frame % 300 === 0 && savesRuns()) autosave();
    updateToolbar();
    if (world.won && (input.wasPressed('Enter') || input.wasPressed('TouchJump') || input.wasPressed('TouchJump2') || input.wasPressed('Space') || input.padPressed('jump'))) {
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
  if (currentPanel === 'menu-levels') map.draw(ctx);
  else if (world) world.render(ctx);
  else drawTitle();
  requestAnimationFrame(frame);
}

// Show the address other devices on the same Wi-Fi can open (only when the server allows it).
async function showLanAddress() {
  try {
    const r = await fetch('api/lan', { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return;
    const j = await r.json();
    const urls = Array.isArray(j.urls) ? j.urls.filter((u) => typeof u === 'string' && /^http:\/\/[0-9.]{7,15}:\d{1,5}$/.test(u)) : [];
    if (!urls.length) return; // local-only mode, or static hosting
    for (const el of document.querySelectorAll('.lan-line')) {
      el.textContent = `Same Wi-Fi? Other devices can play at ${urls[0]}`;
      el.hidden = false;
    }
  } catch { /* static hosting: no server, nothing to show */ }
}

show('menu-main');
updateTouchUi();
updateFullscreenUi();
showLanAddress();
requestAnimationFrame(frame);
