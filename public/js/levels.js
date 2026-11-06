// Level data. Every level is a single 40x23 screen of 8px tiles.
// Levels are "painted" with a tiny builder so coordinates stay exact.
//
// Legend
//   #  ground (solid)          =  brick (solid)
//   ^ v < >  spikes (up / down / pointing left / pointing right)
//   F  fake ground (looks solid, is not)
//   I  invisible block (solid, appears once you bump it)
//   P p  spawn for player 1 / player 2
//   D  exit door              M  runaway door  N  where it runs to
//   Q  fake door (it bites)   C  crumbling block
//   H  hidden spike           X  falling block   V  falling spike
//   S  horizontal saw         Z  vertical saw    J  spring
//   B  boss (its settings come from the level's `boss` field)
//   { }  conveyor belt moving left / right (solid)
//   O o  on/off blocks, groups A / B (they take turns being solid)
//   L l  ceiling laser, two timings (fires a beam straight down)
//   K k  pressure plate, channel 1 / 2 (opens gates while someone stands on it)
//   G g  gate, channel 1 / 2 (solid until a matching plate is held)

export const TILE = 8;
export const COLS = 40;
export const ROWS = 23;
export const W = COLS * TILE; // 320
export const H = ROWS * TILE; // 184

function build(name, sign, paint, extra = {}) {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
  const L = {
    rect(x, y, w, h, c) {
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          if (i >= 0 && i < COLS && j >= 0 && j < ROWS) g[j][i] = c;
        }
      }
    },
    set(x, y, c) { L.rect(x, y, 1, 1, c); },
  };
  // Ceiling and side walls on every level.
  L.rect(0, 0, COLS, 1, '#');
  L.rect(0, 0, 1, ROWS, '#');
  L.rect(COLS - 1, 0, 1, ROWS, '#');
  paint(L);
  return { name, sign, rows: Object.freeze(g.map((r) => r.join(''))), boss: null, ...extra };
}

const WORLD1 = [
  build('WELCOME', 'WELCOME! THIS ONE IS EASY :)', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.rect(9, 20, 3, 1, '^');
    L.set(16, 19, 'H');
    L.rect(22, 20, 2, 3, 'F');
    L.set(28, 10, 'X');
    L.set(36, 19, 'D');
  }),

  build('SHY DOOR', 'DOORS ARE SHY. HEADS ARE SOFT.', (L) => {
    L.rect(0, 20, 12, 3, '#');
    L.rect(12, 21, 4, 2, '#'); L.rect(12, 20, 4, 1, '^');
    L.rect(16, 20, 24, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.rect(12, 15, 2, 1, 'I');
    L.rect(22, 17, 3, 1, '=');
    L.rect(27, 14, 3, 1, '=');
    L.rect(33, 11, 6, 1, '=');
    L.set(31, 19, 'M'); L.set(37, 10, 'N');
  }),

  build('CRUMBLE', 'DONT STAND STILL.', (L) => {
    L.rect(0, 20, 6, 3, '#');
    L.rect(6, 21, 28, 2, '#'); L.rect(6, 20, 28, 1, '^');
    L.rect(34, 20, 6, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    for (const c of [8, 13, 18, 23, 28]) L.rect(c, 17, 2, 1, 'C');
    L.set(5, 13, '='); L.set(34, 13, '=');
    L.set(20, 13, 'S');
    L.set(37, 19, 'D');
  }),

  build('BOING', 'SPRINGS ARE FUN. DONT GET GREEDY.', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.rect(8, 20, 31, 1, '^');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.set(6, 19, 'J');
    L.rect(11, 13, 3, 1, '=');
    L.set(12, 3, 'V');
    L.rect(18, 14, 3, 1, '=');
    L.set(20, 13, 'J');
    L.rect(16, 1, 15, 1, 'v');
    L.rect(27, 9, 12, 1, '=');
    L.set(33, 8, 'H');
    L.set(37, 8, 'D');
  }),

  build('TRUST ISSUES', 'THE EXIT IS RIGHT THERE :)', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.set(6, 19, 'Q');
    L.rect(10, 20, 4, 1, '^');
    L.rect(11, 15, 2, 1, 'I');
    L.set(17, 11, '='); L.set(17, 14, 'Z');
    L.rect(21, 20, 2, 3, 'F');
    L.rect(26, 17, 3, 1, '=');
    L.rect(31, 14, 3, 1, '=');
    L.rect(36, 11, 3, 1, '=');
    L.rect(31, 8, 3, 1, 'C');
    L.rect(24, 6, 5, 1, '=');
    L.set(27, 5, 'H');
    L.set(25, 5, 'D');
    L.set(37, 2, 'X');
  }),

  build('THE GRUDGE', 'STOMP IT WHILE IT IS DIZZY', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(3, 19, 'P'); L.set(5, 19, 'p');
    L.rect(3, 15, 5, 1, '=');
    L.rect(32, 15, 5, 1, '=');
    L.set(19, 4, 'B');
  }, { boss: { kind: 0, hp: 4 } }),
];

