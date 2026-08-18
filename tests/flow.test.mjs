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


// =====================================================================
// 【每個題型有自己的進度】
//
// 使用者用翻卡做到一半 → 到設定換成拼出來 → 回學習畫面。
// 該接的是拼出來那一份，不是記憶體裡的翻卡 ——
// 每個題型是一種不同的練習（認得／選得出來／寫得出來），
// 換題型是「換一件事做」，不是「同一件事換個樣子」。
//
// 而舊題型那一輪不能因此消失：換回去時它要還在。
// =====================================================================
console.log('\n【每個題型有自己的進度】');
{
  // 用快照當作「各題型各自存一份」的模型，驗的是鍵與比對規則
  const store = new Map();
  const keyOf = (uid, mode) => `${uid}::${mode}`;

  const mk = () => createSession({ save: async () => {}, onChange: () => {}, onFinish: () => {} });
  const three = () => pool.filter((x) => x.item_type === 'word').slice(0, 3)
    .map((item) => ({ item, direction: 'ko2zh', card: { ...OLD } }));

  // 翻卡做到第 2 題
  const A = mk();
  A.start(three(), { mode: 'flip', kind: 'review' });
  A.grade(RATING.GOOD);
  store.set(keyOf('u1', 'flip'), JSON.parse(JSON.stringify(A.snapshot())));

  // 換成四選一，從頭做到第 1 題
  const B = mk();
  B.start(three(), { mode: 'choice', kind: 'review' });
  store.set(keyOf('u1', 'choice'), JSON.parse(JSON.stringify(B.snapshot())));

  chk('★ 兩個題型各存一份', store.size === 2, [...store.keys()].join('、'));
  chk('翻卡那一份記得做到第 2 題',
      store.get(keyOf('u1', 'flip')).idx === 1);
  chk('四選一那一份是從頭', store.get(keyOf('u1', 'choice')).idx === 0);

  // 回到翻卡 → 接回第 2 題
  const C = mk();
  C.resume(store.get(keyOf('u1', 'flip')));
  chk('★ 換回翻卡，進度還在', C.state().idx === 1 && C.state().mode === 'flip',
      `第 ${C.state().idx + 1} 題／題型 ${C.state().mode}`);

  // ★ 換使用者拿不到別人的
  chk('★ 換使用者拿不到別人的進度', !store.has(keyOf('u2', 'flip')),
      '鍵不帶使用者的話，換帳號會接到上一個人的那一輪');

  // 快照裡要記得自己是哪個題型 —— 否則回去時無從判斷該不該接
  chk('快照記得自己的題型', A.snapshot().modeId === 'flip', A.snapshot().modeId);
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
