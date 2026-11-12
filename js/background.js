// トレジャーハンター向けの背景（夕暮れの密林と古代遺跡）をコードでドット絵として描く。
// 低解像度で描いて 3倍 に拡大して使う（ドット感を出すため）。乱数は固定シードなので毎回同じ絵になる。
//
// 2つのレイヤーに分けている:
//   'sky' : 空のグラデーション・星・太陽。画面に固定（ループさせない → 太陽が複数にならない）
//   'far' : 雲・山・遺跡・木・地下。横にループ＋視差スクロールする（背景は透過）

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BG_SCALE = 3;

export function createBackground(width, height, groundY, part, theme = 'field') {
  const S = BG_SCALE;
  const lw = Math.ceil(width / S), lh = Math.ceil(height / S);
  const horizon = groundY / S;           // 地面タイルが始まる行（低解像度）
  const c = document.createElement('canvas');
  c.width = lw; c.height = lh;
  const x = c.getContext('2d');
  const rnd = mulberry32(part === 'sky' ? 11 : 20240607);

  const rect = (col, X, Y, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(Math.round(X), Math.round(Y), w, h); };
  const disc = (col, cx, cy, r, dither = false) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (dither && ((cx + dx + cy + dy) & 1)) continue;
        rect(col, cx + dx, cy + dy);
      }
    }
  };

  if (theme === 'cave') {
    paintCave(x, lw, lh, rnd, rect, disc);
  } else if (theme === 'forest') {
    paintForest(part, x, lw, lh, horizon, rnd, rect, disc);
  } else if (theme === 'city') {
    paintCity(part, x, lw, lh, horizon, rnd, rect, disc);
  } else if (part === 'sky') {
    // --- 空（夕焼けのグラデーション。境目はチェッカーでディザ）。地平線より下も同じ色で埋める ---
    const sky = ['#23235b', '#3b2f78', '#6b3a86', '#a24a8a', '#d6607a', '#f08a5d', '#fbb55a', '#ffd98a'];
    for (let y = 0; y < lh; y++) {
      const t = (Math.min(y, horizon) / horizon) * sky.length;
      const i = Math.min(sky.length - 1, Math.floor(t));
      const f = t - i;
      for (let X = 0; X < lw; X++) {
        const useNext = f > 0.7 && i + 1 < sky.length && ((X + y) & 1) === 0;
        rect(sky[useNext ? i + 1 : i], X, y);
      }
    }

    // 星
    for (let k = 0; k < Math.round(28 * lw / 320); k++) rect('#ffffff', rnd() * lw, rnd() * horizon * 0.3);

    // 太陽（ハロー付き）。画面の中央やや右に1つだけ
    const sunX = Math.round(lw * 0.58), sunY = Math.round(horizon - 38);
    disc('#fbb55a', sunX, sunY, 40, true);
    disc('#ffc873', sunX, sunY, 32, true);
    disc('#ffd98a', sunX, sunY, 27);
    disc('#fff3c4', sunX, sunY, 21);

    // 上部の暗いビネット
    const g = x.createLinearGradient(0, 0, 0, 40);
    g.addColorStop(0, 'rgba(10, 10, 30, 0.35)');
    g.addColorStop(1, 'rgba(10, 10, 30, 0)');
    x.fillStyle = g;
    x.fillRect(0, 0, lw, 40);
  } else {
    // --- 地下（地面ブロックを消したときに見える暗い土の奥）---
    const under = ['#2b1a22', '#241520', '#1d1019', '#170c14'];
    for (let y = Math.floor(horizon); y < lh; y++) {
      rect(under[Math.min(under.length - 1, Math.floor((y - horizon) / 14))], 0, y, lw, 1);
    }

    // 筋雲
    const cloudCols = ['#b44a7e', '#e0788a', '#f4a58a'];
    for (let k = 0; k < Math.round(9 * lw / 320); k++) {
      const cx = rnd() * lw, cy = horizon * (0.19 + rnd() * 0.47), w = 26 + rnd() * 46;
      const col = cloudCols[Math.floor(rnd() * cloudCols.length)];
      rect(col, cx, cy, w, 2);
      rect(col, cx + 6, cy - 1, w * 0.6, 1);
      rect(col, cx - 5, cy + 2, w * 0.5, 1);
    }

    // --- 遠くの山並み ---
    const ridge = (col, base, amp, f1, f2, ph) => {
      for (let X = 0; X < lw; X++) {
        const top = Math.round(horizon - base - amp * Math.sin(X * f1 + ph) - amp * 0.5 * Math.sin(X * f2 + ph * 2));
        rect(col, X, top, 1, horizon - top);
      }
    };
    ridge('#6a3f7c', 26, 12, 0.028, 0.071, 0.6);
    ridge('#4a2d66', 14, 8, 0.045, 0.11, 2.1);

    // --- 階段状の遺跡（ジッグラト）---
    const ziggurat = (cx, base, w0, steps, stepH, shrink, lit, dark, edge, doorCol) => {
      for (let i = 0; i < steps; i++) {
        const w = w0 - i * shrink * 2;
        const y = base - (i + 1) * stepH;
        for (let X = 0; X < w; X++) {
          const px = cx - w / 2 + X;
          rect(px < cx ? lit : dark, px, y, 1, stepH);
        }
        rect(edge, cx - w / 2, y, w, 1);                    // 段の縁のハイライト
      }
      // 頂上の祠と入口
      const topY = base - steps * stepH;
      const tw = Math.max(10, w0 - steps * shrink * 2);
      rect(lit, cx - tw / 2 + 2, topY - 7, tw / 2 - 2, 7);
      rect(dark, cx, topY - 7, tw / 2 - 2, 7);
      rect(edge, cx - tw / 2 + 2, topY - 8, tw - 4, 1);
      rect(doorCol, cx - 2, topY - 5, 4, 5);
      // 基部の大扉
      rect(doorCol, cx - 4, base - 12, 8, 12);
      rect(edge, cx - 5, base - 13, 10, 1);
    };
    ziggurat(Math.round(lw * 0.19), horizon, 76, 7, 6, 5, '#6a4a6a', '#4f3858', '#8a6486', '#1a1020');
    ziggurat(Math.round(lw * 0.74), horizon, 124, 9, 6, 6, '#9a7048', '#664630', '#c49a60', '#1a1020');

    // --- ジャングル（シルエットの木々）---
    const tree = (tx, canopyY, scale) => {
      const dark = '#1b3d2a', mid = '#2a5c35', light = '#3f8040';
      rect(dark, tx - 1, canopyY, 3, horizon - canopyY);                       // 幹
      for (let k = 0; k < 7; k++) {                                            // 葉の塊
        const ox = (rnd() - 0.5) * 34 * scale, oy = (rnd() - 0.5) * 12 * scale;
        disc(dark, Math.round(tx + ox), Math.round(canopyY + oy), Math.round((8 + rnd() * 6) * scale));
      }
      for (let k = 0; k < 5; k++) {
        const ox = (rnd() - 0.5) * 30 * scale, oy = (rnd() - 0.5) * 10 * scale - 3;
        disc(mid, Math.round(tx + ox), Math.round(canopyY + oy), Math.round((4 + rnd() * 4) * scale));
      }
      for (let k = 0; k < 4; k++) {
        const ox = (rnd() - 0.5) * 26 * scale, oy = (rnd() - 0.5) * 8 * scale - 5;
        disc(light, Math.round(tx + ox), Math.round(canopyY + oy), Math.round((2 + rnd() * 2) * scale), true);
      }
    };
    // [横位置(幅に対する割合), 樹冠の高さ(地平線からのオフセット), 大きさ]
    // 左右反転でループさせる継ぎ目(0と1)に木がかからないよう、両端から離して置く
    for (const [fx, off, sc] of [[0.12, -88, 1.1], [0.33, -72, 0.8], [0.5, -64, 0.65], [0.66, -80, 0.9], [0.88, -92, 1.1]]) {
      tree(Math.round(lw * fx), horizon + off, sc);
    }

    // 茂み
    for (let X = 0; X < lw; X += 6 + Math.floor(rnd() * 8)) {
      disc('#1f4a2c', X, horizon - 1, 4 + Math.floor(rnd() * 4));
      disc('#2f6b3a', X - 1, horizon - 4, 2 + Math.floor(rnd() * 2), true);
    }

    // 夕靄
    x.fillStyle = 'rgba(255, 190, 140, 0.16)';
    x.fillRect(0, horizon - 22, lw, 22);
  }

  // 拡大した canvas を返す（ニアレストネイバー）
  const out = document.createElement('canvas');
  out.width = lw * S; out.height = lh * S;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

