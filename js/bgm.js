// BGM: BGM/<名前>_bgm_intro.ogg を1回流して、続けて BGM/<名前>_bgm_loop.ogg を繰り返す（Web Audio で隙間なく）。
// ステージの切り替えはページの読み直しなので、「どの曲を・いつ始めたか」を sessionStorage に残し、
// 読み直した先で同じ曲の続きの位置から流す。曲が変わるときだけ最初から流し直す。
// ブラウザは最初の操作（クリック・キー）があるまで音を出せないので、それまでは待つ。
const KEY = 'tooreasure.bgm';
const VOLUME = 0.2;

let ctx = null, master = null;
try {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = VOLUME; master.connect(ctx.destination);
} catch { /* 音なしで動かす */ }

const cache = {};                       // 名前 → Promise<{intro, loop}>
let cur = null, startedAt = 0, fresh = false;
let playing = null, token = 0, pendingFade = 0;          // playing: いま鳴っている { gain, nodes }

try {
  // ブラウザの更新（F5 など）のときは続きではなく、曲の最初から流す
  if (performance.getEntriesByType('navigation')[0]?.type === 'reload') sessionStorage.removeItem(KEY);
} catch { /* 無視 */ }
try {
  const s = JSON.parse(sessionStorage.getItem(KEY));
  if (s?.name) { cur = s.name; startedAt = s.startedAt; }
} catch { /* 無視 */ }
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ name: cur, startedAt })); } catch { /* 無視 */ } };

function load(name) {
  if (!cache[name]) {
    const get = async f => {
      const res = await fetch(`BGM/${name}_bgm_${f}.ogg`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    };
    cache[name] = Promise.all([get('intro'), get('loop')]).then(([intro, loop]) => ({ intro, loop }));
    cache[name].catch(() => { delete cache[name]; });
  }
  return cache[name];
}

function stopCurrent() {
  if (!playing) return;
  const p = playing; playing = null;
  const t = ctx.currentTime;
  p.gain.gain.setValueAtTime(p.gain.gain.value, t);
  p.gain.gain.linearRampToValueAtTime(0, t + 0.4);
  for (const n of p.nodes) try { n.stop(t + 0.45); } catch { /* 無視 */ }
}

async function begin() {
  if (!ctx || !cur) return;
  const my = ++token, name = cur;
  let bufs;
  try { bufs = await load(name); } catch { return; }
  if (my !== token || ctx.state !== 'running') return;
  stopCurrent();
  if (fresh) { startedAt = Date.now(); fresh = false; save(); }      // 最初の操作が来た時点から流し始める
  const gain = ctx.createGain(); gain.connect(master);
  if (pendingFade > 0) { gain.gain.setValueAtTime(0, ctx.currentTime); gain.gain.linearRampToValueAtTime(1, ctx.currentTime + pendingFade); }
  pendingFade = 0;
  const t0 = ctx.currentTime + 0.05;
  const p = Math.max(0, (Date.now() - startedAt) / 1000);              // 曲の頭からの経過（読み直しをまたいで続く）
  const nodes = [];
  const src = (buf, loop) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = loop; s.connect(gain); nodes.push(s); return s; };
  if (p < bufs.intro.duration) {
    src(bufs.intro, false).start(t0, p);
    src(bufs.loop, true).start(t0 + bufs.intro.duration - p);
  } else {
    src(bufs.loop, true).start(t0, (p - bufs.intro.duration) % bufs.loop.duration);
  }
  playing = { gain, nodes };
}

function wake() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }
if (ctx) {
  ctx.onstatechange = () => { if (ctx.state === 'running' && cur && !playing) begin(); };
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, wake, { passive: true });
}

export const bgm = {
  // 名前: 'forest' | 'cave'。いま流している曲と同じなら何もしない
  // fade: 曲が変わるときのフェードインの秒数
  play(name, fade = 0.5) {
    if (!ctx) return;
    if (name !== cur) {
      pendingFade = fade;
      cur = name; startedAt = Date.now(); fresh = ctx.state !== 'running'; save();
      token++; stopCurrent();
    }
    if (!playing) begin();
  },
  // いま鳴っている曲を sec 秒でフェードアウト（ステージの切り替え前に使う）
  fadeOut(sec = 0.6) {
    if (!ctx || !playing) return;
    const g = playing.gain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + sec);
  },
};

// ---- 効果音（小さな音。ファイルなしで合成）----
function blip(type, f0, f1, dur, vol) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sfx = {
  jump: () => blip('square', 260, 620, 0.13, 0.035),
  text: () => blip('square', 700 + Math.random() * 120, 640, 0.04, 0.018),     // 字幕の文字が出るたび
};
