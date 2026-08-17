// =====================================================================
// 帳號名 ↔ email 映射
//
// Supabase Auth 只認 email。本站讓使用者輸入「帳號名」，
// 在這裡透明轉成 email 再送出。
//
// ⚠️ 網域與補位字串必須與 create_user.py 完全一致，改一邊等於改壞登入。
//    兩邊現在都從 <site>/lang.config.js 取同一個值，
//    並由 tests/lang.test.mjs 跨語言比對（JS 讀到的 vs Python 讀到的）。
//
// 【為什麼網域是每站一份，不是全站共用】
//   韓文站用 `kuri0515.local`，已經有帳號在用，動了等於把人鎖在門外。
//   但新開的 Supabase 專案**拒絕 .local 這個 TLD**（2026 年加的驗證），
//   所以日文站不能沿用 —— 它用 `kuri0515.invalid`，
//   那是 RFC 2606 保留的 TLD，保證永遠不會真的送出信。
//
//   這正是「語言／站台差異走設定」該涵蓋的東西：
//   不只是看得到的字，還包括這種各站建立時空不同而長出來的差異。
// =====================================================================

import { lang } from './lang.js';

export const MIN_LEN = 6;

export const emailDomain = () => lang().authEmailDomain;
export const passwordPad = () => lang().authPasswordPad;

/** `kuri` → `kuri@<本站網域>`；已經是 email 就原樣通過 */
export function toEmail(username) {
  const u = String(username || '').trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${emailDomain()}`;
}

/**
 * 短密碼透明補位以滿足 Supabase 的 6 位下限。
 * ⚠️ 這不增加密碼強度 —— 只是讓短密碼能用。
 */
export function toPassword(raw) {
  const p = String(raw || '');
  return p.length >= MIN_LEN ? p : p + passwordPad();
}

/** 顯示用：把內部 email 還原成帳號名 */
export function toUsername(email) {
  const e = String(email || '');
  const d = emailDomain();
  return e.endsWith(`@${d}`) ? e.slice(0, -(d.length + 1)) : e;
}
