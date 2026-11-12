// マップのタイルとは別に動くもの: 押して動かせる箱（Crate）。ステージJSONの "crates" で配置する。

export const CRATE_W = 28;

// 押して動かせる箱（1マス）。重力で落ち、タイルや他の箱とぶつかる。
export class Crate {
  constructor(def, T) {
    this.T = T;
    this.w = CRATE_W; this.h = T;                 // 当たり判定は幅28px（マスの中央）。1マスの穴に落とせる
    this.pad = (T - CRATE_W) / 2;
    this.x0 = def.col * T + this.pad; this.y0 = def.row * T;
    this.hx = this.x0; this.hy = this.y0;         // 戻る場所（最初は配置位置。中間地点を通ると、そのときの位置）
    this.reset();
  }

  setHome(x, y) { this.hx = x; this.hy = y; }
  reset() { this.x = this.hx; this.y = this.hy; this.vy = 0; }

  // 他の箱 others とタイルに当たらずに動かせる分だけ横に動かす。実際に動いた量を返す
  tryMoveX(dx, world, others) {
    const step = Math.sign(dx);
    let moved = 0;
    const total = Math.abs(dx);
    // 1pxずつ試す（めり込みを避ける）
    while (moved < total) {
      const stepLen = Math.min(1, total - moved);
      const nx = this.x + step * stepLen;
      if (nx < 0 || nx + this.w > world.width) break;
      if (world.overlaps(nx, this.y, this.w, this.h)) break;
      // 箱どうしは上下1pxの誤差を許す（はめ込んだ箱の上面を、別の箱が引っかからず滑れるように）
      if (others.some(o => o !== this && overlapRect(nx, this.y + 1, this.w, this.h - 2, o))) break;
      this.x = nx; moved += stepLen;
    }
    return moved * step;
  }

  update(dt, world, others) {
    this.vy = Math.min(this.vy + 1200 * dt, 600);
    let ny = this.y + this.vy * dt;
    const blockers = others.filter(o => o !== this);
    if (world.overlaps(this.x, ny, this.w, this.h) || blockers.some(o => overlapRect(this.x, ny, this.w, this.h, o))) {
      if (this.vy > 0) {
        // 下から探して接地位置にそろえる
        let y = this.y;
        while (y < ny && !world.overlaps(this.x, y + 1, this.w, this.h) &&
               !blockers.some(o => overlapRect(this.x, y + 1, this.w, this.h, o))) y += 1;
        // 端数のまま止まると、上を滑る別の箱に引っかかるので整数のpxにそろえる
        const snapped = Math.ceil(y - 1e-6);
        ny = (world.overlaps(this.x, snapped, this.w, this.h) ||
              blockers.some(o => overlapRect(this.x, snapped, this.w, this.h, o))) ? Math.floor(y) : snapped;
        if (this.vy > 150) this.snapToCell(world, blockers, ny);     // 落下して着地したときだけ（地面に置いてあるだけの箱は押せなくなる）
      } else {
        ny = this.y;
      }
      this.vy = 0;
    }
    this.y = ny;
  }

  // 着地したとき、マスの中央からほんの少し（2px以内）ずれていたら中央にそろえる。
  // 幅28pxの箱が30pxの穴にはまったとき、左右どちらかに1pxずれて見えるのを防ぐ
  snapToCell(world, blockers, y) {
    const T = this.T;
    const col = Math.round((this.x - this.pad) / T);
    const cx = col * T + this.pad;
    if (cx === this.x || Math.abs(cx - this.x) > 2) return;
    if (world.overlaps(cx, y, this.w, this.h) || blockers.some(o => overlapRect(cx, y + 1, this.w, this.h - 2, o))) return;
    this.x = cx;
  }

  draw(ctx, sprite) { ctx.drawImage(sprite, Math.round(this.x - this.pad), Math.round(this.y), this.T, this.h); }
}

export function overlapRect(x, y, w, h, o) {
  return x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y;
}