// ---- 地下迷宮: 暗い石造りの壁・遺跡の柱・光る水晶。縦横どちらにも継ぎ目なくタイルできる ----
function paintCave(x, lw, lh, rnd, rect, disc) {
  const wrap = fn => { for (const dx of [-lw, 0, lw]) for (const dy of [-lh, 0, lh]) fn(dx, dy); };
  const wdisc = (col, cx, cy, r, dither) => wrap((dx, dy) => disc(col, cx + dx, cy + dy, r, dither));
  const wrect = (col, X, Y, w, h) => wrap((dx, dy) => rect(col, X + dx, Y + dy, w, h));

  // 石壁（レンガ模様）
  x.fillStyle = '#0d0f1e'; x.fillRect(0, 0, lw, lh);
  const bw = 20, bh = 10, cols = lw / bw;
  for (let row = 0; row < lh / bh; row++) {
    const off = (row % 2) * (bw / 2);
    for (let k = 0; k < cols; k++) {
      const v = (k * 5 + row * 3) % 7;
      const col = v < 2 ? '#141830' : v < 4 ? '#181c36' : '#161a32';
      wrect(col, k * bw + off, row * bh, bw - 1, bh - 1);
    }
  }
  // かすれ・ひび
  for (let k = 0; k < 220; k++) rect(rnd() < 0.5 ? '#1e2342' : '#0f1224', rnd() * lw, rnd() * lh);

  // 遺跡の柱のシルエット
  for (const [px, py, pw, ph] of [[30, 20, 12, 90], [120, 60, 14, 100], [185, 10, 10, 70]]) {
    wrect('#0a0c18', px, py, pw, ph);
    wrect('#0a0c18', px - 3, py, pw + 6, 5);
    wrect('#11142a', px + 2, py + 5, 2, ph - 5);
  }

  // 暗い岩のかたまり
  for (let k = 0; k < 12; k++) {
    const cx = Math.round(rnd() * lw), cy = Math.round(rnd() * lh), r = 6 + Math.floor(rnd() * 10);
    wdisc('#0a0c18', cx, cy, r);
    wdisc('#0e1122', cx - 2, cy - 2, Math.max(2, r - 3));
  }

  // 光る水晶（シアン・ピンク）
  for (let k = 0; k < 10; k++) {
    const cx = Math.round(rnd() * lw), cy = Math.round(rnd() * lh);
    const pink = k % 4 === 3;
    const halo = pink ? '#33103a' : '#10304a', light = pink ? '#ff6ad5' : '#5ee0ff', mid = pink ? '#b03a9a' : '#2aa0d0';
    wdisc(halo, cx, cy, 13, true);
    wdisc(halo, cx, cy, 8);
    for (const [ox, h] of [[-3, 6], [0, 11], [3, 7]]) {
      wrect(mid, cx + ox, cy - h + 3, 2, h);
      wrect(light, cx + ox, cy - h + 3, 1, h);
    }
  }
}

