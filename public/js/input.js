// Keyboard + Gamepad input. Bluetooth controllers paired with the device show
// up through the standard Gamepad API, so they work here with no extra code.

const SCHEMES = {
  all: { left: ['ArrowLeft', 'KeyA', 'TouchLeft'], right: ['ArrowRight', 'KeyD', 'TouchRight'], jump: ['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyK', 'TouchJump'] },
  p1: { left: ['KeyA', 'TouchLeft'], right: ['KeyD', 'TouchRight'], jump: ['KeyW', 'Space', 'TouchJump'] },
  p2: { left: ['ArrowLeft', 'TouchLeft2'], right: ['ArrowRight', 'TouchRight2'], jump: ['ArrowUp', 'Slash', 'Numpad0', 'ControlRight', 'TouchJump2'] },
};
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Slash', 'Numpad0']);

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.prevJump = [false, false];
    this.prevPadButtons = [];
    this.pads = [];
    this.capture = false;
    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); });
    window.addEventListener('blur', () => this.down.clear());
  }

  poll() {
    let list = [];
    try { list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch { list = []; }
    this.pads = list.filter((p) => p && p.connected);
  }

  padNames() {
    return this.pads.map((p) => String(p.id).slice(0, 60));
  }

  pad(i) {
    const p = this.pads[i];
    if (!p) return null;
    const b = (n) => !!(p.buttons[n] && p.buttons[n].pressed);
    const ax = p.axes[0] || 0;
    return {
      left: ax < -0.4 || b(14),
      right: ax > 0.4 || b(15),
      up: (p.axes[1] || 0) < -0.5 || b(12),
      down: (p.axes[1] || 0) > 0.5 || b(13),
      jump: b(0) || b(1),
      a: b(0),
      back: b(1),
      start: b(9),
    };
  }

  // Edge-detected gamepad button for menus/pause.
  padPressed(name) {
    let hit = false;
    this.pads.forEach((_, i) => {
      const s = this.pad(i);
      const prev = this.prevPadButtons[i] || {};
      if (s && s[name] && !prev[name]) hit = true;
    });
    return hit;
  }

  player(slot, scheme, padIndex) {
    const k = SCHEMES[scheme];
    const any = (codes) => codes.some((c) => this.down.has(c));
    const pad = padIndex === null || padIndex === undefined ? null : this.pad(padIndex);
    const left = any(k.left) || !!(pad && pad.left);
    const right = any(k.right) || !!(pad && pad.right);
    const jump = any(k.jump) || !!(pad && pad.jump);
    const jumpPressed = (jump && !this.prevJump[slot]) || k.jump.some((c) => this.pressed.has(c));
    this.prevJump[slot] = jump;
    return { left, right, jump, jumpPressed };
  }

  wasPressed(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.prevPadButtons = this.pads.map((_, i) => this.pad(i));
  }
}

// ---------------------------------------------------------------------------
// Touch controls.
//
// One full-screen layer tracks every finger (Touch Events, with Pointer Events
// as a fallback for mouse/pen) and, on every change, works out which virtual
// button each finger is over. Nothing depends on a touch *starting* inside a
// button, so:
//   - taps that land between or just outside the buttons still count
//   - sliding a thumb from left to right switches direction without lifting
//   - the state is rebuilt from the live finger list every time, and anything
//     that can swallow a "finger up" (menus, alerts, app switching, browser
//     gestures) clears it, so buttons can't get stuck down.
//
// Layout "one": left half of the screen = move (left/right of the D-pad
// centre), right half = jump.
// Layout "two": left half = player 1, right half = player 2; each finger picks
// the nearest of that player's three buttons.
export class TouchPad {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    this.layout = 'one';
    this.fingers = new Map(); // id -> { x, y }
    this.active = new Set(); // codes currently held
    this.buttons = [...root.querySelectorAll('[data-touch]')];
    const opt = { passive: false };
    root.addEventListener('touchstart', (e) => this.onTouch(e), opt);
    root.addEventListener('touchmove', (e) => this.onTouch(e), opt);
    root.addEventListener('touchend', (e) => this.onTouch(e), opt);
    root.addEventListener('touchcancel', (e) => this.onTouch(e), opt);
    // Mouse / pen (e.g. testing with touch controls forced on).
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.fingers.set(`p${e.pointerId}`, { x: e.clientX, y: e.clientY });
      this.sync();
    });
    root.addEventListener('pointermove', (e) => {
      const id = `p${e.pointerId}`;
      if (e.pointerType === 'touch' || !this.fingers.has(id)) return;
      this.fingers.set(id, { x: e.clientX, y: e.clientY });
      this.sync();
    });
    const up = (e) => { if (e.pointerType !== 'touch' && this.fingers.delete(`p${e.pointerId}`)) this.sync(); };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // Anything that can eat a "finger up" resets the controls.
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => this.clear());
    window.addEventListener('orientationchange', () => this.clear());
  }

  onTouch(e) {
    if (e.cancelable) e.preventDefault(); // no scrolling, zooming, callouts or delayed clicks
    const live = new Set();
    for (const t of e.touches) live.add(t.identifier);
    for (const t of e.changedTouches) {
      if (e.type === 'touchend' || e.type === 'touchcancel') this.fingers.delete(t.identifier);
      else this.fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    // Drop any finger the browser no longer reports (lost touchend).
    for (const id of [...this.fingers.keys()]) if (typeof id === 'number' && !live.has(id)) this.fingers.delete(id);
    this.sync();
  }

  centre(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  codeFor(f) {
    const box = this.root.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    const byCode = (c) => this.buttons.find((b) => b.dataset.touch === c);
    if (this.layout === 'one') {
      if (f.x >= mid) return 'TouchJump';
      const l = this.centre(byCode('TouchLeft')), r = this.centre(byCode('TouchRight'));
      return f.x < (l.x + r.x) / 2 ? 'TouchLeft' : 'TouchRight';
    }
    const group = f.x < mid ? ['TouchLeft', 'TouchRight', 'TouchJump'] : ['TouchLeft2', 'TouchRight2', 'TouchJump2'];
    let best = null, bestD = Infinity;
    for (const c of group) {
      const p = this.centre(byCode(c));
      const d = Math.abs(p.x - f.x) + Math.abs(p.y - f.y) * 0.35; // mostly horizontal: thumbs drift up and down
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  sync() {
    const now = new Set();
    if (!this.root.hidden) for (const f of this.fingers.values()) now.add(this.codeFor(f));
    for (const c of now) if (!this.active.has(c)) this.input.pressed.add(c); // a fresh press, even if released this frame
    for (const c of this.active) this.input.down.delete(c);
    for (const c of now) this.input.down.add(c);
    this.active = now;
    for (const b of this.buttons) b.classList.toggle('on', now.has(b.dataset.touch));
  }

  setLayout(layout) {
    if (layout !== this.layout) { this.layout = layout; this.clear(); }
  }

  clear() {
    this.fingers.clear();
    this.sync();
  }
}
