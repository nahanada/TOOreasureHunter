import { rowsToCanvas } from './sprites.js';
import { Crate } from './entities.js';

const EPS = 1e-4;

// マップ（タイルの2次元配列）と当たり判定。データは data/stages/*.json と data/tiles.json。
export class World {
  constructor(map, tileset) {
    this.T = map.tileSize;
    this.legend = map.legend;
    this.spawn = { ...map.spawn };
    this.grid = map.grid.map(r => r.split(''));
    this.rows = this.grid.length;
    this.cols = this.grid[0].length;
    this.tileset = tileset.tiles;
    this.stage = map;                                   // 名前・テーマなど、タイル以外の情報（書き出しでそのまま使う）

    this.sprites = {};
    for (const [name, t] of Object.entries(tileset.tiles)) {
      this.sprites[name] = rowsToCanvas(t.rows, tileset.palette, tileset.pixelScale);
    }

    this.layer = document.createElement('canvas');
    this.lights = [];
    this.resizeLayer();
    this.render();

    // 押せる箱と、宝箱の中身（stage.chests: [{col,row,item}]）
    this.crateDefs = (map.crates ?? []).map(d => ({ col: d.col, row: d.row }));
    this.chests = {};
    for (const c of map.chests ?? []) this.chests[`${c.col},${c.row}`] = c.item;
    // ポスターなどの文章（stage.texts: [{col,row,text}]）。下ボタンで字幕として表示
    this.texts = {};
    for (const t of map.texts ?? []) this.texts[`${t.col},${t.row}`] = t.text;
    this.rebuildCrates();
  }

  get width() { return this.cols * this.T; }
  get height() { return this.rows * this.T; }

  rebuildCrates() { this.crates = this.crateDefs.map(d => new Crate(d, this.T)); }

  updateEntities(dt, player) {
    for (const c of this.crates) {
      c.update(dt, this, this.crates, player);
      if (c.y > this.height + 60) c.reset();      // 穴に落ちた箱は元の位置へ
    }
  }

  // 箱を最初の位置に戻す。x,y（やられた場所）を渡すと、その近く（左右24マス・上下8マス以内）の箱だけ戻す
  // → 遠くの箱で埋めた穴などは、やられても埋まったまま
  resetEntities() {
    for (const c of this.crates) c.reset();       // 最後の中間地点を通ったときの位置（なければ最初の位置）に戻る
  }

  // 中間地点を通ったとき: いまの箱の位置を「戻る場所」として保存。ステージを最初からやり直すときは破棄
  saveCrates() { for (const c of this.crates) c.setHome(c.x, c.y); }
  clearSavedCrates() { for (const c of this.crates) c.setHome(c.x0, c.y0); }

