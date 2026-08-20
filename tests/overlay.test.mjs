// =====================================================================
// 開站失敗時的錯誤畫面，真的畫得出來嗎
//
// 【為什麼要獨立一支】
//   dom.test.mjs 已經驗過「index.html 裡有這段攔截器」，
//   但那只是字串比對 —— 它證明不了那段程式跑起來會產生任何東西。
//   而這個功能的用途正是「別的東西都壞了的時候」，
//   它自己壞掉不會有任何跡象：畫面一樣是白的。
//
//   所以這裡用 runScripts:'dangerously' 真的把那段執行起來，
//   丟一個錯進去，看畫面上有沒有出現東西。
//
//     node tests/overlay.test.mjs
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { SITE, SITE_DIR } from './_site.mjs';

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

console.log(`【開站錯誤畫面】（站台：${SITE}）`);

const dom = new JSDOM(fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8'),
  { runScripts: 'dangerously', url: 'https://x.test/' });
const { window } = dom;
await new Promise((r) => setTimeout(r, 50));

// ★ 只認「畫面上真的多出來的那一塊」，不能用文字比對找 ——
//   那段 script 的原始碼裡就有「開啟失敗」四個字，
//   用 textContent 找會抓到 <script> 自己，然後永遠通過。
//   （第一版就是這樣寫的，它「通過」了而畫面其實是空的。）
const overlay = () => [...window.document.body.children].find(
  (e) => e.tagName === 'DIV' && /position:fixed/.test(e.getAttribute('style') || ''));

chk('平常不出現', !overlay(), '沒出事就不該有東西擋在畫面上');

const err = new window.Error('Boom: 模擬模組求值失敗');
window.dispatchEvent(new window.ErrorEvent('error', { error: err, message: err.message }));
await new Promise((r) => setTimeout(r, 20));

const box = overlay();
chk('★ 出錯時畫面上真的出現一塊', !!box, '它自己壞掉的話，畫面一樣是白的，沒有任何跡象');

const text = box ? box.textContent.replace(/\s+/g, ' ') : '';
chk('說得出錯誤內容', /Boom: 模擬模組求值失敗/.test(text), text.slice(0, 60));
chk('★ 帶上建置編號', /版本 [0-9a-f]{8}/.test(text),
    '沒有版本就分不清是新 bug 還是舊快取 —— 而那兩者的處置完全不同');
chk('帶上瀏覽器 UA', /Mozilla/.test(text), '手機出問題時，是哪一支瀏覽器是第一個要問的');

// 只顯示一次：連續的錯誤會互相蓋掉，第一個才是根因
window.dispatchEvent(new window.ErrorEvent('error', {
  error: new window.Error('後續的連鎖錯誤'), message: 'x' }));
await new Promise((r) => setTimeout(r, 20));
const boxes = [...window.document.body.children].filter(
  (e) => e.tagName === 'DIV' && /position:fixed/.test(e.getAttribute('style') || ''));
chk('★ 只顯示第一個錯誤', boxes.length === 1,
    `出現 ${boxes.length} 塊 —— 連鎖錯誤會把根因擠掉`);

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
