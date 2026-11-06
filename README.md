# RAGE

A pixel-art rage platformer for the browser with three worlds, each ending in a boss:

- **World 1** is solo.
- Beating its boss unlocks **World 2**, which you can play solo, local 2-player or online 2-player through a lobby.
- Beating World 2 unlocks **World 3**, which is co-op only: two players have to work together to beat it.

Everything is built with plain HTML5 canvas, CSS and JavaScript. It has **zero dependencies** and no external assets: all the pixel art, the font and the sound effects are generated in code.

## Play

```bash
npm start            # this computer + other devices on your Wi-Fi / LAN
npm run start:local  # this computer only
npm test             # protocol, level and server security tests
```

`npm start` prints two addresses:

```
  On this computer:   http://localhost:8080
  On your Wi-Fi/LAN:  http://192.168.1.23:8080
```

Open the second one on a phone, tablet or another computer on the same network. The game also shows it on the main menu and in the Online lobby. If nothing loads on the other device, allow Node through your computer's firewall when asked (macOS shows a popup the first time; on Windows choose "Private networks"). Use `PORT=8081 npm start` if port 8080 is taken.

Requires Node 18 or newer. The `public/` folder also works on any static host (GitHub Pages, etc.). There the room-code lobby is unavailable, so use **Manual connect** instead.

### Controls

| | Solo / Online | Local P1 | Local P2 |
|---|---|---|---|
| Move | A D / ← → | A D | ← → |
| Jump (hold = higher) | Space W ↑ Z | W / Space | ↑ / Num0 |

**R** restarts the stage (it counts as a death), **Esc** pauses and **M** mutes.

**Touch controls** turn on automatically on phones and tablets and float over a full-screen game.

- **One player:** touch anywhere on the left half to move (left or right of the ◀ ▶ buttons) and anywhere on the right half to jump. You can slide your thumb between ◀ and ▶ without lifting it.
- **Local 2-player on one tablet:** the left half belongs to P1 (red) and the right half to P2 (blue). Each finger counts as whichever of that player's buttons is closest.
- You can force them on or off under **Controls → Touch controls** (or from the pause menu), for example on a tablet with a keyboard or a touchscreen laptop.

**Full screen:** starting a game on a phone or tablet goes full screen automatically where the browser allows it. There's also a ⛶ button and an **F** key. On iPhone, Safari doesn't allow web pages to go full screen; instead tap Share → **Add to Home Screen** and open RAGE from the home screen.

**Cheat codes:** Main menu → **Cheat codes**.
| Code | Does |
|---|---|
| `FRIENDS` | Unlocks multiplayer (World 2, Local 2 player and Online) |
| `HUZZAR` | Unlocks every world and stage |
| `ASIA` | Unlocks everything too, with a personal hello |

Cheats mark your save with "cheats used" on the main menu.

### Menus, saving and level select

- **Autosave:** your run (stage, deaths, time) saves automatically on every stage change, every death, when you pause, and when you leave the page. **Continue** on the main menu picks up where you left off.
- **Level select:** stages unlock as you beat them. Each card shows your best (fewest deaths, fastest clear). You can start any unlocked stage in Solo or Local 2P. **Reset progress** wipes everything.
- **In-game toolbar:** Home, sound and pause buttons, plus the stage, run time and your best for the stage.
- **Pause menu:** Resume, Restart stage, Level select, Sound and Home. Press **H** to go straight home.
- **Menus** work with the keyboard (arrow keys and Enter, Esc for back) and controllers (D-pad, A to select, B for back).

Saves stay in your browser (`localStorage`) and never leave your machine. A save is checked and cleaned up when it loads, so a corrupted or hand-edited save can't break the game. Online games don't save a run, but clearing stages as host still unlocks them.

### World 1: The Pit (solo)
1. **Welcome**: "this one is easy :)" (it is not)
2. **Shy Door**: hidden blocks and a door that runs away from you
3. **Crumble**: platforms that crumble under you, plus a saw
4. **Boing**: springs. Don't hold jump on the second one.
5. **Trust Issues**: the exit is right there :)
6. **Boss, The Grudge**: dodge its shots and slam. Stomp it while it's dizzy, 4 times.

### World 2: The Machine (unlocks after The Grudge, solo or 2 player)
1. **Conveyor**: belts push you around, plus a ceiling laser
2. **Blink**: orange and cyan blocks take turns existing. Jump while both are showing.
3. **Laser Tag**: timed laser beams. A flicker means one is about to fire.
4. **Gauntlet**: everything at once :)
5. **Boss, The Overclock**: faster, 6 hits, and its slam brings shards down from the ceiling. The floor belts push you toward it.

### World 3: The Bond (unlocks after The Overclock, co-op only)
1. **Teamwork**: a ledge too high for one player. Stand on your partner's head.
2. **Tag Team**: gates open only while someone holds the matching plate. You hold, I go, then swap.
3. **Trust Fall**: boost, hold, spring, hold again.
4. **Boss, The Warden**: its shield only drops while someone stands on a floor switch. One player holds the switch while the other stomps. It shoots at both of you in turn.

The exit door in World 3 only works when **both** players are at it. If your online partner leaves during World 3, the game ends, because it can't be finished alone.

The 2-player modes (local and online) are locked until World 2 is unlocked. Multiplayer games use World 2 and World 3; when hosting online you pick which world to start in.

Traps reset when everyone is dead. In co-op, one player can scout while the other survives.

## Two players

Both modes unlock once you beat World 1, and multiplayer games are played in World 2.

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
  - It only answers requests addressed to `localhost`, an IP address or a `*.local` name. This stops websites from reaching it through "DNS rebinding" while it's open to your local network. To serve it under a domain name, set `ALLOWED_HOSTS=game.example.com`.
  - `npm start` is reachable on your local network, and `npm run start:local` limits it to this computer.
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
