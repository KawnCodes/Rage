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
//   B  boss

export const TILE = 8;
export const COLS = 40;
export const ROWS = 23;
export const W = COLS * TILE; // 320
export const H = ROWS * TILE; // 184

function build(name, sign, paint) {
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
  return Object.freeze({ name, sign, rows: Object.freeze(g.map((r) => r.join(''))) });
}

export const LEVELS = Object.freeze([
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
  }),
]);

export const BOSS_LEVEL = LEVELS.length - 1;
