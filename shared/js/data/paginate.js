// =====================================================================
// 分頁撈完 —— 與 supabase client 無關的那一半
//
// 【為什麼獨立成一個檔】
//   它只認「一個可以 .order().range() 的 builder」，不需要 client、
//   不需要站台設定，所以能純 node 測試，也能讓測試替身**直接用這一份**。
//   先前替身自己抄了一份，正式版加了選項之後兩邊就對不上 ——
//   舊簽名把選項物件當成 pageSize，迴圈再也不結束（見 docs/LESSONS.md L-012）。
//   同一段邏輯只留一份，抄第二份必然漂移。
// =====================================================================

/**
 * 分頁撈完整個結果集。
 *
 * 【為什麼需要】
 *   PostgREST 有伺服器端的單次回傳上限（Supabase 預設 1000 列），
 *   前端再各自寫死 limit 300／400 這種數字，詞庫一長就靜默截斷 ——
 *   不會報錯，只是東西「不見了」。實際踩到：詞庫到 347 條時，
 *   瀏覽頁的 limit=300 讓 47 條查不到。
 *
 *   固定上限治不了本，只是把牆往後挪。改成分頁撈到沒有為止。
 *
 * 【★ 為什麼一定要指定 tiebreak】
 *   分頁靠的是 range(0–999)、range(1000–1999)…，而 **SQL 沒有排序就沒有
 *   列的順序**。同一個查詢的兩頁之間，資料庫完全可以用不同順序回你 ——
 *   於是有些列出現兩次、有些一次都沒出現。
 *
 *   它的可怕之處在於：結果**筆數看起來是對的**，錯的是內容。
 *   （這不是理論：我自己寫稽核腳本時就漏了 order，
 *     於是「6223 張卡」只認出 5000 多個詞形，
 *     然後對著一份假的「1030 個詞沒有卡片」清單找了半天原因。）
 *
 *   呼叫端寫的 order（sort_order、idx…）通常有大量同分列，
 *   同分之間仍然沒有順序。所以這裡再補一個唯一的欄位當決勝負 ——
 *   PostgREST 會把多個 order 依序疊起來，不會蓋掉呼叫端的主排序。
 *
 *   沒給就直接丟例外，不預設猜一個欄位：猜錯的後果與沒排序一樣，
 *   而且更難發現（看起來「有排」）。
 *
 * @param {() => object} build 每次呼叫都要回傳「全新的」query builder
 *                             （PostgREST 的 builder 是可變的，重用會疊加條件）
 * @param {string|string[]} tiebreak 能唯一決定順序的欄位（表的主鍵）
 */
export async function fetchAll(build, { pageSize = 1000, hardCap = 50000, tiebreak,
                                        concurrency = 4 } = {}) {
  const cols = [].concat(tiebreak || []);
  if (!cols.length) {
    throw new Error('fetchAll 需要 tiebreak —— 沒有唯一排序的分頁會重複或漏掉列，而筆數看起來是對的');
  }
  const page = (from) => {
    let q = build();
    for (const c of cols) q = q.order(c);
    return q.range(from, from + pageSize - 1);
  };

  // ★ 一次發一批，不是一頁一頁地等。
  //
  //   一頁一頁等的成本是**趟數 × 延遲**，而趟數跟著資料量長：
  //   干擾項池 7049 列 ＝ 8 趟連續往返，實測 3.3 秒 ——
  //   而它擋在「第一題出現」之前。一次四頁之後是 0.95 秒。
  //
  // 【為什麼不先問總數再切頁】
  //   呼叫端已經呼叫過 .select()，這裡再呼叫一次會把欄位清單覆蓋掉。
  //   多打一趟 HEAD 拿總數也划不來 —— 那本身就是一趟往返。
  //   所以用「先發一批，看最後一頁滿不滿」：滿的就再發一批。
  //   列是有序的（tiebreak 保證），所以**短的一頁就是最後一頁**。
  //   代價是結尾可能多打幾個空請求，那比多一趟 HEAD 便宜。
  //
  //   限流 4 條是刻意的：手機上同時開太多連線反而互相排隊，
  //   也不該在使用者的網路上一次打十幾個請求。
  // ★ 第一頁單獨發，之後才成批。
  //   從第一頁就開始成批的話，只有 58 列的結果也會打 4 個請求（3 個是空的）——
  //   而「結果很小」才是多數情況。用一趟先問過，就不必為了少數的大結果
  //   讓每一次小查詢都多付三個請求。
  const first = await page(0);
  if (first.error) throw first.error;
  const out = [...(first.data ?? [])];
  if (out.length < pageSize) return out;

  for (let from = pageSize; from < hardCap; from += pageSize * concurrency) {
    const offsets = [];
    for (let k = 0; k < concurrency && from + k * pageSize < hardCap; k++) {
      offsets.push(from + k * pageSize);
    }
    const batch = await Promise.all(offsets.map(page));
    let last = 0;
    for (const r of batch) {
      if (r.error) throw r.error;
      const rows = r.data ?? [];
      out.push(...rows);
      last = rows.length;
    }
    if (last < pageSize) return out;      // 最後一頁沒滿 → 撈完了
  }
  console.warn(`[fetchAll] 達到硬上限 ${hardCap}，結果可能不完整`);
  return out;
}
