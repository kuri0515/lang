// 精讀資料層的假替身。內容是造出來的日文短句，不是任何作品的台詞。
import fs from 'node:fs';
export const IS_STUB = true;
const EP = { id: 'ep1', slug: 'demo-s1e01', work: 'demo', work_title: 'デモ',
             season: 1, episode: 1, title: null, line_count: 17, scene_count: 12,
             deck_slug: 'demo-01' };
const LINES = [
  { idx: 0, scene: 1, start_s: 3, end_s: 5, ruby: '駅[えき]は近[ちか]いです',
    zh: '車站很近', tokens: ['駅', '近い'], grammar: ['masu'] },
  { idx: 1, scene: 1, start_s: 6, end_s: 8, ruby: '本[ほん]を読[よ]みます',
    zh: '看書', tokens: ['本', '読む', 'ゑゑ未建卡'], grammar: ['masu', 'te-iru'] },
  { idx: 2, scene: 1, start_s: 9, end_s: 11, ruby: 'はい', zh: '好的',
    tokens: [], grammar: [] },
  { idx: 3, scene: 2, start_s: 30, end_s: 32, ruby: '水[みず]を飲[の]みます',
    zh: '喝水', tokens: ['水', '飲む'], grammar: [] },
  { idx: 4, scene: 2, start_s: 33, end_s: 36, ruby: '行[い]きましょう',
    zh: '走吧', tokens: ['行く'], grammar: ['zzz-不存在的代號'] },
  // 第 3–12 幕各一行，用來驗「每十個一組」的分組與跨組換幕。
  // 最後一幕（第 12 幕）刻意塞 20 個詞：實測 43% 的幕超過 12 個詞、最多 50 個，
  // 那不是邊角情況，而是「這一區會不會把讀完了那顆按鈕推出螢幕」的分水嶺。
  ...Array.from({ length: 10 }, (_, i) => ({
    idx: 5 + i, scene: 3 + i, start_s: 40 + i * 5, end_s: 43 + i * 5,
    ruby: '水[みず]を飲[の]みます', zh: '喝水',
    tokens: i === 9 ? Array.from({ length: 20 }, (_, j) => `多${j}`) : ['水'],
    // 第 11 幕（i===8）刻意給 8 個句型：實測 23% 的幕有 8 個以上，最多 18 個，
    // 而每一條還帶兩三行的易錯點 —— 攤開就是一整個螢幕的說明文字
    grammar: i === 8
      ? ['masu', 'te-iru', 'ta', 'da-desu', 'nai', 'ka', 'yo-ne', 'keishou']
      : [],
  })),
];
export const marked = [];
const EP2 = { id: 'ep2', slug: 'demo-s2e01', work: 'demo', work_title: 'デモ',
              season: 2, episode: 1, title: null, line_count: 2, scene_count: 1,
              deck_slug: 'demo-02' };
export async function listEpisodes() { return [EP, EP2]; }
export let lineCalls = 0;
export const resetCalls = () => { lineCalls = 0; };
// ★ 替身只能遞出「真正的查詢有要的欄位」。
//
//   先前它把 tokens 與 grammar 直接遞出來，而 loadLines 的 select 裡
//   根本沒有這兩欄 —— 於是線上永遠讀到 undefined，測試卻全綠，
//   守著一個它抓不到的 bug。欄位清單從正式程式讀，不在這裡抄一份：
//   抄一份就會各自漂移，而漂移的那一刻沒有人會知道。
//   （用讀原始碼的方式取，不是 import —— 這支替身本身就是用來頂替
//     那個模組的，import 它會被轉回自己。）
const SRC = fs.readFileSync(new URL('../shared/js/data/script.js', import.meta.url), 'utf8');
const M = SRC.match(/LINE_FIELDS\s*=\s*'([^']+)'/);
if (!M) throw new Error('在 shared/js/data/script.js 找不到 LINE_FIELDS —— 替身無法確認要遞出哪些欄位');
const FIELDS = new Set(M[1].split(',').map((s) => s.trim()));
const onlySelected = (rows) => rows.map((r) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => FIELDS.has(k))));

export async function loadLines(id) {
  lineCalls += 1;
  return onlySelected(id === 'ep2' ? LINES2 : LINES);
}
const LINES2 = [
  { idx: 0, scene: 1, start_s: 1, end_s: 3, ruby: '水[みず]', zh: '水', tokens: ['水'], grammar: [] },
  { idx: 1, scene: 1, start_s: 4, end_s: 6, ruby: '本[ほん]', zh: '書', tokens: ['本'], grammar: [] },
];
export async function loadProgress() { return new Set([1]); }
export async function progressCounts() { return { ep1: 1 }; }
export async function markScene(u, e, scene, done) { marked.push({ scene, done }); }
