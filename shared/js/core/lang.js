// =====================================================================
// 語言設定登記處 —— monorepo 的樞紐
//
// 【為什麼需要這個檔】
//   shared/js 底下的程式碼要能同時服務韓文站與日文站，
//   但「唸什麼語言」「欄位別名叫什麼」「發音課有哪些課」這些
//   本來就是各站不同的東西。把它們寫死在共用碼裡，等於共用碼只服務其中一站。
//
//   所以共用碼一律不寫死語言，改成向這裡要。各站在啟動時
//   （<site>/main.js）呼叫 setLang() 把自己的 lang.config.js 交進來。
//
// 【為什麼是 registry 而不是 import】
//   共用碼不能 import 站台的檔案 —— 那會讓 shared 反向依賴 korean/，
//   等於兩站又黏在一起。反過來由站台注入，方向才是對的：
//
//       korean/lang.config.js  ─┐
//                               ├→ setLang() → shared/js/**  只讀 lang()
//       japanese/lang.config.js ┘
//
// 【為什麼沒設定就直接丟錯】
//   回傳一個空物件會讓錯誤延後到「某個畫面顯示空白」才浮現，
//   那時已經很難查是哪裡漏了。啟動順序錯就當場炸，才找得到。
// =====================================================================

let CFG = null;

/** 站台啟動時呼叫一次。重複呼叫視為程式錯誤（同一頁不該有兩種語言） */
export function setLang(cfg) {
  if (CFG) throw new Error('setLang() 已經呼叫過 —— 一個頁面只能有一種語言');
  if (!cfg || !cfg.code) throw new Error('lang.config.js 缺少 code');
  CFG = cfg;
}

/** 共用碼取用語言設定的唯一入口 */
export function lang() {
  if (!CFG) throw new Error('語言尚未設定 —— <site>/main.js 必須先呼叫 setLang()');
  return CFG;
}

/** 測試用：讓每支測試各自裝配自己的語言設定 */
export function _resetLang() { CFG = null; }

/**
 * localStorage 的鍵，一律加上站台前綴。
 *
 * 【為什麼一定要】
 *   兩站同在 kuri0515.github.io 這一個網域下，
 *   而 localStorage 是**整個網域共用**的 —— 路徑不同不會隔開。
 *   所以 'session-resume-v1' 這種裸鍵，兩站寫的是同一格。
 *
 *   實際發生過（2026-08-18）：在韓文站學到一半，打開日文站，
 *   續跑功能把韓文站那一輪接了回來 —— 日文站上出現整輪韓文單字。
 *   使用者的回報是「日文站串了韓文站的內容」，而程式沒有任何錯誤。
 *
 *   theme（曾寫死 'kr.theme'）、導言展開狀態、今日掌握數，
 *   當時也都是共用的，只是症狀沒有那麼明顯。
 */
export const lsKey = (name) => `${lang().storagePrefix}.${name}`;
