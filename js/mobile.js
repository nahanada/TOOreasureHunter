// スマホ対応: 画面下のタッチ操作（左右パッド + ジャンプボタン）と全画面表示。
// 返す state（left / right / jump）を main.js が毎フレーム読む。

export function initMobile() {
  const state = { left: false, right: false, jump: false, action: false, down: false };
  const body = document.body;
  const $ = id => document.getElementById(id);

  // スマホ・タブレット（主な入力がタッチで、ホバー不可）のときだけタッチ操作を出す。PCでは出さない。
  // 動作確認用に ?touch=1 を付けるとPCでも強制表示できる。
  const isTouch = (matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches) || /[?&]touch=1/.test(location.search);
  body.classList.toggle('touch', isTouch);

  // ---- 左右パッド: 指の位置が左半分なら左、右半分なら右（指をスライドして切替可）----
  const pad = $('pad');
  let padPointer = null;
  const setDir = dir => {
    state.left = dir === 'left';
    state.right = dir === 'right';
    $('btn-left').classList.toggle('on', state.left);
    $('btn-right').classList.toggle('on', state.right);
  };
  let padStartY = 0;
  const padUpdate = e => {
    const r = pad.getBoundingClientRect();
    setDir(e.clientX - r.left < r.width / 2 ? 'left' : 'right');
    state.down = e.clientY - padStartY > 28;       // 押したまま下へスライドすると「↓」（梯子を降りる）
  };
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    padPointer = e.pointerId;
    padStartY = e.clientY;
    try { pad.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
    padUpdate(e);
  });
  pad.addEventListener('pointermove', e => { if (e.pointerId === padPointer) padUpdate(e); });
  const padEnd = e => { if (e.pointerId === padPointer) { padPointer = null; setDir(null); state.down = false; } };
  pad.addEventListener('pointerup', padEnd);
  pad.addEventListener('pointercancel', padEnd);

  // ---- ジャンプボタン ----
  const jb = $('btn-jump');
  const jumpSet = on => { state.jump = on; jb.classList.toggle('on', on); };
  jb.addEventListener('pointerdown', e => { e.preventDefault(); try { jb.setPointerCapture(e.pointerId); } catch { /* 無視 */ } jumpSet(true); });
  jb.addEventListener('pointerup', () => jumpSet(false));
  jb.addEventListener('pointercancel', () => jumpSet(false));

  // ---- アクションボタン（その場で実行できるイベント: 宝箱を開ける など）----
  const ab = $('btn-action');
  const actionSet = on => { state.action = on; ab.classList.toggle('on', on); };
  ab.addEventListener('pointerdown', e => { e.preventDefault(); try { ab.setPointerCapture(e.pointerId); } catch { /* 無視 */ } actionSet(true); });
  ab.addEventListener('pointerup', () => actionSet(false));
  ab.addEventListener('pointercancel', () => actionSet(false));

  // 長押しメニュー・選択・ダブルタップ拡大を抑止
  for (const el of [pad, jb, ab, $('stage')]) el.addEventListener('contextmenu', e => e.preventDefault());

  // ---- 全画面 ----
  let usedFullscreen = false;
  // 右上の1つのボタンを「全画面にする(⛶)」/「全画面を終了(×)」で切り替える
  const fs = $('btn-fs');
  const setFsButton = playing => {
    fs.textContent = playing ? '×' : '⛶';
    fs.setAttribute('aria-label', playing ? '全画面を終了' : '全画面にする');
  };
  async function enterPlay() {
    body.classList.add('play');
    setFsButton(true);
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      usedFullscreen = !!document.fullscreenElement;
    } catch { usedFullscreen = false; }          // iPhone Safari などは非対応 → 画面いっぱい表示のみ
  }
  function exitPlay() {
    body.classList.remove('play');
    setFsButton(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    usedFullscreen = false;
  }
  document.addEventListener('fullscreenchange', () => {
    // システム操作（戻るジェスチャーなど）で全画面が解除されたら表示も戻す
    if (!document.fullscreenElement && usedFullscreen) exitPlay();
  });

  fs.addEventListener('click', () => { body.classList.contains('play') ? exitPlay() : enterPlay(); });
  setFsButton(false);

  return state;
}
