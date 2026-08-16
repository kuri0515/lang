// =====================================================================
// 學習統計的純函式
// 放在 core 是因為首頁與記錄頁都要用 —— 兩份實作會各自漂移。
// =====================================================================

/**
 * 連續學習天數。
 *
 * ★ 今天還沒開始不算斷。
 *   一早打開就看到「連續 0 天」會讓人洩氣，但實際上只是還沒開始，
 *   昨天以前的連續紀錄仍然成立。斷與否只看昨天以前。
 *
 * @param {{n:number}[]} daily  由舊到新的每日答題量
 * @returns {{days:number, startedToday:boolean}}
 */
export function computeStreak(daily) {
  if (!daily?.length) return { days: 0, startedToday: false };
  const startedToday = daily[daily.length - 1].n > 0;
  let days = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].n > 0) { days++; continue; }
    if (i === daily.length - 1 && !startedToday) continue;   // 今天尚未開始，不算斷
    break;
  }
  return { days, startedToday };
}

/** 近 N 天總覽 */
export function summarize(daily) {
  const total = daily.reduce((s, d) => s + d.n, 0);
  const correct = daily.reduce((s, d) => s + d.correct, 0);
  return {
    total,
    correct,
    activeDays: daily.filter((d) => d.n > 0).length,
    accuracy: total ? correct / total : null,
    ...computeStreak(daily),
  };
}

/**
 * 學習階段漏斗：未開始 → 學習中 → 複習中 → 已掌握
 *
 * 從學習者視角，最想先知道的是「我到哪了」——
 * 總共多少詞、走到哪一階段、離掌握還有多遠。
 * 這比任何單項數字都更能回答那個問題。
 */
export function funnel(words, notStartedCount) {
  const mastered = words.filter((w) => w.mastered).length;
  const review = words.filter((w) => w.state === 'review' && !w.mastered).length;
  const learning = words.filter((w) => ['learning', 'new'].includes(w.state)).length;
  const started = words.length;
  const total = started + notStartedCount;
  return {
    total, started, mastered, review, learning, notStarted: notStartedCount,
    startedPct: total ? started / total : 0,
    masteredPct: total ? mastered / total : 0,
  };
}

/**
 * 兩個方向分開統計。
 * 「看韓文想中文」與「看中文想韓文」是兩種能力，難度差很多，
 * 混在一起看會把真正的弱項藏起來。
 */
export function byDirection(rows) {
  const out = {};
  for (const dir of ['ko2zh', 'zh2ko']) {
    const ds = rows.filter((r) => r.direction === dir);
    const total = ds.reduce((s, d) => s + d.total_reviews, 0);
    const correct = ds.reduce((s, d) => s + d.correct_reviews, 0);
    out[dir] = {
      cards: ds.length, total, correct,
      accuracy: total ? correct / total : null,
      mastered: ds.filter((d) => d.mastered).length,
    };
  }
  return out;
}
