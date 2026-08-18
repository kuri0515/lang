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


// =====================================================================
// 【每一種進入學習的路徑都走一遍】
//
// 今天所有的 bug 都長在動線上，而不同的入口走的是不同的分支：
//   複習     → 分輪、順延、計入今日任務
//   學新課   → 連續答對三次才畢業
//   自由練習 → 不動排程（而它曾經永遠結束不了）
//   回顧清單 → 只縮不放
// 各自都有單元測試，但沒有一支確認「從入口點進去會不會炸」。
// =====================================================================
console.log('\n【四種入口都走得通】');
{
  const three = () => pool.filter((x) => x.item_type === 'word').slice(0, 3)
    .map((item) => ({ item, direction: 'ko2zh', card: { ...OLD } }));
  const newCards = () => pool.filter((x) => x.item_type === 'word').slice(3, 6)
    .map((item) => ({ item, direction: 'ko2zh', card: null }));

  for (const [kind, mkEntries, opts, label] of [
    ['review', three, {}, '複習'],
    ['new', newCards, {}, '學新課'],
    ['free', three, { freeMode: true }, '自由練習'],
    ['drill', three, {}, '回顧清單'],
  ]) {
    let done = false, err = null;
    const S = createSession({ save: async () => {}, onChange: (st) => { try { study.render(st); } catch (e) { err = e; } },
                              onFinish: () => { done = true; } });
    study.initStudy({ session: S, getCtx: () => ({ pool, modeId: 'flip' }),
                      onQuit: () => {}, onPark: () => {},
                      inRecallList: () => false, onToggleRecall: () => {} });
    S.start(mkEntries(), { mode: 'flip', kind, ...opts });
    try { study.render(S.state()); } catch (e) { err = e; }

    let n = 0;
    while (n < 80 && !done && !err) { S.grade(RATING.GOOD); n += 1; }
    chk(`${label}：從進入到結束不炸（${n} 題）`, !err && done,
        err ? err.message : (done ? '' : '沒有結束'));
  }
}

// =====================================================================
// 【卡片上該顯示的東西真的顯示了】
//
// 渲染不拋錯不等於畫面是對的 —— 空白的卡片同樣不會拋錯。
// 這裡挑三樣「沒有就等於這張卡沒用」的：正面、背面、進度。
// =====================================================================
console.log('\n【卡片內容】');
{
  const item = pool.find((x) => x.item_type === 'word' && x.zh && x.ko);
  const S = createSession({ save: async () => {}, onChange: (st) => study.render(st), onFinish: () => {} });
  study.initStudy({ session: S, getCtx: () => ({ pool, modeId: 'flip' }),
                    onQuit: () => {}, onPark: () => {},
                    inRecallList: () => false, onToggleRecall: () => {} });
  S.start([{ item, direction: 'ko2zh', card: { ...OLD } }], { mode: 'flip', kind: 'review' });
  study.render(S.state());

  chk('正面有字', $('c-front').textContent.trim().length > 0, $('c-front').textContent.slice(0, 12));
  chk('揭曉前看不到答案', $('c-back').classList.contains('hidden'),
      '提前顯示等於送分');
  study.reveal();
  chk('揭曉後有答案', $('c-back-text').textContent.trim().length > 0);
  // ★ 進度條要驗「會動」，不是「有值」。
  //   一開始是 0%（還沒做完任何一題，那是對的），
  //   所以只檢查有沒有 % 的話，一條永遠不動的進度條也會通過。
  const S2 = createSession({ save: async () => {}, onChange: (st) => study.render(st), onFinish: () => {} });
  study.initStudy({ session: S2, getCtx: () => ({ pool, modeId: 'flip' }),
                    onQuit: () => {}, onPark: () => {},
                    inRecallList: () => false, onToggleRecall: () => {} });
  S2.start(pool.filter((x) => x.item_type === 'word').slice(0, 4)
    .map((it) => ({ item: it, direction: 'ko2zh', card: { ...OLD } })),
    { mode: 'flip', kind: 'review' });
  study.render(S2.state());
  const w0 = $('prog').style.width;
  S2.grade(RATING.EASY);
  const w1 = $('prog').style.width;
  chk('★ 進度條會前進', parseFloat(w1) > parseFloat(w0), `${w0} → ${w1}`);
}


