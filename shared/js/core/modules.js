// =====================================================================
// 學習模組：把詞庫分成幾個並行的「入口」
//
// 【它回答的問題】
//   首頁的「複習／新課／輪練」原本掃的是整個站的內容。站台有兩套彼此無關的
//   內容時（課本 A、Haerin's Schedule），按「複習」不該把兩邊混在一起 ——
//   你想複習 Haerin 的講話稿，卻先被課本的詞考一輪。
//
//   模組＝一組詞庫＋一個輪練用的詞庫。首頁挑定一個模組，
//   三個入口就只在它的範圍裡動。
//
// 【為什麼是純函式，不是寫在 home.js 裡】
//   「這個模組有哪些詞庫 id」算錯的後果是複習混進別的內容，或更糟 ——
//   算出空集合卻被當成「不限定」，於是整站的卡都到期（docs/LESSONS.md L-001：
//   空集合不是「全部」）。這種規則放在碰得到 DOM 與網路的地方就驗不到。
//
// 【站台沒宣告模組（或只有一個）→ 回傳空陣列，整套行為與從前完全一致】
// =====================================================================

/**
 * @param cfgModules  lang().modules：
 *   [{ id, title, sub, deckSlugs: string[] | null, roundDeck, courses }]
 *   deckSlugs 為 null 表示「沒被別的模組認領的詞庫全部歸我」——
 *   日後新增的詞庫預設落在這裡，不會因為忘了登記而哪個入口都看不到。
 * @param decks  content.listDecks() 的結果 [{ id, slug, ... }]
 * @returns [{ id, title, sub, deckIds, roundDeck, courses, available }]
 *   available＝線上已經有它的詞庫。還沒有時入口照樣顯示（使用者要的是
 *   兩個並行的入口），只是按下去說「還沒有內容」，不會悄悄掃到別的東西。
 */
export function resolveModules(cfgModules, decks) {
  if (!Array.isArray(cfgModules) || cfgModules.length < 2) return [];
  const claimed = new Set(cfgModules.flatMap((m) => m.deckSlugs || []));
  return cfgModules.map((m) => {
    const mine = (decks || []).filter((d) => (m.deckSlugs
      ? m.deckSlugs.includes(d.slug)
      : !claimed.has(d.slug)));
    return {
      id: m.id,
      title: m.title,
      sub: m.sub || '',
      deckIds: mine.map((d) => d.id),
      roundDeck: m.roundDeck || null,
      courses: !!m.courses,
      available: mine.length > 0,
    };
  });
}

/** 挑出目前的模組；id 認不得（存下來的偏好過期了）就退回第一個 */
export function pickModule(modules, id) {
  if (!modules?.length) return null;
  return modules.find((m) => m.id === id) || modules[0];
}
