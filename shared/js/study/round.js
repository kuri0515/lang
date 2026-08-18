// =====================================================================
// 輪次池的規則
//
// 【它回答的問題】
//   「整個詞庫，我掃到哪了？」
//   複習池（user_cards）回答的是「哪些快忘了」，由到期日排序；
//   輪次池不看到期日，只保證**每個詞這一輪都輪得到**。
//
// 【為什麼獨立成一個檔】
//   這些規則原本寫在 app.js 的 ensureRound 裡，而那裡碰得到
//   supabase 與 DOM，等於驗不到。驗不到的結果是：
//   「空的 queue 被當成走完一輪」這個錯誤活到線上，
//   把某個使用者推到第 17 輪 —— 而他其實一輪都還沒走完（pos 70／801）。
//
//   這一層是純函式：進去是狀態，出來是狀態，沒有 I/O。
// =====================================================================

/**
 * 這一輪還能不能繼續發牌。
 *
 * ★ 空的 queue 不是「走完」，是「壞掉」。
 *   兩者的差別很要緊：走完該進下一輪（輪數 +1），
 *   壞掉該原地修好（輪數不動）。舊版把兩者混為一談，
 *   於是每按一次輪練就 +1 輪，同時發出一組空的牌。
 */
export const isUsable = (r) => !!r && Array.isArray(r.queue) && r.queue.length > 0;

/** 走完了嗎 —— 有內容，而且指標到底 */
export const isComplete = (r) => isUsable(r) && r.pos >= r.queue.length;

/**
 * 從 ids 開一輪新的。shuffleFn 由呼叫端注入，測試才能給定序。
 *
 * 輪數只在「上一輪真的走完」時 +1。修一個壞掉的輪次維持原輪數 ——
 * 否則修復本身就在推高輪數。
 */
export function nextRound(existing, ids, shuffleFn) {
  if (!ids?.length) throw new Error('輪次池是空的');
  return {
    roundNo: isComplete(existing) ? existing.roundNo + 1 : (existing?.roundNo || 1),
    queue: shuffleFn(ids.slice()),
    pos: 0,
  };
}

/** 這一組要發哪幾個。不動指標 —— 發牌不是消費 */
export const deal = (r, n) => (isUsable(r) ? r.queue.slice(r.pos, r.pos + n) : []);

/**
 * 消費：答完之後才推指標。
 *
 * 【為什麼不在發牌時推】
 *   原本是發出去就推，理由是「中途離開也算走過」。
 *   但那讓「按一下輪練」變成有代價的動作 ——
 *   使用者以為沒反應而多按幾次，詞庫就被吃掉幾十個，
 *   而那些詞這一輪再也不會出現，直接違背輪次池的唯一承諾。
 *   改成答完才推：中途離開下次拿到同一組，重按不會有任何損失。
 */
export function consume(r, n) {
  if (!isUsable(r) || !n) return r;
  return { ...r, pos: Math.min(r.pos + n, r.queue.length) };
}
