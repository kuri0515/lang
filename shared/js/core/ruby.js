// =====================================================================
// 振り仮名（ruby 標注）
//
// 【為什麼日文站需要這個】
//   漢字是華語圈學日語最大的優勢，也是最大的陷阱：
//   看得懂「大丈夫」的意思，不等於唸得出 だいじょうぶ。
//   只顯示漢字，學習者會用中文的讀音在腦裡帶過去，
//   看起來學會了，開口時卻一個字都出不來。
//
//   所以漢字一律要能顯示讀音，而且要顯示在字的正上方（ruby），
//   不是塞在括號裡 —— 括號會打斷句子的節奏，而節奏正是日語的重點。
//
// 【標注格式：漢字[かな]】
//   「駅[えき]は どこですか。」→ 駅 上面標 えき，其餘原樣。
//   這是單字卡界通用的寫法（Anki 等），純文字、好編輯、好 diff，
//   不需要在資料庫裡另立欄位或存 HTML。
//
// 【為什麼不自動產生】
//   同一個漢字在不同詞裡讀法不同（生：せい／なま／い-きる），
//   要正確標注得看上下文。自動產生的讀音錯了不會報錯，
//   只會讓學習者背下一個錯的音 —— 那比沒有標注更糟。
//   所以標注是人寫的資料，這個模組只負責呈現。
// =====================================================================

import { esc } from './dom.js';
import { lang } from './lang.js';

// 漢字[假名]
//
// ★ 注音對象只取「緊鄰方括號前的漢字連續段」，不是括號前的所有字元。
//   第一版寫成 ([^\[\]]+?) —— 看起來只是「非括號字元」，
//   實際上會把助詞一起吃進去：「歯[は]を磨[みが]き」的第二組
//   注音對象變成「を磨」，假名標在「を磨」兩個字上方。
//   資料完全正確，畫面上的對應是錯的 —— 而學習者會照著錯的對應去記。
//   加上 々（同字符號）與數字（500[ごひゃく]円 這種）。
const RUBY = /([一-鿿々〆ヶ0-9０-９]+)\[([^\[\]]+)\]/g;

/** 這段文字有沒有標注 */
export const hasRuby = (t) => /\[[^\[\]]+\]/.test(String(t || ''));

/**
 * 去掉標注，還原成純文字。
 * 朗讀、搜尋、比對答案都該用這個 —— TTS 唸到 "[えき]" 會變成雜音。
 */
export const stripRuby = (t) =>
  String(t || '').replace(RUBY, (_, base) => base);

/**
 * 轉成 HTML。
 *
 * ★ 一律經過 esc()：這段字串最後會進 innerHTML，
 *   而詞條內容是使用者可編輯的（站上有快速編輯）。
 *   架構檢查會盯這件事，但真正的理由是別讓一條詞把整站變成 XSS 入口。
 *
 * @param {string} text 帶標注的文字
 * @returns {string} HTML，未標注的部分原樣（已轉義）
 */
export function rubyHTML(text) {
  const s = String(text || '');
  let out = '';
  let last = 0;
  for (const m of s.matchAll(RUBY)) {
    out += esc(s.slice(last, m.index));
    out += `<ruby>${esc(m[1])}<rt>${esc(m[2])}</rt></ruby>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

/**
 * 檢查標注寫得對不對 —— 給稽核與匯入用。
 * @returns {string|null} 有問題時回原因
 */
export function checkRuby(text, plain) {
  const s = String(text || '');
  if (!s) return null;
  const open = (s.match(/\[/g) || []).length;
  const close = (s.match(/\]/g) || []).length;
  if (open !== close) return `方括號不成對（${open} 個 [ ／ ${close} 個 ]）`;
  if (!open) return '沒有任何標注';
  // 去掉標注後必須與原文一字不差 —— 不然標注的是另一句話
  if (plain != null && stripRuby(s) !== plain) {
    return `去掉標注後與原文不符：「${stripRuby(s)}」≠「${plain}」`;
  }
  const bad = [...s.matchAll(RUBY)].find((m) => !/^[ぁ-ゖァ-ヺー]+$/.test(m[2]));
  if (bad) return `「${bad[1]}」的讀音「${bad[2]}」不是純假名`;
  return null;
}

/**
 * 一則條目在**清單裡**該顯示的 HTML。
 *
 * 【為什麼要有這個，而不是各畫面自己 esc(item.ko)】
 *   資料裡 826 條的漢字都標好了讀音，但只有學習卡片和情境對話會渲染它。
 *   詞庫、學習歷史、回顧清單、同義詞、漢字詞群 —— 七個畫面都印裸漢字。
 *   於是「駅」在卡片上看得到 えき，翻到詞庫又變回一個不會唸的字。
 *
 *   初學者在這個階段還沒有「看到漢字自動浮出讀音」的能力，
 *   少標一次就是少一次曝光；而列表正是滑得最快、看得最多的地方。
 *
 * 【為什麼回傳 HTML 而不是文字】
 *   ruby 本來就是標記。呼叫端必須用 innerHTML 接，
 *   **不可以再包一層 esc()** —— 包了會把 <ruby> 原樣印在畫面上。
 *   （這個錯誤在情境對話已經犯過一次。）
 *   轉義由 rubyHTML/esc 在裡面做完，外面再包只會壞掉，不會更安全。
 *
 * 【為什麼自己問 lang() 而不是要呼叫端傳進來】
 *   hanja 欄兩站裝的東西不同：日文站是注音字串，韓文站是漢字詞源。
 *   把韓文的 hanja 當注音渲染會印出完全錯的東西 ——
 *   所以要由站台用 rubyFromHanja 明確宣告，共用碼不猜。
 *
 *   而這個宣告只有一個正確答案，沒有「這個畫面想傳別的」的情況。
 *   讓八個呼叫端各自傳，就是給了八次傳錯或忘記傳的機會，
 *   而傳錯的後果（韓文站印出漢字詞源當讀音）不會報錯，只會靜靜顯示錯的東西。
 */
export function wordHTML(item) {
  const src = (lang().rubyFromHanja && hasRuby(item?.hanja)) ? item.hanja : (item?.ko || '');
  return hasRuby(src) ? rubyHTML(src) : esc(src);
}
