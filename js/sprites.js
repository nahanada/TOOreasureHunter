// 文字列の配列（1文字=1ピクセル）+ パレットから canvas を作る。
// '.' などパレットに無い文字は透明。
export function rowsToCanvas(rows, palette, scale = 1) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const col = palette[rows[j][i]];
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(i * scale, j * scale, scale, scale);
    }
  }
  return c;
}
