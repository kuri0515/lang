// =====================================================================
// 把 CDN 上的 supabase-js 換成本地替身，讓 views/ 能在 node 裡跑起來。
//
// 【為什麼需要】
//   data/client.js 從 https://esm.sh/... import supabase-js，
//   而 node 的 ESM loader 不吃 https: —— 於是所有經過資料層的模組
//   （包含 views/study.js，也就是學習卡片本身）都載不進來。
//
//   結果是：學生 90% 時間在看的那張卡，完全沒有自動化測試。
//   先前只能測不碰資料層的模組，那剛好避開了最重要的部分。
//
// 【為什麼是替身而不是真的連線】
//   測試不該打網路。這個替身只要「長得像 client」就夠 ——
//   卡片渲染只用到 item 的欄位，不會真的查詢。
//   真的會查詢的地方（同義詞、漢字詞群）在替身下回空陣列，
//   而那正是「查詢還沒回來」的狀態，本來就要能正常顯示。
//
// 用法：node --import ./tests/_cdn-stub.mjs tests/xxx.test.mjs
// =====================================================================
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./_cdn-hooks.mjs', pathToFileURL('./tests/'));
