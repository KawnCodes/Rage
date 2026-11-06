# RAGE

A pixel-art rage platformer for the browser. It has five troll stages and a final boss, **The Grudge**. You can play solo, local 2-player, or online 2-player through a lobby.

Everything is built with plain HTML5 canvas, CSS and JavaScript. It has **zero dependencies** and no external assets: all the pixel art, the font and the sound effects are generated in code.

## Play

```bash
npm start            # http://127.0.0.1:8080  (this machine only)
npm run start:lan    # HOST=0.0.0.0: friends on your Wi-Fi can join
npm test             # protocol, level and server security tests
```

Requires Node 18 or newer. The `public/` folder also works on any static host (GitHub Pages, etc.). There the room-code lobby is unavailable, so use **Manual connect** instead.

### Controls

| | Solo / Online | Local P1 | Local P2 |
|---|---|---|---|
| Move | A D / ← → | A D | ← → |
| Jump (hold = higher) | Space W ↑ Z | W / Space | ↑ / Num0 |

**R** restarts the stage (it counts as a death), **Esc** pauses and **M** mutes. Phones get on-screen buttons.

### Menus, saving and level select

- **Autosave:** your run (stage, deaths, time) saves automatically on every stage change, every death, when you pause, and when you leave the page. **Continue** on the main menu picks up where you left off.
- **Level select:** stages unlock as you beat them. Each card shows your best (fewest deaths, fastest clear). You can start any unlocked stage in Solo or Local 2P. **Reset progress** wipes everything.
- **In-game toolbar:** Home, sound and pause buttons, plus the stage, run time and your best for the stage.
- **Pause menu:** Resume, Restart stage, Level select, Sound and Home. Press **H** to go straight home.
- **Menus** work with the keyboard (arrow keys and Enter, Esc for back) and controllers (D-pad, A to select, B for back).

Saves stay in your browser (`localStorage`) and never leave your machine. A save is checked and cleaned up when it loads, so a corrupted or hand-edited save can't break the game. Online games don't save a run, but clearing stages as host still unlocks them.

### Stages
1. **Welcome**: "this one is easy :)" (it is not)
2. **Shy Door**: hidden blocks and a door that runs away from you
3. **Crumble**: platforms that crumble under you, plus a saw
4. **Boing**: springs. Don't hold jump on the second one.
5. **Trust Issues**: the exit is right there :)
6. **The Grudge**: dodge its shots and slam. Stomp it while it's dizzy, 4 times.

Traps reset when everyone is dead. In co-op, one player can scout while the other survives.

## Two players

- **Local:** one keyboard with two key sets, or controllers. Controller 1 plays P1 and controller 2 plays P2. With only one controller, it plays P2 and the keyboard plays P1.
- **Bluetooth:** pair a Bluetooth gamepad with your computer or phone and it works right away through the Gamepad API.
  Browsers *cannot* link two devices to each other over Bluetooth, because Web Bluetooth only talks to accessories and can't advertise. Two-device play therefore uses the online lobby, which also works over a local Wi-Fi network or a phone hotspot.
- **Online lobby:** one player hosts and gets a 6-character room code, and the friend enters it. The game then runs peer-to-peer over WebRTC.
- **Manual connect:** no server needed. The two players swap a pair of codes by copy and paste.

## Security

- **Game traffic is peer-to-peer.** It goes over WebRTC data channels, which are DTLS-encrypted. The server only relays the one-time connection handshake and never sees gameplay.
- **Nothing from the peer is trusted.** Every message is size-capped, parsed safely, checked against an allowlist of types and rebuilt field by field, with numbers clamped. Messages are also rate-limited (`public/js/protocol.js`). Names are reduced to `A-Z 0-9 _-`.
- **The host is the authority.** It owns level progress, traps and the boss. A guest's claim that it reached the door or hit the boss is checked against the guest's position before it counts.
- **No HTML injection paths.** The code has no `innerHTML`, `eval` or inline scripts. A strict Content-Security-Policy (`script-src 'self'`) is sent both as a header and as a meta tag.
- **Server (`server/server.js`):**
  - Static files are served from an allowlist built at startup, so path traversal can't reach other files.
  - Security headers: CSP, `nosniff`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, no referrer, COOP/CORP and a Permissions-Policy.
  - Room codes are random. Each player gets a 256-bit bearer token, compared in constant time.
  - Join attempts are rate-limited per IP, which stops code guessing. Every endpoint has rate limits.
  - Bodies are size-capped and must be JSON. Cross-origin POSTs are rejected.
  - Rooms expire after 15 minutes. Rooms, queues and long-polls all have caps. Timeouts limit slow-request attacks.
  - The server listens on localhost unless you set `HOST`.
- **Privacy note:** as with any WebRTC game, your partner can see your IP address. Only share codes with people you trust.

### Deploying publicly

Put the server behind HTTPS (for example Caddy or nginx). Set `TRUST_PROXY=1` so rate limits use the real client IP, and `HSTS=1`. Players on very strict networks may need a TURN server, which you add to `RTC_CONFIG` in `public/js/net.js`.

## Layout

```
public/            the game (works from any static host)
  js/game.js       physics, traps, boss, rendering
  js/levels.js     stage layouts
  js/net.js        WebRTC link + lobby client
  js/protocol.js   message validation (shared with the server)
  js/save.js       autosave, unlocks and best times
server/server.js   static files + lobby, zero dependencies
test/              node:test suites
```
