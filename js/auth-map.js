// =====================================================================
// 帳號名 ↔ email 映射
//
// Supabase Auth 只認 email。本站讓使用者輸入「帳號名」，
// 在這裡透明轉成 email 再送出。
//
// ⚠️ 本檔的三個常數必須與 scripts/create_user.py 完全一致，
//    改一邊等於改壞登入。
// =====================================================================

export const EMAIL_DOMAIN = 'kuri0515.local';
export const PASSWORD_PAD = '-k0515';
export const MIN_LEN = 6;

/** `kuri` → `kuri@kuri0515.local`；已經是 email 就原樣通過 */
export function toEmail(username) {
  const u = String(username || '').trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${EMAIL_DOMAIN}`;
}

/**
 * 短密碼透明補位以滿足 Supabase 的 6 位下限。
 * ⚠️ 這不增加密碼強度 —— 只是讓短密碼能用。
 */
export function toPassword(raw) {
  const p = String(raw || '');
  return p.length >= MIN_LEN ? p : p + PASSWORD_PAD;
}

/** 顯示用：把內部 email 還原成帳號名 */
export function toUsername(email) {
  const e = String(email || '');
  return e.endsWith(`@${EMAIL_DOMAIN}`) ? e.slice(0, -(EMAIL_DOMAIN.length + 1)) : e;
}
