// 精讀資料層的假替身。內容是造出來的日文短句，不是任何作品的台詞。
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
  // 第 3–12 幕各一行，用來驗「每十個一組」的分組與跨組換幕
  ...Array.from({ length: 10 }, (_, i) => ({
    idx: 5 + i, scene: 3 + i, start_s: 40 + i * 5, end_s: 43 + i * 5,
    ruby: '水[みず]を飲[の]みます', zh: '喝水',
    tokens: ['水'], grammar: [],
  })),
];
export const marked = [];
const EP2 = { id: 'ep2', slug: 'demo-s2e01', work: 'demo', work_title: 'デモ',
              season: 2, episode: 1, title: null, line_count: 2, scene_count: 1,
              deck_slug: 'demo-02' };
export async function listEpisodes() { return [EP, EP2]; }
export let lineCalls = 0;
export const resetCalls = () => { lineCalls = 0; };
export async function loadLines(id) { lineCalls += 1; return id === 'ep2' ? LINES2 : LINES; }
const LINES2 = [
  { idx: 0, scene: 1, start_s: 1, end_s: 3, ruby: '水[みず]', zh: '水', tokens: ['水'], grammar: [] },
  { idx: 1, scene: 1, start_s: 4, end_s: 6, ruby: '本[ほん]', zh: '書', tokens: ['本'], grammar: [] },
];
export async function loadProgress() { return new Set([1]); }
export async function progressCounts() { return { ep1: 1 }; }
export async function markScene(u, e, scene, done) { marked.push({ scene, done }); }
