// =====================================================================
// 學習卡片的實際渲染
//
//     node --import ./tests/_cdn-stub.mjs tests/card.test.mjs <pool.json>
//
// 【為什麼這支存在】
//   views/study.js 經資料層 import 到 CDN 上的 supabase-js，node 載不進來，
//   所以先前的測試全部避開了它 —— 而它正是學生 90% 時間在看的那張卡。
//   最重要的東西沒有測試，只因為它比較難載。
//
//   實際代價：188 張句子卡的備註都印著「對話 A｜刷牙｜」這種內部格式，
//   資料完全正確、API 驗證全綠，直到把卡片真的渲染出來看才發現。
//
//   _cdn-stub.mjs 用模組 hook 把 CDN 那一行換成本地替身，這個洞才補得起來。
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { SITE, SHARED, SITE_DIR, siteReady } from './_site.mjs';

const dom = new JSDOM(fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8'),
  { pretendToBeVisual: true, url: 'https://x.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
const LANG = await siteReady();

const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const study = await import(`${SHARED}/js/views/study.js`);
const { createSession } = await import(`${SHARED}/js/study/session.js`);

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const $ = (id) => document.getElementById(id);
const hidden = (id) => $(id).classList.contains('hidden');

const S = createSession({ save: async () => {}, onChange: (st) => study.render(st), onFinish: () => {} });
study.initStudy({
  session: S, getCtx: () => ({ pool: items }), onQuit: () => {},
  inRecallList: () => false, onToggleRecall: () => {},
});
const render = (item, direction = 'ko2zh') => {
  S.start([{ item, direction, card: null }], { mode: 'flip', kind: 'new' });
  study.reveal();
};

console.log(`【卡片渲染】（站台：${SITE}）`);
const word = items.find((x) => x.item_type === 'word' && !x.note);
render(word);
chk('單字卡：正面是目標語言、背面是中文',
  $('c-front').textContent === word.ko && $('c-back-text').textContent === word.zh);
chk('沒有備註時不顯示空白區塊', hidden('c-note'));

const dlg = items.find((x) => (x.note || '').startsWith('對話'));
if (dlg) {
  render(dlg);
  // ★ 這一條是這支測試存在的理由
  chk('★ 備註不含內部格式（對話 A｜情境｜）',
      !$('c-note').textContent.includes('｜'),
      '前兩段是給程式歸組用的中繼資料，不是給學生看的');
  chk('情境改成類型標籤的一部分',
      $('c-type').textContent.includes('·'),
      $('c-type').textContent);
}

const ruby = items.find((x) => /\[/.test(x.hanja || ''));
if (ruby) {
  render(ruby);
  chk('帶注音的句子渲染成 <ruby>', $('c-front').querySelectorAll('ruby').length > 0);
  chk('注音沒有洩漏方括號到畫面', !$('c-front').textContent.includes('['),
      '看到 [えき] 就是 ruby 沒生效，而那比沒有注音更難看');
  chk('注音不會再另開一行「漢字 …」', hidden('c-hanja'),
      '正面已經標好了，重複一次是噪音');
}

const kana = items.find((x) => (x.tags || []).includes('平假名') && x.note);
if (kana) {
  render(kana);
  chk('假名卡顯示口訣', !hidden('c-note') && $('c-note').textContent.length > 5);
  chk('口訣是多行（口訣＋字源）', $('c-note').textContent.includes('\n'));
}

// 反面：把注音清掉，ruby 就不該出現 —— 證明上面那條真的在測東西
if (ruby) {
  render({ ...ruby, hanja: '' });
  chk('反面樣本：沒有注音時不會憑空出現 ruby',
      $('c-front').querySelectorAll('ruby').length === 0);
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
