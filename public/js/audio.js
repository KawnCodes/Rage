// Tiny synthesized chiptune sound effects (WebAudio, no audio files).
let ac = null;
let muted = false;

export function initAudio() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    if (ac && ac.state === 'suspended') ac.resume();
  } catch { ac = null; }
}

export function setMuted(m) { muted = !!m; }
export function isMuted() { return muted; }

// [startHz, endHz, seconds, wave, volume, delay]
const SFX = {
  jump: [[330, 660, 0.09, 'square', 0.05]],
  die: [[420, 60, 0.35, 'sawtooth', 0.08], [200, 40, 0.3, 'square', 0.05, 0.05]],
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
  zap: [[1800, 900, 0.12, 'sawtooth', 0.025]],
};

function tone(f0, f1, dur, type, vol, delay = 0) {
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function sfx(name) {
  if (muted || !ac || ac.state !== 'running') return;
  const s = SFX[name];
  if (!s) return;
  try {
    for (const [f0, f1, d, type, v, delay] of s) tone(f0, f1, d, type, v, delay);
  } catch { /* audio is optional */ }
}
