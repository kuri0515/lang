// =====================================================================
// 兩站都真的載得起來
//
//     node tests/boot.test.mjs
//
// 【為什麼光有 arch 與 lang 測試還不夠】
//   arch 測靜態原始碼、lang 測設定物件的內容，兩者都不會「執行」模組。
//   但共用碼裡有一類程式碼是在模組載入當下就跑的 ——
//   題型的 hint 是模板字串，載進來的那一刻就會呼叫 lang()。
//   啟動順序一錯（setLang 還沒跑就 import 了 app.js），
//   症狀是整站白屏，而且錯誤訊息會指向一個看起來不相干的檔案。
//
//   這支測試就是把那個順序真的走一遍，兩站各走一次。
//
// 【為什麼只載一部分模組】
//   views/* 多半會經 data/client.js 去 import esm.sh 上的 supabase-js，
//   node 的 ESM loader 不吃 https: —— 這是既有限制，dom.test.mjs 也一樣避開。
//   所以這裡挑的是「載入當下就會呼叫 lang()」的那些，正好是會炸的那些。
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { setLang, _resetLang } from '../shared/js/core/lang.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SITES = ['korean', 'japanese'];
const MODULES = [
  'study/modes/index.js', 'views/router.js', 'views/theme.js',
  'core/taxonomy.js', 'core/parse-table.js', 'core/speech.js', 'study/session.js',
];

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

for (const site of SITES) {
  console.log(`\n【${site}】`);
  const html = fs.readFileSync(`${ROOT}/${site}/index.html`, 'utf8');
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://x.test/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.getComputedStyle = dom.window.getComputedStyle;

  const { LANG } = await import(`${ROOT}/${site}/lang.config.js`);
  _resetLang();
  setLang(LANG);

  let loadErr = null;
  for (const m of MODULES) {
    try { await import(`${ROOT}/shared/js/${m}`); }
    catch (e) { loadErr = `${m}: ${e.message}`; break; }
  }
  chk(`${MODULES.length} 個共用模組都載得起來`, !loadErr, loadErr || '');

  // ── 載進來的字串真的是這一站的語言嗎 ──
  // 只驗「有沒有炸」會漏掉最陰的情況：載入成功，但拿到的是另一站的字。
  const { MODES } = await import(`${ROOT}/shared/js/study/modes/index.js`);
  const hints = MODES.map((m) => m.hint).join(' ');
  chk('題型說明用的是本站的語言名稱',
    hints.includes(LANG.termLabel) && hints.includes(LANG.termShort),
    hints.slice(0, 50) + '…');
  const otherLabels = SITES.filter((s) => s !== site)
    .map((s) => (s === 'korean' ? '韓文' : '日文'));
  chk('題型說明沒有混進別站的語言名稱',
    !otherLabels.some((x) => hints.includes(x)),
    otherLabels.filter((x) => hints.includes(x)).join('／'));

  // ── 匯入解析認得本站的欄名，也認得出「這欄不像本站的語言」──
  const { parseTable } = await import(`${ROOT}/shared/js/core/parse-table.js`);
  const sample = site === 'korean'
    ? `${LANG.termLabel},中文\n사람,人\nabc,測試`
    : `${LANG.termLabel},中文\n時間,時間\nabc,測試`;
  const r = parseTable(sample);
  chk('認得出本站的欄名（有表頭）', r.error === null && r.rows.length === 2,
    r.error || `${r.rows.length} 列`);
  chk('第一列是本站的語言，不報警', r.rows[0]?.warn === null, r.rows[0]?.warn || '');
  // ★ 反面樣本：檢查本身要對著真正的違規案例驗過，否則「沒輸出」不等於「沒問題」
  chk('第二列不是本站的語言，會報警', !!r.rows[1]?.warn,
    r.rows[1]?.warn || '沒報警 —— 這條檢查等於沒有作用');
}

console.log(fails ? `\n❌ ${fails} 項不通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
