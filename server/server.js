// RAGE lobby + static file server. Zero dependencies (Node >= 18).
//
// Security model
//  - Static files: an allowlist built at startup from public/. Request paths are
//    looked up in a Map, never joined onto the filesystem, so path traversal is
//    impossible. Dotfiles are never served.
//  - Strict security headers (CSP, nosniff, frame-ancestors none, COOP/CORP,
//    no referrer, locked-down Permissions-Policy). Optional HSTS.
//  - Lobby API only relays the WebRTC handshake (SDP/ICE). It never sees game
//    traffic. Rooms use unguessable 6-char codes for joining plus 256-bit
//    per-player bearer tokens (compared in constant time) for everything else.
//  - Every input is size-limited and validated; per-IP rate limits; rooms
//    expire; global caps on rooms, queues and waiting connections.
//  - Cross-origin writes are refused (Origin check + JSON content type) and no
//    CORS headers are sent.
//  - Host header allowlist (localhost, IP addresses, *.local, plus ALLOWED_HOSTS)
//    so other websites can't reach this server through DNS rebinding when it's
//    open to your local network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { validateSignal, ROOM_CODE_RE, ROOM_CODE_ALPHABET, MAX_SIGNAL_BYTES } from '../public/js/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'self'", "font-src 'self'", "media-src 'none'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "worker-src 'none'",
].join('; ');

const LIMITS = {
  maxRooms: 1000,
  roomTtlMs: 15 * 60 * 1000,
  maxQueue: 64,
  maxSignalsPerRoom: 300,
  pollTimeoutMs: 20000,
  maxWaiters: 2000,
  bodyBytes: MAX_SIGNAL_BYTES + 1024,
};

