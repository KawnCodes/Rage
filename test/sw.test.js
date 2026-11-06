import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { render, gameFiles } from '../scripts/build-sw.mjs';

test('sw.js is up to date with the game files (run `npm run sw` after changing the game)', () => {
  const current = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.equal(current, render(), 'public/sw.js is stale: run `npm run sw`');
});

test('the offline cache covers every game file and nothing outside public/', () => {
  const files = gameFiles();
  for (const must of ['index.html', 'js/main.js', 'js/game.js', 'css/style.css', 'manifest.webmanifest']) assert.ok(files.includes(must), must);
  assert.ok(!files.some((f) => f.includes('..') || f.startsWith('/')));
  const sw = render();
  assert.match(sw, /url\.pathname\.startsWith\(scope\.pathname \+ 'api\/'\)\) return;/, 'never caches the lobby API');
  assert.match(sw, /url\.origin !== self\.location\.origin\) return;/, 'never caches other sites');
});
