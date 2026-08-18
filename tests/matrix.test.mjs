// =====================================================================
// 組合矩陣：輪次 × 題型 × 卡片狀態
//
// 【為什麼要有這一支】
//   2026-08-18 一天之內出了四個同型的問題，全部是「兩邊各自正確、
//   接起來錯了」，而且全部不報錯：
//     · 新題型 × 資料庫 enum        → 答的每一題都寫不進去
//     · baseCard × 自由練習          → 那一輪永遠結束不了
//     · 續跑 × 達標次數              → 重新整理後規則悄悄變了
//     · 今日任務 × 回顧清單          → 練自選的詞也算進今日複習
//
//   四個都不是靠讀程式碼發現的，是把每一種組合實際跑一遍才現形。
//   既有的測試在各模組內部很密，交界處很薄 —— 而 bug 都長在交界。
//
// 【為什麼是不變量而不是逐格的預期值】
//   逐格寫預期值要維護 N×M×K 個數字，改一個規則就要改一片，
//   最後沒有人敢動。這裡只問四件「無論哪一格都必須成立」的事：
//     ① 會結束        —— 出不去的話，排程算得再準也沒有意義
//     ② 遺忘不被抹掉  —— 先答錯再連對，那次想不起來仍要算數
//     ③ 掌握數對得上  —— 自由練習不產生掌握數
//     ④ 續跑後一致    —— 中斷再回來，要答的題數不能變
//
//   ★ 四條都造壞樣本證明過會紅。原本還有一條「間隔不灌水」，
//     但把三層防護全拿掉它都不會紅（拿掉重排之後一題就結束，
//     根本沒有第二次評分）—— 不可證偽的檢查是裝飾，已刪除。
//
//     用法：node tests/matrix.test.mjs（SITE=japanese 換站台）
// =====================================================================
import { SHARED, siteReady } from './_site.mjs';

const LANG = await siteReady();
const { createSession } = await import(`${SHARED}/js/study/session.js`);
const { MODES, getMode } = await import(`${SHARED}/js/study/modes/index.js`);
const { RATING, ROUND_CRITERION } = await import(`${SHARED}/js/core/srs.js`);

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

const NEW = null;
const OLD = { state: 'review', interval_days: 8, ease_factor: 2.5,
              repetitions: 4, lapses: 0 };
const LAPSED = { state: 'learning', interval_days: 0, ease_factor: 2.2,
                 repetitions: 0, lapses: 3 };

const KINDS = [
  { kind: 'review', label: '複習', counts: true },
  { kind: 'new', label: '學新課', counts: false },
  { kind: 'drill', label: '回顧清單', counts: false },
  { kind: 'free', label: '自由練習', counts: false, freeMode: true },
];
const CARDS = [[NEW, '全新'], [OLD, '學過(8天)'], [LAPSED, '重學中']];

/** 跑一輪到結束（或放棄），回傳觀察到的東西 */
function run({ kind, freeMode }, card, modeId, rating, { resumeAt = 0 } = {}) {
  const criterion = getMode(modeId).criterion ?? ROUND_CRITERION;
  let stats = null, last = null;
  const mk = () => createSession({
    save: async (p) => { last = p; },
    onChange: () => {}, onFinish: (s) => { stats = s; },
  });
  let S = mk();
  S.start([{ item: { id: 'x', ko: 'あ', zh: 'a' }, direction: 'zh2ko',
             card: card && { ...card } }],
          { mode: modeId, kind, freeMode, criterion });

  let n = 0;
  while (n < 80 && !stats) {
    S.grade(rating);
    n += 1;
    // 中途模擬「重新整理」：拍快照、換一個全新的 session 接回去
    if (resumeAt && n === resumeAt && !stats) {
      const snap = JSON.parse(JSON.stringify(S.snapshot()));
      S = mk();
      if (!S.resume(snap)) return { ended: false, n, why: '續跑被拒絕' };
    }
  }
  return { ended: !!stats, n, stats, last };
}

console.log(`【組合矩陣】（站台：${LANG.code}，${KINDS.length} 種輪次 × `
  + `${MODES.length} 種題型 × ${CARDS.length} 種卡片狀態）`);

