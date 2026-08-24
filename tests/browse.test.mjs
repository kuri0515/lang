// =====================================================================
// 詞庫瀏覽的伺服器端分頁
//
// 【為什麼要專門測】
//   這一頁本來是「先把整份撈下來，再在前端一頁一頁畫」。
//   日文站 items 到 7049 條之後，那是 gzip 628 KB、8 趟往返、
//   實測 3.9 秒 —— 而使用者要看的只有最前面 60 條。
//   改成伺服器端分頁之後，會壞的地方變成三個，而三個都不報錯：
//     · 總數若改用「已載入幾筆」去算，數字會一路往上跳
//     · 「載入更多」若沒帶 offset，每次都回同一批
//     · 換篩選時，先送的舊查詢可能後回來，蓋掉新的結果
//
//     STUB_POOL=... node --import ./tests/_cdn-stub.mjs tests/browse.test.mjs
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { SHARED, SITE_DIR, siteReady } from './_site.mjs';

const dom = new JSDOM(fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8'),
  { pretendToBeVisual: true, url: 'https://x.test/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} };
await siteReady();

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

const { $, qsa } = await import(`${SHARED}/js/core/dom.js`);
const content = await import(`${SHARED}/js/data/content.js`);
const browse = await import(`${SHARED}/js/views/browse.js`);

const POOL = JSON.parse(fs.readFileSync(process.env.STUB_POOL, 'utf8'));
const rows = () => qsa('#b-list .b-row').length;
const moreBtn = () => $('b-more').querySelector('button');

browse.initBrowse({ user: () => null, isAdmin: () => false, onPractice: () => {} });

console.log(`【第一頁只取 60 條（詞庫共 ${POOL.length} 條）】`);
await browse.render();
await tick();
const PAGE = 60;
chk('★ 只畫第一頁', rows() === Math.min(PAGE, POOL.length), `畫了 ${rows()} 列`);
chk('★ 總數是資料庫算的，不是已載入的筆數',
    $('b-count').textContent.startsWith(`${POOL.length} 條`),
    `${$('b-count').textContent} —— 用已載入的筆數去算，數字會在載入更多時一路往上跳`);

if (POOL.length > PAGE) {
  console.log('【載入更多：接著往下，不是重來一次】');
  const rest = POOL.length - PAGE;
  chk('footer 說還有幾條', /還有 \d+ 條/.test(moreBtn()?.textContent || ''),
      moreBtn()?.textContent || '（沒有按鈕）');
  chk('剩下的條數對', moreBtn().textContent.includes(`還有 ${rest} 條`), moreBtn().textContent);

  const before = qsa('#b-list .b-row').map((el) => el.dataset.id);
  moreBtn().click();
  await tick(); await tick();
  const after = qsa('#b-list .b-row').map((el) => el.dataset.id);
  chk('★ 是接在後面，不是換一批',
      after.slice(0, before.length).join() === before.join(),
      '沒帶 offset 的話每次都回同一批，而畫面看起來只是「載入更多沒有反應」');
  chk('★ 沒有重複的條目', new Set(after).size === after.length,
      `${after.length - new Set(after).size} 筆重複`);
  chk('列數增加', after.length === Math.min(PAGE * 2, POOL.length), `${after.length} 列`);
}

console.log('【換篩選：晚回來的舊結果不能蓋掉新的】');
{
  // 讓第一趟慢、第二趟快，造出回應順序顛倒的現場。
  // 拖慢的是替身本身（globalThis.__stubDelay），不是把模組的匯出換掉 ——
  // ESM 的 namespace 是唯讀的，而且換掉匯出等於測到一半就不是正式那條路了。
  // 兩次查詢要看得出差別，所以用一個查無結果的關鍵字當「舊的那一次」。
  // 拖慢的是替身本身（globalThis.__stubDelay），不是把模組的匯出換掉 ——
  // ESM 的 namespace 是唯讀的，而且換掉匯出等於測到一半就不是正式那條路了。
  $('b-search').value = 'ゑゑ查無此詞ゑゑ';
  globalThis.__stubDelay = (n2) => (n2 === 1 ? 40 : 0);
  const slow = browse.render();              // 先送，會晚回來（0 條）
  await tick();
  $('b-search').value = '';
  const fast = browse.render();              // 後送，先回來（全部）
  await Promise.all([slow, fast]);
  await new Promise((r) => setTimeout(r, 80));
  delete globalThis.__stubDelay;
  chk('★ 晚回來的舊查詢不蓋掉新結果',
      $('b-count').textContent.startsWith(`${POOL.length} 條`) && rows() > 0,
      `${$('b-count').textContent}／${rows()} 列 —— `
      + '先送的那趟後回來時若照畫，搜尋框是空的、清單卻是「查無此詞」的結果');
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
