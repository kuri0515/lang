// =====================================================================
// SRS 引擎 —— SM-2 变体
//
// 纯函数：输入卡片状态 + 评分，输出新状态。不碰 DOM、不碰网络。
// 这样换算法（未来上 FSRS）只需替换本文件，UI 与数据层零改动。
// =====================================================================

export const RATING = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

// 学习阶段的分钟级步长（新卡在毕业前反复出现）
const LEARNING_STEPS_MIN = [1, 10];
const MIN_EASE = 1.3;

/**
 * 複習階梯 —— 費氏數列，單位是天。
 *
 * 【為什麼是固定階梯而不是乘一個係數】
 *   乘係數（interval × ease）的問題是它會複利：ease 稍微高一點，
 *   幾次之後就跑到幾百天、甚至幾年，而那個數字沒有任何現實意義 ——
 *   沒有人能預測「九年後還記不記得」。
 *   固定階梯的每一階都是真實可解釋的時間，也不會失控。
 *
 * 【為什麼是費氏】
 *   成長比趨近 1.618，比常見的 2.5 保守 —— 對全新的文字系統，
 *   前兩週多看幾次遠比省下幾次划算。
 *   而且 1、2、3、5、8、13 是人講得出口的節奏
 *   （明天、後天、大後天、五天後、一週多、兩週），
 *   學習者能預期自己什麼時候會再見到它，這件事本身會提高持續率。
 *
 * 【為什麼停在 89 而不繼續往上】
 *   89 天≈三個月，是一個詞進入長期記憶後的維護週期。
 *   再往外推（144、233…）就變成「幾乎不再出現」，
 *   那和刪掉它沒有差別，卻讓人以為自己還記得。
 *   到頂之後就固定每三個月見一次，這是維護不是學習。
 */
const LADDER = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const TOP = LADDER.length - 1;

/** 目前的間隔落在第幾階（取「不超過它」的最高階，舊資料的 2.5 天也對得上）*/
function rungOf(interval) {
  let i = 0;
  while (i < TOP && LADDER[i + 1] <= interval) i++;
  return i;
}
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
      // 一看就會 → 直接跳到第三階（3 天），不必從 1 天爬
      repetitions += 1;
      interval = LADDER[2];
      return commit('review', days(interval));
    }
    // HARD / GOOD：沿学习步骤前进
    repetitions += 1;
    if (repetitions < LEARNING_STEPS_MIN.length) {
      return commit('learning', minutes(LEARNING_STEPS_MIN[repetitions]));
    }
    // 毕业 → 階梯第一階
    interval = LADDER[0];
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

  // ★ 用評分決定「爬幾階」，不是乘一個係數。
  //   很簡單 → +2 階（本來就會的不必一階一階爬）
  //   記得   → +1 階
  //   有點難 → 原地（同樣的間隔再來一次）
  //
  //   「有點難」原地而不是退階：退階會讓一張詞在 3→2→3→2 之間來回，
  //   永遠畢不了業。原地的意思是「你還沒準備好前進，但也沒退步」。
  const step = rating === RATING.EASY ? 2 : rating === RATING.GOOD ? 1 : 0;
  interval = LADDER[Math.min(TOP, rungOf(interval) + step)];

  // ease 已經不參與排程計算（階梯是固定的）。仍然更新它，
  // 因為 reviews.prev_ease_factor 是歷史資料的一部分，
  // 而且它是一個誠實的難度訊號：日後要換 FSRS 之類的演算法時用得上。
  if (rating === RATING.HARD) ease = Math.max(MIN_EASE, ease - 0.15);
  else if (rating === RATING.EASY) ease += 0.15;

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