// 空のグラデーション（昼）。境目はチェッカーでディザ
function daySky(lw, horizon, lh, rect, cols) {
  for (let y = 0; y < lh; y++) {
    const t = (Math.min(y, horizon) / Math.max(1, horizon)) * cols.length, i = Math.min(cols.length - 1, Math.floor(t)), f = t - i;
    for (let X = 0; X < lw; X++) rect(cols[(f > 0.65 && i + 1 < cols.length && ((X + y) & 1) === 0) ? i + 1 : i], X, y);
  }
}
function cloud(rect, rnd, cx, cy) {
  const w = 14 + Math.floor(rnd() * 14);
  for (let j = 0; j < 5; j++) {
    const ww = Math.round(w * (j === 0 ? 0.45 : j < 3 ? 1 : 0.8) - j), off = Math.round((w - ww) / 2);
    rect(j > 2 ? '#d4e8f8' : '#ffffff', cx + off, cy + j, ww, 1);
  }
}

// ---- 昼の森: 空・雲・ぼんやりした山 ＋ 幹と葉の木々（奥・手前の2層）----
function paintForest(part, x, lw, lh, horizon, rnd, rect, disc) {
  if (part === 'sky') {
    daySky(lw, horizon, lh, rect, ['#3f8fe6', '#5aa5ee', '#7bbbf4', '#9dd0f8', '#bfe3fb']);
    for (let k = 0; k < Math.round(7 * lw / 320) + 2; k++) cloud(rect, rnd, Math.floor(rnd() * lw), Math.floor(rnd() * horizon * 0.5));
    return;
  }
  // 地下（地面をくりぬいた所から見える土）
  const under = ['#3b2616', '#2e1d10', '#23160c'];
  for (let y = Math.floor(horizon); y < lh; y++) rect(under[Math.min(2, Math.floor((y - horizon) / 20))], 0, y, lw, 1);
  // 遠い山（霞んだ青緑）
  const ridge = (col, base, amp, f1, f2, ph) => {
    for (let X = 0; X < lw; X++) {
      const top = Math.round(horizon - base - amp * Math.sin(X * f1 + ph) - amp * 0.5 * Math.sin(X * f2 + ph * 2));
      rect(col, X, top, 1, horizon - top);
    }
  };
  ridge('#8fb7c8', 40, 14, 0.03, 0.08, 0.4);
  ridge('#6f9fa0', 24, 10, 0.045, 0.1, 1.9);
  // 木: 奥(far) と 手前(near) の2層
  const pal = {
    far:  { trunk: '#3d4f35', dark: '#2f5a3a', mid: '#3d7447', light: '#58975a' },
    near: { trunk: '#4a2e16', dark: '#1d4a2a', mid: '#2c6a35', light: '#49914a' },
  };
  const tree = (tx, top, tw, set, big) => {
    const p = pal[set];
    rect(p.trunk, tx - Math.floor(tw / 2), top, tw, horizon - top);
    if (set === 'near') rect('#6b4423', tx - Math.floor(tw / 2), top, 1, horizon - top);       // 幹のハイライト
    const n = big ? 9 : 6;
    for (let k = 0; k < n; k++) {
      const ox = Math.round((rnd() - 0.5) * (big ? 38 : 26)), oy = Math.round((rnd() - 0.5) * 14);
      disc(p.dark, tx + ox, top + oy, Math.round((big ? 9 : 6) + rnd() * 5));
    }
    for (let k = 0; k < n - 2; k++) {
      const ox = Math.round((rnd() - 0.5) * (big ? 34 : 22)), oy = Math.round((rnd() - 0.5) * 12) - 2;
      disc(p.mid, tx + ox, top + oy, Math.round((big ? 5 : 3) + rnd() * 3));
    }
    for (let k = 0; k < 4; k++) disc(p.light, tx + Math.round((rnd() - 0.5) * 24), top + Math.round((rnd() - 0.5) * 10) - 4, 2, true);
  };
  // 左右反転でつなぐので、両端(0と1)から離して置く
  for (const fx of [0.06, 0.17, 0.27, 0.37, 0.46, 0.55, 0.64, 0.74, 0.84, 0.94]) {
    tree(Math.round(lw * fx + (rnd() - 0.5) * 6), Math.round(horizon - 46 - rnd() * 22), 3, 'far', false);
  }
  for (const fx of [0.11, 0.31, 0.5, 0.69, 0.89]) {
    tree(Math.round(lw * fx), Math.round(horizon - 78 - rnd() * 18), 5, 'near', true);
  }
  // 下草
  for (let X = 0; X < lw; X += 4 + Math.floor(rnd() * 6)) {
    disc('#2c6a35', X, horizon - 1, 3 + Math.floor(rnd() * 3));
    disc('#49914a', X - 1, horizon - 3, 1 + Math.floor(rnd() * 2), true);
  }
  // 木もれ日の霞
  x.fillStyle = 'rgba(255, 250, 200, 0.10)';
  x.fillRect(0, horizon - 70, lw, 70);
}

