import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLook, lookFrames, lookColor, presetToPx, COLORS, FACES, HATS, PAINT, SPRITE_H, DEFAULT_LOOKS } from '../public/js/looks.js';
import { decode } from '../public/js/protocol.js';

const allowed = new Set([null, ...PAINT, ...COLORS.flatMap((c) => [c.body, c.hi]), '#3060c0', '#f5c542', '#e8334a', '#f4f0ff', '#0a0610', '#ff6ad0', '#5fd068']);

test('every preset combination builds 5 frames of the right size from known colours', () => {
  for (let c = 0; c < COLORS.length; c++) for (let f = 0; f < FACES.length; f++) for (let h = 0; h < HATS.length; h++) {
    const frames = lookFrames({ c, f, h });
    assert.equal(frames.length, 5);
    for (const fr of frames) {
      assert.equal(fr.length, SPRITE_H);
      for (const row of fr) { assert.equal(row.length, 8); for (const col of row) assert.ok(allowed.has(col), `colour ${col}`); }
    }
  }
});

test('the default look is the original character', () => {
  const idle = lookFrames(DEFAULT_LOOKS[0])[0].slice(SPRITE_H - 8);
  const K = '#0a0610', W = '#f4f0ff', R = '#e8334a', H = '#ff8a9a';
  const enc = (row) => row.map((c) => (c === null ? '.' : c === K ? 'K' : c === W ? 'W' : c === R ? 'R' : c === H ? 'H' : '?')).join('');
  assert.deepEqual(idle.map(enc), ['..KKKK..', '.KHRRRK.', 'KRRRRRRK', 'KRWKRWKK', 'KRRRRRRK', 'KRRKKKRK', '.KRRRRK.', '.KK..KK.']);
});

test('hostile looks are cleaned', () => {
  assert.deepEqual(cleanLook({ c: 99, f: -1, h: 2.5, px: 'zz', css: 'red;background:url(x)' }), DEFAULT_LOOKS[0]);
  assert.deepEqual(cleanLook('nope'), DEFAULT_LOOKS[0]);
  assert.equal(cleanLook({ c: 1, f: 1, h: 1, px: 'g'.repeat(56) }).px, undefined);
  assert.equal(cleanLook({ c: 1, f: 1, h: 1, px: 'f'.repeat(57) }).px, undefined);
  assert.equal(cleanLook({ c: 1, f: 1, h: 1, px: '0123456789abcdef'.repeat(4).slice(0, 56) }).px.length, 56);
  const m = decode(JSON.stringify({ t: 'hello', v: 6, name: '<img>', look: { c: '1', f: 2, h: 3, px: '<script>' } }));
  assert.equal(m.name, 'IMG');
  assert.deepEqual(m.look, { c: DEFAULT_LOOKS[1].c, f: 2, h: 3 });
});

test('painted looks round-trip and pick a sensible tag colour', () => {
  const px = presetToPx({ c: 2, f: 1, h: 0 });
  assert.match(px, /^[0-9a-f]{56}$/);
  const frames = lookFrames({ c: 0, f: 0, h: 0, px });
  assert.equal(frames[0].length, SPRITE_H);
  assert.ok(PAINT.includes(lookColor({ c: 0, f: 0, h: 0, px })));
});
