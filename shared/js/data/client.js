// =====================================================================
// Supabase 客戶端與共用常量
// 只有本檔認識 supabase-js；其餘 data/* 透過 sb 使用它。
// =====================================================================
// ★ 自託管，不走第三方 CDN。
//   先前是 esm.sh：17 個檔、83 KB gzip、相依深度 4 層，而且在另一個網域
//   （手機上多一次 DNS + TLS，約 300–600 ms）。
//   更要緊的是 esm.sh 掛掉這個站就開不起來 ——
//   一個學習網站不該把「能不能開」交給第三方。
//   產物由 shared/scripts/build-vendor.mjs 產生並進版控，升級時才重跑。
import { createClient } from '../../vendor/supabase.js';
import { lang } from '../core/lang.js';

/**
 * 每站一個 Supabase 專案，所以 client 不能在模組載入時就建好 ——
 * 那時 setLang() 還沒跑，要不到該連哪一個專案。
 * 改成第一次用到時才建，之後重用同一個實例（多個 client 會各自持有
 * 一份 auth 狀態，登入了卻查不到資料就是這樣來的）。
 */
let _sb = null;
export const sb = new Proxy({}, {
  get(_, prop) {
    if (!_sb) {
      const { url, anonKey } = lang().supabase;
      _sb = createClient(url, anonKey);
    }
    const v = _sb[prop];
    return typeof v === 'function' ? v.bind(_sb) : v;
  },
});

/**
 * 條目欄位清單集中一處 —— 之前四個查詢各自抄一份，加欄位就會漏掉某個。
 *
 * 【欄位名為什麼還叫 ko / example_ko】
 *   兩站共用同一套 schema，欄位語意是「目標語言」而不是「韓文」。
 *   日文站的 ko 存日文、romanization 存羅馬字、hanja 存漢字寫法 ——
 *   對日文其實比韓文更合身。改名要動韓文站的線上資料庫，
 *   風險遠大於收益，所以留著，靠這段註解說清楚語意。
 */
export const ITEM_FIELDS =
  'id, ko, zh, romanization, hanja, pos, item_type, example_ko, example_zh, note, tags, audio_url';

// 方向代號同樣沿用 ko2zh／zh2ko（＝目標語言→中文／中文→目標語言），
// 但畫面上的字要照站台講，所以標籤走 lang()。
export const DIRECTIONS = ['ko2zh', 'zh2ko'];
export const dirLabel = () => {
  const t = lang().termLabel;
  return { ko2zh: `看${t} → 想中文`, zh2ko: `看中文 → 想${t}` };
};
export const dirShort = () => {
  const t = lang().termShort;
  return { ko2zh: `${t}→中`, zh2ko: `中→${t}` };
};
export const TYPE_LABEL = { word: '單字', phrase: '詞組', sentence: '句子' };
export const STATE_LABEL = { new: '新', learning: '學習中', review: '複習中', suspended: '暫停' };
export const RATE_LABEL = { 1: '忘了', 2: '有點難', 3: '記得', 4: '很簡單' };

export { fetchAll } from './paginate.js';
