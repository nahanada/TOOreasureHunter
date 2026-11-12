import { rowsToCanvas } from './sprites.js';
import { sfx } from './bgm.js';

// キャラクターのスプライト（data/character.json）を canvas に変換
export function buildCharacterSprites(data) {
  const sprites = {};
  for (const [name, rows] of Object.entries(data.frames)) {
    sprites[name] = rowsToCanvas(rows, data.palette, 1);
  }
  return sprites;
}

export class Player {
  // cfg は data/config.json の内容（デバッグパネルから書き換えられる）
  constructor(cfg, world, sprites) {
    this.cfg = cfg;
    this.world = world;
    this.sprites = sprites;
    this.spawnPoint = null;          // 最後に通った中間地点（なければステージのスポーン地点）
    this.respawn();
  }

  // やられたとき・やり直しのとき: 最後の中間地点（なければ最初のスポーン地点）へ
  respawn() {
    const spawn = this.spawnPoint ?? this.world.spawn;
    this.x = spawn.x - this.cfg.hitboxW / 2;   // spawn は足元の中心座標
    this.y = spawn.y - this.cfg.hitboxH;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.facing = 1;
    this.walking = false;
    this.walkTime = 0;
    this.jumping = false;
    this.climbing = false;
    this.climbDist = 0;
    this.lastJump = null;   // 直近ジャンプの実測値 {height, time}
    this.world.resetEntities?.();                 // 箱は最後の中間地点を通ったときの位置に戻す
    this.onDeath?.();
  }

  // 中間地点をリセットして最初から
  restartStage() {
    this.spawnPoint = null;
    this.world.resetCheckpoints?.();
    this.world.clearSavedCrates?.();               // 最初からやり直すときは全部の箱を最初の位置へ
    this.respawn();
  }

  get gravity() { return 8 * this.cfg.jumpHeight / (this.cfg.jumpTime ** 2); }
  get jumpSpeed() { return 4 * this.cfg.jumpHeight / this.cfg.jumpTime; }

  // ---- 梯子 ----
  // 当たり判定の中心の列にある梯子のうち、体に重なっているもの（なければ null）
  ladderHere() {
    const { world, cfg } = this;
    const T = world.T;
    const col = Math.floor((this.x + cfg.hitboxW / 2) / T);
    const r0 = Math.floor((this.y + 8) / T), r1 = Math.floor((this.y + cfg.hitboxH - 1) / T);
    for (let r = r0; r <= r1; r++) if (world.isLadder(col, r)) return { col, row: r };
    return null;
  }

  // 梯子の上に立っているとき、その梯子（↓で降りられる）
  ladderBelow() {
    const { world, cfg } = this;
    const T = world.T;
    const col = Math.floor((this.x + cfg.hitboxW / 2) / T);
    const feet = this.y + cfg.hitboxH;
    const r = Math.round(feet / T);
    if (Math.abs(feet - r * T) < 2 && world.isLadder(col, r) && !world.isLadder(col, r - 1)) return { col, row: r };
    return null;
  }

  grabLadder(l) {
    const T = this.world.T;
    this.climbing = true;
    this.x = (l.col + 0.5) * T - this.cfg.hitboxW / 2;   // 梯子の真ん中にそろえる
    this.vx = 0; this.vy = 0;
    this.onGround = false; this.jumping = false;
  }

