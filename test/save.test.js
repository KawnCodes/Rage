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

import { merge, exportCode, importCode, teamId, toWire, fromWire } from '../public/js/save.js';
import { decode, encode } from '../public/js/protocol.js';

test('team ids are the two sanitized names, in a stable order', () => {
  assert.equal(teamId('julian', 'Asia'), 'ASIA & JULIAN');
  assert.equal(teamId('Asia', 'julian'), 'ASIA & JULIAN');
  assert.equal(teamId('<b>x</b>', 'y'), 'BXB & Y');
});

test('merging keeps the furthest unlock and the best records', () => {
  const a = clean({ unlocked: 5, best: [{ deaths: 3, time: 900 }, null] });
  const b = clean({ unlocked: 9, best: [{ deaths: 7, time: 600 }, { deaths: 1, time: 100 }], cheated: true });
  const m = merge(a, b);
  assert.equal(m.unlocked, 9);
  assert.deepEqual(m.best[0], { deaths: 3, time: 600 });
  assert.deepEqual(m.best[1], { deaths: 1, time: 100 });
  assert.equal(m.cheated, true);
});

test('progress codes round-trip and reject junk', () => {
  const s = clean({ unlocked: 12, wins: 2, best: [{ deaths: 4, time: 700 }] });
  const got = importCode(exportCode(s, ['ASIA', 'JULIAN']));
  assert.deepEqual(got.names, ['ASIA', 'JULIAN']);
  assert.equal(got.save.unlocked, 12);
  assert.deepEqual(got.save.best[0], { deaths: 4, time: 700 });
  assert.equal(importCode(exportCode(s, null)).names, null);
  for (const bad of ['', 'nope', 'RAGESAVE1-!!!', 'RAGESAVE1-' + btoa('[]'), 'RAGESAVE1-' + btoa('{"u":"all"}'), 'RAGESAVE1-' + 'A'.repeat(30000)]) {
    const r = importCode(bad);
    assert.ok(r === null || r.save.unlocked === 0, bad.slice(0, 20));
  }
  const evil = importCode('RAGESAVE1-' + btoa(JSON.stringify({ n: ['<script>', 'x'], u: 1e9, b: [[-5, -5]] })));
  assert.deepEqual(evil.names, ['SCRIPT', 'X']);
  assert.equal(evil.save.unlocked, LEVELS.length - 1);
  assert.equal(evil.save.best[0], null);
});

test('progress sent online passes the protocol checks', () => {
  const s = clean({ unlocked: 20, wins: 1, best: [{ deaths: 2, time: 300 }] });
  const m = decode(encode({ t: 'prog', ...toWire(s) }));
  assert.ok(m);
  assert.equal(fromWire(m).unlocked, 20);
  assert.equal(decode(encode({ t: 'prog', u: 1, w: 0, b: [['x', 1]] })), null);
  assert.equal(decode(encode({ t: 'prog', u: 1, w: 0, b: new Array(200).fill(null) })), null);
});
