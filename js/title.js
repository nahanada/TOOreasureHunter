// タイトル画面とストーリー画面。URL にステージ指定(?stage=)が無いときに、ゲーム開始前に表示する。
//  タイトル: 空・山・芝生・木・洞窟の入り口をドット絵で描き、ロゴと「START」(data/title.json)を重ねる。
//            タッチ / クリック / 何かキーを押すと進む。
//  ストーリー: data/story.json の pages を順に表示。タッチ・クリック・キーで「次へ」。最後まで進んだらゲーム開始。

import { rowsToCanvas } from './sprites.js';
import { sfx } from './bgm.js';

const LW = 210, LH = 120, S = 3;         // 低解像度のドット絵 210x120 を 3倍に拡大 = 630x360（ゲームの見える範囲と同じ）

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 画面に合わせた拡大（main.js の resize と同じ考え方）----
function fit(canvas, cfg) {
  const vw = (cfg.viewCols ?? 21) * 30, vh = (cfg.viewRows ?? 12) * 30;
  const dpr = window.devicePixelRatio || 1;
  const kFit = Math.min(innerWidth * dpr / vw, innerHeight * dpr / vh);
  const k = (kFit >= 1 && cfg.pixelPerfect) ? Math.floor(kFit) : kFit;
  canvas.width = Math.round(vw * k); canvas.height = Math.round(vh * k);
  canvas.style.width = canvas.width / dpr + 'px'; canvas.style.height = canvas.height / dpr + 'px';
  return { k, vw, vh };
}

