// =====================================================================
// 版號要涵蓋所有會影響線上的檔案
//
// version.json 是判斷「上線了沒」的依據：拿本地的跟線上的比對，
// 一樣就當作已同步。所以版號漏算任何一種檔案，
// 都會讓一次真實的部署被讀成「線上與本地一致」——
// **錯誤方向是假的通過**，而假的通過沒有人會去查。
//
// 這曾經發生：buildId 只雜湊 `.js`，於是改樣板或 CSS 之後版號不變。
//
// 驗法是端到端的：真的去改一個檔案，看 `--check` 會不會抓到。
// 「清單裡有沒有 .css」那種字面檢查證明不了雜湊真的讀了它。
//
//     node tests/build.test.mjs
// =====================================================================
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

/** 跑 --check，回傳它是否通過 */
const checkPasses = () => {
  try {
    execFileSync('node', [`${ROOT}/shared/scripts/build-sites.mjs`, '--check'],
                 { stdio: 'pipe' });
    return true;
  } catch { return false; }
};

/** 暫時改一個檔案，看 --check 會不會紅。finally 保證還原 */
function mustDetectChangeIn(path, append) {
  const orig = fs.readFileSync(path);
  try {
    fs.writeFileSync(path, Buffer.concat([orig, Buffer.from(append)]));
    return checkPasses() === false;          // 抓到了才算對
  } finally {
    fs.writeFileSync(path, orig);            // 一定還原，測試不留痕跡
  }
}

console.log('【版號涵蓋範圍】');

chk('乾淨的工作區 --check 會通過', checkPasses(),
    '基準不成立的話，下面每一條都會「通過」而其實什麼都沒驗到');

chk('★ 改 CSS，版號要跟著變',
    mustDetectChangeIn(`${ROOT}/shared/css/style.css`, '\n/* probe */\n'),
    'CSS-only 的部署會被讀成「線上與本地一致」，而使用者拿到的是舊樣式');

chk('★ 改樣板，版號要跟著變',
    mustDetectChangeIn(`${ROOT}/shared/index.template.html`, '\n<!-- probe -->\n'),
    '搬一個區塊、改一段文案都屬於這一類 —— 全都不會動到任何 .js');

chk('★ 改共用 JS，版號要跟著變',
    mustDetectChangeIn(`${ROOT}/shared/js/core/dom.js`, '\n// probe\n'),
    '這一類本來就涵蓋，一起驗是為了確認測試方法本身有效');

chk('改站台設定，版號要跟著變',
    mustDetectChangeIn(`${ROOT}/korean/lang.config.js`, '\n// probe\n'));

chk('★ 驗完之後工作區乾淨（每個 probe 都還原了）', checkPasses(),
    'finally 沒還原的話會留下髒檔案，而下一次 build 會靜靜地把它帶上線');

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
