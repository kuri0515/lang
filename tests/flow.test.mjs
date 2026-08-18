// =====================================================================
// 端到端：一整輪學習的完整動線
//
// 【為什麼要有】
//   既有的測試把每個模組驗得很細，但沒有一支從頭走到尾。
//   而今天出的問題全部長在動線上：
//     · 分頁列打開後離開，回不去（要有「繼續這一輪」）
//     · 🏠 與 ✕ 語意混在一起（一個保留、一個結束）
//     · 中斷續跑後達標次數變了
//   這些都不是單一函式的錯，是「接起來之後」才出現的。
//
// 【為什麼用真實的 index.html 與真實的模組】
//   替身能證明函式回傳什麼，證明不了「使用者點下去會發生什麼」。
//   這一支只做一件事：模擬一個人從開始學到結束，中間離開再回來。
//
//     用法：node --import ./tests/_cdn-stub.mjs tests/flow.test.mjs
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { SHARED, SITE, SITE_DIR, siteReady } from './_site.mjs';

const dom = new JSDOM(fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8'),
  { pretendToBeVisual: true, url: 'https://x.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
// jsdom 沒實作 scrollTo，而 router.show() 會呼叫它 ——
// 不補的話例外會把換頁流程中斷，看起來像「切不過去」，其實是環境問題。
dom.window.scrollTo = () => {};
const LANG = await siteReady();

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const $ = (id) => document.getElementById(id);
const visible = (id) => !$(id).classList.contains('hidden');

const study = await import(`${SHARED}/js/views/study.js`);
const { createSession } = await import(`${SHARED}/js/study/session.js`);
const { getMode } = await import(`${SHARED}/js/study/modes/index.js`);
const { RATING } = await import(`${SHARED}/js/core/srs.js`);
const { show, initTabs, setTabResume } = await import(`${SHARED}/js/views/router.js`);
const pool = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

console.log(`【一整輪的動線】（站台：${LANG.code}）`);

// 三個詞的一輪，用翻卡（每一站都有）
const OLD = { state: 'review', interval_days: 8, ease_factor: 2.5,
              repetitions: 4, lapses: 0 };
const entries = pool.filter((x) => x.item_type === 'word').slice(0, 3)
  .map((item) => ({ item, direction: 'ko2zh', card: { ...OLD } }));

let finished = 0;
const session = createSession({
  save: async () => {},
  onChange: (st) => study.render(st),
  onFinish: () => { finished += 1; },
});
study.initStudy({
  session, getCtx: () => ({ pool, modeId: 'flip' }),
  onQuit: () => show('view-done'),
  onPark: () => show('view-home'),
  inRecallList: () => false, onToggleRecall: () => {},
});
setTabResume(() => {
  const st = session.state();
  if (!(st.total > 0 && st.idx < st.total)) return false;
  show('view-study');
  study.render(st);
  return true;
});
initTabs();

session.start(entries, { mode: 'flip', kind: 'review',
                         criterion: getMode('flip').criterion });
await show('view-study');
study.render(session.state());

chk('開始後在學習畫面', visible('view-study'));
chk('★ 學習中分頁列看得到', visible('tabbar'),
    '續跑做好之後，離開不會弄丟進度 —— 沒有理由把人關在這一頁');

// ── 答一題，然後跑去查詞 ───────────────────────────────────
session.grade(RATING.GOOD);
const midway = session.state().idx;
chk('答一題後前進', midway === 1, `第 ${midway + 1} 題`);

$('tabbar').querySelector('[data-tab="view-browse"]').click();
await new Promise((r) => setTimeout(r, 0));
chk('切到詞庫', visible('view-browse'));
chk('這一輪沒有被結束', finished === 0, '離開不等於放棄 —— 結束要按 ✕');

// ── 點「首頁」要接回那一輪 ────────────────────────────────
$('tabbar').querySelector('[data-tab="view-home"]').click();
await new Promise((r) => setTimeout(r, 0));
chk('★ 點「首頁」回到學習畫面', visible('view-study'),
    '他離開是因為分心，回來時不該要求他想起自己在做什麼');
chk('回到離開前那一題', session.state().idx === midway,
    `第 ${session.state().idx + 1} 題（離開前是第 ${midway + 1} 題）`);

// ── 🏠 離開但保留；✕ 才是結束 ─────────────────────────────
$('btn-park').click();
await new Promise((r) => setTimeout(r, 0));
chk('🏠 離開到首頁', visible('view-home'));
chk('★ 🏠 不會結束這一輪', finished === 0,
    '一輪 30–80 題，只是想看一眼首頁不該付結束的代價');

$('tabbar').querySelector('[data-tab="view-home"]').click();
await new Promise((r) => setTimeout(r, 0));
chk('再點「首頁」又回到那一輪', visible('view-study'));

// ── 做完剩下的 ────────────────────────────────────────────
let n = 0;
while (n < 60 && !finished) { session.grade(RATING.GOOD); n += 1; }
chk(`答完會結束（再答 ${n} 題）`, finished === 1);

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
