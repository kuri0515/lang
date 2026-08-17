// =====================================================================
// 認證 —— 對外一律用「帳號名」，email 解析封在這一層
// =====================================================================
import { sb } from './client.js';
import { toEmail, toPassword, toUsername } from '../core/auth-map.js';

/**
 * 帳號名 → email。三段容錯：
 *   1. 含 @ → 本來就是 email
 *   2. 問後端 email_for_username()（帳號可能綁真實信箱）
 *   3. 查無 → 退回 <name>@kuri0515.local 的機械映射
 */
async function resolveEmail(input) {
  const raw = String(input || '').trim();
  if (raw.includes('@')) return raw.toLowerCase();
  try {
    const { data, error } = await sb.rpc('email_for_username', { p_username: raw });
    if (!error && data) return data;
  } catch { /* RPC 不存在或網路失敗時靜默退回機械映射 */ }
  return toEmail(raw);
}

export const signUp = (username, password, displayName) =>
  sb.auth.signUp({
    email: toEmail(username),
    password: toPassword(password),
    options: {
      data: {
        username: String(username).trim().toLowerCase(),
        display_name: displayName || username,
        // 這裡就算塞 role:'admin' 也沒用 —— handle_new_user trigger
        // 只在 service_role 建號時採信 role。
      },
    },
  });

export const signIn = async (username, password) =>
  sb.auth.signInWithPassword({
    email: await resolveEmail(username),
    password: toPassword(password),
  });

export const signOut = () => sb.auth.signOut();

/** 寄密碼重置信到帳號綁定的真實信箱 */
export const resetPassword = async (username) =>
  sb.auth.resetPasswordForEmail(await resolveEmail(username), {
    redirectTo: window.location.origin + window.location.pathname,
  });

export async function currentUser() {
  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

export const onChange = (cb) =>
  sb.auth.onAuthStateChange((_e, s) => cb(s?.user ?? null));

export const displayName = (u) =>
  u?.user_metadata?.display_name || u?.user_metadata?.username || toUsername(u?.email);

/** 讀自己的 profile（含 role）。isAdmin 僅供 UX，真門禁在 RLS。 */
export async function myProfile(userId) {
  const { data, error } = await sb.from('profiles')
    .select('username, display_name, role, study_mode, daily_new_limit')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
