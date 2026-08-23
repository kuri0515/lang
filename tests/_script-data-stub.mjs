// 精讀資料層的假替身。內容是造出來的日文短句，不是任何作品的台詞。
export const IS_STUB = true;
const EP = { id: 'ep1', slug: 'demo-s1e01', work: 'demo', work_title: 'デモ',
             season: 1, episode: 1, title: null, line_count: 5, scene_count: 2 };
const LINES = [
  { idx: 0, scene: 1, start_s: 3, end_s: 5, ja: '駅は近いです', ruby: '駅[えき]は近[ちか]いです',
    zh: '車站很近', tokens: ['駅', '近い'] },
  { idx: 1, scene: 1, start_s: 6, end_s: 8, ja: '本を読みます', ruby: '本[ほん]を読[よ]みます',
    zh: '看書', tokens: ['本', '読む'] },
  { idx: 2, scene: 1, start_s: 9, end_s: 11, ja: 'はい', ruby: 'はい', zh: '好的', tokens: [] },
  { idx: 3, scene: 2, start_s: 30, end_s: 32, ja: '水を飲みます', ruby: '水[みず]を飲[の]みます',
    zh: '喝水', tokens: ['水', '飲む'] },
  { idx: 4, scene: 2, start_s: 33, end_s: 36, ja: '行きましょう', ruby: '行[い]きましょう',
    zh: '走吧', tokens: ['行く'] },
];
export const marked = [];
export async function listEpisodes() { return [EP]; }
export async function loadLines() { return LINES; }
export async function loadProgress() { return new Set([1]); }
export async function progressCounts() { return { ep1: 1 }; }
export async function markScene(u, e, scene, done) { marked.push({ scene, done }); }
