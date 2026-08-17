// =====================================================================
// 測試的站台裝配
//
// 拆成 monorepo 之後，「測哪一站」變成每支測試都要回答的問題。
// 集中在這裡，是為了讓答案只有一份 —— 否則五支測試各自拼路徑，
// 改目錄結構時必然漏掉一支，而那一支會靜默地測到舊路徑。
//
//     node tests/xxx.test.mjs            → 預設 korean
//     SITE=japanese node tests/xxx.test.mjs
//
// ★ 為什麼要 await siteReady()：
//   shared/js 的模組在載入時就會用到 lang()（題型的 hint 是模板字串），
//   所以測試必須先 setLang 再 import 那些模組 —— 用動態 import，不能靜態。
// =====================================================================
import { setLang, _resetLang } from '../shared/js/core/lang.js';

export const SITE = process.env.SITE || 'korean';
export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const SHARED = `${ROOT}/shared`;
export const SITE_DIR = `${ROOT}/${SITE}`;

/**
 * 裝上該站的語言設定。回傳 LANG 供測試直接斷言。
 *
 * config.js 裡是公開的 anon key，測試不連網，所以載入它沒有副作用。
 */
export async function siteReady() {
  const { LANG } = await import(`${SITE_DIR}/lang.config.js`);
  _resetLang();
  setLang(LANG);
  return LANG;
}