// ---- World 2: THE MACHINE (unlocks after The Grudge; multiplayer starts here) ----
const WORLD2 = [
  build('CONVEYOR', 'THE FLOOR HAS OPINIONS', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.rect(6, 20, 10, 1, '{');
    L.rect(16, 20, 3, 1, '^');
    L.rect(19, 20, 8, 1, '}');
    L.rect(27, 20, 2, 1, '^');
    L.set(24, 1, 'L');
    L.set(33, 10, 'X');
    L.set(37, 19, 'D');
  }),

  build('BLINK', 'NOW YOU SEE IT', (L) => {
    L.rect(0, 20, 6, 3, '#');
    L.rect(6, 21, 28, 2, '#'); L.rect(6, 20, 28, 1, '^');
    L.rect(34, 20, 6, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.rect(8, 17, 3, 1, 'O');
    L.rect(13, 17, 3, 1, 'o');
    L.rect(18, 17, 3, 1, 'O');
    L.rect(23, 17, 3, 1, 'o');
    L.rect(28, 17, 3, 1, 'O');
    L.set(36, 19, 'H');
    L.set(38, 19, 'D');
  }),

  build('LASER TAG', 'RED MEANS NO', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.set(8, 1, 'L'); L.set(14, 1, 'l'); L.set(20, 1, 'L'); L.set(26, 1, 'l'); L.set(32, 1, 'L');
    L.set(17, 19, 'H');
    L.rect(23, 20, 1, 3, 'F');
    L.set(29, 19, 'H');
    L.set(37, 19, 'D');
  }),

  build('GAUNTLET', 'EVERYTHING AT ONCE :)', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.rect(10, 20, 29, 1, '^');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.rect(11, 17, 4, 1, '}');
    L.rect(17, 15, 3, 1, 'O');
    L.rect(22, 13, 3, 1, 'o');
    L.rect(27, 11, 4, 1, '=');
    L.set(29, 1, 'l');
    L.rect(33, 9, 6, 1, '{');
    L.set(37, 8, 'D');
  }),

  build('THE OVERCLOCK', 'IT GOT AN UPGRADE', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.rect(1, 20, 7, 1, '}'); L.rect(32, 20, 7, 1, '{');
    L.set(3, 19, 'P'); L.set(5, 19, 'p');
    L.rect(3, 15, 5, 1, '=');
    L.rect(32, 15, 5, 1, '=');
    L.set(19, 4, 'B');
  }, { boss: { kind: 1, hp: 6 } }),
];

// ---- World 3: THE BOND (co-op only: every stage needs two players) ----
const WORLD3 = [
  build('TEAMWORK', 'TWO HEADS ARE TALLER THAN ONE', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(2, 19, 'P'); L.set(4, 19, 'p');
    // a slab too high to jump onto alone, with a gated tunnel underneath
    L.rect(16, 16, 18, 2, '#');
    L.rect(20, 18, 1, 2, 'G');
    L.set(22, 15, 'K');
    L.rect(27, 15, 2, 1, '^');
    L.set(35, 19, 'H');
    L.set(38, 19, 'D');
  }),

  build('TAG TEAM', 'YOU HOLD. I GO. THEN SWAP.', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.rect(12, 1, 1, 12, '#'); L.rect(12, 13, 1, 7, 'G');
    L.rect(26, 1, 1, 12, '#'); L.rect(26, 13, 1, 7, 'g');
    L.set(6, 19, 'K'); L.set(15, 19, 'K');
    L.set(19, 1, 'L');
    L.set(21, 19, 'k'); L.set(33, 19, 'k');
    L.rect(29, 20, 2, 1, '^');
    L.set(35, 19, 'H');
    L.set(37, 19, 'D');
  }),

  build('TRUST FALL', 'CATCH ME', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(2, 19, 'P'); L.set(3, 19, 'p');
    L.rect(8, 16, 6, 2, '#');
    L.rect(11, 18, 1, 2, 'G');
    L.set(12, 15, 'K');
    L.set(17, 19, 'J');
    L.rect(20, 12, 8, 1, '=');
    L.set(26, 11, 'k');
    L.set(23, 1, 'l');
    L.rect(30, 1, 1, 12, '#'); L.rect(30, 13, 1, 7, 'g');
    L.set(34, 19, 'k');
    L.set(37, 19, 'D');
  }),

  build('THE WARDEN', 'HOLD A SWITCH TO DROP ITS SHIELD', (L) => {
    L.rect(0, 20, 40, 3, '#');
    L.set(6, 19, 'P'); L.set(33, 19, 'p');
    L.set(2, 19, 'K'); L.set(37, 19, 'K');
    L.rect(3, 15, 5, 1, '=');
    L.rect(32, 15, 5, 1, '=');
    L.set(19, 4, 'B');
  }, { boss: { kind: 2, hp: 6, shield: true } }),
];

export const WORLDS = Object.freeze([
  { name: 'THE PIT', levels: WORLD1, coop: false },
  { name: 'THE MACHINE', levels: WORLD2, coop: false },
  { name: 'THE BOND', levels: WORLD3, coop: true },
].map((w, wi, all) => {
  const start = all.slice(0, wi).reduce((n, x) => n + x.levels.length, 0);
  return Object.freeze({ name: w.name, start, end: start + w.levels.length - 1, coop: w.coop });
}));

export const LEVELS = Object.freeze([...WORLD1, ...WORLD2, ...WORLD3].map((L, i) => {
  const world = WORLDS.findIndex((w) => i >= w.start && i <= w.end);
  return Object.freeze({ ...L, world, stage: i - WORLDS[world].start, coop: WORLDS[world].coop });
}));

// Multiplayer (local 2P and online) is only available from World 2 onwards.
export const MULTIPLAYER_START = WORLDS[1].start;

// Co-op worlds can't be played solo.
export const COOP_START = WORLDS.find((w) => w.coop).start;
export const isCoopLevel = (i) => !!(LEVELS[i] && LEVELS[i].coop);

export const isBossLevel = (i) => !!(LEVELS[i] && LEVELS[i].boss);
export const isLastWorld = (w) => w >= WORLDS.length - 1;

// "1-3", "1-BOSS", "2-1" ...
export function stageLabel(i) {
  const L = LEVELS[i];
  if (!L) return '?';
  return `${L.world + 1}-${L.boss ? 'BOSS' : L.stage + 1}`;
}
