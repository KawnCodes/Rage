import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, sanitizeName, validateSignal, encodeManual, decodeManual, RateLimiter, MAX_MESSAGE_BYTES } from '../public/js/protocol.js';

test('decode rejects junk', () => {
  for (const raw of [null, 42, '', 'not json', '[]', '"str"', '{}', '{"t":"nope"}', '{"t":"p"}',
    'x'.repeat(MAX_MESSAGE_BYTES + 1), '{"t":"p","x":"1","y":0,"vx":0,"vy":0,"a":0,"lv":0,"dc":0}',
    '{"t":"w","lv":0,"q":1,"e":"x","bu":[]}', '{"t":"w","lv":0,"q":1,"e":[[1,2,3]],"bu":[]}']) {
    assert.equal(decode(raw), null, String(raw).slice(0, 40));
  }
});

test('decode clamps numbers and drops unknown fields', () => {
  const m = decode(JSON.stringify({ t: 'p', x: 1e9, y: -1e9, vx: 99, vy: -99, f: 7, a: 3.7, d: 1, lv: 2, dc: 5, evil: '<img>', __proto__: { admin: true } }));
  assert.deepEqual(m, { t: 'p', x: 400, y: -64, vx: 12, vy: -12, f: 1, a: 4, d: 1, lv: 2, dc: 5 });
  assert.equal(Object.getPrototypeOf(m), Object.prototype);
  assert.equal(m.admin, undefined);
});

test('decode rejects NaN / Infinity smuggled as numbers', () => {
  assert.equal(decode('{"t":"lvl","lv":1e999}'), null);
  assert.equal(decode('{"t":"ping","n":-1e999}'), null);
});

test('decode caps array sizes', () => {
  const big = { t: 'w', lv: 0, q: 1, e: Array.from({ length: 300 }, () => [0, 0, 0, 0, 0]), b: null, bu: [] };
  assert.equal(decode(JSON.stringify(big)), null);
  const ok = { ...big, e: [[1, 2, 3, 4, 5]] };
  assert.deepEqual(decode(JSON.stringify(ok)).e, [[1, 2, 3, 4, 5]]);
});

test('names are sanitized to a safe charset', () => {
  assert.equal(sanitizeName('<script>alert(1)</script>'), 'SCRIPTALERT1');
  assert.equal(sanitizeName('   '), 'PLAYER');
  assert.equal(sanitizeName({}), 'PLAYER');
  assert.equal(sanitizeName('a'.repeat(50)).length, 12);
  assert.equal(decode('{"t":"hello","v":1,"name":"\\"><img src=x onerror=alert(1)>"}').name, 'IMG SRCX ONE');
});

test('signals are validated', () => {
  assert.equal(validateSignal({ kind: 'offer', sdp: 'hello' }), null);
  assert.equal(validateSignal({ kind: 'offer', sdp: 'v=0\r\n\u0000' }), null);
  assert.deepEqual(validateSignal({ kind: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' }).kind, 'offer');
  assert.equal(validateSignal({ kind: 'ice', c: { candidate: 'x'.repeat(2000) } }), null);
  assert.deepEqual(validateSignal({ kind: 'ice', c: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0, extra: 1 } }),
    { kind: 'ice', c: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal(validateSignal({ kind: 'rm -rf' }), null);
  assert.equal(validateSignal([]), null);
});

test('manual codes round-trip and reject tampering', () => {
  const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n';
  const code = encodeManual('o', sdp);
  assert.equal(decodeManual(code, 'o'), sdp);
  assert.equal(decodeManual(code, 'a'), null);
  assert.equal(decodeManual('RAGE1-!!!', 'o'), null);
  assert.equal(decodeManual('RAGE1-' + btoa('{"k":"o","s":"<script>"}'), 'o'), null);
  assert.equal(decodeManual('nope', 'o'), null);
});

test('rate limiter', () => {
  const r = new RateLimiter(10, 5);
  let ok = 0;
  for (let i = 0; i < 20; i++) if (r.allow(1000)) ok++;
  assert.equal(ok, 5);
  assert.equal(r.allow(1200), true); // 2 tokens refilled
});
