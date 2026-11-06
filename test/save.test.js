import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, emptySave, recordClear, formatTime, multiplayerUnlocked } from '../public/js/save.js';
import { LEVELS, MULTIPLAYER_START, COOP_START } from '../public/js/levels.js';

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

test('multiplayer stays locked until world 2 is unlocked', () => {
  const s = emptySave();
  assert.equal(multiplayerUnlocked(s), false);
  recordClear(s, MULTIPLAYER_START - 1, 3, 600); // beat the world 1 boss
  assert.equal(multiplayerUnlocked(s), true);
});

test('local 2P runs inside world 1 are dropped', () => {
  assert.equal(clean({ unlocked: 9, run: { mode: 'local', level: 2 } }).run, null);
  assert.equal(clean({ unlocked: 9, run: { mode: 'solo', level: 2 } }).run.level, 2);
});

test('old saves that beat the grudge get world 2', () => {
  assert.equal(clean({ unlocked: MULTIPLAYER_START - 1, wins: 1 }).unlocked, MULTIPLAYER_START);
  assert.equal(clean({ unlocked: 3 }).unlocked, 3);
});

test('a solo run can never sit inside the co-op world', () => {
  const s = clean({ unlocked: COOP_START, run: { mode: 'solo', level: COOP_START + 1 } });
  assert.equal(s.run, null);
  assert.ok(s.unlocked >= COOP_START + 1);
  assert.equal(clean({ run: { mode: 'local', level: COOP_START } }).run.level, COOP_START);
});
