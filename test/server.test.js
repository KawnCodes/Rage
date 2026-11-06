import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server/server.js';

let server, base;
test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });

test('serves index with security headers', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.match(await r.text(), /<canvas/);
});

test('path traversal and unknown files are 404', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fserver/server.js', '/js/../../server/server.js', '/server/server.js', '/.git/config', '/js/']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
});

test('static is GET/HEAD only', async () => {
  const r = await fetch(base + '/index.html', { method: 'POST' });
  assert.equal(r.status, 405);
});

test('full signaling flow', async () => {
  const c = await post('/api/rooms');
  assert.equal(c.status, 201);
  const { code, token: host } = await c.json();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(host, /^[0-9a-f]{64}$/);

  const j = await post(`/api/rooms/${code}/join`);
  assert.equal(j.status, 200);
  const { token: guest } = await j.json();
  assert.notEqual(guest, host);

  // second join is refused
  assert.equal((await post(`/api/rooms/${code}/join`)).status, 409);

  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  let r = await fetch(`${base}/api/rooms/${code}/poll`, { headers: auth(host) });
  assert.deepEqual(await r.json(), { msgs: [{ kind: 'joined' }] });

  const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n';
  const pending = fetch(`${base}/api/rooms/${code}/poll`, { headers: auth(guest) });
  assert.equal((await post(`/api/rooms/${code}/signal`, { data: { kind: 'offer', sdp } }, auth(host))).status, 204);
  assert.deepEqual(await (await pending).json(), { msgs: [{ kind: 'offer', sdp }] });

  // bad signal, bad token, wrong content type
  assert.equal((await post(`/api/rooms/${code}/signal`, { data: { kind: 'offer', sdp: '<script>' } }, auth(host))).status, 400);
  assert.equal((await post(`/api/rooms/${code}/signal`, { data: { kind: 'offer', sdp } }, auth('0'.repeat(64)))).status, 404);
  r = await fetch(`${base}/api/rooms/${code}/signal`, { method: 'POST', headers: { 'Content-Type': 'text/plain', ...auth(host) }, body: '{}' });
  assert.equal(r.status, 415);

  // close
  assert.equal((await post(`/api/rooms/${code}/close`, {}, auth(host))).status, 204);
  assert.equal((await fetch(`${base}/api/rooms/${code}/poll`, { headers: auth(host) })).status, 404);
});

test('cross-origin POST refused', async () => {
  const r = await post('/api/rooms', {}, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('oversized body refused', async () => {
  const c = await (await post('/api/rooms')).json();
  const r = await post(`/api/rooms/${c.code}/signal`, { data: 'x'.repeat(50000) }, { Authorization: `Bearer ${c.token}` });
  assert.equal(r.status, 413);
});

test('invalid room codes', async () => {
  assert.equal((await post('/api/rooms/abc/join')).status, 404);
  assert.equal((await post('/api/rooms/ZZZZZZ/join')).status, 404);
});

const rawGet = (path, host) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const req = http.request({ hostname: u.hostname, port: u.port, path, headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject);
  req.end();
});

test('unknown Host headers are refused (DNS rebinding protection)', async () => {
  assert.equal(await rawGet('/', 'evil.example.com'), 421);
  assert.equal(await rawGet('/api/health', 'attacker.test:8080'), 421);
  for (const ok of ['localhost:8080', '127.0.0.1', '192.168.1.20:8080', 'gaming-pc.local:8080', '[::1]:8080']) {
    assert.equal(await rawGet('/', ok), 200, ok);
  }
});

test('lan endpoint is empty when listening on localhost only', async () => {
  const r = await fetch(base + '/api/lan');
  assert.deepEqual(await r.json(), { urls: [] });
});

test('quick play pairs two people, a third waits, and abandoned hosts are skipped', async () => {
  const q = async () => { const r = await post('/api/quick'); return { status: r.status, ...(await r.json()) }; };
  const a = await q();
  assert.equal(a.role, 'host');
  // a is waiting (long-poll open)
  const waiting = fetch(`${base}/api/rooms/${a.code}/poll`, { headers: { Authorization: `Bearer ${a.token}` } });
  const b = await q();
  assert.equal(b.role, 'guest');
  assert.equal(b.code, a.code);
  assert.deepEqual(await (await waiting).json(), { msgs: [{ kind: 'joined' }] });
  const c = await q();
  assert.equal(c.role, 'host');
  assert.notEqual(c.code, a.code);
  // c "leaves" without closing: pretend its last poll was long ago
  const stale = await post(`/api/rooms/${c.code}/close`, {}, { Authorization: `Bearer ${c.token}` });
  assert.equal(stale.status, 204);
  const d = await q();
  assert.equal(d.role, 'host', 'a closed room is never matched');
  assert.notEqual(d.code, c.code);
});
