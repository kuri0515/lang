// =====================================================================
// 事件匯流排
//
// 【解決什麼】
//   重構前，編輯器存檔後要直接伸手去改 study 的 queue、browse 的清單，
//   再手動呼叫對方的 render()。這讓「編輯」這件事必須知道站上所有
//   會顯示條目的地方 —— 每加一個新畫面，編輯器就得改一次。
//
//   改成：編輯器只管廣播「某條目變了」，誰關心誰自己訂閱。
//   編輯器不再認識任何畫面，新畫面也不必去改編輯器。
// =====================================================================

const handlers = new Map();

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => handlers.get(event)?.delete(fn);   // 回傳取消訂閱
}

export function emit(event, payload) {
  for (const fn of handlers.get(event) ?? []) {
    // 一個訂閱者出錯不該讓其他訂閱者收不到
    try { fn(payload); } catch (e) { console.error(`[bus] ${event}`, e); }
  }
}

/** 事件名集中在此，避免各處打錯字串 */
export const EVENTS = {
  ITEM_UPDATED: 'item:updated',     // 條目內容變了（編輯／新增）
  ITEMS_CHANGED: 'items:changed',   // 條目集合變了（匯入／下架）
  SESSION_END: 'session:end',       // 一輪學習結束
  PROGRESS_WRITTEN: 'progress:written',  // 答題已寫入雲端
};
