// =====================================================================
// 學習會話引擎 —— 佇列、評分、撤銷、前後導覽、延遲寫入
//
// 【設計】
//   本模組完全不碰 DOM，也不認識任何畫面。它只管：
//     「現在該出哪一題」「這題答完之後佇列變成什麼樣」「什麼時候寫庫」
//   畫面透過 onChange 回呼被通知去重畫。
//
//   這樣做的好處是這段最容易出錯的邏輯（撤銷、回看不重複計分、
//   延遲寫入的競態）可以被單獨測試，不需要瀏覽器。
// =====================================================================
import { schedule, RATING, ROUND_CRITERION } from '../core/srs.js';

// 評分後延遲多久才寫庫。這段時間內可完整撤銷。
// 為什麼延遲而非「寫了再刪」：reviews 是只追加日誌，RLS 沒開 delete，
// 誤點若已落庫就洗不掉，會永久污染正確率。
export const UNDO_MS = 2500;

/**
 * 一輪的題數。
 *
 * 【為什麼要分輪】
 *   模擬每天學 8 條的學習者：第 82 天要複習 75 條（正確率 85%），
 *   70% 的話 87 條。排程沒有壞（沒有尖峰，是穩定成長），
 *   但一輪 87 題會讓人今天不想打開 App，而排程再好也救不了沒打開的那天。
 *
 * 【為什麼是 10】
 *   一開始定 20，使用者說 10 就好。這個數字沒有理論最佳解，
 *   只有「會不會想打開」，那要問真的在用的人。
 *
 * 【★ 這是 10 個「詞」，不是 10 道「題」】
 *   加上「連續答對三次才算掌握」之後，一輪實際要答的題數是：
 *     正確率 100% → 30 題（約 3 分鐘）
 *     正確率  80% → 47 題（約 5 分鐘）
 *     正確率  60% → 85 題（約 8 分鐘）
 *   畫面文案一律寫「個詞」——寫「題」會讓人以為十下就結束，
 *   做到第三十下還沒完會覺得這個 App 在騙人。
 *
 * 【為什麼放在這裡而不是各檔各寫一個 20】
 *   這個數字原本散在三個檔案：app.js 的常數、首頁的提示文字、
 *   結束畫面的註解。改一處漏兩處是遲早的事，
 *   而漏掉的那處不會報錯 —— 只會讓畫面上寫著「一輪 20 題」、實際做 10 題。
 */
export const ROUND_SIZE = 10;