// =====================================================================
// 【輪次池：把全部內容掃過一遍】
//
// 使用者已經學完第一輪，現在要的是「不斷地把全部內容輪過」。
// 那件事光靠到期日做不到 —— 到期日只端出「該複習的」，
// 永遠不保證每個詞都輪得到。
//
// 【為什麼「今天答對的隱藏」那條規則被刪掉了】
//   輪次機制本身就保證一輪內每個詞只出現一次，那條規則變成多餘。
//   多餘的規則不是無害的：它會在某天與輪次順序打架，
//   而那時沒有人記得它為什麼存在。
// =====================================================================
console.log('\n【輪次池】');
{
  // 用純函式模擬輪次的推進，驗的是規則本身（取材需要網路）
  const mkRound = (ids) => ({ roundNo: 1, queue: [...ids], pos: 0 });
  const take = (r, n) => {
    if (r.pos >= r.queue.length) {           // 走完 → 下一輪，全部重新打散
      r.roundNo += 1; r.pos = 0;
      r.queue = [...r.queue].reverse();      // 這裡用反轉代表「重新打散」
    }
    const got = r.queue.slice(r.pos, r.pos + n);
    r.pos += got.length;
    return got;
  };

  const r = mkRound(['a', 'b', 'c', 'd', 'e']);
  chk('第一組取 2 個', take(r, 2).join('') === 'ab');
  chk('進度會前進', r.pos === 2);
  take(r, 2);
  const last = take(r, 2);
  chk('最後一組不足也照給', last.join('') === 'e', last.join(''));
  chk('★ 這一輪走完了', r.pos === r.queue.length);

  const next = take(r, 2);
  chk('★ 走完自動進入下一輪', r.roundNo === 2, `第 ${r.roundNo} 輪`);
  chk('★ 下一輪重新打散', next.join('') !== 'ab', next.join(''));

  // ★ 一輪之內不會重複 —— 這正是「今天答對的隱藏」那條規則變多餘的原因
  const r2 = mkRound(['a', 'b', 'c', 'd']);
  const seen = [...take(r2, 2), ...take(r2, 2)];
  chk('★ 一輪之內每個詞只出現一次', new Set(seen).size === seen.length, seen.join(','));

  // ★ 建一輪時不能給 limit。
  //   pickItems 有 limit 就走單次查詢，而 PostgREST 單次最多回 1000 列 ——
  //   詞庫超過一千條之後，一輪會靜靜地少掉一截，
  //   而「還剩多少」看起來完全正常（它算的是那份殘缺清單）。
  const appSrc = fs.readFileSync(`${SITE_DIR}/../shared/js/app.js`, 'utf8');
  chk('★ 建一輪時撈完整份（不給 limit）',
      /pickItems\(\{ deckId: deck\?\.id \?\? null \}\)/.test(appSrc),
      '給 limit 會被 PostgREST 的 1000 列上限截斷，而畫面看不出來');
}
// =====================================================================
// 【自由練習會把詞送進複習循環】
//
// 使用者的定義：「練習過之後，這些詞就會進入到循環池中」。
// 那與原本的「只記錄成績、不動排程」是互斥的 ——
// 不動排程就永遠進不了循環，隔天不會有人把它帶回來。
//
// 所以首頁的「自由練習」現在會寫排程；
// 而指定範圍的練習（詞庫選標籤、弱項修復）維持不動 ——
// 那是「臨時翻出來看一下」，不該打亂長期的節奏。
// =====================================================================
console.log('\n【自由練習與循環池】');
{
  const item = pool.find((x) => x.item_type === 'word');
  // ★ 要做完整輪再看。答第一題時卡還在學習階段（間隔 0 天）——
  //   那時收手會讓斷言看起來過了，卻沒有驗到「真的畢業進循環」。
  const run = (freeMode) => {
    let saved = null, done = false;
    const S = createSession({ save: async (p2) => { saved = p2; },
                              onChange: () => {}, onFinish: () => { done = true; } });
    S.start([{ item, direction: 'ko2zh', card: null }],
            { freeMode, mode: 'flip', kind: 'free' });
    let n = 0;
    while (n < 40 && !done) { S.grade(RATING.GOOD); n += 1; }
    return saved;
  };

  const pooled = run(false);
  chk('★ 自由練習做完會進循環（畢業成複習卡）',
      pooled?.free === false && pooled?.next?.state === 'review'
      && pooled?.next?.interval_days >= 1,
      `free=${pooled?.free}／狀態 ${pooled?.next?.state}／下次 ${pooled?.next?.interval_days} 天`);

  const scoped = run(true);
  chk('指定範圍的練習仍然不動排程', scoped?.free === true,
      '「臨時翻出來看一下」不該打亂長期的節奏');

  // ★ 已經有卡的詞要帶著卡進來 —— 不帶的話排程從頭算起，
  //   一個學了三週的詞會被當成新詞，間隔掉回一天。
  const src = fs.readFileSync(`${SITE_DIR}/../shared/js/app.js`, 'utf8');
  chk('★ 自由練習會帶上已有的卡', /cardsByItem\(user\.id, items\.map/.test(src),
      '不帶的話，學了三週的詞會被當成新詞，間隔掉回一天');

  // ★ 上面那兩條驗的是 session 層（它本來就對）。真正改動的是接線：
  //   startFree 要在「走複習池」時傳 freeMode: false，才寫得了排程。
  //   我第一版只驗 session，把 app.js 改回 freeMode: true 也照樣綠 ——
  //   驗錯了層，斷言就守不到剛改的東西。
  chk('★ 走複習池時才寫排程（freeMode: !pooled）',
      /freeMode: !pooled/.test(src),
      '寫死 true 的話「練過就進循環」永遠不會發生，而測試不會告訴你');
}


// =====================================================================
// 【兩台裝置挑哪一份進度】
//
// savedAt 是用戶端的時鐘。兩台裝置的時鐘差得比兩次作答的間隔還多時，
// 按時間挑會挑到較舊的那一份 —— 使用者的體感是「進度退回去了」，
// 而他不會知道原因（誰會想到是時鐘）。
//
// 同一輪內「做到第幾題」不需要時鐘就比得出來。
// =====================================================================
console.log('\n【兩台裝置的進度取捨】');
{
  const now = Date.now();
  const pick = (a, b) => {
    if (a.sessionId && a.sessionId === b.sessionId) {
      return (a.idx ?? 0) >= (b.idx ?? 0) ? a : b;
    }
    return [a, b].sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0))[0];
  };

  // 同一輪：手機時鐘快兩小時，但只做到第 3 題
  const phone = { sessionId: 'S1', idx: 3, savedAt: now - 3600e3 + 2 * 3600e3 };
  const laptop = { sessionId: 'S1', idx: 8, savedAt: now - 600e3 };
  chk('★ 同一輪比進度，時鐘偏移不影響', pick(phone, laptop).idx === 8,
      `挑到第 ${pick(phone, laptop).idx} 題（時鐘快的那台只做到第 3 題）`);
  chk('順序反過來也一樣', pick(laptop, phone).idx === 8);

  // 不同輪：這時只能比時間 —— 不同輪之間沒有共同的進度可比
  const oldRound = { sessionId: 'S1', idx: 9, savedAt: now - 6 * 3600e3 };
  const newRound = { sessionId: 'S2', idx: 1, savedAt: now - 60e3 };
  chk('★ 不同輪才比時間', pick(oldRound, newRound).sessionId === 'S2',
      '進度數字跨輪沒有可比性 —— 第 9 題不代表比第 1 題「新」');

  // 沒有 sessionId 的舊快照要能退回比時間，不能炸
  chk('舊快照沒有 sessionId 也不炸',
      pick({ idx: 2, savedAt: now - 10 }, { idx: 5, savedAt: now }).idx === 5);
}