// ── ① 每一格都要結束得了 ───────────────────────────────────
{
  const stuck = [];
  for (const k of KINDS) {
    for (const m of MODES) {
      for (const [card, cl] of CARDS) {
        for (const [r, rl] of [[RATING.GOOD, '記得'], [RATING.EASY, '很簡單']]) {
          const out = run(k, card, m.id, r);
          if (!out.ended) stuck.push(`${k.label}/${m.label}/${cl}/${rl}`);
        }
      }
    }
  }
  chk(`每一格都結束得了（${KINDS.length * MODES.length * CARDS.length * 2} 格）`,
    stuck.length === 0, stuck.length ? stuck.slice(0, 4).join('、') : '出不去的話，排程算得再準也沒有意義');
}

// ── ② 先答錯、之後連對，那次遺忘不能被抹掉 ──────────────────
//
// 【為什麼換掉原本想寫的「間隔不灌水」】
//   我原本寫的是「8 天按很簡單應得 21 天，不該爬到 55/89」。
//   但那一條不可證偽：把三層防護（baseCard、未達標強制留在學習階段、
//   用第一次評分排程）逐一甚至全部拿掉，它都不會紅 ——
//   因為拿掉重排之後，那一輪一題就結束了，根本沒有第二次評分。
//   不可證偽的檢查是裝飾：它永遠綠，而綠不代表守住了什麼。
//
// 換成這一條，因為我實際證明過它會紅：
//   把排程從「第一次評分」改回「最後一次評分」，
//   忘了一張 8 天的卡再連對三次會得到 13 天、lapses=0 ——
//   跟從來沒忘過一模一樣，而那個詞會被排到 13 天後複習。
{
  const erased = [];
  for (const k of KINDS.filter((x) => x.kind === 'review' || x.kind === 'new')) {
    for (const m of MODES) {
      // 第一次答錯，之後一路答對
      let stats = null, last = null, n = 0;
      const S = createSession({ save: async (p) => { last = p; },
                                onChange: () => {}, onFinish: (s) => { stats = s; } });
      S.start([{ item: { id: 'x', ko: 'あ', zh: 'a' }, direction: 'zh2ko', card: { ...OLD } }],
              { mode: m.id, kind: k.kind,
                criterion: getMode(m.id).criterion ?? ROUND_CRITERION });
      S.grade(RATING.AGAIN);
      while (n < 80 && !stats) { S.grade(RATING.GOOD); n += 1; }
      const lapses = last?.next?.lapses ?? 0;
      const iv = last?.next?.interval_days;
      if (lapses < 1 || iv > 8) erased.push(`${k.label}/${m.label} → ${iv} 天、lapses=${lapses}`);
    }
  }
  chk('先答錯再連對，遺忘仍被記錄', erased.length === 0,
    erased.slice(0, 3).join('、')
    || '後面的操練不該把「當時想不起來」抵銷掉 —— 第一次作答才是測驗');
}

// ── ③ 只有正規複習算進今日任務 ─────────────────────────────
{
  const wrong = [];
  for (const k of KINDS) {
    for (const m of MODES) {
      const out = run(k, OLD, m.id, RATING.GOOD);
      const got = out.stats?.mastered ?? 0;
      // free 連 mastered 都不該累加；其餘輪次會累加，但只有 review 該計入今日任務
      if (k.kind === 'free' && got > 0) wrong.push(`${k.label}/${m.label} 的 mastered=${got}`);
      if (k.kind !== 'free' && got === 0) wrong.push(`${k.label}/${m.label} 的 mastered=0`);
    }
  }
  chk('自由練習不產生掌握數，其餘輪次會', wrong.length === 0, wrong.slice(0, 3).join('、')
    || '「哪一種算進今日任務」由 home.addMasteredToday 決定，那裡另有斷言');
}

// ── ④ 中途重新整理，結果不變 ───────────────────────────────
{
  const drift = [];
  for (const k of KINDS) {
    for (const m of MODES) {
      const plain = run(k, OLD, m.id, RATING.GOOD);
      const cut = run(k, OLD, m.id, RATING.GOOD, { resumeAt: 1 });
      if (!cut.ended) { drift.push(`${k.label}/${m.label} 續跑後出不去`); continue; }
      if (plain.n !== cut.n) {
        drift.push(`${k.label}/${m.label} 需要的題數 ${plain.n} → ${cut.n}`);
      }
    }
  }
  chk('中途重新整理，這一輪要答的題數不變', drift.length === 0,
    drift.slice(0, 3).join('、') || '不一樣的話，表示有狀態沒有存進快照');
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