function loadStatic(dir) {
  const files = new Map();
  const walk = (d, rel) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const abs = path.join(d, ent.name);
      const r = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(abs, r);
      else if (ent.isFile()) {
        const type = MIME[path.extname(ent.name).toLowerCase()];
        if (!type) continue;
        const body = fs.readFileSync(abs);
        const etag = `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
        files.set(r, { body, type, etag });
      }
    }
  };
  walk(dir, '');
  if (files.has('/index.html')) files.set('/', files.get('/index.html'));
  return files;
}

function baseHeaders(res, opts, req) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Browsers only honour COOP on secure origins (HTTPS or localhost); elsewhere it just logs a warning.
  const h = String(req.headers.host || '').toLowerCase();
  if (opts.hsts || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h)) res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (opts.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendJson(res, status, obj) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

function roomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
  return s;
}

class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.map = new Map(); }
  allow(key, now = Date.now()) {
    let b = this.map.get(key);
    if (!b) { b = { t: this.burst, last: now }; this.map.set(key, b); }
    b.t = Math.min(this.burst, b.t + ((now - b.last) / 1000) * this.rate);
    b.last = now;
    if (b.t < 1) return false;
    b.t -= 1;
    return true;
  }
  sweep(now = Date.now()) {
    for (const [k, b] of this.map) if (now - b.last > 120000) this.map.delete(k);
  }
}

// This machine's addresses on the local network (Wi-Fi / Ethernet), private ranges first.
export function lanAddresses() {
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return out.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

function hostAllowed(hostHeader, extra) {
  if (typeof hostHeader !== 'string' || hostHeader.length > 255) return false;
  let host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']')); // [ipv6]:port
  else host = host.replace(/:\d+$/, '');
  if (!host) return false;
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    net.isIP(host) !== 0 || extra.includes(host);
}

export function createServer(opts = {}) {
  const options = { trustProxy: false, hsts: false, publicDir: PUBLIC_DIR, allowedHosts: [], ...opts };
  const allowedHosts = options.allowedHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean);
  let lanUrls = [];
  const files = loadStatic(options.publicDir);
  const rooms = new Map();
  let waiters = 0;
  const limits = {
    api: new Bucket(4, 60), // general API calls per IP
    create: new Bucket(10 / 60, 10), // room creation per IP
    join: new Bucket(20 / 60, 20), // join attempts per IP (stops code guessing)
  };

  const ipOf = (req) => {
    if (options.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      if (typeof xf === 'string' && xf.length < 256) return xf.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  };

  function deleteRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    rooms.delete(code);
    for (const role of ['host', 'guest']) flush(room, role, true);
  }

  function flush(room, role, closing = false) {
    const w = room.waiters[role];
    if (!w) return;
    const q = room.queues[role];
    if (!q.length && !closing) return;
    room.waiters[role] = null;
    clearTimeout(w.timer);
    waiters--;
    const msgs = q.splice(0);
    if (closing) msgs.push({ kind: 'bye' });
    sendJson(w.res, 200, { msgs });
  }

  function push(room, role, msg) {
    const q = room.queues[role];
    if (q.length >= LIMITS.maxQueue) return false;
    q.push(msg);
    flush(room, role);
    return true;
  }

  function authRoom(req, code) {
    if (!ROOM_CODE_RE.test(code)) return null;
    const room = rooms.get(code);
    if (!room) return null;
    const h = req.headers.authorization;
    if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
    const tok = h.slice(7);
    if (safeEqual(tok, room.tokens.host)) return { room, role: 'host', other: 'guest' };
    if (room.tokens.guest && safeEqual(tok, room.tokens.guest)) return { room, role: 'guest', other: 'host' };
    return null;
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const ct = String(req.headers['content-type'] || '');
      if (!ct.toLowerCase().startsWith('application/json')) { reject(Object.assign(new Error('json required'), { status: 415 })); return; }
      const len = Number(req.headers['content-length'] || 0);
      if (len > LIMITS.bodyBytes) { reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > LIMITS.bodyBytes) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
          resolve(v);
        } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  async function handleApi(req, res, url) {
    const ip = ipOf(req);
    if (!limits.api.allow(ip)) return sendJson(res, 429, { error: 'slow down' });

    if (req.method === 'POST') {
      // Refuse cross-site requests.
      const origin = req.headers.origin;
      if (origin !== undefined) {
        let ok = false;
        try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
        if (!ok) return sendJson(res, 403, { error: 'bad origin' });
      }
    }

    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    if (parts.length === 2 && parts[1] === 'health' && req.method === 'GET') return sendJson(res, 200, { ok: true });
    // Addresses other devices on the same network can open (empty when local-only).
    if (parts.length === 2 && parts[1] === 'lan' && req.method === 'GET') return sendJson(res, 200, { urls: lanUrls });

    if (parts[1] !== 'rooms') return sendJson(res, 404, { error: 'not found' });

    // POST /api/rooms
    if (parts.length === 2) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      if (!limits.create.allow(ip)) return sendJson(res, 429, { error: 'too many rooms' });
      await readJson(req);
      if (rooms.size >= LIMITS.maxRooms) return sendJson(res, 503, { error: 'server full' });
      let code;
      do { code = roomCode(); } while (rooms.has(code));
      const room = {
        code,
        created: Date.now(),
        tokens: { host: crypto.randomBytes(32).toString('hex'), guest: null },
        queues: { host: [], guest: [] },
        waiters: { host: null, guest: null },
        signals: 0,
      };
      rooms.set(code, room);
      return sendJson(res, 201, { code, token: room.tokens.host });
    }

    const code = parts[2];
    const action = parts[3];
    if (parts.length !== 4 || !ROOM_CODE_RE.test(code)) return sendJson(res, 404, { error: 'not found' });

    if (action === 'join') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      if (!limits.join.allow(ip)) return sendJson(res, 429, { error: 'too many attempts' });
      await readJson(req);
      const room = rooms.get(code);
      if (!room) return sendJson(res, 404, { error: 'room not found' });
      if (room.tokens.guest) return sendJson(res, 409, { error: 'room is full' });
      room.tokens.guest = crypto.randomBytes(32).toString('hex');
      push(room, 'host', { kind: 'joined' });
      return sendJson(res, 200, { token: room.tokens.guest });
    }

    // Closing a room that is already gone is a no-op (both players may race to close it).
    if (action === 'close' && req.method === 'POST' && !rooms.has(code)) return sendJson(res, 204);

    const auth = authRoom(req, code);
    if (!auth) return sendJson(res, 404, { error: 'not found' });

    if (action === 'signal') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      const body = await readJson(req);
      const data = validateSignal(body.data);
      if (!data || data.kind === 'joined') return sendJson(res, 400, { error: 'bad signal' });
      if (!auth.room.tokens.guest) return sendJson(res, 409, { error: 'no peer yet' });
      if (++auth.room.signals > LIMITS.maxSignalsPerRoom) return sendJson(res, 429, { error: 'too many signals' });
      if (!push(auth.room, auth.other, data)) return sendJson(res, 429, { error: 'queue full' });
      return sendJson(res, 204);
    }

    if (action === 'poll') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method' });
      const { room, role } = auth;
      if (room.queues[role].length) return sendJson(res, 200, { msgs: room.queues[role].splice(0) });
      // One long-poll per player: a new poll replaces the old one.
      const old = room.waiters[role];
      if (old) { room.waiters[role] = null; clearTimeout(old.timer); waiters--; sendJson(old.res, 204); }
      if (waiters >= LIMITS.maxWaiters) return sendJson(res, 503, { error: 'busy' });
      const w = { res, timer: null };
      w.timer = setTimeout(() => {
        if (room.waiters[role] === w) { room.waiters[role] = null; waiters--; sendJson(res, 204); }
      }, LIMITS.pollTimeoutMs);
      room.waiters[role] = w;
      waiters++;
      res.on('close', () => {
        if (room.waiters[role] === w) { room.waiters[role] = null; clearTimeout(w.timer); waiters--; }
      });
      return undefined;
    }

    if (action === 'close') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
      deleteRoom(code);
      return sendJson(res, 204);
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Method not allowed');
    }
    const f = files.get(url.pathname);
    if (!f) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Not found');
    }
    if (req.headers['if-none-match'] === f.etag) {
      res.writeHead(304, { ETag: f.etag });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': f.type,
      'Content-Length': f.body.length,
      'Cache-Control': 'no-cache',
      ETag: f.etag,
    });
    return res.end(req.method === 'HEAD' ? undefined : f.body);
  }

  const server = http.createServer((req, res) => {
    baseHeaders(res, options, req);
    if (!hostAllowed(req.headers.host, allowedHosts)) {
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Unknown host. Add it to ALLOWED_HOSTS if you serve RAGE under a domain name.');
    }
    let url;
    try {
      if (typeof req.url !== 'string' || req.url.length > 2048) throw new Error();
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(res, 400, { error: 'bad url' });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((e) => {
        if (!res.headersSent) sendJson(res, e && e.status ? e.status : 500, { error: e && e.status ? e.message : 'server error' });
      });
      return undefined;
    }
    return handleStatic(req, res, url);
  });

  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  server.maxConnections = 1000;

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) if (now - room.created > LIMITS.roomTtlMs) deleteRoom(code);
    for (const b of Object.values(limits)) b.sweep(now);
  }, 30000);
  sweeper.unref();
  server.on('listening', () => {
    const a = server.address();
    const wildcard = a && (a.address === '0.0.0.0' || a.address === '::');
    lanUrls = wildcard ? lanAddresses().map((ip) => `http://${ip}:${a.port}`) : [];
  });
  server.on('close', () => {
    clearInterval(sweeper);
    for (const code of [...rooms.keys()]) deleteRoom(code);
  });

  return server;
}

// Run directly: `node server/server.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  // Default: reachable from other devices on your local network. HOST=127.0.0.1 for this machine only.
  const host = process.argv.includes('--local') ? '127.0.0.1' : process.env.HOST || '0.0.0.0';
  const server = createServer({
    trustProxy: process.env.TRUST_PROXY === '1',
    hsts: process.env.HSTS === '1',
    allowedHosts: (process.env.ALLOWED_HOSTS || '').split(','),
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try: PORT=8081 npm start` : `Could not start: ${e.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log('');
    console.log('  RAGE is running!');
    console.log(`  On this computer:   http://localhost:${port}`);
    if (host === '0.0.0.0' || host === '::') {
      const ips = lanAddresses();
      if (ips.length) {
        console.log('  On your Wi-Fi/LAN:  ' + ips.map((ip) => `http://${ip}:${port}`).join('\n                      '));
        console.log('  (open that address on your phone, tablet or a friend\'s computer on the same network)');
      } else {
        console.log('  No network connection found, so other devices can\'t reach it right now.');
      }
    } else {
      console.log('  Only this computer can connect (local-only mode). Run `npm start` (without :local) to allow your network.');
    }
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });
}
