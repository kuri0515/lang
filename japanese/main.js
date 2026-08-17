// =====================================================================
// 日文站進入點
//
// 順序是有意義的，不能改成靜態 import：
//   shared/js/app.js 在模組載入時就會開始跑（底部有 IIFE 去取登入狀態），
//   而它一路上會用到 lang()。靜態 import 會讓 app.js 先被求值，
//   那時 setLang() 還沒呼叫 —— 整站白屏，錯誤訊息還指向不相干的檔案。
//
//   所以：先設定語言，設定好了才動態載入 app。
// =====================================================================

import { setLang } from '../shared/js/core/lang.js';
import { LANG } from './lang.config.js';

setLang(LANG);
await import('../shared/js/app.js');