  updateClimb(dt, input) {
    const { world, cfg } = this;
    const T = world.T, w = cfg.hitboxW, h = cfg.hitboxH;
    const col = Math.floor((this.x + w / 2) / T);
    const mid = Math.floor((this.y + h / 2) / T), low = Math.floor((this.y + h - 2) / T), under = Math.floor((this.y + h + 1) / T);
    const head = Math.floor((this.y + 8) / T);               // 頭だけ梯子に届いている（宙に浮いた梯子）場合も掴んだままにする
    const row = [mid, low, under, head].find(r => world.isLadder(col, r)) ?? null;
    if (row === null) { this.climbing = false; return; }     // 梯子から外れた
    const run = world.ladderRun(col, row);
    const top = run.top * T, bottom = (run.bottom + 1) * T;
    // ↑で登る / ↓で降りる / 何も押さないとゆっくり滑り落ちる
    const vy = input.up ? -cfg.climbSpeed : input.down ? cfg.descendSpeed : cfg.slideSpeed;
    const dir = Math.sign(vy);
    if (input.dir !== 0) this.facing = input.dir;            // 向きは最後に押した左右のまま
    // 左右キーで梯子の横へ。体の中心が梯子の列から外れたら手を離して落ちる
    if (input.dir !== 0) {
      const nx = this.x + input.dir * cfg.climbSideSpeed * dt;
      if (!world.overlaps(nx, this.y, w, h)) this.x = nx;
      if (Math.abs(this.x + w / 2 - (col + 0.5) * T) >= T / 2) {
        this.climbing = false; this.vx = input.dir * 60; this.vy = 0; this.grabCooldown = 0.3;
        return;
      }
    }
    let feet = this.y + h + vy * dt;
    if (dir < 0 && world.overlaps(this.x, feet - h, w, h)) feet = this.y + h;      // 天井にぶつかる
    // 宙に浮いた梯子は、何も押していないと下端で止まってぶら下がる（↓を押すと降りる）
    if (!input.up && !input.down && !world.isSolid(col, run.bottom + 1)) {
      feet = Math.min(feet, Math.max(bottom - 10 - 8 + h, this.y + h));
    }
    if (feet <= top) {                                       // 上まで登った → 床の上に立つ
      feet = top; this.climbing = false; this.onGround = true;
    } else if (world.isSolid(col, run.bottom + 1) ? feet >= bottom : feet - h + 8 >= bottom) {
      // 下まで降りた（床に着いた / 宙に浮いた梯子なら体が梯子から完全に外れた）
      if (feet >= bottom && world.isSolid(col, run.bottom + 1)) feet = bottom;
      this.climbing = false; this.grabCooldown = 0.3;
    }
    this.climbDist += Math.abs(feet - (this.y + h));
    this.y = feet - h;
    if (this.climbing) { this.vx = 0; this.vy = 0; }
  }

  // ---- 中間地点 ----
  checkCheckpoint() {
    const { world, cfg } = this;
    const T = world.T;
    const c = Math.floor((this.x + cfg.hitboxW / 2) / T), r = Math.floor((this.y + cfg.hitboxH - 4) / T);
    const name = world.tileName(c, r);
    // 光る（記録される）のは最初に通ったときだけ。光っている旗をまた通っても何も上書きしない
    if (name && world.tileset[name].checkpoint === 'off') {
      this.spawnPoint = { x: (c + 0.5) * T, y: (r + 1) * T };
      world.activateCheckpoint(c, r);
      world.saveCrates();                       // この時点の箱の位置を保存（やられてもここまでの箱の状態に戻る）
      this.onCheckpoint?.();
    }
  }

