// 3x5 bitmap pixel font, drawn with fillRect so it stays crisp.
const G = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001110',
  ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', '!': '010010010000010',
  '?': '110001010000010', ':': '000010000010000', '-': '000000111000000', '+': '000010111010000',
  "'": '010010000000000', '/': '001001010100100', '(': '010100100100010', ')': '010001001001010',
  '#': '101111101111101', '=': '000111000111000', '%': '101001010100101', '>': '100010001010100',
  '<': '001010100010001', '_': '000000000000111', '*': '000101010101000',
};

export function textWidth(str, scale = 1) {
  return str.length === 0 ? 0 : (str.length * 4 - 1) * scale;
}

export function drawText(ctx, str, x, y, color = '#fff', scale = 1, shadow = '#0a0610') {
  const s = String(str).toUpperCase();
  if (shadow) drawRaw(ctx, s, x + scale, y + scale, shadow, scale);
  drawRaw(ctx, s, x, y, color, scale);
}

function drawRaw(ctx, s, x, y, color, scale) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of s) {
    const g = G[ch] || G['?'];
    for (let i = 0; i < 15; i++) {
      if (g.charCodeAt(i) === 49) ctx.fillRect(cx + (i % 3) * scale, cy + ((i / 3) | 0) * scale, scale, scale);
    }
    cx += 4 * scale;
  }
}

export function drawTextCentered(ctx, str, cx, y, color, scale = 1, shadow) {
  drawText(ctx, str, Math.round(cx - textWidth(String(str), scale) / 2), y, color, scale, shadow);
}
