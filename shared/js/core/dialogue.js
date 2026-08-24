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

/**
 * 資料庫端的粗篩關鍵字。
 *
 * 只有這個檔知道對話是怎麼認出來的，所以關鍵字也由這裡出 ——
 * 呼叫端各自寫一份字串，改了 HEAD 之後就會有人被留在舊的認法上。
 * 粗篩故意寬鬆（只要含這兩個字），真正的判定仍然是 parseLine。
 */
export const DIALOGUE_MARK = '對話';
if (!HEAD.test(`${DIALOGUE_MARK} A｜測試｜`)) {
  throw new Error('DIALOGUE_MARK 與 HEAD 對不上 —— 粗篩會把所有對話濾掉');
}

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
 * 這批 item 裡，哪些「本來想當對話」卻沒成立。
 *
 * 【為什麼需要這支】
 *   對話沒有自己的資料表，全靠 note 開頭那一串約定。約定的壞處是
 *   **改壞了不會報錯**，而且症狀離原因很遠：
 *
 *     · 只改了其中一句的情境名 → 一段對話裂成兩段各一句
 *       → groupDialogues 把兩段都丟掉 → 清單上少了整整兩段對話
 *     · 把全形｜打成半形 | → 那一句退化成普通單字卡，對話短一句
 *     · 說話者打成 C → 同上
 *
 *   三種都只是「東西變少了」，而少掉的東西不會自己出聲。
 *   所以要有人專門去看「差一點就是對話」的那些。
 *
 *   回傳的是問題清單，不是丟例外 —— 內容有瑕疵不該讓整個畫面打不開，
 *   況且看得到其餘 90 段對話的人，才有機會發現少了哪一段。
 */
export function dialogueProblems(items) {
  const out = [];
  const scenes = new Map();
  for (const it of items) {
    const note = (it.note || '').trim();
    const p = parseLine(note);
    if (!p) {
      // 只挑「開頭就是對話兩個字」的 —— 內文順帶提到「對話」的一般註解
      // （韓文站實測有 3 條）不是壞掉，只是被粗篩一起撈了回來
      if (note.startsWith(DIALOGUE_MARK)) {
        out.push({ kind: 'format', id: it.id, ko: it.ko, note,
          why: '開頭是「對話」但格式不合 —— 常見原因是全形｜打成半形，或說話者不是 A／B' });
      }
      continue;
    }
    if (!scenes.has(p.scene)) scenes.set(p.scene, []);
    scenes.get(p.scene).push({ ...p, item: it });
  }
  for (const [scene, lines] of scenes) {
    if (lines.length < 2) {
      out.push({ kind: 'orphan', scene, id: lines[0].item.id, ko: lines[0].item.ko,
        why: '這個情境只有一句，整段不會出現在清單上 —— 通常是其中一句的情境名被改過' });
    } else if (new Set(lines.map((l) => l.speaker)).size < 2) {
      out.push({ kind: 'one-sided', scene, id: lines[0].item.id, ko: lines[0].item.ko,
        why: '整段只有一個說話者 —— 對話練習會變成單口相聲' });
    }
  }
  return out;
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
