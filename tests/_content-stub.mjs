// data/content.js 的替身：只提供精讀畫面用得到的那一支。
// 造出來的假卡片，與任何作品無關。
export const IS_STUB = true;
const DICT = {
  駅: { id: 'w-eki', ko: '駅', hanja: '駅[えき]', zh: '車站', pos: '名詞' },
  近い: { id: 'w-chikai', ko: '近い', hanja: '近[ちか]い', zh: '近的', pos: '形容詞' },
  本: { id: 'w-hon', ko: '本', hanja: '本[ほん]', zh: '書', pos: '名詞' },
  読む: { id: 'w-yomu', ko: '読む', hanja: '読[よ]む', zh: '讀', pos: '動詞' },
  水: { id: 'w-mizu', ko: '水', hanja: '水[みず]', zh: '水', pos: '名詞' },
  飲む: { id: 'w-nomu', ko: '飲む', hanja: '飲[の]む', zh: '喝', pos: '動詞' },
  行く: { id: 'w-iku', ko: '行く', hanja: '行[い]く', zh: '去', pos: '動詞' },
};
export const askedWith = [];
export const askedFields = [];
export async function itemsByKo(list, deckSlug = null, fields = 'ALL') {
  askedWith.push(deckSlug);
  askedFields.push(fields);
  return (list || []).map((k) => DICT[k]).filter(Boolean);
}
export let deckCalls = 0;
export async function pickItems() { return []; }
export async function listDecks() { deckCalls += 1; return []; }
export const invalidateDecks = () => {};
export async function distractorPool() { return []; }
