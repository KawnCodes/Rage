import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, emptySave, recordClear, formatTime } from '../public/js/save.js';
import { LEVELS } from '../public/js/levels.js';

test('garbage saves fall back to an empty save', () => {
  for (const raw of [null, 42, 'x', [], { unlocked: 'all' }]) {
    const s = clean(raw);
    assert.equal(s.unlocked, 0);
    assert.equal(s.run, null);
  }
});

test('save values are clamped and unknown fields dropped', () => {
  const s = clean({
    unlocked: 999, totalDeaths: -5, wins: 1e99, evil: '<script>',
    run: { mode: 'host', level: 2 },
    best: [{ deaths: 3, time: 600 }, { deaths: 'x', time: 1 }, 'nope'],
  });
  assert.equal(s.unlocked, LEVELS.length - 1);
  assert.equal(s.totalDeaths, 0);
  assert.equal(s.wins, 1e6);
  assert.equal(s.run, null); // only solo/local runs are resumable
  assert.equal(s.evil, undefined);
  assert.deepEqual(s.best[0], { deaths: 3, time: 600 });
  assert.equal(s.best[1], null);
  assert.equal(s.best[2], null);
});

test('runs are restored and cannot point past the last stage', () => {
  const s = clean({ run: { mode: 'local', level: 50, deaths: [2, 'x'], time: 120 } });
  assert.deepEqual(s.run, { mode: 'local', level: LEVELS.length - 1, deaths: [2, 0], time: 120 });
});

test('clearing stages unlocks the next and keeps bests', () => {
  const s = emptySave();
  recordClear(s, 0, 5, 900);
  assert.equal(s.unlocked, 1);
  recordClear(s, 0, 9, 600);
  assert.deepEqual(s.best[0], { deaths: 5, time: 600 });
  recordClear(s, LEVELS.length - 1, 0, 60);
  assert.equal(s.unlocked, LEVELS.length - 1);
  assert.equal(formatTime(60 * 75), '1:15');
});