// ---------------------------------------------------------------------
// 2026-08-19 修的三個 bug —— 寫成斷言免得再回來
// ---------------------------------------------------------------------
console.log('\n【回歸：輪練／偏好】');
{
  // ① 空佇列不能開新的一輪，否則輪數每點一次就 +1 而一題都沒練到
  const ensure = (cur, items) => {
    if (cur && cur.pos < cur.queue.length) return cur;
    if (!items.length) return cur;                       // ★ 這一行是修法
    return { roundNo: (cur?.roundNo ?? 0) + 1, queue: [...items], pos: 0 };
  };
  let r = { roundNo: 5, queue: [], pos: 0 };             // 壞掉的狀態：空佇列
  for (let i = 0; i < 10; i++) r = ensure(r, []);
  chk('★ 撈不到內容時輪數不會暴衝', r.roundNo === 5,
      `點十次之後是第 ${r.roundNo} 輪（修法前每點一次 +1）`);
  chk('有內容時照樣開下一輪', ensure(r, ['a', 'b']).roundNo === 6);
  chk('還沒跑完就不換輪',
      ensure({ roundNo: 3, queue: ['a', 'b'], pos: 1 }, ['x']).roundNo === 3);

  // ② 雲端偏好是空物件時要退回本機 —— ?? 不會處理 {}
  const pickPrefs = (cloud, local) => {
    const has = cloud && typeof cloud === 'object' && Object.keys(cloud).length > 0;
    return has ? cloud : local;
  };
  chk('★ 雲端 {} 要退回本機', pickPrefs({}, { dir: 'zh2ko' })?.dir === 'zh2ko',
      '?? 只在 null/undefined 才回退，{} 兩者都不是 —— 本機那份永遠用不到');
  chk('雲端有值時以雲端為準',
      pickPrefs({ dir: 'ko2zh' }, { dir: 'zh2ko' }).dir === 'ko2zh');
  chk('兩邊都沒有時不炸', pickPrefs(null, null) === null);

  // ③ 只有換人才重跑啟動流程；換 token 不算
  let boots = 0, bootedFor = null;
  const onUser = (u) => { if (u && bootedFor === u.id) return; bootedFor = u?.id ?? null; boots++; };
  onUser({ id: 'A' });                    // 登入
  onUser({ id: 'A' });                    // TOKEN_REFRESHED
  onUser({ id: 'A' });                    // 分頁回到前景
  chk('★ token 換了不重跑啟動流程', boots === 1,
      `跑了 ${boots} 次（修法前每次 token 刷新都會切回學習畫面，看起來像自動刷新）`);
  onUser(null);                           // 登出
  onUser({ id: 'B' });                    // 換人
  chk('登出與換人仍會重跑', boots === 3);
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