// ---- 背景（動かないところは1枚に描いておく）----
function paintScene() {
  const c = document.createElement('canvas');
  c.width = LW; c.height = LH;
  const x = c.getContext('2d');
  const rnd = mulberry32(20241107);
  const rect = (col, X, Y, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(Math.round(X), Math.round(Y), w, h); };

  // 空: 青のグラデーション（境目はチェッカーで）
  const sky = ['#2f7fe0', '#4a97ee', '#69aef5', '#8cc4fa', '#add8fc', '#cbe8fd'];
  const HZ = 78;
  for (let y = 0; y < HZ + 8; y++) {
    const t = Math.min(y / HZ, 0.999) * sky.length, i = Math.floor(t), f = t - i;
    for (let X = 0; X < LW; X++) rect(sky[(f > 0.65 && i + 1 < sky.length && ((X + y) & 1) === 0) ? i + 1 : i], X, y);
  }
  // 太陽
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
    const d = dx * dx + dy * dy;
    if (d <= 25) rect('#fff6c2', 188 + dx, 14 + dy);
    else if (d <= 49 && ((dx + dy) & 1) === 0) rect('#ffeaa0', 188 + dx, 14 + dy);
  }

  // 山脈: 遠い山(青灰色・雪) → 近い山(青緑)
  const mountain = (cx, base, hgt, half, col, snow) => {
    for (let dx = -half; dx <= half; dx++) {
      const hh = Math.round(hgt * (1 - Math.abs(dx) / half) + (rnd() < 0.5 ? 0 : 1));
      for (let k = 0; k < hh; k++) {
        const Y = base - k;
        const isSnow = snow && k > hh - Math.max(3, hh * 0.28) && hh > 14;
        const shade = dx > 0 && k < hh * 0.85;
        rect(isSnow ? ((dx + k) & 3 ? '#ffffff' : '#dbe8f6') : (shade ? col[1] : col[0]), cx + dx, Y);
      }
    }
  };
  mountain(30, HZ + 2, 34, 36, ['#8aa3cf', '#7690bf'], true);
  mountain(88, HZ + 2, 44, 44, ['#8aa3cf', '#7690bf'], true);
  mountain(150, HZ + 2, 38, 40, ['#8aa3cf', '#7690bf'], true);
  mountain(205, HZ + 2, 30, 32, ['#8aa3cf', '#7690bf'], true);
  mountain(10, HZ + 4, 20, 30, ['#5f86b5', '#4f74a3'], false);
  mountain(64, HZ + 4, 24, 34, ['#5f86b5', '#4f74a3'], false);
  mountain(120, HZ + 4, 22, 30, ['#5f86b5', '#4f74a3'], false);
  mountain(180, HZ + 4, 26, 36, ['#5f86b5', '#4f74a3'], false);

  // 丘（奥 → 手前）
  const hill = (base, amp, period, phase, col, dark) => {
    for (let X = 0; X < LW; X++) {
      const top = Math.round(base - amp * (0.5 + 0.5 * Math.sin(X / period + phase)));
      for (let Y = top; Y < LH; Y++) rect((Y === top) ? dark : col, X, Y);
    }
  };
  hill(84, 7, 13, 0.5, '#4a9d47', '#6cc050');
  hill(92, 6, 9, 2.2, '#3b8a3d', '#5cb04a');

  // 洞窟の入り口（右の岩山）
  const CX = 170, CB = 104;                         // 中心X, 地面の高さ
  for (let dx = -30; dx <= 30; dx++) {
    const top = Math.round(CB - 26 * Math.pow(1 - Math.abs(dx) / 31, 0.7));
    for (let Y = top; Y <= CB + 2; Y++) {
      const n = rnd();
      rect(Y === top ? '#8a8174' : (n < 0.12 ? '#5e564d' : n < 0.3 ? '#7a7166' : dx > 6 ? '#6a6157' : '#857b6e'), CX + dx, Y);
    }
  }
  // 岩のすじ・ところどころの草
  for (let i = 0; i < 26; i++) { const X = CX - 24 + Math.floor(rnd() * 48), Y = CB - 20 + Math.floor(rnd() * 18); rect('#4f4840', X, Y, 3 + Math.floor(rnd() * 3), 1); }
  for (let i = 0; i < 14; i++) { const X = CX - 26 + Math.floor(rnd() * 52); rect('#5cb04a', X, CB - 26 + Math.floor(rnd() * 8), 2, 1); }
  // 入り口（アーチ）
  for (let dy = 0; dy < 17; dy++) {
    const half = dy < 5 ? 4 + dy : 9;
    const half2 = dy < 3 ? 3 + dy * 2 : (dy < 5 ? 6 + (dy - 3) : 9);
    for (let dx = -Math.min(half2, 9); dx <= Math.min(half2, 9); dx++) rect(dy < 14 ? '#0a0b12' : '#0a0b12', CX + dx, CB - 16 + dy);
    void half;
  }
  // 入り口の縁（石）
  for (let dy = 0; dy < 17; dy++) {
    const w = dy < 3 ? 3 + dy * 2 : (dy < 5 ? 6 + (dy - 3) : 9);
    rect('#a89c8a', CX - w - 1, CB - 16 + dy); rect('#6a6157', CX + w + 1, CB - 16 + dy);
  }
  for (let dx = -4; dx <= 4; dx++) rect('#a89c8a', CX + dx, CB - 17);
  // 入り口の中のかすかな奥行き
  for (let dy = 8; dy < 17; dy++) for (let dx = -3; dx <= 3; dx++) if (((dx + dy) & 1) === 0) rect('#161826', CX + dx, CB - 16 + dy);
  // たいまつの台（炎は毎フレーム描く）
  rect('#5a3a1a', CX - 15, CB - 6, 2, 6); rect('#5a3a1a', CX + 14, CB - 6, 2, 6);

  // 木
  const pine = (X, base, h) => {
    rect('#5a3a1a', X, base - 3, 2, 3);
    for (let k = 0; k < h; k++) {
      const w = Math.floor(k / 2) + 1, Y = base - 3 - (h - k);
      for (let dx = -w; dx <= w; dx++) rect(((dx + k) & 3) === 0 ? '#2d6f35' : (dx > 0 ? '#245c2c' : '#357f3d'), X + dx, Y + h - h + 0);
      void Y;
    }
  };
  void pine;
  const treeRound = (X, base, r) => {
    for (let k = 0; k < r + 5; k++) rect('#6b4421', X, base - k, 2, 1);
    rect('#5a3a1a', X + 1, base - r - 4, 1, r + 4);
    const cy = base - r - 6;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) {
      const d = (dx * dx) / ((r + 2) * (r + 2)) + (dy * dy) / (r * r);
      if (d > 1) continue;
      const light = (dx + dy) < -r * 0.4;
      rect(d > 0.78 ? '#1f5a2a' : (light ? '#5fbe4c' : '#3f9a40'), X + dx, cy + dy);
    }
    for (let i = 0; i < r; i++) { rect('#7ad65a', X - r + Math.floor(rnd() * r * 2), cy - r + 1 + Math.floor(rnd() * r), 2, 1); }
  };
  const treeFir = (X, base, h) => {
    rect('#5a3a1a', X - 1, base - 4, 3, 4);
    for (let k = 0; k < h; k++) {
      const w = 1 + Math.floor(k * 0.55);
      for (let dx = -w; dx <= w; dx++) rect(dx > 0 ? '#1f5a2a' : ((dx + k) & 3) === 0 ? '#2f7f3a' : '#2a6d33', X + dx, base - 4 - (h - k));
    }
  };
  treeFir(8, 100, 20); treeRound(22, 102, 7); treeFir(40, 99, 15);
  treeRound(116, 100, 6); treeFir(126, 99, 17);
  treeRound(198, 101, 8); treeFir(206, 99, 19);
  treeFir(188, 98, 12);

  // 手前の芝生（地面）
  for (let Y = 100; Y < LH; Y++) {
    for (let X = 0; X < LW; X++) {
      const n = rnd();
      const base = Y < 103 ? '#6cc850' : (Y < 110 ? '#58b640' : '#47a334');
      rect(n < 0.07 ? '#8be065' : n < 0.14 ? '#3a8d2c' : base, X, Y);
    }
  }
  for (let X = 0; X < LW; X++) rect('#9aec6e', X, 100 + ((X * 7) % 3 === 0 ? 0 : 1));
  // 草の穂と花
  for (let i = 0; i < 46; i++) {
    const X = Math.floor(rnd() * LW), Y = 102 + Math.floor(rnd() * 17);
    rect('#2f7f25', X, Y - 1); rect('#2f7f25', X + 2, Y - 2); rect('#2f7f25', X + 1, Y);
  }
  const flowers = ['#ffffff', '#ffd23f', '#ff7a9a'];
  for (let i = 0; i < 18; i++) {
    const X = 4 + Math.floor(rnd() * (LW - 8)), Y = 105 + Math.floor(rnd() * 13);
    rect('#3a8d2c', X, Y + 1); rect(flowers[i % 3], X, Y); rect(flowers[i % 3], X - 1, Y, 1, 1);
  }
  return c;
}