export function createSession({ save, onChange, onFinish, onError }) {
  // 這一輪達到「連續答對三次」的條目 id。用 Set 而不是計數 ——
  // 同一張卡達標後若又被排回（不會，但防呆），不該重複計入。
  const mastered = new Set();
  let criterion = ROUND_CRITERION;
  let queue = [];
  let idx = 0;
  let free = false;              // 自由練習：只記錄不動排程
  let stats = { n: 0, correct: 0 };
  const graded = new Set();      // 已作答過的佇列位置（回看時不可重複計分）
  let pending = null;            // { payload, snapshot, timer }
  let shownAt = 0;
  let sessionId = null;          // 同一輪共用，讓「一次學習」成為可查詢的單位
  let modeId = 'flip';
  let activity = 'review';   // new | review | free | drill

  const state = () => ({
    sessionId, mode: modeId, activity,
    entry: queue[idx] ?? null,
    idx, total: queue.length, free, stats,
    isGraded: graded.has(idx),
    canUndo: !!pending,
    canPrev: idx > 0,
    canNext: idx < queue.length - 1,
  });

  const notify = () => onChange?.(state());

  function flush(write = true) {
    if (!pending) return;
    const { timer, payload } = pending;
    clearTimeout(timer);
    pending = null;
    if (write) Promise.resolve(save(payload)).catch((e) => onError?.(e));
  }

  return {
    state,
    get queue() { return queue; },

    /** 開始一輪。entries: [{item, direction, card}] */
    /**
     * @param criterion 一輪之內要連續答對幾次才算掌握。
     *
     *   由呼叫端傳進來，不從題型註冊表查 —— session 是底層，
     *   而 modes/index.js 在模組求值時就會呼叫 lang()，
     *   從這裡 import 它會讓「還沒 setLang 就載入 session」的情境直接炸掉
     *   （測試就是這樣紅的）。層次顛倒的代價往往不是設計不美，是載入順序陷阱。
     */
    start(entries, { freeMode = false, mode = 'flip', kind = 'review',
                     criterion: crit = ROUND_CRITERION } = {}) {
      flush();
      queue = entries;
      idx = 0;
      free = freeMode;
      modeId = mode;
      activity = kind;
      criterion = crit;
      sessionId = (globalThis.crypto?.randomUUID?.()) || null;
      stats = { n: 0, correct: 0, mastered: 0 };
      mastered.clear();
      graded.clear();
      shownAt = Date.now();
      notify();
    },

    /** 依題型過濾佇列（例如詞序重組需要可拆的條目） */
    filter(pred) {
      const before = queue.length;
      queue = queue.filter(pred);
      idx = 0;
      return { kept: queue.length, dropped: before - queue.length };
    },

    markShown() { shownAt = Date.now(); },

    grade(rating) {
      if (graded.has(idx)) return;      // 回看模式不重複計分
      flush();                          // 上一題定案，只有最近一題可撤銷

      const entry = queue[idx];
      if (!entry) return;
      // ★ 一律從「進這一輪時的卡況」重算，不從上一次的結果累積。
      //
      //   同一張卡在一輪內會被評分多次（要連續答對三次才算過）。
      //   若每次都拿上一次的結果去排程，費氏階梯會爬三階：
      //   1 天 → 3 → 8 → 21。而那三次評分只隔幾分鐘，
      //   不是三次成功回憶，是同一次。灌水的後果要三週後才看得到。
      //
      //   改成每次都從 baseCard 算，最後一次評分的結果就是這一輪的結論。
      if (entry.baseCard === undefined) entry.baseCard = entry.card || null;
      // ★ 排程由「這一輪的第一次作答」決定，不是最後一次。
      //
      //   間隔重複量的是「隔了這麼多天，你還記不記得」——
      //   那個答案在第一次作答就揭曉了。後面兩次是操練，不是測驗：
      //   兩分鐘前才看過答案，再答對不代表隔八天也記得。
      //
      //   先前用最後一次，結果是：忘了一張 8 天的卡、再連對三次，
      //   得到 13 天且 lapses=0 —— 跟從來沒忘過一模一樣。
      //   那次遺忘被完全抹掉，而抹掉的後果是它會被排到 13 天後，
      //   一個你剛剛才想不起來的詞。這不會報錯，也看不出來。
      if (entry.firstRating === undefined) entry.firstRating = rating;

      const hits = rating >= RATING.GOOD ? (entry.hits || 0) + 1 : 0;
      const reached = !free && hits >= criterion;

      let next = schedule(entry.baseCard || {}, entry.firstRating);
      if (reached && next.state === 'learning') {
        // 達標 → 從上面算出的狀態畢業。
        // 第一次就答錯的卡，lapses 已經在上一步記下來了，這一步不會抹掉它，
        // 只是讓它結束重學、回到階梯第一階（1 天）。
        next = schedule(next, RATING.GOOD, new Date(), { forceGraduate: true });
      }

      // ★ 連續答對 ROUND_CRITERION 次才算學會。
      //
      //   「記得」與「很簡單」都算數，「有點難」與「忘了」歸零重來 ——
      //   嚴格只認「很簡單」的話，誠實按「記得」的人進度永遠不前進，
      //   他可以按二十次「記得」而那個詞畢不了業。
      //
      //   還沒達標就強制留在學習階段，不讓它畢業。這一步很重要：
      //   放它畢業再重排的話，同一張卡在一輪內會被排程三次，
      //   而費氏階梯會爬三階（1 天 → 3 → 8 → 21）——
      //   那三次評分只隔五分鐘，不是三次成功回憶，是同一次。
      //
      //   只用在學新課。複習輪一張卡評一次就好：
      //   它本來就是「隔了幾天還記不記得」的測驗，當場再問三遍沒有意義。
      //   複習輪同樣要三次 —— 每天要有 20 個詞達到這個標準才解鎖新課，
      //   所以「達標」的定義必須兩邊一致。
      //   自由練習（free）不套：那是不計排程的隨意練習。
      if (!free) {
        entry.hits = hits;
        if (reached) mastered.add(entry.item.id);
        else if (next.state === 'review') {
          // 還沒達標就不讓它畢業，繼續留在這一輪
          next = { ...next, state: 'learning', interval_days: 0,
                   due_at: new Date(Date.now() + 60000).toISOString() };
        }
      }
      const snapshot = { idx, queueLen: queue.length, stats: { ...stats } };

      graded.add(idx);
      stats = { n: stats.n + 1, correct: stats.correct + (rating >= 3 ? 1 : 0),
                mastered: mastered.size };
      idx += 1;
      // ★ 還在學習階段的卡，當輪末尾再出現一次 —— 直到它畢業為止。
      //
      //   學習步驟（1 分鐘、10 分鐘）本來就存在排程資料裡，
      //   但先前只有「忘了」會重排，於是按「記得」的新卡當輪就消失了，
      //   要等下次開複習才再見到 —— 「今天學到會為止」根本做不到。
      //   現在讓步驟真的在同一輪內跑完：
      //     忘了     → 回到第一步，再來
      //     有點難／記得 → 前進一步，還沒畢業就再來一次
      //     很簡單   → 直接畢業，不再出現
      //   8 條的一課，一次坐下來就能走到「今天都會了」。
      //
      //   卡在同一張出不去是使用者自己的選擇（他一直按「忘了」），
      //   而且重排是加到隊尾，中間隔著其他題，不會變成連續轟炸。
      if (next.state === 'learning') {
        queue.push({ ...entry, hits: entry.hits, baseCard: entry.baseCard,
                   firstRating: entry.firstRating,
                   card: { ...(entry.card || {}), ...next } });
      }

      pending = {
        payload: {
          item: entry.item, direction: entry.direction, prevCard: entry.card,
          rating, next, elapsedMs: Date.now() - shownAt, free,
          mode: modeId, sessionId, activity,
        },
        snapshot,
        timer: setTimeout(() => flush(true), UNDO_MS),
      };

      if (idx >= queue.length) { flush(); onFinish?.(stats, free); return; }
      shownAt = Date.now();
      notify();
    },

    undo() {
      if (!pending) return false;
      const { snapshot } = pending;
      clearTimeout(pending.timer);
      pending = null;
      idx = snapshot.idx;
      graded.delete(idx);
      queue.length = snapshot.queueLen;   // 丟掉 AGAIN 補進佇列的那張
      stats = snapshot.stats;
      notify();
      return true;
    },

    /** 純瀏覽，不計分 */
    go(delta) {
      const t = idx + delta;
      if (t < 0 || t >= queue.length) return false;
      flush();
      idx = t;
      shownAt = Date.now();
      notify();
      return true;
    },

    quit() { flush(); onFinish?.(stats, free); },

    /**
     * 把這一輪的狀態拍成可序列化的快照，供中斷後續跑。
     *
     * 【為什麼需要】
     *   網址的 hash 只記得「在哪一頁」，不記得「做到第幾題」。
     *   重新整理、切到別的 App 再回來、手機把分頁回收 ——
     *   這三件事在手機上每天都會發生，而目前的結果都是整輪重來。
     *   一輪要答三十到八十題，重來一次的代價足以讓人今天不想再開。
     *
     * 【為什麼先 flush()】
     *   pending 是「最近一題還可以撤銷」的暫存。不落定就拍快照的話，
     *   續跑後那一題會消失 —— 使用者明明答過了，回來卻要再答一次。
     */
    snapshot() {
      flush();
      return { queue, idx, stats, free, modeId, activity,
               mastered: [...mastered], sessionId };
    },

    /** 從快照續跑。回傳是否成功 —— 資料壞掉時要能安靜地回到正常流程 */
    resume(s) {
      if (!s || !Array.isArray(s.queue) || !s.queue.length) return false;
      queue = s.queue;
      idx = Math.min(Number(s.idx) || 0, queue.length);
      stats = s.stats || { n: 0, correct: 0, mastered: 0 };
      free = !!s.free;
      modeId = s.modeId || 'flip';
      activity = s.activity || 'review';
      sessionId = s.sessionId || null;
      mastered.clear();
      (s.mastered || []).forEach((id) => mastered.add(id));
      graded.clear();
      shownAt = Date.now();
      pending = null;
      onChange?.(this.state());
      return true;
    },

    /** 離開頁面前把還沒定案的那題寫掉 */
    flushNow() { flush(true); },

    /** 條目內容被編輯後同步進佇列（由事件匯流排觸發） */
    syncItem(saved) {
      let hit = false;
      for (const e of queue) if (e.item.id === saved.id) { Object.assign(e.item, saved); hit = true; }
      if (hit) notify();
    },
  };
}