  update(dt, input) {
    const cfg = this.cfg;
    this.checkCheckpoint();

    // 梯子: ↑で掴む（体が梯子に重なっているとき）、梯子の上に立っているときは↓で降りる
    let grabbed = false;
    this.grabCooldown = Math.max(0, (this.grabCooldown ?? 0) - dt);
    if (!this.climbing && this.grabCooldown === 0) {
      // 空中ではジャンプ長押しでも掴める（宙に浮いた梯子にジャンプで飛びつく）
      const wantGrab = input.up || (!this.onGround && input.jumpHeld);
      const here = wantGrab ? this.ladderHere() : null;
      const below = (!here && input.down) ? this.ladderBelow() : null;
      if (here || below) { this.grabLadder(here ?? below); grabbed = true; }
    }
    if (this.climbing) {
      if (input.jump && !grabbed) {
        // ジャンプキー(スペース)で梯子から飛び降りる
        this.climbing = false; this.onGround = true; this.grabCooldown = 0.3;
      } else {
        this.updateClimb(dt, input);
        this.checkDeath();
        return;
      }
    }

    const target = input.dir * cfg.moveSpeed;
    if (this.onGround) {
      this.airHold = 0; this.airDir = 0;
      // 地上: 静止からは accelTime 秒かけて最大速度まで加速。キーを離すと即停止。
      if (input.dir === 0) {
        this.vx = 0;
      } else {
        // 進行方向と逆のキーを押したら、滑らずに速度をリセットしてから逆方向へ加速
        if (this.vx * input.dir < 0) this.vx = 0;
        const step = cfg.moveSpeed / cfg.accelTime * dt;
        this.vx += Math.max(-step, Math.min(step, target - this.vx));
      }
      this.walking = input.dir !== 0;
      if (this.walking) {
        this.facing = input.dir;
        this.walkTime += dt * 1000;
      } else {
        this.walkTime = 0;
      }
    } else if (input.dir === 0) {
      this.airHold = 0; this.airDir = 0;
    } else if (input.dir !== 0) {
      // 空中: 慣性（現在の速度）に、入力方向への加速を足す。最大速度は moveSpeed のまま。
      // 同じ方向のキーを空中で押し続けるほど加速が増え、airAccelRamp 秒で airAccel + airAccelBonus（最大）になる
      this.airHold = (this.airDir === input.dir) ? this.airHold + dt : 0;
      this.airDir = input.dir;
      const accel = cfg.airAccel + cfg.airAccelBonus * Math.min(1, this.airHold / cfg.airAccelRamp);
      this.vx += input.dir * accel * dt;
      this.vx = Math.max(-cfg.moveSpeed, Math.min(cfg.moveSpeed, this.vx));
    }

    if (input.jump && this.onGround) {
      this.vy = -this.jumpSpeed;
      sfx.jump();
      this.onGround = false;
      this.jumping = true;
      this.jumpStartFeet = this.y + cfg.hitboxH;
      this.jumpPeakFeet = this.jumpStartFeet;
      this.jumpTime = 0;
    }

    // 可変ジャンプ: 上昇中にボタンを離すと重力が jumpCut 倍になり、ジャンプが低く終わる
    // （一瞬のタップ=小ジャンプ、押し続ける=フルジャンプ）
    const cut = (this.jumping && this.vy < 0 && !input.jumpHeld) ? cfg.jumpCut : 1;
    const vyOld = this.vy;
    this.vy = Math.min(this.vy + this.gravity * cut * dt, cfg.maxFallSpeed);
    const dy = (vyOld + this.vy) / 2 * dt;

    this.inputDown = !!input.down;
    this.moveX(this.vx * dt, dt);
    this.moveY(dy);

    if (this.jumping) {
      this.jumpTime += dt;
      this.jumpPeakFeet = Math.min(this.jumpPeakFeet, this.y + cfg.hitboxH);
      if (this.onGround) {
        this.jumping = false;
        this.lastJump = { height: this.jumpStartFeet - this.jumpPeakFeet, time: this.jumpTime };
      }
    }

    this.checkDeath();
  }

  // 落とし穴・針に触れた / 画面の下に落ちた → 中間地点（またはスポーン地点）へ戻る
  checkDeath() {
    const { world, cfg } = this;
    if (this.fell) return;                                           // 穴に落ちて次のステージへ向かっている最中
    if (world.hitsFall(this.x, this.y, cfg.hitboxW, cfg.hitboxH)) { this.fell = true; this.onFall?.(); return; }
    if (world.hitsHazard(this.x, this.y, cfg.hitboxW, cfg.hitboxH)) { this.onHazard?.(); this.respawn(); }
    else if (this.y > world.height + 60) this.respawn();
  }