  // 針・落とし穴など「触れるとやられる」タイルに、キャラの当たり判定が触れているか
  hitsHazard(x, y, w, h) {
    const T = this.T;
    const px = x + 4, pw = w - 8, py = y + 10, ph = h - 10;      // 少し小さめの判定で、ぎりぎりは許す
    const c0 = Math.floor(px / T), c1 = Math.floor((px + pw) / T);
    const r0 = Math.floor(py / T), r1 = Math.floor((py + ph) / T);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const name = this.tileName(c, r);
        const t = name && this.tileset[name];
        if (!t || !t.hazard) continue;
        if (t.hazardShape === 'left' || t.hazardShape === 'right') {      // 横向きの鍾乳石: 左右方向の三角形（先端は left=左 / right=右）
          const x0 = Math.max(px, c * T), x1 = Math.min(px + pw, (c + 1) * T);
          const y0 = Math.max(py, r * T), y1 = Math.min(py + ph, (r + 1) * T);
          if (x0 >= x1 || y0 >= y1) continue;
          const xx = t.hazardShape === 'right' ? x0 : x1;                       // 根元側の端
          const f = t.hazardShape === 'right' ? 1 - (xx - c * T) / T : (xx - c * T) / T;   // 0=先端 1=根元
          const hh = (T / 2) * 0.85 * f, cy = (r + 0.5) * T;
          const dy = cy >= y0 && cy <= y1 ? 0 : Math.min(Math.abs(y0 - cy), Math.abs(y1 - cy));
          if (dy <= hh) return true;
          continue;
        }
        if (t.hazardShape) {                       // 鍾乳石・石筍: 三角形の尖った当たり判定（先端ほど細い）
          const x0 = Math.max(px, c * T), x1 = Math.min(px + pw, (c + 1) * T);
          const y0 = Math.max(py, r * T), y1 = Math.min(py + ph, (r + 1) * T);
          if (x0 >= x1 || y0 >= y1) continue;
          const yy = t.hazardShape === 'up' ? y1 : y0;                         // 三角形がいちばん太い側の端
          const f = t.hazardShape === 'up' ? (yy - r * T) / T : 1 - (yy - r * T) / T;   // 0=先端 1=根元
          const hw = (T / 2) * 0.85 * f, cx = (c + 0.5) * T;
          const dx = cx >= x0 && cx <= x1 ? 0 : Math.min(Math.abs(x0 - cx), Math.abs(x1 - cx));
          if (dx <= hw) return true;
          continue;
        }
        const top = r * T + (t.hazardTop ?? 0);
        if (px < (c + 1) * T && px + pw > c * T && py < (r + 1) * T && py + ph > top) return true;
      }
    }
    return false;
  }

  // 「落ちたら次のステージへ進む穴」(tiles.json の fall: true) に体が入ったか
  hitsFall(x, y, w, h) { return this.hitsFlag(x, y, w, h, 'fall') || this.hitsFlag(x, y, w, h, 'warp'); }   // fall=落とし穴 / warp=駅の入口など（触れたら次のステージへ）
  hitsFlag(x, y, w, h, flag) {
    const T = this.T;
    const c0 = Math.floor((x + 4) / T), c1 = Math.floor((x + w - 4) / T);
    const r0 = Math.floor((y + 10) / T), r1 = Math.floor((y + h) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const n = this.tileName(c, r);
      const t = n && this.tileset[n];
      if (t && t[flag]) return true;
    }
    return false;
  }
  // 文章を設定できるマスか（ポスター・宝箱・通過で字幕が出る透明マス）
  holdsText(name) { return !!(this.tileset[name]?.interact?.text || this.tileset[name]?.passText || name === 'chest' || name === 'chest_open'); }
  // 体が通過している「通過で字幕」マス（文章がある場合だけ）。{key, text} を返す
  passTarget(x, y, w, h) {
    const T = this.T;
    const c0 = Math.floor((x + 4) / T), c1 = Math.floor((x + w - 4) / T);
    const r0 = Math.floor((y + 10) / T), r1 = Math.floor((y + h) / T);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const n = this.tileName(c, r);
      const key = `${c},${r}`;
      if (n && this.tileset[n]?.passText && this.texts[key]) return { key, text: this.texts[key] };
    }
    return null;
  }

  tileName(c, r) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
    return this.legend[this.grid[r][c]] ?? null;
  }

  isSolid(c, r) {
    const n = this.tileName(c, r);
    return n ? !!this.tileset[n].solid : false;
  }

  // ---- 梯子 ----
  isLadder(c, r) {
    const n = this.tileName(c, r);
    return n ? !!this.tileset[n].climb : false;
  }

  // (c,r) を含む、縦につながった梯子の範囲 {top, bottom}（行番号）
  ladderRun(c, r) {
    let top = r, bottom = r;
    while (this.isLadder(c, top - 1)) top--;
    while (this.isLadder(c, bottom + 1)) bottom++;
    return { top, bottom };
  }

  // ---- 中間地点 ----
  charFor(tileName) { return Object.keys(this.legend).find(k => this.legend[k] === tileName); }

  activateCheckpoint(c, r) {
    const on = this.charFor('checkpoint_on');
    if (on) this.setTile(c, r, on);
  }

  resetCheckpoints() {
    const off = this.charFor('checkpoint'), on = this.charFor('checkpoint_on');
    if (!off || !on) return;
    let changed = false;
    for (const row of this.grid) for (let c = 0; c < row.length; c++) if (row[c] === on) { row[c] = off; changed = true; }
    if (changed) this.render();
  }

  // 矩形がソリッドなタイルと重なっているか
  overlaps(x, y, w, h) {
    const T = this.T;
    const c0 = Math.floor(x / T), c1 = Math.floor((x + w - EPS) / T);
    const r0 = Math.floor(y / T), r1 = Math.floor((y + h - EPS) / T);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.isSolid(c, r)) return true;
      }
    }
    return false;
  }

  // 矩形(を margin だけ広げた範囲)に触れている「実行できるイベント」を持つタイルのうち、一番近いものを返す
  findInteractable(x, y, w, h, margin = 8) {
    const T = this.T;
    const c0 = Math.floor((x - margin) / T), c1 = Math.floor((x + w + margin) / T);
    const r0 = Math.floor((y - margin) / T), r1 = Math.floor((y + h + margin) / T);
    const cx = x + w / 2;
    let best = null;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const name = this.tileName(c, r);
        if (!name || !this.tileset[name].interact) continue;
        const d = Math.abs((c + 0.5) * T - cx);
        if (!best || d < best.dist) best = { c, r, name, def: this.tileset[name].interact, dist: d };
      }
    }
    return best;
  }

  // イベントを実行する（tiles.json の interact: becomes=別のタイルに変える, message=表示する文, goal=ステージクリア）
  // 宝箱は stage.chests に中身(item)があれば「○○をゲット！」と表示し、item を返す
  interact(target) {
    const { c, r, def, name } = target;
    let message = def.message ?? '';
    let item = null;
    if (name === 'chest') {
      // 中身は名前(文字列)、または {name, jump, message}（jump=ジャンプ力の増加量）
      // data/items.json の一覧（名前→jump/message）と合わせて {name, jump, message} にそろえる
      const raw = this.chests[`${c},${r}`];
      if (raw) {
        const o = typeof raw === 'string' ? { name: raw } : raw;
        item = { ...(this.itemCatalog?.[o.name] ?? {}), ...o };
        message = `${item.name}をゲット！` + (item.message ? ' ' + item.message : '');
      } else message = '宝箱は空っぽだった…';
    }
    const own = this.texts[`${c},${r}`];
    if (def.text) message = own ?? '';
    else if (own && name === 'chest') message = (message ? message + ' ' : '') + own;     // 宝箱: 中身の表示のあとに文章を続ける
    if (def.becomes) {
      const ch = this.charFor(def.becomes);
      if (ch) this.setTile(c, r, ch);
    }
    return { message, goal: !!def.goal, item, subtitle: !!def.text || !!(own && name === 'chest') };
  }

  setTile(c, r, ch) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;
    if (!(ch in this.legend) || this.grid[r][c] === ch) return;
    this.grid[r][c] = ch;
    this.render();
  }

  // マップの大きさを変える。anchor 'bl' = 左下を基準（足りない分は上に増える・上が削れる）/ 'tl' = 左上を基準
  resize(newCols, newRows, anchor = 'bl') {
    const dy = anchor === 'bl' ? newRows - this.rows : 0;
    const blank = this.charFor(null) ?? '.';
    const grid = Array.from({ length: newRows }, () => Array(newCols).fill(blank));
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const nr = r + dy;
        if (nr >= 0 && nr < newRows && c < newCols) grid[nr][c] = this.grid[r][c];
      }
    }
    this.grid = grid;
    this.cols = newCols; this.rows = newRows;
    this.spawn = { x: this.spawn.x, y: this.spawn.y + dy * this.T };
    this.crateDefs = this.crateDefs.map(d => ({ col: d.col, row: d.row + dy }))
      .filter(d => d.row >= 0 && d.row < newRows && d.col < newCols);
    const chests = {};
    for (const [k, v] of Object.entries(this.chests)) {
      const [c, r] = k.split(',').map(Number);
      if (r + dy >= 0 && r + dy < newRows && c < newCols) chests[`${c},${r + dy}`] = v;
    }
    this.chests = chests;
    const texts = {};
    for (const [k, v] of Object.entries(this.texts)) {
      const [c, r] = k.split(',').map(Number);
      if (r + dy >= 0 && r + dy < newRows && c < newCols) texts[`${c},${r + dy}`] = v;
    }
    this.texts = texts;
    this.resizeLayer();
    this.render();
    this.rebuildCrates();
  }

  resizeLayer() {
    this.layer.width = this.width;
    this.layer.height = this.height;
  }

  render() {
    const x = this.layer.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.clearRect(0, 0, this.layer.width, this.layer.height);
    this.lights = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const n = this.tileName(c, r);
        if (!n) continue;
        x.drawImage(this.sprites[n], c * this.T, r * this.T, this.T, this.T);
        const glow = this.tileset[n].glow;
        if (glow) this.lights.push({ x: (c + 0.5) * this.T, y: (r + 0.5) * this.T, ...glow });
      }
    }
  }

  // data/stages/*.json と同じ形式で書き出す
  toJSON() {
    const { movers, ...rest } = this.stage;            // 古い形式の movers は書き出さない
    return {
      ...rest,
      tileSize: this.T,
      legend: this.legend,
      spawn: this.spawn,
      crates: this.crateDefs,
      chests: Object.entries(this.chests).map(([k, item]) => {      // 宝箱が無くなったマスの中身は書き出さない
        const [col, row] = k.split(',').map(Number);
        return { col, row, item };
      }).filter(({ col, row }) => ['chest', 'chest_open'].includes(this.tileName(col, row))),
      texts: Object.entries(this.texts).map(([k, text]) => {
        const [col, row] = k.split(',').map(Number);
        return { col, row, text };
      }).filter(({ col, row, text }) => text && this.holdsText(this.tileName(col, row))),
      grid: this.grid.map(r => r.join('')),
    };
  }
}
