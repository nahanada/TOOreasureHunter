// 記録（ベストタイム上位3位）。ブラウザの localStorage に保存し、できるだけ消えないよう永続化も要求する。
//  キー: 'all' = 最初から最後まで通して遊んだ合計タイム / ステージID（stage1 など）= RTA のタイム
const KEY = 'tooreasure.records';
const MAX = 3;

export const RECORD_BOARDS = [
  { id: 'all', label: 'ALL STAGES' },
  { id: 'stage1', label: 'FIRST STAGE' },
  { id: 'stage2', label: 'SECOND STAGE' },
  { id: 'stage3', label: 'THIRD STAGE' },
];

// 1:23.45（1時間を超えたら 1:02:03.45）
export function fmtTime(s) {
  const cs = Math.floor(s * 100), h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60, c = cs % 100;
  const p2 = n => String(n).padStart(2, '0');
  return (h ? `${h}:${p2(m)}` : `${m}`) + `:${p2(sec)}.${p2(c)}`;
}

export function loadRecords() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && typeof r === 'object') return r;
  } catch { /* 無視 */ }
  return {};
}

// 記録を追加。戻り値: 順位（1〜3）/ 圏外なら 0
export function addRecord(board, time) {
  if (!(time > 0)) return 0;
  const all = loadRecords();
  const list = Array.isArray(all[board]) ? all[board] : [];
  const entry = { t: Math.round(time * 100) / 100, d: new Date().toISOString().slice(0, 10) };
  let rank = list.findIndex(e => entry.t < e.t);
  if (rank < 0) rank = list.length;
  if (rank >= MAX) return 0;
  list.splice(rank, 0, entry);
  all[board] = list.slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { return 0; }
  return rank + 1;
}

// ブラウザに「消さないで」と頼む（許可されなくても動作に影響なし）
export function keepRecords() {
  try { navigator.storage?.persist?.(); } catch { /* 無視 */ }
}
