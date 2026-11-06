# RAGE

A pixel-art rage platformer for the browser with six worlds, each ending in a boss:

- **World 1** is solo.
- Beating its boss unlocks **World 2**, which you can play solo, local 2-player or online 2-player through a lobby.
- Beating World 2 unlocks **World 3**, which is co-op only: two players have to work together to beat it.
- **Worlds 4, 5 and 6** can be played solo or together. Beating World 2 solo skips the co-op world and goes straight to World 4.

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

### Play offline and get updates automatically

After the first visit, the whole game is saved on the device (a *service worker*), so it opens and plays with no internet. On iPhone, also do **Share → Add to Home Screen** for a full-screen app icon.

Whenever the device is online, the game checks for a new version, downloads it in the background, and the main menu shows **🔄 Update ready**. `npm start` rebuilds the offline file list (`public/sw.js`) automatically, so any change you make reaches phones the next time they're online.

Browsers only allow offline mode for games loaded over **HTTPS** (or `localhost`), not the plain `http://192.168…` address. Two ways to get HTTPS:

1. **GitHub Pages (easiest, free).** In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) publishes the game on every push, to an address like `https://<your-username>.github.io/<repo>/`. Open that once on each phone and add it to the Home Screen. Pages is static hosting, so there's no room-code lobby there; use **Manual connect**. (Pages on a private repository needs a paid GitHub plan.)
2. **Your own computer over HTTPS.** Create a certificate and start the server with it:
   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout key.pem -out cert.pem \
     -subj "/CN=rage.local" -addext "subjectAltName=IP:192.168.1.23"
   HTTPS_CERT=cert.pem HTTPS_KEY=key.pem npm start
   ```
   Use your computer's address in place of `192.168.1.23`. Each iPhone then has to trust the certificate: send `cert.pem` to the phone (AirDrop), install it under **Settings → General → VPN & Device Management**, then turn it on under **Settings → General → About → Certificate Trust Settings**.

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

### Your character

Main menu → **🎨 Customise character** (also in the pause menu and the online room).

- **Player 1** is you: your look solo and to your partner online. **Player 2** is the second player in local co-op.
- **Display name:** shown above your character and to your partner online.
- **Colour, face and hat:** 12 colours, 6 faces (angry, happy, cool, surprised, cyclops, sleepy) and 7 hats (cap, crown, horns, bow, party hat, antenna, or none).
- **🎨 Paint your own:** draw your character on an 8×7 pixel grid with a 15-colour palette (drag to paint, also on touchscreens). Legs and the running animation are added for you, and hats still work on top.
- **🎲 Randomise** if you can't decide.

Changes save on the device and apply straight away, even mid-game. Online, your partner sees your new look and name within a second. Looks are sent as a few small numbers and palette indexes, and drawn only from the game's built-in colours, so a partner can't send anything harmful.

### Menus, saving and the world map

- **Autosave:** your run (stage, deaths, time) saves automatically on every stage change, every death, when you pause, and when you leave the page. **Continue** on the main menu picks up where you left off.
- **World map (Level select):** each world is a little overworld with stage dots joined by a path and a castle for the boss. Walk along it with the arrow keys or D-pad and press Enter or A to play; **up/down** switch world. On a touchscreen, tap a stage to walk there and tap it again to play. Cleared stages get a flag, and the box at the bottom shows your best (fewest deaths, fastest clear). Switch between **Solo** and **2P** in the bar at the bottom. **Reset** wipes the current profile's progress.
- **Profiles and shared progress:** main menu → **Profile**. Your **Solo** profile is yours alone. A **team** profile (for example "ASIA & JULIAN") is progress two people share:
  - Pick it for local co-op on one device.
  - Online, the team profile for the two of you is picked automatically on both devices and kept in sync as you clear stages.
  - A new team starts with the furthest progress either of you had on your own.
  - **Your progress code is saved on the device** and kept up to date automatically; it's shown on the Profile screen, ready to copy to another device.
  - **Received progress:** codes other people send you are kept on the device in a list, so you can add them to your solo or team profile now or later. Adding combines the progress with what's already there, so nothing is lost. You can also paste a code by hand.
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

### World 4: The Frost
1. **Slip N Slide**: ice. Brakes not included.
2. **Icicles**: look up.
3. **Cold Feet**: tiny ice platforms over spikes, plus a saw.
4. **Boss, The Yeti**: shards fall when it slams, and the middle of the arena is ice.

### World 5: The Void
1. **Portals**: step into one, come out of the other. Not every portal is your friend.
2. **Leap of Faith**: jump in the hole. Trust me.
3. **Glitch Walk**: walls you can only get past by portal, plus lasers.
4. **Boss, The Glitch**: it teleports around the arena.

### World 6: The Core
1. **Meltdown**: conveyors, blinking blocks and ice over a sea of spikes.
2. **Round Trip**: see you at the start :)
3. **Last Straw**: one long climb using everything.
4. **Final boss, The Rage**: 8 hits, falling shards and teleporting. No refunds.

The exit door in World 3 only works when **both** players are at it. If your online partner leaves during World 3, the game ends, because it can't be finished alone.

The 2-player modes (local and online) are locked until World 2 is unlocked. Multiplayer games use World 2 and World 3; when hosting online you pick which world to start in.

Traps reset when everyone is dead. In co-op, one player can scout while the other survives.

## Two players

Both modes unlock once you beat World 1, and multiplayer games are played in World 2.

- **Local:** one keyboard with two key sets, or controllers. Controller 1 plays P1 and controller 2 plays P2. With only one controller, it plays P2 and the keyboard plays P1.
- **Bluetooth controllers:** pair a Bluetooth gamepad with your computer or phone and it works right away through the Gamepad API.
- **Two iPhones with no internet:** web pages on iPhone can't use Bluetooth at all, and browsers can't link phone-to-phone over Bluetooth anywhere. The game does the next best thing:
  1. Phone A turns on **Personal Hotspot** and Phone B joins it (or both join the same Wi-Fi).
  2. In **Manual connect**, the **Share** button sends the connection code over **AirDrop**, which finds the other phone by Bluetooth and needs no internet.
  3. The game then plays directly between the phones.

  Step-by-step instructions are in the game under Manual connect → "Two iPhones, no internet?". Both phones need the game saved for offline play first (see below).
- **⚡ Quick play (one tap):** when the game is opened from a computer running `npm start`, both players tap **Quick play** and the server pairs them. Nothing to type.
- **🔗 Invite a friend:** makes a private room and opens the share sheet with a link. Your friend taps the link and joins automatically (same Wi-Fi as the server). There's also a 6-character room code they can type instead.
- **Online lobby:** however you connect, you both land in a **room**:
  - **📤 Share my progress** sends your progress to your partner with one press; it shows up in their *Received progress* list, ready to add to your team.
  - The host picks the world and presses **Start game**.
  - You can also share from the pause menu during a game.
  - Gameplay runs peer-to-peer over WebRTC.
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
  js/save.js       autosave, profiles/teams, unlocks, best times, progress codes
  js/map.js        the overworld map
  js/looks.js      character looks (colours, faces, hats, painted sprites)
  sw.js            offline cache (generated by scripts/build-sw.mjs)
scripts/           build-sw.mjs: regenerates public/sw.js
.github/workflows/ pages.yml: publishes the game to GitHub Pages
server/server.js   static files + lobby, zero dependencies
test/              node:test suites
```