// ---- 都会（駅前）: 空・雲・鳥・遠いビル群・電波塔・高架と電車・手前のにぎやかな建物 ----
function paintCity(part, x, lw, lh, horizon, rnd, rect, disc) {
  if (part === 'sky') {
    daySky(lw, horizon, lh, rect, ['#58a8f0', '#78bef5', '#98d0f9', '#b6e0fb', '#d6eefc']);
    for (let k = 0; k < Math.round(6 * lw / 320) + 2; k++) cloud(rect, rnd, Math.floor(rnd() * lw), Math.floor(rnd() * horizon * 0.45));
    // 飛行機雲
    for (let X = 0; X < lw * 0.5; X++) rect('rgba(255,255,255,0.55)', Math.floor(lw * 0.1 + X), Math.round(horizon * 0.2 - X * 0.12), 1, 1);
    return;
  }
  for (let y = Math.floor(horizon); y < lh; y++) rect('#2c2f3d', 0, y, lw, 1);          // 道路の下
  const winColors = ['#6f8aa6', '#7d93b0', '#8aa0bb'];

  // 窓の並び（昼は青っぽい窓、ところどころ明るい）
  const windows = (bx, top, w, h, floorH, lit) => {
    for (let wy = top + 3; wy < top + h - 5; wy += floorH) {
      for (let wx = bx + 3; wx < bx + w - 4; wx += 5) rect(rnd() < 0.18 ? lit : winColors[Math.floor(rnd() * 3)], wx, wy, 3, 3);
    }
  };
  // 1) いちばん奥: かすんだ超高層ビル + 電波塔
  let bx = -6;
  while (bx < lw) {
    const w = 10 + Math.floor(rnd() * 12), h = 50 + Math.floor(rnd() * 46), top = horizon - h;
    rect('#b4c8dc', bx, top, w, h); rect('#a2b8ce', bx + w - 2, top, 2, h);
    if (rnd() < 0.5) rect('#a2b8ce', bx + Math.floor(w / 2), top - 6, 1, 6);                 // アンテナ
    for (let wy = top + 4; wy < horizon - 4; wy += 4) rect('#c6d8ea', bx + 2, wy, w - 5, 1);   // 窓の横線
    bx += w + Math.floor(rnd() * 3);
  }
  // 2) 中くらいのビル: 看板や貯水タンクつき
  bx = 2;
  const cols = [['#c3b9a6', '#a89e8c'], ['#d4c9b0', '#b8ac92'], ['#b3c2cf', '#97a8b8'], ['#cfb6a4', '#b39a88']];
  while (bx < lw) {
    const w = 16 + Math.floor(rnd() * 18), h = 30 + Math.floor(rnd() * 34), top = horizon - h, c = cols[Math.floor(rnd() * cols.length)];
    rect(c[0], bx, top, w, h); rect(c[1], bx + w - 3, top, 3, h); rect(c[1], bx, top, w, 1);
    windows(bx, top, w, h, 6, '#f6e9b0');
    const k = rnd();
    if (k < 0.3) { rect('#6a4a3a', bx + 3, top - 7, 7, 7); rect('#4a3228', bx + 2, top - 8, 9, 1); rect('#3a2a22', bx + 5, top, 1, 2); }        // 貯水タンク
    else if (k < 0.55) {                                                                                                                      // 屋上の看板
      const bc = ['#e04a3c', '#2f6fb5', '#f0a020', '#7c4fb0'][Math.floor(rnd() * 4)];
      rect('#3a3a44', bx + 3, top - 10, 1, 10); rect('#3a3a44', bx + w - 5, top - 10, 1, 10);
      rect(bc, bx + 1, top - 16, w - 2, 7); rect('#ffffff', bx + 3, top - 14, w - 6, 1); rect('#ffffff', bx + 3, top - 12, Math.max(2, w - 12), 1);
    } else if (k < 0.7) rect('#7a7a84', bx + 4, top - 4, w - 8, 4);                                                                           // 室外機の並び
    bx += w + 3 + Math.floor(rnd() * 8);
  }
  // 3) 高架と電車（地平線のすぐ上を横切る）
  const deckY = horizon - 17;
  rect('#8a8a94', 0, deckY, lw, 3); rect('#6e6e78', 0, deckY + 3, lw, 1);
  for (let X = 2; X < lw; X += 24) { rect('#7a7a84', X, deckY + 4, 3, 13); rect('#686872', X + 2, deckY + 4, 1, 13); }
  {
    let tx = Math.round(lw * 0.12);
    for (let i = 0; i < 4; i++) {                                                           // 4両編成（真ん中を空けて、つなぎ目は1つ）
      rect('#e8e8ec', tx, deckY - 11, 30, 11); rect(i % 2 ? '#2f9a5a' : '#2f6fb5', tx, deckY - 4, 30, 2);
      for (let wx = tx + 2; wx < tx + 28; wx += 6) rect('#3a4a66', wx, deckY - 9, 4, 4);
      rect('#b0b0b8', tx, deckY - 11, 30, 1);
      tx += 31;
    }
  }
  // 4) 手前の街並み: 街路樹・信号・のぼり旗
  for (let X = 8; X < lw; X += 30 + Math.floor(rnd() * 18)) {
    rect('#5a3a1a', X, horizon - 12, 2, 12);
    disc('#2f7f3a', X, horizon - 17, 6); disc('#58b04a', X - 2, horizon - 19, 3, true);
  }
  for (let X = 22; X < lw; X += 46 + Math.floor(rnd() * 20)) {
    rect('#e85a2a', X, horizon - 22, 6, 14); rect('#ffffff', X + 2, horizon - 20, 2, 3); rect('#ffffff', X + 2, horizon - 15, 2, 3);     // のぼり旗
    rect('#6a6a72', X - 1, horizon - 24, 1, 24);
  }
  // 遠くの鳥
  for (let k = 0; k < 6; k++) {
    const bxx = Math.floor(rnd() * lw), byy = 20 + Math.floor(rnd() * 40);
    rect('#3a4a66', bxx, byy, 1, 1); rect('#3a4a66', bxx + 1, byy + 1, 1, 1); rect('#3a4a66', bxx + 2, byy, 1, 1);
  }
}
