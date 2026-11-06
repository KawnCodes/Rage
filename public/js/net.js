// WebRTC peer-to-peer link + lobby signaling client.
//
// Game data never touches the server: it flows directly between the two
// browsers over DTLS-encrypted WebRTC data channels. The lobby server only
// relays the short connection handshake (SDP/ICE), and the manual mode
// doesn't need a server at all.
import { decode, encode, validateSignal, RateLimiter, ROOM_CODE_RE, MAX_MESSAGE_BYTES } from './protocol.js';

const RTC_CONFIG = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
const CONNECT_TIMEOUT_MS = 30000;

export class PeerLink {
  constructor(isHost) {
    this.isHost = isHost;
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.fast = null;
    this.rel = null;
    this.open = false;
    this.closed = false;
    this.pendingIce = [];
    this.limiter = new RateLimiter(150, 300); // msgs/sec from the peer
    this.onMessage = () => {};
    this.onOpen = () => {};
    this.onClose = () => {};
    this.onIce = null;

    this.pc.onicecandidate = (e) => {
      if (e.candidate && this.onIce) this.onIce(e.candidate.toJSON());
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this.close();
    };
    if (isHost) {
      this.fast = this.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
      this.rel = this.pc.createDataChannel('rel', { ordered: true });
      this.setup(this.fast);
      this.setup(this.rel);
    } else {
      this.pc.ondatachannel = (e) => {
        const ch = e.channel;
        if (ch.label === 'fast' && !this.fast) { this.fast = ch; this.setup(ch); }
        else if (ch.label === 'rel' && !this.rel) { this.rel = ch; this.setup(ch); }
        else ch.close(); // unexpected channel: refuse
      };
    }
    this.timer = setTimeout(() => { if (!this.open) this.close(); }, CONNECT_TIMEOUT_MS);
  }

  setup(ch) {
    ch.onopen = () => this.checkOpen();
    ch.onclose = () => this.close();
    ch.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_BYTES) return;
      if (!this.limiter.allow()) return;
      const m = decode(e.data);
      if (m) this.onMessage(m);
    };
  }

  checkOpen() {
    if (!this.open && this.fast && this.rel && this.fast.readyState === 'open' && this.rel.readyState === 'open') {
      this.open = true;
      clearTimeout(this.timer);
      this.onOpen();
    }
  }

  send(msg, reliable = false) {
    const ch = reliable ? this.rel : this.fast;
    if (!ch || ch.readyState !== 'open' || ch.bufferedAmount > 256 * 1024) return;
    try { ch.send(encode(msg)); } catch { /* channel closing */ }
  }

  async createOffer() {
    const o = await this.pc.createOffer();
    await this.pc.setLocalDescription(o);
    return this.pc.localDescription.sdp;
  }

  async acceptOffer(sdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    this.flushIce();
    const a = await this.pc.createAnswer();
    await this.pc.setLocalDescription(a);
    return this.pc.localDescription.sdp;
  }

  async acceptAnswer(sdp) {
    if (this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    this.flushIce();
  }

  addIce(c) {
    if (!this.pc.remoteDescription) {
      if (this.pendingIce.length < 64) this.pendingIce.push(c);
      return;
    }
    this.pc.addIceCandidate(c).catch(() => {});
  }

  flushIce() {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) this.pc.addIceCandidate(c).catch(() => {});
  }

  // For manual mode: wait until all candidates are inside the local SDP.
  waitIceComplete(timeoutMs = 5000) {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') { resolve(this.pc.localDescription.sdp); return; }
      const done = () => { clearTimeout(t); this.pc.removeEventListener('icegatheringstatechange', check); resolve(this.pc.localDescription.sdp); };
      const check = () => { if (this.pc.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, timeoutMs);
      this.pc.addEventListener('icegatheringstatechange', check);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    try { this.fast && this.fast.close(); } catch { /* ignore */ }
    try { this.rel && this.rel.close(); } catch { /* ignore */ }
    try { this.pc.close(); } catch { /* ignore */ }
    this.onClose();
  }
}

// ---- Lobby signaling client (talks to server/server.js, same origin only) ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Signaling {
  constructor() {
    this.code = null;
    this.token = null;
    this.closed = false;
    this.abort = new AbortController();
    this.onSignal = () => {};
    this.onError = () => {};
  }

  static async available() {
    try {
      const r = await fetch('api/health', { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return false;
      const j = await r.json();
      return j && j.ok === true;
    } catch { return false; }
  }

  async post(path, body, auth) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${this.token}`;
    const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body || {}), cache: 'no-store', credentials: 'omit' });
    let j = null;
    try { j = await r.json(); } catch { /* empty */ }
    if (!r.ok) throw new Error((j && typeof j.error === 'string' ? j.error : `HTTP ${r.status}`).slice(0, 80));
    return j;
  }

  async create() {
    const j = await this.post('api/rooms', {});
    if (!j || !ROOM_CODE_RE.test(j.code) || typeof j.token !== 'string' || !/^[0-9a-f]{64}$/.test(j.token)) throw new Error('bad server reply');
    this.code = j.code; this.token = j.token;
    this.pollLoop();
  }

  async join(code) {
    if (!ROOM_CODE_RE.test(code)) throw new Error('invalid room code');
    const j = await this.post(`api/rooms/${code}/join`, {});
    if (!j || typeof j.token !== 'string' || !/^[0-9a-f]{64}$/.test(j.token)) throw new Error('bad server reply');
    this.code = code; this.token = j.token;
    this.pollLoop();
  }

  async send(data) {
    if (this.closed) return;
    await this.post(`api/rooms/${this.code}/signal`, { data }, true);
  }

  async pollLoop() {
    let errors = 0;
    while (!this.closed) {
      try {
        const r = await fetch(`api/rooms/${this.code}/poll`, {
          headers: { Authorization: `Bearer ${this.token}` }, cache: 'no-store', credentials: 'omit', signal: this.abort.signal,
        });
        if (this.closed) return;
        if (r.status === 200) {
          const j = await r.json();
          const msgs = j && Array.isArray(j.msgs) ? j.msgs.slice(0, 64) : [];
          for (const m of msgs) {
            const v = validateSignal(m);
            if (v) this.onSignal(v);
          }
          errors = 0;
        } else if (r.status !== 204) {
          throw new Error(r.status === 404 ? 'room expired' : `HTTP ${r.status}`);
        }
      } catch (e) {
        if (this.closed) return;
        if (++errors >= 4) { this.onError(e); this.closed = true; return; }
        await sleep(1000 * errors);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    if (this.token && this.code) {
      fetch(`api/rooms/${this.code}/close`, {
        method: 'POST', keepalive: true, credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` }, body: '{}',
      }).catch(() => {});
    }
  }
}
