// Tiny synthesized chiptune sound effects (WebAudio, no audio files).
let ac = null;
let muted = false;

// iPhone/iPad notes:
//  * Safari only lets sound start inside a real tap (touchend/click), so this
//    is called on every tap, not just the first one; it's a no-op once running.
//  * The context can drop to 'suspended' or 'interrupted' after a call, Siri,
//    or switching apps, so every tap also tries to wake it back up.
//  * Web audio normally obeys the ring/silent switch. Asking for the
//    'playback' session (iOS 17+) makes the game audible like a video would be;
//    the in-game mute button still silences it.
let unlocked = false;
export function initAudio() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ac = new AC({ latencyHint: 'interactive' }); } catch { ac = new AC(); }
    }
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    if (ac.state !== 'running') {
      const p = ac.resume();
      if (p && p.catch) p.catch(() => {});
    }
    if (!unlocked || ac.state !== 'running') {
      // Playing a silent sample inside the gesture is what actually unlocks iOS.
      const b = ac.createBuffer(1, 1, 22050);
      const src = ac.createBufferSource();
      src.buffer = b;
      src.connect(ac.destination);
      src.start(0);
      unlocked = true;
    }
  } catch { /* audio is optional */ }
}

export function setMuted(m) { muted = !!m; }
export function isMuted() { return muted; }

// [startHz, endHz, seconds, wave, volume, delay, vibratoHz, vibratoDepthHz]
const SFX = {
  jump: [[330, 660, 0.09, 'square', 0.05]],
  // Deaths: one of these plays at random (see DEATHS below).
  dieTrombone: [ // wah wah wah waaaah
    [392, 380, 0.17, 'sawtooth', 0.055, 0], [370, 358, 0.17, 'sawtooth', 0.055, 0.19],
    [349, 338, 0.17, 'sawtooth', 0.055, 0.38], [330, 300, 0.42, 'sawtooth', 0.055, 0.57, 7, 9],
  ],
  dieWhistle: [ // slide whistle down ... bonk
    [1500, 260, 0.5, 'sine', 0.07, 0, 9, 25], [140, 90, 0.09, 'square', 0.07, 0.52],
  ],
  dieBalloon: [ // deflating raspberry
    [180, 70, 0.7, 'sawtooth', 0.06, 0, 14, 22], [90, 45, 0.7, 'square', 0.03, 0, 11, 10],
  ],
  boing: [[180, 880, 0.18, 'square', 0.06]],
  bonk: [[140, 90, 0.08, 'square', 0.07]],
  spike: [[900, 1400, 0.05, 'square', 0.05]],
  crack: [[120, 80, 0.12, 'sawtooth', 0.05]],
  fall: [[600, 200, 0.2, 'triangle', 0.06]],
  whoosh: [[200, 1200, 0.3, 'triangle', 0.06]],
  door: [[523, 523, 0.08, 'square', 0.05], [659, 659, 0.08, 'square', 0.05, 0.08], [784, 784, 0.16, 'square', 0.05, 0.16]],
  hit: [[880, 220, 0.2, 'square', 0.08], [440, 110, 0.25, 'sawtooth', 0.05, 0.05]],
  slam: [[90, 30, 0.35, 'sawtooth', 0.12]],
  shoot: [[700, 300, 0.07, 'square', 0.03]],
  lol: [[300, 500, 0.1, 'square', 0.05], [300, 500, 0.1, 'square', 0.05, 0.14]],
  win: [[523, 523, 0.12, 'square', 0.05], [659, 659, 0.12, 'square', 0.05, 0.12], [784, 784, 0.12, 'square', 0.05, 0.24], [1046, 1046, 0.4, 'square', 0.05, 0.36]],
  select: [[660, 990, 0.05, 'square', 0.04]],
  // HUZZAR!! fanfare: quick rising notes, a held chord and a sparkle on top
  huzzar: [
    [523, 523, 0.08, 'square', 0.05], [659, 659, 0.08, 'square', 0.05, 0.09], [784, 784, 0.08, 'square', 0.05, 0.18],
    [1046, 1046, 0.36, 'square', 0.05, 0.27], [784, 784, 0.36, 'triangle', 0.05, 0.27], [523, 523, 0.36, 'triangle', 0.04, 0.27],
    [1568, 2093, 0.1, 'square', 0.02, 0.5], [2093, 2637, 0.12, 'square', 0.015, 0.58],
  ],
  zap: [[1800, 900, 0.12, 'sawtooth', 0.025]],
  gate: [[160, 260, 0.12, 'square', 0.05]],
  clank: [[1200, 700, 0.06, 'square', 0.06], [900, 500, 0.08, 'triangle', 0.05, 0.05]],
};

const DEATHS = ['dieTrombone', 'dieWhistle', 'dieBalloon'];
let lastDeath = -1;

function tone(f0, f1, dur, type, vol, delay = 0, vibHz = 0, vibDepth = 0) {
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (vibHz > 0) {
    // wobble: a slow oscillator nudging the pitch up and down
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.setValueAtTime(vibHz, t);
    depth.gain.setValueAtTime(vibDepth, t);
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
  }
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function sfx(name) {
  if (muted || !ac) return;
  if (ac.state !== 'running') {
    // woke up after an interruption? try again (works once iOS allows it)
    try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    return;
  }
  if (name === 'die') {
    // pick a funny death sound, never the same one twice in a row
    let i = Math.floor(Math.random() * DEATHS.length);
    if (i === lastDeath) i = (i + 1) % DEATHS.length;
    lastDeath = i;
    name = DEATHS[i];
  }
  const s = SFX[name];
  if (!s) return;
  try {
    for (const [f0, f1, d, type, v, delay, vib, depth] of s) tone(f0, f1, d, type, v, delay, vib, depth);
  } catch { /* audio is optional */ }
}
