// =====================================================================
// SRS 引擎 —— SM-2 变体
//
// 纯函数：输入卡片状态 + 评分，输出新状态。不碰 DOM、不碰网络。
// 这样换算法（未来上 FSRS）只需替换本文件，UI 与数据层零改动。
// =====================================================================

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

// 学习阶段的分钟级步长（新卡在毕业前反复出现）
const LEARNING_STEPS_MIN = [1, 10];
const GRADUATING_INTERVAL_DAYS = 1;
const EASY_INTERVAL_DAYS = 4;
const MIN_EASE = 1.3;

const DAY_MS = 86400000;

/**
 * @param {object} card  { state, interval_days, ease_factor, repetitions, lapses }
 * @param {number} rating 1..4
 * @param {Date}   now
 * @returns {object} 新的卡片字段（可直接 upsert 进 user_cards）
 */
export function schedule(card, rating, now = new Date()) {
  let {
    state = 'new',
    interval_days: interval = 0,
    ease_factor: ease = 2.5,
    repetitions = 0,
    lapses = 0,
  } = card || {};

  ease = Number(ease);
  interval = Number(interval);

  if (state === 'new' || state === 'learning') {
    if (rating === RATING.AGAIN) {
      // 打回学习步骤第一步
      repetitions = 0;
      return commit('learning', minutes(LEARNING_STEPS_MIN[0]));
    }
    if (rating === RATING.EASY) {
      repetitions += 1;
      interval = EASY_INTERVAL_DAYS;
      return commit('review', days(interval));
    }
    // HARD / GOOD：沿学习步骤前进
    repetitions += 1;
    if (repetitions < LEARNING_STEPS_MIN.length) {
      return commit('learning', minutes(LEARNING_STEPS_MIN[repetitions]));
    }
    // 毕业
    interval = GRADUATING_INTERVAL_DAYS;
    return commit('review', days(interval));
  }

  // ---- state === 'review' ----
  if (rating === RATING.AGAIN) {
    lapses += 1;
    repetitions = 0;
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = 0;
    return commit('learning', minutes(LEARNING_STEPS_MIN[0]));
  }

  repetitions += 1;
  if (rating === RATING.HARD) {
    ease = Math.max(MIN_EASE, ease - 0.15);
    interval = Math.max(1, interval * 1.2);
  } else if (rating === RATING.GOOD) {
    interval = Math.max(1, interval * ease);
  } else {
    // EASY
    ease = ease + 0.15;
    interval = Math.max(1, interval * ease * 1.3);
  }
  interval = Math.round(interval * 100) / 100;
  return commit('review', days(interval));

  // -------------------------------------------------------------------
  function commit(newState, dueMs) {
    return {
      state: newState,
      due_at: new Date(now.getTime() + dueMs).toISOString(),
      interval_days: newState === 'learning' ? 0 : interval,
      ease_factor: Math.round(ease * 1000) / 1000,
      repetitions,
      lapses,
      last_reviewed_at: now.toISOString(),
    };
  }
  function minutes(m) { return m * 60000; }
  function days(d) { return d * DAY_MS; }
}

/** 给按钮显示"下次多久后再见" */
export function previewIntervals(card, now = new Date()) {
  const out = {};
  for (const [name, r] of Object.entries(RATING)) {
    const next = schedule(card, r, now);
    out[r] = humanize(new Date(next.due_at) - now);
  }
  return out;
}

export function humanize(ms) {
  const min = ms / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))} 分钟`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)} 小时`;
  const d = hr / 24;
  if (d < 30) return `${Math.round(d)} 天`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)} 个月`;
  return `${(mo / 12).toFixed(1)} 年`;
}

/**
 * 手動回顧的排程規則：**只縮不放**。
 *
 * 【為什麼不能直接沿用正規複習的算法】
 *   回顧是使用者自己挑出來多練的，發生在排程之外。
 *   若答得好就照正規算法把間隔乘上去，等於「臨時多背幾遍」就把
 *   下次複習日推遠 —— 那正好破壞間隔重複的節奏，
 *   而且是往「看起來更熟、實際更容易忘」的方向壞。
 *
 * 【為什麼答不好時要縮】
 *   答不好是真的訊號：這個詞比排程以為的更脆弱。
 *   忽略它等於明知會忘還讓它照原定日期躺著。
 *
 * 所以規則是不對稱的：
 *   記得／很簡單 → 完全不動排程（回傳 null，呼叫端只記錄答題）
 *   忘了         → 照正規的遺忘處理（回學習步驟、ease 下修）——
 *                  真的忘了就是忘了，隱瞞它沒有意義
 *   有點難       → 把下次到期日拉近，但不算遺忘、不動 ease；
 *                  它只是「比我以為的更需要再看一眼」
 *
 * @returns {object|null} 要寫回卡片的欄位；null 表示不動排程
 */
export function scheduleRecall(card, rating, now = new Date()) {
  if (rating >= RATING.GOOD) return null;            // 答得好 → 一動不如一靜

  if (rating === RATING.AGAIN) return schedule(card, rating, now);

  // ---- HARD：拉近，但不懲罰 ----
  const interval = Number(card?.interval_days ?? 0);
  const due = card?.due_at ? new Date(card.due_at) : null;
  if (card?.state !== 'review' || !(interval > 0)) return null;  // 還在學習階段，本來就很快回來

  const shorter = Math.max(1, Math.round(interval * 0.5 * 100) / 100);
  const nextDue = new Date(now.getTime() + shorter * DAY_MS);

  // ★ 只縮不放：算出來比原訂日期還晚就不動。
  //   缺了這一條，一張間隔很短的卡在回顧時按「有點難」，
  //   反而會被推到更遠 —— 與這個函式的用意完全相反。
  if (due && nextDue >= due) return null;

  return {
    state: 'review',
    due_at: nextDue.toISOString(),
    interval_days: shorter,
    ease_factor: Number(card.ease_factor ?? 2.5),   // 不動：這不是遺忘
    repetitions: Number(card.repetitions ?? 0),
    lapses: Number(card.lapses ?? 0),
    last_reviewed_at: now.toISOString(),
  };
}
