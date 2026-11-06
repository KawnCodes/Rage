import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, WORLDS, COLS, ROWS, MULTIPLAYER_START, isBossLevel, stageLabel } from '../public/js/levels.js';

const LEGAL = new Set([...' #=^v<>FIPpDMNQCHXVSZJB{}OoLl']);

test('levels are well formed', () => {
  assert.ok(LEVELS.length >= 5);
  LEVELS.forEach((L, i) => {
    assert.equal(L.rows.length, ROWS, `level ${i} rows`);
    for (const r of L.rows) {
      assert.equal(r.length, COLS, `level ${i} width`);
      for (const c of r) assert.ok(LEGAL.has(c), `level ${i} illegal char ${c}`);
    }
    const all = L.rows.join('');
    assert.equal(all.split('P').length - 1, 1, `level ${i} needs exactly one P`);
    if (isBossLevel(i)) assert.ok(all.includes('B') && L.boss.hp > 0 && L.boss.hp <= 10, 'boss level has a boss');
    else assert.ok(/[DM]/.test(all), `level ${i} needs an exit`);
    if (all.includes('M')) assert.ok(all.includes('N'), `level ${i} runaway door target`);
    // spawns stand on something solid
    L.rows.forEach((r, y) => [...r].forEach((c, x) => {
      if (c === 'P' || c === 'p') assert.ok('#={}'.includes(L.rows[y + 1][x]), `level ${i} spawn floor`);
    }));
  });
});

test('worlds: each ends in a boss, multiplayer starts at world 2', () => {
  assert.equal(WORLDS.length, 2);
  for (const w of WORLDS) {
    assert.ok(isBossLevel(w.end), 'world ends with a boss');
    for (let i = w.start; i < w.end; i++) assert.ok(!isBossLevel(i));
  }
  assert.equal(MULTIPLAYER_START, WORLDS[1].start);
  assert.equal(stageLabel(0), '1-1');
  assert.equal(stageLabel(WORLDS[0].end), '1-BOSS');
  assert.equal(stageLabel(WORLDS[1].start), '2-1');
});