// ---- 雲 ----
function makeCloud(w, h, rnd) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = (i / w) * 2 - 1, v = (j / h) * 2 - 0.25;
      const bump = 0.55 + 0.35 * Math.sin(i * 0.9 + rnd() * 0.4) * (1 - Math.abs(u));
      if (u * u + (v * v) / (bump * bump + 0.2) < 0.9 && v > -0.4) {
        x.fillStyle = v > 0.55 ? '#cfe4f7' : '#ffffff';
        x.fillRect(i, j, 1, 1);
      }
    }
  }
  return c;
}

// ---- 入力待ち: タッチ / クリック / キー のどれかで resolve ----
function waitForInput(minDelay = 250) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const ignore = e => e.type === 'keydown' && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'F3', 'F5', 'F11', 'F12'].includes(e.key));
    const done = e => {
      if (performance.now() - t0 < minDelay || ignore(e)) return;
      if (e.target?.id === 'btn-fs') return;               // 全画面ボタンでは進めない
      removeEventListener('pointerdown', done); removeEventListener('keydown', done);
      resolve();
    };
    addEventListener('pointerdown', done);
    addEventListener('keydown', done);
  });
}

// 戻り値: 普通に始める = undefined / RTA を選んだ = { rta: ステージID }
export async function runTitle({ canvas, cfg, logo, rtaList = [] }) {
  const ctx = canvas.getContext('2d');
  let view = fit(canvas, cfg);
  const onResize = () => { view = fit(canvas, cfg); };
  addEventListener('resize', onResize);

  const scene = paintScene();
  const low = document.createElement('canvas');
  low.width = LW; low.height = LH;
  const lx = low.getContext('2d');
  // ロゴ（変換済みデータ → canvas）
  const lc = document.createElement('canvas');
  lc.width = logo.width; lc.height = logo.height;
  const lcx = lc.getContext('2d');
  const paint = (g, ctx2) => g.rows.forEach((row, j) => [...row].forEach((ch, i) => { const col = g.palette[ch]; if (col) { ctx2.fillStyle = col; ctx2.fillRect(i, j, 1, 1); } }));
  paint(logo, lcx);
  // 「START」の文字もロゴと同じドットの大きさ（変換済みデータ data/title.json の start）
  const sc = document.createElement('canvas');
  sc.width = logo.start.width; sc.height = logo.start.height;
  paint(logo.start, sc.getContext('2d'));

  const rnd = mulberry32(5);
  const clouds = [
    { img: makeCloud(34, 11, rnd), x: 20, y: 6, v: 1.6 }, { img: makeCloud(26, 9, rnd), x: 120, y: 48, v: 1.1 },
    { img: makeCloud(40, 12, rnd), x: 170, y: 30, v: 0.8 }, { img: makeCloud(22, 8, rnd), x: 70, y: 56, v: 1.4 },
  ];

  // 左下の「RTA」の文字（data/title.json の rta）。押すとステージを選ぶメニューが開く
  let rc = null;
  if (logo.rta && rtaList.length) {
    rc = document.createElement('canvas');
    rc.width = logo.rta.width; rc.height = logo.rta.height;
    paint(logo.rta, rc.getContext('2d'));
  }
  const RTA_X = 4, RTA_Y = LH - (logo.rta?.height ?? 7) - 4;          // 低解像度での位置
  const rtaHit = { x: RTA_X * S - 9, y: RTA_Y * S - 9, w: (logo.rta?.width ?? 0) * S + 18, h: (logo.rta?.height ?? 0) * S + 18 };   // 押せる範囲（630x360 の座標）
  const MENU = { x: 12, y: 360 - 58 - rtaList.length * 34 - 8, w: 230, row: 34 };
  const optRect = i => ({ x: MENU.x + 8, y: MENU.y + 4 + i * MENU.row, w: MENU.w - 16, h: MENU.row - 4 });
  const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  let menu = false, sel = 0, choice;

  let go = false, fade = 0;
  const t0 = performance.now();
  const toLogical = e => {
    const b = canvas.getBoundingClientRect();
    return { x: (e.clientX - b.left) * view.vw / b.width, y: (e.clientY - b.top) * view.vh / b.height };
  };
  const ignoreKey = e => e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'F3', 'F5', 'F11', 'F12'].includes(e.key);
  const start = rta => { if (go) return; choice = rta ? { rta } : undefined; go = true; };
  const onPointer = e => {
    if (go || performance.now() - t0 < 250 || e.target?.id === 'btn-fs') return;
    const p = toLogical(e);
    if (menu) {
      const i = rtaList.findIndex((_, k) => inside(p, optRect(k)));
      if (i >= 0) start(rtaList[i].id);
      else if (!inside(p, MENU)) menu = false;                       // メニューの外を押したら閉じる
      return;
    }
    if (rc && inside(p, rtaHit)) { menu = true; sel = 0; return; }
    start();
  };
  const onMove = e => {
    if (!menu) return;
    const p = toLogical(e), i = rtaList.findIndex((_, k) => inside(p, optRect(k)));
    if (i >= 0) sel = i;
  };
  const onKey = e => {
    if (go || performance.now() - t0 < 250 || ignoreKey(e)) return;
    if (menu) {
      if (e.key === 'ArrowUp' || e.key === 'w') sel = (sel + rtaList.length - 1) % rtaList.length;
      else if (e.key === 'ArrowDown' || e.key === 's') sel = (sel + 1) % rtaList.length;
      else if (['Enter', ' ', 'z', 'e'].includes(e.key)) start(rtaList[sel].id);
      else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'x') menu = false;
      e.preventDefault();
      return;
    }
    if (rc && (e.key === 'r' || e.key === 'R')) { menu = true; sel = 0; return; }   // R キーでも RTA メニュー
    start();
  };
  addEventListener('pointerdown', onPointer);
  addEventListener('pointermove', onMove);
  addEventListener('keydown', onKey);

  function drawMenu(t) {
    ctx.setTransform(view.k, 0, 0, view.k, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(MENU.x, MENU.y, MENU.w, 8 + rtaList.length * MENU.row);
    ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 2; ctx.strokeRect(MENU.x + 1, MENU.y + 1, MENU.w - 2, 6 + rtaList.length * MENU.row);
    ctx.textAlign = 'left';
    rtaList.forEach((o, i) => {
      const r = optRect(i);
      ctx.fillStyle = i === sel ? '#ffe9a0' : '#ffffff'; ctx.font = 'bold 17px sans-serif';
      ctx.fillText(o.label, r.x + 8, r.y + r.h / 2 + 6);
    });
  }
  let last = performance.now();
  await new Promise(resolve => {
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = now / 1000;
      lx.clearRect(0, 0, LW, LH);
      lx.drawImage(scene, 0, 0);
      // 雲（山の手前・丘の奥）
      for (const c of clouds) {
        c.x += c.v * dt;
        if (c.x > LW + 4) c.x = -c.img.width - 4;
        lx.drawImage(c.img, Math.round(c.x), c.y);
      }
      // 山・丘の上に雲が乗らないよう、雲の下から山を描き直す代わりに、地面より下は雲を描かない（雲は空の高さのみ）
      // たいまつ（ゆらめく炎）
      const flick = Math.sin(t * 17) > 0.2 ? 1 : 0;
      for (const tx of [155, 185]) {
        lx.fillStyle = '#ff7a1a'; lx.fillRect(tx, 96 - flick, 2, 2 + flick);
        lx.fillStyle = '#ffd23f'; lx.fillRect(tx, 97 - flick, 1, 1 + flick);
        lx.fillStyle = 'rgba(255,190,90,0.18)'; lx.fillRect(tx - 3, 93, 8, 8);
      }
      // ロゴ（ゆっくり上下にゆれる）
      const bob = Math.round(Math.sin(t * Math.PI * 2 / 6) * 1.5);        // 約6秒で1往復
      const lxp = Math.round((LW - logo.width) / 2), lyp = 8 + bob;
      lx.fillStyle = 'rgba(0,0,0,0.18)';
      lx.drawImage(lc, lxp + 1, lyp + 2);           // かんたんな影
      lx.globalCompositeOperation = 'source-over';
      lx.drawImage(lc, lxp, lyp);
      // START（静止）
      lx.drawImage(sc, Math.round((LW - logo.start.width) / 2), 84);
      if (rc) lx.drawImage(rc, RTA_X, RTA_Y);                         // 左下の「RTA」
      // 画面へ（拡大はドットのまま）
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
      if (menu) drawMenu(t);
      if (go) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        fade += dt / 0.45;
        ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, fade) + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (fade >= 1) { resolve(); return; }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  removeEventListener('resize', onResize);
  removeEventListener('pointerdown', onPointer); removeEventListener('pointermove', onMove); removeEventListener('keydown', onKey);
  return choice;
}

// ---- ストーリーの背景（210x120 のドット絵）----
function skyAndClouds(x, rnd, horizon) {
  const bands = ['#4aa8ee', '#5cb4f2', '#72c0f5', '#8accf8', '#a6daf9', '#c4e8fb'];
  const h = horizon / bands.length;
  bands.forEach((c, i) => { x.fillStyle = c; x.fillRect(0, Math.floor(i * h), LW, Math.ceil(h) + 1); });
  x.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const cx = Math.floor(rnd() * LW), cy = 6 + Math.floor(rnd() * (horizon * 0.5)), w = 16 + Math.floor(rnd() * 20);
    x.fillRect(cx, cy + 2, w, 3); x.fillRect(cx + 3, cy, w - 8, 3); x.fillRect(cx + 6, cy - 1, Math.floor(w / 2), 2);
  }
}
function pineTree(x, px, base, h, dark, light) {
  x.fillStyle = '#6b4423'; x.fillRect(px, base - Math.max(2, h * 0.18), 2, Math.max(2, h * 0.18));
  for (let i = 0; i < 3; i++) {
    const top = base - h + i * (h * 0.22), w = 3 + i * 2 + Math.floor(h / 8);
    for (let r = 0; r < h * 0.4; r++) {
      const ww = Math.max(1, Math.round(w * (r / (h * 0.4)) + 1));
      x.fillStyle = r % 3 === 0 ? light : dark;
      x.fillRect(px + 1 - Math.floor(ww / 2), Math.round(top + r), ww, 1);
    }
  }
}
function roundTree(x, px, base, h, dark, light) {
  x.fillStyle = '#6b4423'; x.fillRect(px, base - Math.floor(h * 0.45), 2, Math.floor(h * 0.45));
  const r = Math.max(3, Math.floor(h * 0.32)), cy = base - Math.floor(h * 0.6);
  for (const [dx, dy, rr, c] of [[0, 0, r, dark], [-r * 0.5, r * 0.2, r * 0.75, dark], [r * 0.5, r * 0.2, r * 0.75, dark], [-r * 0.2, -r * 0.3, r * 0.55, light]]) {
    x.fillStyle = c;
    for (let yy = -rr; yy <= rr; yy++) { const w = Math.round(Math.sqrt(Math.max(0, rr * rr - yy * yy))); x.fillRect(px + 1 + Math.round(dx) - w, Math.round(cy + dy + yy), w * 2, 1); }
  }
}
function paintStoryScene(kind) {
  const c = document.createElement('canvas'); c.width = LW; c.height = LH;
  const x = c.getContext('2d'), rnd = mulberry32(kind === 'meadow' ? 7 : 3);
  if (kind === 'meadow') {                                   // 一面の花畑・木々・青空・くねくねと続く道
    const hz = 52;
    skyAndClouds(x, rnd, hz);
    x.fillStyle = '#7fc4a0'; for (let i = 0; i < LW; i++) x.fillRect(i, hz - 6 - Math.round(Math.sin(i / 17) * 3 + Math.sin(i / 7)), 1, 8);   // 遠い丘
    x.fillStyle = '#5fae4a'; x.fillRect(0, hz, LW, LH - hz);
    for (let i = 0; i < 26; i++) {                           // 遠くの木々
      const px = Math.floor(rnd() * LW);
      (i % 2 ? pineTree : roundTree)(x, px, hz + 2, 12 + Math.floor(rnd() * 5), '#2f7a3a', '#4a9a4a');
    }
    for (let y = hz; y < LH; y++) {                          // 草のグラデーション
      x.fillStyle = y % 6 < 3 ? '#68b84f' : '#5aa845'; x.fillRect(0, y, LW, 1);
    }
    const roadX = y => 100 + Math.sin((y - hz) / 6.5) * (4 + (y - hz) * 0.55) - (y - hz) * 0.1;   // くねくね
    const roadW = y => 2 + (y - hz) * 0.45;
    for (let y = hz; y < LH; y++) {
      const cx = Math.round(roadX(y)), w = Math.round(roadW(y));
      x.fillStyle = '#c9a56a'; x.fillRect(cx - w, y, w * 2, 1);
      x.fillStyle = '#e2c68e'; x.fillRect(cx - Math.floor(w / 2), y, w, 1);
      x.fillStyle = '#9a7a47'; x.fillRect(cx - w, y, 1, 1); x.fillRect(cx + w - 1, y, 1, 1);
    }
    const colors = ['#ff5a7a', '#ffd23f', '#ffffff', '#ff9ad0', '#b57aff', '#ff8a3d'];
    for (let i = 0; i < 900; i++) {                          // 一面の花
      const y = hz + 1 + Math.floor(Math.pow(rnd(), 0.7) * (LH - hz - 1)), px = Math.floor(rnd() * LW);
      if (Math.abs(px - roadX(y)) < roadW(y) + 2) continue;
      const s = y > hz + 30 ? 2 : 1;
      x.fillStyle = colors[Math.floor(rnd() * colors.length)]; x.fillRect(px, y, s, s);
      if (s === 2) { x.fillStyle = '#3f8a35'; x.fillRect(px, y + 2, 1, 1); }
    }
    for (const [px, h] of [[10, 44], [34, 38], [60, 30], [150, 32], [176, 42], [198, 48]]) {   // 手前の木々
      (px % 4 ? roundTree : pineTree)(x, px, hz + 8 + Math.floor(h / 3), h, '#26702f', '#3f9a44');
    }
  } else {                                                   // 森と青空
    const hz = 70;
    skyAndClouds(x, rnd, hz);
    x.fillStyle = '#4f9a6a'; for (let i = 0; i < LW; i++) x.fillRect(i, hz - 18 - Math.round(Math.sin(i / 20) * 4), 1, 20);   // 遠い山
    x.fillStyle = '#2e7d3e'; x.fillRect(0, hz - 4, LW, LH);
    for (let layer = 0; layer < 3; layer++) {                // 奥から手前へ木を重ねる
      const n = 14 + layer * 4, base = hz + layer * 14, h = 26 + layer * 14;
      const dark = ['#2a7438', '#1f6030', '#17502a'][layer], light = ['#3f9648', '#2f7e3c', '#256a34'][layer];
      for (let i = 0; i < n; i++) {
        const px = Math.floor(rnd() * LW);
        (rnd() < 0.5 ? pineTree : roundTree)(x, px, base + Math.floor(rnd() * 6), h + Math.floor(rnd() * 8), dark, light);
      }
      x.fillStyle = ['#3a8a3f', '#2f7a36', '#256a2e'][layer]; x.fillRect(0, base + 8, LW, 3);
    }
    x.fillStyle = '#1c5a2a'; x.fillRect(0, hz + 40, LW, LH);
    for (let i = 0; i < 160; i++) { x.fillStyle = rnd() < 0.5 ? '#2a7a38' : '#164c24'; x.fillRect(Math.floor(rnd() * LW), hz + 40 + Math.floor(rnd() * (LH - hz - 40)), 2, 1); }
    x.fillStyle = 'rgba(255,255,200,0.12)';                  // 木もれ日
    for (let i = 0; i < 6; i++) x.fillRect(20 + i * 35, 0, 6, hz + 30);
  }
  return c;
}

