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

/**
 * 登入狀態變化。
 *
 * ★ 把事件名一起交出去。onAuthStateChange 不只在登入登出時觸發 ——
 *   TOKEN_REFRESHED（約每小時一次）與分頁重新取得焦點也會觸發。
 *   把事件丟掉的話，呼叫端無從分辨「使用者換人了」與「只是換了一張 token」，
 *   只能每次都重跑一遍啟動流程。
 */
// 目前的 access token。給「頁面關閉時用 keepalive 送出」那條路用 ——
// 那時來不及等 getSession()（它是非同步的），而 keepalive 的請求
// 必須當場帶好授權標頭。onAuthStateChange 每次都給我們最新的 session，
// 順手記下來就好。
let _token = null;
export const accessToken = () => _token;

export const onChange = (cb) =>
  sb.auth.onAuthStateChange((event, s) => {
    _token = s?.access_token ?? null;
    cb(s?.user ?? null, event);
  });

export const displayName = (u) =>
  u?.user_metadata?.display_name || u?.user_metadata?.username || toUsername(u?.email);

/** 讀自己的 profile（含 role）。isAdmin 僅供 UX，真門禁在 RLS。 */
export async function myProfile(userId) {
  const { data, error } = await sb.from('profiles')
    .select('username, display_name, role, study_prefs')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * 練習方式的偏好（題型／方向／內容類型）。
 *
 * 【為什麼要上雲端】
 *   換一台裝置登入就該還在。這是「我習慣怎麼練」，不是「我做到哪」——
 *   前者跟著人走，後者跟著裝置走也無所謂。
 *
 * 【失敗不吵】
 *   存不上去頂多是下次要重設一次，不該讓它擋住學習。
 *   本機那一份仍然有效，同一台裝置照樣記得。
 */
/**
 * 存練習偏好到雲端。
 *
 * ★ 失敗要說出來。原本 catch {} 全吞，理由是「存不上頂多下次重設」——
 *   但實際發生的是欄位層權限少授一欄（0017 加欄位、忘了補 0002 的 grant），
 *   寫入被拒了整整一段時間而沒有任何地方會提。
 *   本機那份仍然有效，所以不擋使用者；只在主控台留一行，
 *   讓下次有人查「設定為什麼不同步」時看得到線索。
 */
export async function savePrefs(userId, prefs) {
  if (!userId) return;
  const { error } = await sb.from('profiles')
    .update({ study_prefs: prefs }).eq('id', userId);
  if (error) console.warn('[prefs] 雲端同步失敗，本機那份仍然有效：', error.message);
}
