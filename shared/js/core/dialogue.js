// =====================================================================
// 情境對話：解析與練習邏輯
//
// 對話沒有另立資料表 —— 每一句就是一條普通的 item，
// 靠 note 開頭的「對話 A｜情境｜語法說明」歸組。
// 這是詞表原有的約定，沿用而不是另發明一套：
// 好處是對話句同時也是一般的複習卡，SRS 照常運作，不必兩套進度。
//
// 【行序靠 sort_order，不能靠 id】
//   id 是 uuid，排序等於亂序。實際踩過：用 id 排出來的說話者序列是
//   BBAA、ABBA，看起來像資料壞了，其實只是排序欄位挑錯。
// =====================================================================

const HEAD = /^對話\s*([AB])｜([^｜]+)｜?(.*)$/;

/** 從 note 解析出說話者、情境、語法說明；不是對話就回 null */
export function parseLine(note) {
  const m = HEAD.exec((note || '').trim());
  return m ? { speaker: m[1], scene: m[2].trim(), grammar: (m[3] || '').trim() } : null;
}

/**
 * 把一堆 item 歸成對話。
 * items 需已依 sort_order 排好 —— 這裡不再排序，避免呼叫端以為排過了。
 */
export function groupDialogues(items) {
  const by = new Map();
  for (const it of items) {
    const p = parseLine(it.note);
    if (!p) continue;
    if (!by.has(p.scene)) by.set(p.scene, { scene: p.scene, lines: [] });
    by.get(p.scene).lines.push({ ...p, item: it });
  }
  return [...by.values()].filter((d) => d.lines.length >= 2);
}

/**
 * 打亂一段對話的行序，供「排回原順序」練習用。
 *
 * ★ 一定要與原順序不同，否則會出現「打亂後跟原本一樣」的尷尬局面 ——
 *   使用者以為壞了。兩句的對話只有一種打亂方式，所以直接對調。
 *   rand 可注入，測試才驗得了。
 */
export function shuffleLines(lines, rand = Math.random) {
  if (lines.length < 2) return [...lines];
  if (lines.length === 2) return [lines[1], lines[0]];
  const a = [...lines];
  for (let tries = 0; tries < 20; tries++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.some((x, i) => x !== lines[i])) return a;
  }
  return [lines[lines.length - 1], ...lines.slice(0, -1)];   // 保底：整體位移
}

/**
 * 對答案：使用者排出的順序對不對。
 * 回傳每一格是否落在正確位置，方便畫面逐格標示而不是只說「錯了」——
 * 只說錯不告訴哪裡錯，等於要人重猜。
 */
export function checkOrder(picked, lines) {
  const flags = picked.map((x, i) => x === lines[i]);
  return { flags, correct: flags.every(Boolean) };
}