// ---- ストーリー ----
export async function runStory({ canvas, cfg, story, scene, dotoo }) {
  const pages = story?.pages ?? [];
  if (!pages.length) return;
  const ctx = canvas.getContext('2d');
  let view = fit(canvas, cfg);
  const onResize = () => { view = fit(canvas, cfg); };
  addEventListener('resize', onResize);

  // 背景: 暗い洞窟の色（星のような小さな光）
  const rnd = mulberry32(99);
  const sparks = Array.from({ length: 40 }, () => ({ x: rnd() * 630, y: rnd() * 360, p: rnd() * 6 }));
  const bg = scene ? paintStoryScene(scene) : null;
  let page = 0, shown = 0, fade = 1;                    // fade: 1=真っ暗 → 0
  let finished = false, endFade = 0, lastN = 0, lastPage = 0;
  const CPS = 28;                                       // 1秒に出る文字数
  const textOf = i => String(pages[i].text ?? pages[i]);
  const advance = () => {
    if (finished) return;
    if (shown < [...textOf(page)].length) { shown = Infinity; return; }
    if (page + 1 < pages.length) { page++; shown = 0; } else finished = true;
  };
  const onInput = e => {
    if (e.type === 'keydown' && (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'F3', 'F5', 'F11', 'F12'].includes(e.key))) return;
    if (e.target?.id === 'btn-fs') return;
    advance();
  };
  await new Promise(r => setTimeout(r, 200));
  addEventListener('pointerdown', onInput); addEventListener('keydown', onInput);

  let last = performance.now();
  await new Promise(resolve => {
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = now / 1000;
      const k = view.k;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#07080f'; ctx.fillRect(0, 0, 630, 360);
      if (bg) ctx.drawImage(bg, 0, 0, 630, 360);
      else for (const s of sparks) {
        const a = 0.25 + 0.25 * Math.sin(t * 1.5 + s.p);
        ctx.fillStyle = 'rgba(255,230,160,' + a + ')'; ctx.fillRect(Math.round(s.x), Math.round(s.y), 3, 3);
      }
      if (dotoo) ctx.drawImage(dotoo, Math.round(630 - dotoo.width * 2 - 6), 60, dotoo.width * 2, dotoo.height * 2);   // 字幕の後ろにキャラ絵（ゲーム中の字幕と同じ位置）
      shown = Math.min(shown === Infinity ? Infinity : shown + CPS * dt, [...textOf(page)].length + 1);
      const chars = [...textOf(page)];
      const n = shown === Infinity ? chars.length : Math.min(chars.length, Math.floor(shown));
      if (n > lastN && page === lastPage && /\S/.test(chars[n - 1] ?? '')) sfx.text();
      lastN = n; lastPage = page;
      // 文字ウィンドウ
      ctx.fillStyle = bg ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.72)'; ctx.fillRect(30, 220, 570, 110);
      ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 2; ctx.strokeRect(31, 221, 568, 108);
      ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
      // 折り返し（1文字ずつ幅を測る）
      let lineW = 0, line = 0;
      for (let i = 0; i < n; i++) {
        const ch = chars[i];
        if (ch === '\n') { line++; lineW = 0; continue; }
        const w = ctx.measureText(ch).width;
        if (lineW + w > 530) { line++; lineW = 0; }
        ctx.fillText(ch, 50 + lineW, 254 + line * 28);
        lineW += w;
      }
      // 「次へ ▶」
      if (n >= chars.length && Math.floor(t * 2) % 2 === 0) {
        ctx.textAlign = 'right'; ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 15px sans-serif';
        ctx.fillText('次へ ▶', 585, 318);
      }
      if (fade > 0) { fade = Math.max(0, fade - dt / 0.5); ctx.fillStyle = 'rgba(0,0,0,' + fade + ')'; ctx.fillRect(0, 0, 630, 360); }
      if (finished) {
        endFade += dt / 0.5;
        ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, endFade) + ')'; ctx.fillRect(0, 0, 630, 360);
        if (endFade >= 1) { resolve(); return; }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  removeEventListener('pointerdown', onInput); removeEventListener('keydown', onInput);
  removeEventListener('resize', onResize);
}

// URL にステージ指定が無いときのオープニング: タイトル → ストーリー（RTA を選んだときはストーリーなし）
// 戻り値: RTA を選んだ = { rta: ステージID } / 普通に始めた = undefined
export async function runIntro({ canvas, getJSON }) {
  const [cfg, logo, story, stages, dotooData] = await Promise.all([
    getJSON('data/config.json'), getJSON('data/title.json'), getJSON('data/story.json').catch(() => ({ pages: [] })),
    getJSON('data/stages.json').catch(() => ({})), getJSON('data/dotoo.json'),
  ]);
  const choice = await runTitle({ canvas, cfg, logo, rtaList: stages.rta ?? [] });
  if (choice) return choice;
  await runStory({ canvas, cfg, story, scene: 'forest', dotoo: rowsToCanvas(dotooData.rows, dotooData.palette) });
}
