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

  // On-screen touch buttons: <button data-touch="TouchLeft"> etc.
  bindTouch(root) {
    for (const el of root.querySelectorAll('[data-touch]')) {
      const code = el.dataset.touch;
      const on = (e) => { e.preventDefault(); if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); };
      const off = (e) => { e.preventDefault(); this.down.delete(code); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
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
