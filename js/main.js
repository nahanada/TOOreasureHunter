import { createBackground } from './background.js';
import { World } from './world.js';
import { Player, buildCharacterSprites } from './player.js';
import { initMobile } from './mobile.js';
import { runIntro, runStory, runHelp } from './title.js';
import { addRecord, keepRecords } from './records.js';
import { rowsToCanvas } from './sprites.js';
import { bgm, sfx } from './bgm.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const BG_PARALLAX = 0.5;     // 草原の遠景は手前の半分の速さでスクロール

const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => {
  if (!r.ok) throw new Error(`${url} を読み込めませんでした (${r.status})`);
  return r.json();
});

async function start() {
  // ステージ: URL の ?stage=名前 で選ぶ（省略時は data/stages.json の first）
  const params = new URLSearchParams(location.search);
  // ステージ指定なし = ゲームの最初から。タイトル画面 → ストーリー → 最初のステージ
  // RTA: タイトル左下の「RTA」から選んだステージだけを遊び、ゴールまでのタイムを出す（URL の ?stage=stage1&rta=1 でも可）
  const touch = initMobile();                  // 全画面ボタンとタッチ操作は、タイトル・ストーリーでも使えるように最初に準備
  let stageId = params.get('stage');
  let rta = !!stageId && params.has('rta');
  let gamePaused = false;                      // 止めている間（エディタ・「タイトルへ戻る」の確認）
  let showHelp = false;                        // ストーリーを見た後は、ゲーム画面の上に操作説明を出す
  if (!stageId) {
    bgm.play('forest');                       // タイトル・ストーリー・森のあいだは forest_bgm
    stageId = (await getJSON('data/stages.json')).first;
    const choice = await runIntro({ canvas, getJSON });
    showHelp = !choice;
    if (choice?.rta) {
      stageId = choice.rta; rta = true;
      history.replaceState(null, '', `?stage=${encodeURIComponent(stageId)}&rta=1`);    // 読み直すと同じ RTA をやり直せる
    }
  }
  const [cfgData, stage, tileData, charData, itemCatalog, stageList, dotooData, story] = await Promise.all([
    getJSON('data/config.json'),
    getJSON(`data/stages/${stageId}.json`),
    getJSON('data/tiles.json'),
    getJSON('data/character.json'),
    getJSON('data/items.json'),
    getJSON('data/stages.json'),
    getJSON('data/dotoo.json'),
    getJSON('data/story.json').catch(() => ({})),
  ]);

  bgm.play(stage.theme === 'cave' ? 'cave' : 'forest');      // 洞窟のステージは cave_bgm、それ以外は forest_bgm（ページを読み直しても続きから）
  const cfg = Object.assign(cfgData, stage.player ?? {});   // ステージごとの設定（ジャンプの高さなど）で上書き
  const dotoo = rowsToCanvas(dotooData.rows, dotooData.palette);      // 字幕の裏に出すキャラ絵（data/dotoo.json）
  const world = new World(stage, tileData);
  world.itemCatalog = itemCatalog;
  const theme = stage.theme ?? 'field';
  const player = new Player(cfg, world, buildCharacterSprites(charData));

  // ---- 背景 ----
  // field(夕暮れの遺跡) / forest(昼の森) / city(都会): 空(画面固定) + 遠景(横ループ・視差) / cave: 洞窟の壁(縦横ループ・視差)
  let far, sky = null, skyWidth = 0, groundY = 0;
  if (theme === 'cave') {
    far = createBackground(660, 480, 0, 'far', 'cave');
  } else {
    // 地平線の位置: 全てソリッドで埋まった最初の行
    // （stage.horizonRow で行を直接指定もできる。穴や洞窟の入り口があって地面が一直線でない森のステージなど）
    let groundRow = world.rows;
    if (Number.isFinite(stage.horizonRow)) groundRow = stage.horizonRow;
    else for (let r = 0; r < world.rows; r++) {
      if (Array.from({ length: world.cols }, (_, c) => world.isSolid(c, r)).every(Boolean)) { groundRow = r; break; }
    }
    groundY = Math.min(groundRow * world.T, world.height);
    // 遠景（山・遺跡・木）: 1画面ぶんを描き、左右反転コピーを並べて「継ぎ目なくループする」画像にする（透過）
    const farTile = createBackground(1080, world.height, groundY, 'far', theme);
    far = document.createElement('canvas');
    far.width = farTile.width * 2;
    far.height = farTile.height;
    const b = far.getContext('2d');
    b.drawImage(farTile, 0, 0);
    b.save(); b.translate(far.width, 0); b.scale(-1, 1); b.drawImage(farTile, 0, 0); b.restore();
  }

  // ---- 画面サイズ ----
  // 見える範囲は端末によらず固定（config.json の viewCols x viewRows マス。初期値は 21x12 = 630x360 論理px）。
  // ゲームの絵は論理ピクセルで描き、画面に収まる倍率 k に拡大する（pixelPerfect なら整数倍のみ）。
  // 画面の縦横比が合わない分は黒い帯（レターボックス）になり、見える範囲は変わらない。
  const camera = { x: 0, y: 0, scale: 1 };
  const view = { w: cfg.viewCols * world.T, h: cfg.viewRows * world.T, k: 1 };
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const devW = Math.floor(innerWidth * dpr);
    const devH = Math.floor(innerHeight * dpr);
    const kFit = Math.min(devW / view.w, devH / view.h);
    const k = (kFit >= 1 && cfg.pixelPerfect) ? Math.floor(kFit) : kFit;
    view.k = camera.scale = k;
    canvas.width = Math.round(view.w * k);
    canvas.height = Math.round(view.h * k);
    canvas.style.width = canvas.width / dpr + 'px';     // 物理ピクセルと1:1
    canvas.style.height = canvas.height / dpr + 'px';
  }
  resize();
  addEventListener('resize', resize);
  new MutationObserver(resize).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ---- 入力 ----
  const keys = new Set();
  addEventListener('keydown', e => {
    if ((e.key === 'r' || e.key === 'R') && !e.repeat) retry();      // やり直し
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  });
  addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => keys.clear());

  // ジャンプ・アクションは「押した瞬間」だけ有効（長押しで連続しない）
  let jumpHeldPrev = false, actionHeldPrev = false;
  const readInput = () => {
    const upHeld = keys.has('ArrowUp') || keys.has('w') || touch.jump;      // 梯子を登る（ジャンプボタンも兼ねる）
    const jumpHeld = keys.has(' ') || upHeld;
    const jump = jumpHeld && !jumpHeldPrev;
    jumpHeldPrev = jumpHeld;
    const right = keys.has('ArrowRight') || keys.has('d') || touch.right;
    const left = keys.has('ArrowLeft') || keys.has('a') || touch.left;
    const actionHeld = keys.has('e') || keys.has('z') || keys.has('s') || keys.has('ArrowDown') || keys.has('Enter') || touch.action;
    const action = actionHeld && !actionHeldPrev;
    actionHeldPrev = actionHeld;
    // ↓は梯子を降りるキー。S / ↓ はアクションキーでもあるので、梯子の上に立っているときだけ効く
    const down = keys.has('ArrowDown') || keys.has('s') || touch.down || touch.action;     // 丸ボタンも↓キーと同じ（アクション + 梯子を降りる）
    return { dir: (right ? 1 : 0) - (left ? 1 : 0), jump, jumpHeld, up: upHeld, down, action };
  };

  // ---- メッセージ ----
  let toast = { text: '', time: 0 };    // 画面上部に出すメッセージ
  // ステージごとの記録 { items:[{name,jump}], opened:開けた宝箱の数, chests:宝箱の数, time:かかった秒数 }。
  // ステージをまたいで sessionStorage に残し、最後の脱出後にタイムと「開けた宝箱/全部の宝箱」を出す。
  // 最初のステージから始めたときは記録をリセット。同じステージを読み直したときは、そのステージ分だけ取り直し。
  // RTA のときは保存せず、このステージだけの記録にする。
  const RUN_KEY = 'tooreasure.run';
  let run = { stages: {} };
  if (!rta) {
    try { run = JSON.parse(sessionStorage.getItem(RUN_KEY)) ?? run; } catch { /* 無視 */ }
    if (!run?.stages || stageId === stageList.first) run = { stages: {} };
  }
  const chestCh = world.charFor('chest');
  const chestCount = world.grid.reduce((n, row) => n + row.filter(ch => ch === chestCh).length, 0);
  const rec = run.stages[stageId] = { items: [], opened: 0, chests: chestCount, time: 0, deaths: 0 };
  const allStages = () => Object.values(run.stages);
  // 前のステージで取ったチョコレート・なめらかプリン（jump）は持ち越す（このステージの基本値に足す）
  const carried = allStages().flatMap(s => s.items).reduce((s, i) => s + (i.jump || 0), 0);
  cfg.jumpHeight += carried;
  const saveRun = () => { if (!rta) try { sessionStorage.setItem(RUN_KEY, JSON.stringify(run)); } catch { /* 無視 */ } };
  saveRun();
  const inventory = rec.items;
  // 結果画面に出すステージか（RTA ならそのステージ、普通は次のステージが無い最後のステージ）
  const finalStage = rta || !stage.next;
  const ending = !rta && !stage.next ? (story.ending ?? []) : [];      // 最後のステージのゴール後に流す脱出のストーリー
  // ステージクリア（ゴール / 落とし穴 / 駅の入口）: タイムを止めて記録する
  function clearStage(extra = {}) {
    if (cleared) return;
    // 記録: RTA ならそのステージのタイム / 通しで遊んだなら合計タイムを、ベスト3に登録
    let rank = 0;
    if (finalStage && (rta || run.stages[stageList.first])) {      // 通しの記録は、最初のステージから遊んだときだけ
      rank = addRecord(rta ? stageId : 'all', rta ? rec.time : allStages().reduce((a, r) => a + (r.time || 0), 0));
      keepRecords();
    }
    cleared = { t: 0, rt: 0, rank, phase: finalStage ? (ending.length ? 'fade' : 'result') : null, ...extra };
    if (finalStage) { toast.time = 0; bgm.play('forest', 0.8); }   // 結果画面に字幕が重ならないよう消す / ゴールしたら forest_bgm
    // 次のステージで曲が変わる（森 → 洞窟）ときは、切り替わる前に一瞬フェードアウト
    if (!finalStage && nextTrack && nextTrack !== (stage.theme === 'cave' ? 'cave' : 'forest')) bgm.fadeOut(0.9);
    saveRun();
  }
  let nextTrack = null;
  if (stage.next) getJSON(`data/stages/${stage.next}.json`).then(n => { nextTrack = n.theme === 'cave' ? 'cave' : 'forest'; }).catch(() => {});
  player.onFall = () => clearStage({ walk: !world.hitsFlag(player.x, player.y, cfg.hitboxW, cfg.hitboxH, 'fall') && world.hitsFlag(player.x, player.y, cfg.hitboxW, cfg.hitboxH, 'warp') });      // walk=駅の入口: 左右キーを押している間は歩き続けたまま切り替わる / 落とし穴 → 暗転して次のステージへ

  // ---- やられたとき ----
  // 針・鍾乳石に当たる → 少し止まって点滅 + 破片が飛び散る + 画面が揺れる → 中間地点へ
  let parts = [], shake = 0, deathsHere = 0;
  player.onHazard = () => {
    rec.deaths++; saveRun();                                    // 針・鍾乳石でやられた回数
    deathsHere++;
    shake = 0.25;
    const cx = player.x + cfg.hitboxW / 2, cy = player.y + cfg.hitboxH / 2;
    // 黒・白・グレーが中心の、ところどころ虹色の破片
    const mono = ['#000000', '#ffffff', '#8a8a8a', '#3a3a3a', '#cfcfcf'], rainbow = ['#ff4d4d', '#ffa23a', '#ffe34a', '#4fd36a', '#4aa8ff', '#9a6bff'];
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 160;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.5 + Math.random() * 0.3, c: i % 3 === 2 ? rainbow[(i / 3 | 0) % rainbow.length] : mono[i % mono.length] });
    }
  };
  player.onCheckpoint = () => { deathsHere = 0; };
  function updateFx(dt) {
    shake = Math.max(0, shake - dt);
    for (const p of parts) { p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    parts = parts.filter(p => p.life > 0);
  }
  // やり直し（R キー / スマホの左上のボタン）: 最後の中間地点へ
  function retry() {
    if (cleared || player.dying || player.fell) return;
    player.respawn();
  }
  document.getElementById('btn-retry')?.addEventListener('pointerdown', e => { e.preventDefault(); retry(); });
  // はじめから（スマホ）: 「タイトルへ戻りますか？」→「はい」でタイトル画面へ（ページを読み直す）
  const confirmEl = document.getElementById('confirm');
  const askTitle = open => { gamePaused = open; confirmEl.hidden = !open; };
  document.getElementById('btn-restart')?.addEventListener('pointerdown', e => { e.preventDefault(); if (!cleared) askTitle(true); });
  document.getElementById('confirm-no')?.addEventListener('pointerdown', e => { e.preventDefault(); askTitle(false); });
  document.getElementById('confirm-yes')?.addEventListener('pointerdown', e => { e.preventDefault(); bgm.leave(); location.href = location.pathname; });
  document.body.classList.add('ingame');


  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let camY = null;
  function updateCamera() {
    const vw = view.w, vh = view.h;
    const cx = player.x + cfg.hitboxW / 2, cy = player.y + cfg.hitboxH / 2;
    camera.x = Math.round(clamp(cx - vw / 2, 0, Math.max(0, world.width - vw)));
    // 縦はジャンプのたびに揺れないよう、画面の中ほど(35%〜65%)から出たときだけ追従する
    if (camY === null) camY = cy - vh * 0.65;
    if (cy < camY + vh * 0.35) camY = cy - vh * 0.35;
    if (cy > camY + vh * 0.65) camY = cy - vh * 0.65;
    camY = clamp(camY, 0, Math.max(0, world.height - vh));
    camera.y = Math.round(camY);
  }

  // ---- アクション（宝箱を開ける・出口に入る など）----
  let interactTarget = null;            // 今その場で実行できるイベント
  let ladderHint = null;                // 降りられる梯子の上に立っているとき {col,row}
  let cleared = null;                   // ステージクリア後の状態 {t}
  const passSeen = new Set();           // 通過で字幕が出た透明マス（1回だけ出す）
  let titleT = stage.title ? 3.2 : 0;   // ステージ開始時のタイトル表示（"SECOND STAGE" など）

  function updateInteract(input, dt) {
    interactTarget = world.findInteractable(player.x, player.y, cfg.hitboxW, cfg.hitboxH);
    if (interactTarget && input.action) {
      if (interactTarget.name === 'chest') rec.opened++;              // 開けた宝箱の数（空っぽでも数える）
      const result = world.interact(interactTarget);
      toast = result.subtitle
        ? { text: result.message, time: 1e9, sub: true, born: performance.now(), x: player.x }   // ポスターなど: 字幕。動くと消える
        : { text: result.message, time: 2.2 };
      if (result.item) {
        inventory.push({ name: result.item.name, jump: result.item.jump || 0 });
        if (result.item.jump) cfg.jumpHeight += result.item.jump;     // 「チョコレート」「なめらかプリン」など（items.json の jump）
      }
      saveRun();
      if (result.goal) clearStage();
      interactTarget = world.findInteractable(player.x, player.y, cfg.hitboxW, cfg.hitboxH);
    }
    // 通過で字幕が出る透明マス（落下中に通ってもよい）
    const pass = world.passTarget(player.x, player.y, cfg.hitboxW, cfg.hitboxH);
    if (pass && !passSeen.has(pass.key)) {
      passSeen.add(pass.key);
      toast = { text: pass.text, time: 1e9, sub: true, born: performance.now(), x: player.x };
    }
    if (toast.sub && (input.dir !== 0 || input.jump || input.up || Math.abs(player.x - toast.x) > 1)) toast.time = 0;      // 動いたら字幕を消す
    toast.time = Math.max(0, toast.time - dt);
    titleT = Math.max(0, titleT - dt);
    // 梯子の上に立っている: ↓（スマホは ● か、パッドを押したまま下へ）で降りられることを知らせる
    ladderHint = !interactTarget && !cleared && !player.climbing && player.onGround && !player.dying ? player.ladderBelow() : null;
  }

  // 実行できるイベントの上に出す吹き出し（丸に点 = アクションボタンと同じ絵）
  function drawBubble({ c, r }) {
    const x = (c + 0.5) * world.T, y = r * world.T - 12 + Math.round(Math.sin(performance.now() / 200) * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }

  const images = {};                    // 字幕に出す画像（[img:パス]）
  function loadImage(src) {
    if (!images[src]) { images[src] = new Image(); images[src].src = src; }
    return images[src];
  }

  // 梯子の上: 下向きの矢印の吹き出し
  function drawLadderHint({ col: c, row: r }) {
    const x = (c + 0.5) * world.T, y = r * world.T + 14 + Math.round(Math.sin(performance.now() / 200) * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.moveTo(x - 5, y - 2); ctx.lineTo(x + 5, y - 2); ctx.lineTo(x, y + 4); ctx.closePath(); ctx.fill();
  }

  function drawToast(vw, vh) {
    if (toast.time <= 0 || !toast.text) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, toast.time / 0.4);
    ctx.textAlign = 'center';
    if (toast.sub) {                                  // 字幕: ストーリーと同じ文字ウィンドウ（半透明）+ 右端にキャラ絵。1文字ずつ表示
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;                                 // 2倍。中心はやや下（足元は画面の外）
      ctx.drawImage(dotoo, Math.round(vw - dotoo.width * 2 - 6), vh - 300, dotoo.width * 2, dotoo.height * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(30, vh - 140, vw - 60, 110);
      ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 2; ctx.strokeRect(31, vh - 139, vw - 62, 108);
      ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
      // 文章の中の [tile:タイル名] / [img:画像のパス] は、字幕の左側に絵として出す（看板の説明など）
      if (!toast.parsed) {
        const imgs = [];
        const text = toast.text.replace(/\[(tile|img):([^\]]+)\]/g, (_, k, v) => { imgs.push({ k, v: v.trim() }); return ''; }).replace(/^\s*\n/, '');
        toast.parsed = { text, imgs };
      }
      let tx = 50;
      for (const im of toast.parsed.imgs) {
        const src = im.k === 'tile' ? world.sprites[im.v] : loadImage(im.v);
        if (!src || (src instanceof HTMLImageElement && !src.complete)) continue;
        const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
        const k = im.k === 'tile' ? 2 : Math.min(90 / sh, 180 / sw);
        const w = Math.round(sw * k), h = Math.round(sh * k);
        ctx.drawImage(src, tx - 6, vh - 85 - h / 2, w, h);
        tx += w + 6;
      }
      if (tx > 50) tx += 8;
      const chars = [...toast.parsed.text], n = Math.min(chars.length, Math.floor((performance.now() - toast.born) / 1000 * 28));
      if (toast.n === undefined || toast.born !== toast.bornSeen) { toast.n = 0; toast.bornSeen = toast.born; }
      if (n > toast.n && /\S/.test(chars[n - 1])) sfx.text();
      toast.n = n;
      const maxW = vw - 50 - tx;
      let lineW = 0, line = 0;
      for (let i = 0; i < n; i++) {
        const c = chars[i];
        if (c === '\n') { line++; lineW = 0; continue; }
        const cw = ctx.measureText(c).width;
        if (lineW + cw > maxW) { line++; lineW = 0; }
        ctx.fillText(c, tx + lineW, vh - 106 + line * 28);
        lineW += cw;
      }
      ctx.restore();
      return;
    }
    ctx.font = 'bold 15px sans-serif';
    const w = ctx.measureText(toast.text).width + 24;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(Math.round(vw / 2 - w / 2), 24, Math.round(w), 28);
    ctx.fillStyle = '#ffe9a0';
    ctx.fillText(toast.text, Math.round(vw / 2), 43);
    ctx.restore();
  }

  // ---- 洞窟の暗さ: 全体を暗くして、プレイヤーとたいまつの周りだけ明るくする ----
  const dark = document.createElement('canvas');
  function lightHole(d, x, y, r, strength) {
    const g = d.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = g;
    d.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function drawDarkness(vw, vh) {
    if (!stage.darkness) return;
    if (dark.width !== vw || dark.height !== vh) { dark.width = vw; dark.height = vh; }
    const d = dark.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, vw, vh);
    d.fillStyle = 'rgba(2,3,12,' + stage.darkness + ')';
    d.fillRect(0, 0, vw, vh);
    d.globalCompositeOperation = 'destination-out';
    lightHole(d, player.x + cfg.hitboxW / 2 - camera.x, player.y + cfg.hitboxH / 2 - camera.y, 240, 1);
    for (const l of world.lights) lightHole(d, l.x - camera.x, l.y - camera.y, l.radius * 1.4, 0.45);
    ctx.drawImage(dark, 0, 0);
  }
  function drawGlows() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of world.lights) {
      const x = l.x - camera.x, y = l.y - camera.y;
      const g = ctx.createRadialGradient(x, y, 0, x, y, l.radius);
      g.addColorStop(0, 'rgba(' + l.color + ',' + l.alpha * 0.5 + ')');
      g.addColorStop(1, 'rgba(' + l.color + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - l.radius, y - l.radius, l.radius * 2, l.radius * 2);
    }
    ctx.restore();
  }

  function drawTitle(vw, vh) {
    if (titleT <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, titleT / 0.8, (3.2 - titleT) / 0.4 + 0.001);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, vh / 2 - 44, vw, 88);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9a0';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(stage.title, vw / 2, vh / 2 + 4);
    if (stage.name) {
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(stage.name, vw / 2, vh / 2 + 30);
    }
    ctx.restore();
  }

  // タイム表示 1:23.45（1時間を超えたら 1:02:03.45）
  const fmtTime = s => {
    const cs = Math.floor(s * 100), h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60, c = cs % 100;
    const p2 = n => String(n).padStart(2, '0');
    return (h ? `${h}:${p2(m)}` : `${m}`) + `:${p2(sec)}.${p2(c)}`;
  };
  // RTA 中は左上にタイムを出す
  function drawTimer() {
    if (!rta || cleared?.phase === 'result') return;
    ctx.save();
    ctx.font = 'bold 16px monospace'; ctx.textAlign = 'left';
    const text = fmtTime(rec.time), w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, 8, w, 24);
    ctx.fillStyle = cleared ? '#ffd23f' : '#ffffff'; ctx.fillText(text, 16, 26);
    ctx.restore();
  }

  function drawClear(vw, vh) {
    if (!cleared) return;
    if (!finalStage || cleared.phase !== 'result') {   // 次のステージへ進む / 脱出のストーリーの前: 暗転するだけ
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, cleared.t / 0.8) + ')';
      ctx.fillRect(0, 0, vw, vh);
      return;
    }
    // 結果画面: タイム → 開けた宝箱の数（7/13 など）→ 持ち帰ったお宝を順に出す
    const t = cleared.rt;
    ctx.fillStyle = 'rgba(0,0,0,' + (cleared.black ? 1 : Math.min(0.82, t / 1.2)) + ')';
    ctx.fillRect(0, 0, vw, vh);
    if (t < 0.6) return;
    const list = rta ? [rec] : allStages();
    const time = list.reduce((s, r) => s + (r.time || 0), 0);
    const opened = list.reduce((s, r) => s + (r.opened || 0), 0);
    const chests = list.reduce((s, r) => s + (r.chests || 0), 0);
    const deaths = list.reduce((s, r) => s + (r.deaths || 0), 0);
    const items = list.flatMap(r => r.items);
    const shown = Math.min(items.length, Math.max(0, Math.floor((t - 2.2) / 0.15) + 1));
    const done = t >= 2.2 + items.length * 0.15 + 0.3;
    cleared.done = done;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9a0'; ctx.font = 'bold 28px sans-serif';
    ctx.fillText(rta ? `${stage.title ?? stageId}  RTA` : '脱出成功', vw / 2, 44);
    if (t >= 1.0) {
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('クリアタイム', vw / 2, 78);
      ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 32px monospace'; ctx.fillText(fmtTime(time), vw / 2, 112);
      if (cleared.rank === 1) { ctx.fillStyle = '#7fe0ff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('新記録', vw / 2, 129); }
    }
    if (t >= 1.4) {
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('開けた宝箱', vw / 2, 142);
      ctx.fillStyle = '#ffe9a0'; ctx.font = 'bold 24px monospace'; ctx.fillText(`${opened}/${chests}`, vw / 2, 170);
    }
    if (t >= 1.8) {
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('リスポーン', vw / 2 - 40, 198);
      ctx.fillStyle = '#ffe9a0'; ctx.font = 'bold 20px monospace'; ctx.fillText(`${deaths}回`, vw / 2 + 40, 198);
    }
    if (t >= 2.2 && items.length) {
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('持ち帰ったお宝', vw / 2, 226);
      const rows = Math.ceil(items.length / 2), step = Math.min(18, (vh - 266) / Math.max(1, rows));
      ctx.font = `${Math.max(9, Math.min(14, Math.floor(step - 3)))}px sans-serif`; ctx.fillStyle = '#ffe9a0';
      for (let i = 0; i < shown; i++) {
        const col = i % 2, row = Math.floor(i / 2);
        ctx.textAlign = items.length === 1 ? 'center' : (col ? 'left' : 'right');
        ctx.fillText(items[i].name, items.length === 1 ? vw / 2 : vw / 2 + (col ? 14 : -14), 246 + row * step);
      }
    }
    if (done) {
      ctx.textAlign = 'center'; ctx.fillStyle = '#aaa'; ctx.font = '11px sans-serif';
      ctx.fillText(rta ? 'Enter / アクションボタンでタイトルへ　R でもう一度' : 'Enter / アクションボタンでタイトルへ', vw / 2, vh - 12);
    }
    ctx.restore();
  }

  function draw() {
    const vw = view.w, vh = view.h;
    ctx.setTransform(view.k, 0, 0, view.k, 0, 0);     // 以降は論理ピクセルで描く
    ctx.imageSmoothingEnabled = false;
    // 前フレームの絵が残らないよう毎フレーム塗り直す
    ctx.fillStyle = theme === 'cave' ? '#07080f' : '#000';
    ctx.fillRect(0, 0, vw, vh);
    if (theme === 'cave') {
      // 洞窟の壁: 縦横にループ、手前の0.4倍の速さで動く
      const ox = Math.floor(camera.x * 0.4) % far.width, oy = Math.floor(camera.y * 0.4) % far.height;
      for (let y = -oy; y < vh; y += far.height) for (let x = -ox; x < vw; x += far.width) ctx.drawImage(far, x, y);
    } else {
      if (skyWidth !== vw) { sky = createBackground(vw, world.height, groundY, 'sky', theme); skyWidth = vw; }
      // 空は画面固定、遠景は横のみ視差スクロール（縦は地面と揃える）
      ctx.drawImage(sky, 0, -camera.y);
      const off = Math.floor(camera.x * BG_PARALLAX) % far.width;
      for (let x = -off; x < vw; x += far.width) ctx.drawImage(far, x, -camera.y);
    }
    // 地面・足場
    const sx = shake > 0 ? Math.round((Math.random() - 0.5) * 8 * shake / 0.25) : 0, sy = shake > 0 ? Math.round((Math.random() - 0.5) * 8 * shake / 0.25) : 0;   // やられたときの揺れ
    ctx.drawImage(world.layer, camera.x, camera.y, vw, vh, sx, sy, vw, vh);
    // 動くもの・キャラ（ワールド座標）
    ctx.save();
    ctx.translate(-camera.x + sx, -camera.y + sy);
    for (const c of world.crates) c.draw(ctx, world.sprites.crate);
    if (interactTarget && !cleared) drawBubble(interactTarget);     // 吹き出しはキャラの後ろ
    player.draw(ctx);
    for (const p of parts) { ctx.globalAlpha = Math.min(1, p.life / 0.2); ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4); }
    ctx.globalAlpha = 1;
    ctx.restore();
    drawDarkness(vw, vh);
    drawGlows();
    drawToast(vw, vh);
    drawTitle(vw, vh);
    drawClear(vw, vh);
    drawTimer();
  }

  // ---- ループ ----
  let last = performance.now();
  let helping = false;                 // 操作説明を表示中: マップだけ描いて止める
  function frame(now) {
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    if (helping) { draw(); requestAnimationFrame(frame); return; }

    let input = readInput();
    // タイム: ステージが始まってからクリアするまで
    if (!cleared) rec.time += rawDt;
    if (cleared) {
      // クリア後は操作を受け付けない。しばらくしたら次のステージへ（最後なら結果画面→アクションでタイトルへ）
      if (cleared.done && !cleared.going) {
        if (input.action) { cleared.going = true; bgm.leave(); location.assign(location.pathname); }
        else if (rta && keys.has('r')) { cleared.going = true; bgm.leave(); location.reload(); }        // RTA をもう一度
      }
      input = cleared.walk ? { ...input, jump: false, jumpHeld: false, action: false } : { dir: 0, jump: false, jumpHeld: false, action: false };
      cleared.t += dt;
      if (cleared.phase === 'result') cleared.rt += dt;
      if (cleared.t > 1.1 && !finalStage && !cleared.going) {
        cleared.going = true;
        params.set('stage', stage.next);
        bgm.leave();                                   // 前のステージの曲を止めてから移る（次のページで続きから流す）
        location.search = params.toString();
      }
      if (cleared.t > 1.1 && cleared.phase === 'fade') {
        // 最後のステージ: 暗転したら脱出のストーリー → 結果画面
        cleared.phase = 'story';
        runStory({ canvas, cfg, story: { pages: ending }, scene: 'meadow', dotoo }).then(() => {
          resize();
          cleared.phase = 'result'; cleared.black = true; cleared.rt = 0;
          keys.clear(); actionHeldPrev = true;                         // ストーリーを進めたキーで結果画面を飛ばさない
          last = performance.now();
          requestAnimationFrame(frame);
        });
        return;
      }
    }
    updateFx(dt);
    world.updateEntities(dt, player);
    player.update(dt, input);
    updateInteract(input, dt);
    updateCamera();
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (showHelp) {
    updateCamera();                            // カメラを先に合わせる（ずれ防止）
    helping = true;                            // 操作説明の間は、街のマップを表示したまま止める（TUTORIAL は閉じた後に出る）
    await runHelp();
    helping = false;
    keys.clear(); last = performance.now();
  }
}

start().catch(err => {
  console.error(err);
  canvas.width = 900; canvas.height = 200;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText(err.message, 20, 40);
  ctx.fillText('ローカルで開く場合は python -m http.server などのサーバー経由で開いてください。', 20, 70);
});