/**
 * 這一輪只練哪一種內容：all / word / sentence。
 *
 * 【為什麼放在這裡而不是 views】
 *   它是純函式，卻決定了佇列裡留下什麼 —— 屬於會話引擎的職責。
 *   放在 views/home.js 的話，想測它就得連帶載入資料層，
 *   而資料層會去 CDN 取 supabase-js，node 根本載不起來。
 *   測不到的判斷邏輯遲早會壞掉而沒人發現。
 *
 * 【詞組算在「單字」】
 *   詞組（かき氷、お菓子）在使用上更接近單字，不是要練語序的對象。
 *   分成三類會讓選擇器變長，而第三類幾乎沒人會單獨挑。
 */
export const matchesType = (item, t) =>
  t === 'all' || !t ? true
  : t === 'sentence' ? item.item_type === 'sentence'
  : item.item_type !== 'sentence';

/**
 * 依「辨別優先」重排佇列：同一形近組的條目相鄰出現。
 *
 * 【為什麼隨機打亂是錯的】
 *   ぬ 和 め 都在清單裡卻被打散到頭尾，中間隔了十幾題 ——
 *   那等於各自單獨練，而各自單獨練本來就都會。
 *   辨別要的是「剛看完 ぬ 馬上看到 め」，讓兩者在工作記憶裡碰面。
 *
 * 【為什麼組與組之間仍要打亂】
 *   固定順序會讓人靠位置記答案（第三題總是 ぬ），
 *   那是記順序不是記字。所以組內固定、組間隨機。
 *
 * @param {Array}    entries  佇列項目（含 item）
 * @param {Function} groupOf  item.ko → 形近組（沒有回 null）
 * @param {Function} rand     可注入，測試才驗得了
 */
export function orderForDiscrimination(entries, groupOf, rand = Math.random) {
  const blocks = [];
  const byGroup = new Map();
  for (const e of entries) {
    const g = groupOf?.(e.item?.ko);
    if (!g) { blocks.push([e]); continue; }
    const key = g.keys.join('|');
    if (!byGroup.has(key)) { const b = []; byGroup.set(key, b); blocks.push(b); }
    byGroup.get(key).push(e);
  }
  // 組內照該組宣告的順序排，不照使用者標記的先後 ——
  // 宣告順序是教學順序（先 さ 再 き 再 ち：兩橫→三橫→鏡像）
  for (const [key, b] of byGroup) {
    const order = key.split('|');
    b.sort((x, y) => order.indexOf(x.item.ko) - order.indexOf(y.item.ko));
  }
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks.flat();
}
