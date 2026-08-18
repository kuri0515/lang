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
/**
 * @param opts.forceGraduate 這一輪已經連續答對達標了，不要再留在學習步驟。
 *
 *   學習步驟（1 分鐘、10 分鐘）原本自己決定何時畢業。
 *   但現在畢業的判準是「一輪之內連續答對三次」，
 *   兩套判準併存會互相打架：達標了卻還卡在第二步，
 *   那張卡會永遠排回隊尾，一輪永遠結束不了。
 *
 *   不用「把 repetitions 塞成 99」那種做法 —— 那個假數字會寫進資料庫，
 *   之後任何讀 repetitions 的地方都拿到錯的值，而且看不出來是誰塞的。
 */
export function schedule(card, rating, now = new Date(), opts = {}) {
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
    if (!opts.forceGraduate && repetitions < LEARNING_STEPS_MIN.length) {
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

/**
 * 難度分：越高，下一輪越該先複習。
 *
 * 【為什麼需要它 —— 只照 due_at 排會把最該練的排到最後】
 *   答錯的卡會被排進學習階段，due_at 設成一分鐘後。
 *   而佇列照 due_at 由舊到新排，所以「一分鐘後」比所有逾期的卡都新 ——
 *   剛答錯的那張，反而排到整個佇列的最後面。
 *   使用者往往只做前面幾輪，等於最該練的那些永遠輪不到。
 *   這個錯誤不會報錯，畫面上也看不出來，只會讓難的詞一直難。
 *
 * 【三個訊號，由重到輕】
 *   state==='learning'  剛剛才答錯，還沒畢業 —— 最該馬上再見到
 *   lapses              曾經忘掉幾次 —— 忘過的比沒忘過的更容易再忘
 *   ease_factor         一直覺得難的（2.5 是預設，越低表示越常按「有點難」）
 *
 *   ease_factor 已經不參與排程（費氏階梯不乘係數），但它仍在記錄難度，
 *   拿來排序正好 —— 資料已經有了，不必新增欄位。
 */
export function difficultyScore(card) {
  if (!card) return 0;
  const ease = Number(card.ease_factor ?? 2.5);
  return (card.state === 'learning' ? 100 : 0)
    + (Number(card.lapses) || 0) * 10
    + Math.round((2.5 - ease) * 4);
}

/**
 * 一輪之內要連續答對幾次才算學會。
 *
 * 【為什麼是「答對」而不是「完全記住」】
 *   嚴格只認「很簡單」的話，誠實按「記得」的人進度永遠不前進 ——
 *   他可以按二十次「記得」而那個詞畢不了業。
 *   「記得」與「很簡單」都算數，「有點難」與「忘了」歸零重來。
 *
 * 【為什麼只用在學新課，不用在複習】
 *   複習卡在一輪內被評分三次，費氏階梯會爬三階：1 天 → 3 → 8 → 21。
 *   而那三次評分只隔五分鐘 —— 那不是三次成功回憶，是同一次。
 *   把它當三次會讓間隔嚴重灌水，而灌水的後果要三週後才看得到。
 */
export const ROUND_CRITERION = 3;