  moveX(dx, dt = 0) {
    const { world, cfg } = this;
    const T = world.T, w = cfg.hitboxW, h = cfg.hitboxH;
    const nx = Math.max(0, Math.min(world.width - w, this.x + dx));
    let hit = nx !== this.x + dx;               // 画面端
    this.x = nx;
    if (world.overlaps(this.x, this.y, w, h)) {
      this.x = dx > 0 ? Math.floor((this.x + w) / T) * T - w
                      : (Math.floor(this.x / T) + 1) * T;
      hit = true;
    }
    // 箱: 押して動かす。押している間は cfg.pushSpeed (px/秒) までしか進めない
    for (const c of world.crates) {
      // 箱の上に立っているだけ（足元が上面すれすれ）のときは押さない。体が4px以上めり込んだときだけ「横から押している」
      // 頭が箱の底すれすれ（4px以内）のときも横からは押さない（ジャンプで箱の脇を通るとき、瞬間移動しないように）
      if (!(this.x < c.x + c.w && this.x + w > c.x && this.y < c.y + c.h - 4 && this.y + h > c.y + 4)) continue;
      // dx=0（立ち止まっているとき・ジャンプで箱が重なったとき）は、近い側へ押し出すだけで箱は動かさない
      const dir = dx !== 0 ? Math.sign(dx) : ((this.x + w / 2) < (c.x + c.w / 2) ? 1 : -1);
      const overlap = dir > 0 ? (this.x + w) - c.x : (c.x + c.w) - this.x;
      const maxPush = (dt > 0 && dx !== 0) ? cfg.pushSpeed * dt : 0;
      const moved = Math.abs(c.tryMoveX(dir * Math.min(overlap, maxPush), world, world.crates));
      this.x = dir > 0 ? c.x - w : c.x + c.w;
      if (dx !== 0 && (moved === 0 || overlap > maxPush)) hit = true;
    }
    if (hit) this.vx = 0;                       // 壁にぶつかったら慣性も止める
  }

  moveY(dy) {
    const { world, cfg } = this;
    const T = world.T, w = cfg.hitboxW, h = cfg.hitboxH;
    this.onGround = false;
    const prevFeet = this.y + h, prevTop = this.y;
    this.y += dy;
    if (world.overlaps(this.x, this.y, w, h)) {
      if (dy > 0) {
        this.y = Math.floor((this.y + h) / T) * T - h;
        this.onGround = true;
      } else {
        this.y = (Math.floor(this.y / T) + 1) * T;
      }
      this.vy = 0;
    }
    // 梯子の一番上は「上から乗れる床」（下からは通り抜けられる。↓を押すと降りられる）
    if (!this.onGround && dy >= 0 && !this.inputDown) {
      const feet = this.y + h;
      const c0 = Math.floor((this.x + 2) / T), c1 = Math.floor((this.x + w - 2) / T);
      const r = Math.floor(feet / T);
      for (let c = c0; c <= c1; c++) {
        if (world.isLadder(c, r) && !world.isLadder(c, r - 1) && prevFeet <= r * T + 1 && feet >= r * T) {
          this.y = r * T - h; this.onGround = true; this.vy = 0;
          break;
        }
      }
    }
    // 箱の上に乗る / 箱に頭をぶつける
    for (const c of world.crates) {
      if (!(this.x < c.x + c.w && this.x + w > c.x && this.y < c.y + c.h && this.y + h > c.y)) continue;
      if (dy >= 0 && prevFeet <= c.y + 4) { this.y = c.y - h; this.onGround = true; this.vy = 0; }
      else if (dy < 0 && prevTop >= c.y + c.h - 4) { this.y = c.y + c.h; this.vy = 0; }   // 下から頭をぶつけたときだけ
    }
  }

  draw(ctx) {
    const { cfg, sprites } = this;
    const sw = sprites.stand.width, sh = sprites.stand.height;
    const px = Math.round(this.x + cfg.hitboxW / 2 - sw / 2);
    const py = Math.round(this.y + cfg.hitboxH - sh);

    ctx.save();
    // 梯子の登り降りは、手足を広げた絵を左右反転しながら交互に出す
    const flip = this.facing < 0;
    if (flip) {
      ctx.translate(px + sw, py);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(px, py);
    }

    if (this.climbing || !this.onGround) {
      ctx.drawImage(sprites.walk, 0, 0);            // 空中・梯子は手広げポーズ
    } else if (!this.walking) {
      ctx.drawImage(sprites.stand, 0, 0);
    } else {
      // 脚無し胴体 + 両脚を常時表示。左右の脚を内側(大)/外側(小)に交互にずらす（蟹歩き風）
      const inward = Math.floor(this.walkTime / cfg.stepMs) % 2 === 0;
      const offR = inward ? -cfg.legInward : cfg.legOutward;   // 右脚は画像の右側 → 内側は -x
      const offL = inward ? cfg.legInward : -cfg.legOutward;   // 左脚は内側が +x
      ctx.drawImage(sprites.walkBody, 0, 0);
      ctx.drawImage(sprites.legR, offR, 0);
      ctx.drawImage(sprites.legL, offL, 0);
    }
    ctx.restore();
  }
}
