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
