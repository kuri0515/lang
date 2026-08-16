// =====================================================================
// 資料存取層 —— 所有 Supabase 呼叫集中在此
// UI 不直接碰 supabase client（解耦：換後端只改本檔）
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { toEmail, toPassword, toUsername } from './auth-map.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const DIRECTIONS = ['ko2zh', 'zh2ko'];
export const DIR_LABEL = { ko2zh: '看韓文 → 想中文', zh2ko: '看中文 → 想韓文' };

// ---------- Auth ----------
// 對外一律用「帳號名」，email 映射封在這一層，UI 不需要知道。
export const auth = {
  signUp: (username, password, displayName) =>
    sb.auth.signUp({
      email: toEmail(username),
      password: toPassword(password),
      options: {
        data: {
          username: String(username).trim().toLowerCase(),
          display_name: displayName || username,
          // 注意：這裡就算塞 role:'admin' 也沒用 ——
          // handle_new_user trigger 只在 service_role 建號時採信 role。
        },
      },
    }),
  signIn: (username, password) =>
    sb.auth.signInWithPassword({ email: toEmail(username), password: toPassword(password) }),
  signOut: () => sb.auth.signOut(),
  async user() {
    const { data } = await sb.auth.getUser();
    return data?.user ?? null;
  },
  onChange: (cb) => sb.auth.onAuthStateChange((_e, s) => cb(s?.user ?? null)),
  displayName: (u) =>
    u?.user_metadata?.display_name || u?.user_metadata?.username || toUsername(u?.email),
};

/** 讀自己的 profile（含 role）。isAdmin 僅供 UX，真門禁在 RLS。 */
export async function myProfile(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('username, display_name, role, study_mode, daily_new_limit')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

// ---------- 內容 ----------
export async function listDecks() {
  const { data, error } = await sb
    .from('decks')
    .select('id, slug, title, title_ko, description, level, sort_order')
    .order('sort_order').order('slug');
  if (error) throw error;
  return data ?? [];
}

export async function countItems(deckId) {
  const { count, error } = await sb
    .from('items').select('id', { count: 'exact', head: true })
    .eq('deck_id', deckId).eq('is_active', true);
  if (error) throw error;
  return count ?? 0;
}

// ---------- 學習佇列 ----------
/** 到期的複習卡。dirs 為要納入的方向陣列。 */
export async function fetchDue(userId, dirs = DIRECTIONS, limit = 200) {
  const { data, error } = await sb
    .from('user_cards')
    .select('*, items(*)')
    .eq('user_id', userId)
    .in('direction', dirs)
    .neq('state', 'suspended')
    .lte('due_at', new Date().toISOString())
    .order('due_at')
    .limit(limit);
  if (error) throw error;
  return (data ?? []).filter((c) => c.items);
}

/** 尚未建卡的新條目（對指定方向而言是「新」的）。 */
export async function fetchNewItems(userId, deckId, dirs, limit = 20) {
  const { data: seen, error: e1 } = await sb
    .from('user_cards').select('item_id, direction').eq('user_id', userId);
  if (e1) throw e1;
  const seenKey = new Set((seen ?? []).map((r) => `${r.item_id}|${r.direction}`));

  let q = sb.from('items').select('*').eq('is_active', true)
    .order('sort_order').order('slug');
  if (deckId) q = q.eq('deck_id', deckId);
  const { data, error } = await q.limit(Math.max(limit * 5, 300));
  if (error) throw error;

  // 展開成 (條目 × 方向) 的卡，過濾掉已建卡的
  const out = [];
  for (const item of data ?? []) {
    for (const dir of dirs) {
      if (!seenKey.has(`${item.id}|${dir}`)) out.push({ item, direction: dir, card: null });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------- 寫入 ----------
export async function saveReview({ userId, item, direction, prevCard, rating, next, elapsedMs }) {
  const prev = prevCard || {};
  const isCorrect = rating >= 3;

  const cardRow = {
    user_id: userId,
    item_id: item.id,
    direction,
    ...next,
    total_reviews: (prev.total_reviews ?? 0) + 1,
    correct_reviews: (prev.correct_reviews ?? 0) + (isCorrect ? 1 : 0),
  };

  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    sb.from('user_cards').upsert(cardRow, { onConflict: 'user_id,item_id,direction' }),
    sb.from('reviews').insert({
      user_id: userId,
      item_id: item.id,
      direction,
      rating,
      elapsed_ms: elapsedMs ?? null,
      prev_interval_days: prev.interval_days ?? 0,
      prev_ease_factor: prev.ease_factor ?? 2.5,
    }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
}

// ---------- 統計 ----------
export async function todayStats(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data, error } = await sb
    .from('reviews').select('is_correct')
    .eq('user_id', userId).gte('reviewed_at', start.toISOString());
  if (error) throw error;
  const rows = data ?? [];
  const correct = rows.filter((r) => r.is_correct).length;
  return {
    reviewed: rows.length,
    correct,
    accuracy: rows.length ? correct / rows.length : null,
  };
}

export async function overallStats(userId) {
  const { data, error } = await sb
    .from('user_cards').select('total_reviews, correct_reviews, state, interval_days')
    .eq('user_id', userId);
  if (error) throw error;
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + r.total_reviews, 0);
  const correct = rows.reduce((s, r) => s + r.correct_reviews, 0);
  return {
    cards: rows.length,
    // 「已掌握」= 進入複習期且間隔已拉到 21 天以上
    mastered: rows.filter((r) => r.state === 'review' && Number(r.interval_days) >= 21).length,
    accuracy: total ? correct / total : null,
  };
}

/** 弱項：正確率低 / 遺忘次數多，優先複習 */
export async function weakItems(userId, limit = 20) {
  const { data, error } = await sb
    .from('v_item_accuracy').select('*')
    .eq('user_id', userId).gte('total_reviews', 3)
    .order('accuracy', { ascending: true }).order('lapses', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
