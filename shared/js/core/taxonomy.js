// =====================================================================
// 標籤分類與教學順序 —— 演算法層
//
// 為什麼獨立成一個模組：這是教學知識，不是畫面細節。
// 瀏覽的篩選列、發音課程路徑都要用同一份，抄兩份必然漂移。
//
// 【這個檔裡沒有任何一句韓文或日文】
//   拆 monorepo 時看清楚一件事：這個模組本來混了兩種東西 ——
//     ① 演算法：怎麼分組、怎麼排序、怎麼算下一課、掌握門檻多少
//     ② 課程內容：有哪些課、每課的導言、生活場景有哪些
//   ① 兩個語言完全一樣，② 完全不一樣。
//   所以 ① 留在這裡，② 搬到 <site>/taxonomy.js，由 lang().taxonomy 供應。
//
// 【為什麼要分組】
//   標籤裡混著兩種性質完全不同的東西：
//     主題（食物·動物·場所）  學習者按興趣挑 —— 當篩選器是對的
//     發音（收音ㄷ·激音化）    這是一套有順序的課程 —— 當篩選器是錯的
//   平鋪在一起，想找「食物」得滑過「收音ㄼ」。
//
// 【為什麼發音不按數量排】
//   收音ㄽ 只掛 1 條，按數量排會落到最末，看起來像殘渣。
//   但它是「複合收音」這一課裡的一行，不是一個冷門分類。
//   自學者沒有老師說「你該練複合收音了」，順序本身就是教學。
//   所以發音一律按站台給的序列排，與條目數無關。
// =====================================================================

import { lang } from './lang.js';

const tx = () => lang().taxonomy;

/** 發音教學序列（站台提供，順序即教學） */
export const pronOrder = () => tx().pronOrder;
/** 主題組裡優先露出的「起步主題」 */
export const starterTopics = () => tx().starterTopics;
/** 語法類標籤：詞性與句子結構 */
export const grammarTags = () => tx().grammarTags;
/** 篩選列的三個分組（label / hint 由站台寫，語氣要對得上該語言的學習者） */
export const groups = () => tx().groups;
/** 每一課的導言 */
export const lessonIntro = () => tx().lessonIntro;
/** 生活 · 興趣模組的場景 */
export const lifeScenes = () => tx().lifeScenes;
/** 所有場景用到的標籤（去重）—— 查詢時一次撈完 */
export const lifeTags = () => [...new Set(tx().lifeScenes.flatMap((s) => s.tags))];

/**
 * 把 listTags() 的 [[tag, count]] 分成三組。
 *
 * 未列進 pronOrder 的發音標籤（靠 pronPrefix 認出來）也算發音組 ——
 * 日後新增 收音ㅆ 之類時不會憑空掉出分組，只是排在該組最後。
 * 硬名單漏掉一項就讓標籤消失，是這種設計最容易犯的錯。
 */
export function groupTags(pairs) {
  const t = tx();
  const pronSet = new Set(t.pronOrder);
  const gramSet = new Set(t.grammarTags);
  const isPron = (tag) => pronSet.has(tag) || t.pronPrefixes.some((p) => tag.startsWith(p));

  const out = { topic: [], pron: [], grammar: [] };
  for (const [tag, n] of pairs) {
    if (isPron(tag)) out.pron.push([tag, n]);
    else if (gramSet.has(tag)) out.grammar.push([tag, n]);
    else out.topic.push([tag, n]);
  }
  // 主題：起步主題置頂，其餘按數量；語法按數量；發音按教學順序
  const starter = (x) => (t.starterTopics.indexOf(x) + 1 || 999);
  out.topic.sort((a, b) => starter(a[0]) - starter(b[0]) || b[1] - a[1]);
  out.grammar.sort((a, b) => b[1] - a[1]);
  const rank = (x) => (t.pronOrder.indexOf(x) + 1 || 999);
  out.pron.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  return out;
}

/**
 * 掌握門檻。要求 100% 會讓人卡在某一課出不去 —— 一課裡有幾條特別難是常態，
 * 為了那兩條擋住整條路線，自學者只會放棄。低於 80% 又太鬆，一路夾生。
 *
 * 兩個語言的難點不同，但「別卡死人」這件事一樣，所以門檻共用。
 */
export const LESSON_DONE = 0.8;

/**
 * 從課程進度算出「下一課」。
 *
 * ★ 判準是「還沒掌握牢」而不是「還沒碰過」——
 *   碰過兩條就算過關、直接跳下一課，等於整條路線一路夾生，
 *   而發音正是最不能夾生的部分：底子沒打穩，後面每個音變規則都聽不懂。
 *
 * rows = [{ tag, total, started, mastered }]，順序不拘，本函式自己照教學序排。
 * 回傳 { next, done, total }；全部達標時 next 為 null。
 */
export function nextLesson(rows) {
  const ordered = tx().pronOrder
    .map((t) => rows.find((r) => r.tag === t))
    .filter((r) => r && r.total > 0);
  const rate = (r) => r.mastered / r.total;
  return {
    next: ordered.find((r) => rate(r) < LESSON_DONE) ?? null,
    done: ordered.filter((r) => rate(r) >= LESSON_DONE).length,
    total: ordered.length,
    ordered,
  };
}

/**
 * 一課練完的收尾話。
 *
 * 【刻意不是每課都有】
 *   每課都給一句，等於每句都不算數 —— 稱讚天天有就成了背景音。
 *   只有真的有話可說的課才給。其餘留白，讓成績自己說話。
 *
 * 【答得不好時不假稱讚】
 *   自學者答錯一半，最不需要的是「太棒了」。
 *   要的是有人告訴他「這裡卡住是正常的，原因是這個」——
 *   把挫敗重新定義成預期中的一步，他才留得下來。
 *
 * 【課程家族】
 *   有些課是同一條規則的多個實例（韓語的十一組複合收音就是），
 *   話也該是同一句。站台用 taxonomy.lessonFamilies 宣告這種家族，
 *   本函式只負責「屬於哪個家族就用哪句」。
 *
 * @param {string} tag       課程標籤，非課程內容傳空字串
 * @param {number} accuracy  本輪正確率 0–1
 * @returns {string} 收尾話；沒有話可說時回空字串
 */
export function lessonOutro(tag, accuracy) {
  const t = tx();
  if (!tag || !t.lessonIntro[tag]) return '';
  const low = accuracy < 0.6;
  for (const fam of t.lessonFamilies || []) {
    if (fam.match(tag)) return low ? fam.low : fam.ok;
  }
  return (low ? t.outroLow[tag] : t.outroOk[tag]) || '';
}

/**
 * 挑一個場景給她。
 *
 * ★ 判準與發音課程相反：那邊找「第一個沒掌握牢的」，因為要照順序走；
 *   這邊優先找「已經開始、還沒做完的」—— 對興趣驅動的內容，
 *   把手上那件事收完比開新的一件更有成就感。都沒開始就給第一個，
 *   全部做完就不硬塞。
 */
export function pickScene(scenes) {
  const started = scenes.filter((s) => s.started > 0 && s.mastered < s.total);
  if (started.length) {
    // 已開始的裡面挑最接近完成的 —— 差一點就收尾，比從頭開新的划算
    return { scene: started.sort((a, b) => b.mastered / b.total - a.mastered / a.total)[0],
             reason: 'continue' };
  }
  const fresh = scenes.find((s) => s.started === 0 && s.total > 0);
  return fresh ? { scene: fresh, reason: 'start' } : { scene: null, reason: 'done' };
}
