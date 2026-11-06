import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, COLS, ROWS, BOSS_LEVEL } from '../public/js/levels.js';

const LEGAL = new Set([...' #=^v<>FIPpDMNQCHXVSZJB']);

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
    if (i === BOSS_LEVEL) assert.ok(all.includes('B'), 'boss level has a boss');
    else assert.ok(/[DM]/.test(all), `level ${i} needs an exit`);
    if (all.includes('M')) assert.ok(all.includes('N'), `level ${i} runaway door target`);
    // spawns stand on something solid
    L.rows.forEach((r, y) => [...r].forEach((c, x) => {
      if (c === 'P' || c === 'p') assert.ok('#='.includes(L.rows[y + 1][x]), `level ${i} spawn floor`);
    }));
  });
});
