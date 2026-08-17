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
import { schedule, RATING } from '../core/srs.js';

// 評分後延遲多久才寫庫。這段時間內可完整撤銷。
// 為什麼延遲而非「寫了再刪」：reviews 是只追加日誌，RLS 沒開 delete，
// 誤點若已落庫就洗不掉，會永久污染正確率。
export const UNDO_MS = 2500;

export function createSession({ save, onChange, onFinish, onError }) {
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
    start(entries, { freeMode = false, mode = 'flip', kind = 'review' } = {}) {
      flush();
      queue = entries;
      idx = 0;
      free = freeMode;
      modeId = mode;
      activity = kind;
      sessionId = (globalThis.crypto?.randomUUID?.()) || null;
      stats = { n: 0, correct: 0 };
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
      const next = schedule(entry.card || {}, rating);
      const snapshot = { idx, queueLen: queue.length, stats: { ...stats } };

      graded.add(idx);
      stats = { n: stats.n + 1, correct: stats.correct + (rating >= 3 ? 1 : 0) };
      idx += 1;
      // 「忘了」的卡當輪末尾再出現一次
      if (rating === RATING.AGAIN) queue.push({ ...entry, card: { ...(entry.card || {}), ...next } });

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
