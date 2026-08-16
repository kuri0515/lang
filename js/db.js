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
// 對外一律用「帳號名」，email 解析封在這一層，UI 不需要知道。
//
// 解析順序：
//   1. 輸入含 @ → 本來就是 email，直接用
//   2. 問後端 email_for_username()（帳號可能綁真實信箱）
//   3. 查無 → 退回 <name>@kuri0515.local 的機械映射
async function resolveEmail(input) {
  const raw = String(input || '').trim();
  if (raw.includes('@')) return raw.toLowerCase();
  try {
    const { data, error } = await sb.rpc('email_for_username', { p_username: raw });
    if (!error && data) return data;
  } catch { /* RPC 不存在或網路失敗時靜默退回機械映射 */ }
  return toEmail(raw);
}

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
  signIn: async (username, password) =>
    sb.auth.signInWithPassword({
      email: await resolveEmail(username),
      password: toPassword(password),
    }),
  /** 寄密碼重置信到帳號綁定的真實信箱 */
  resetPassword: async (username) =>
    sb.auth.resetPasswordForEmail(await resolveEmail(username), {
      redirectTo: window.location.origin + window.location.pathname,
    }),
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

/** 尚未建卡的新條目（對指定方向而言是「新」的）。tag 可限定主題。 */
export async function fetchNewItems(userId, deckId, dirs, limit = 20, tag = '') {
  const { data: seen, error: e1 } = await sb
    .from('user_cards').select('item_id, direction').eq('user_id', userId);
  if (e1) throw e1;
  const seenKey = new Set((seen ?? []).map((r) => `${r.item_id}|${r.direction}`));

  let q = sb.from('items').select('*').eq('is_active', true)
    .order('sort_order').order('slug');
  if (deckId) q = q.eq('deck_id', deckId);
  if (tag) q = q.contains('tags', [tag]);
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

// ---------- 詞庫瀏覽 ----------
/** 搜尋 / 篩選條目，並附上「我學到哪了」的狀態 */
export async function browseItems(userId, { q = '', tag = '', deckId = null, limit = 300 } = {}) {
  let query = sb.from('items')
    .select('id, ko, zh, romanization, pos, item_type, example_ko, example_zh, note, tags, audio_url, hanja')
    .eq('is_active', true);

  if (deckId) query = query.eq('deck_id', deckId);
  if (tag) query = query.contains('tags', [tag]);
  if (q.trim()) {
    const k = q.trim().replace(/[%,()]/g, '');   // 這些字元會擾亂 PostgREST 的 or 語法
    query = query.or(`ko.ilike.*${k}*,zh.ilike.*${k}*,romanization.ilike.*${k}*`);
  }

  const { data, error } = await query.order('sort_order').limit(limit);
  if (error) throw error;
  const items = data ?? [];
  if (!items.length || !userId) return items.map((i) => ({ ...i, cards: {} }));

  // 附上兩個方向的學習狀態
  const { data: cards } = await sb.from('user_cards')
    .select('item_id, direction, state, total_reviews, correct_reviews')
    .eq('user_id', userId)
    .in('item_id', items.map((i) => i.id));

  const byItem = {};
  for (const c of cards ?? []) (byItem[c.item_id] ||= {})[c.direction] = c;
  return items.map((i) => ({ ...i, cards: byItem[i.id] || {} }));
}

/** 所有標籤與各自條目數 */
export async function listTags() {
  const { data, error } = await sb.from('items').select('tags').eq('is_active', true);
  if (error) throw error;
  const count = {};
  for (const r of data ?? []) for (const t of r.tags || []) count[t] = (count[t] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]);
}

/** 今日已學的新卡數（用來套用每日新卡上限） */
export async function newCardsToday(userId) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count, error } = await sb.from('user_cards')
    .select('item_id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', start.toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** 選擇題的干擾項來源：同詞庫的條目池，一次抓好放記憶體 */
export async function distractorPool(deckId = null, limit = 400) {
  let q = sb.from('items').select('id, ko, zh, pos, tags, item_type').eq('is_active', true);
  if (deckId) q = q.eq('deck_id', deckId);
  const { data, error } = await q.limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** 近 N 天的每日答題量與正確率（學習曲線用） */
export async function dailyStats(userId, days = 30) {
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('reviews')
    .select('is_correct, reviewed_at')
    .eq('user_id', userId).gte('reviewed_at', from.toISOString());
  if (error) throw error;

  const byDay = {};
  for (const r of data ?? []) {
    const d = new Date(r.reviewed_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    (byDay[k] ||= { n: 0, correct: 0 });
    byDay[k].n += 1;
    if (r.is_correct) byDay[k].correct += 1;
  }

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const v = byDay[k] || { n: 0, correct: 0 };
    out.push({ date: k, n: v.n, correct: v.correct,
               accuracy: v.n ? v.correct / v.n : null });
  }
  return out;
}

// ---------- 管理員：編輯內容 ----------
/**
 * 更新條目。回傳資料庫回讀的那一行 —— 不靠斷言，
 * 呼叫端拿到什麼就是雲端真正存了什麼。
 * 權限由 RLS 的 items_admin_write 把關，非管理員會拿到錯誤。
 */
export async function updateItem(id, patch) {
  const { data, error } = await sb
    .from('items').update(patch).eq('id', id)
    .select('id, ko, zh, romanization, pos, item_type, example_ko, example_zh, note, tags, audio_url, hanja')
    .single();
  if (error) throw error;
  return data;
}

/**
 * 批次下架／恢復條目。
 *
 * ★ 刻意做成軟刪除（is_active=false）而非真刪：
 *   items 被真刪會連帶 cascade 掉 user_cards 與 reviews，
 *   使用者辛苦累積的學習記錄與正確率會一起消失，且無法復原。
 *   下架後條目不再出現在學習與瀏覽中，效果等同刪除，但可還原。
 */
export async function setItemsActive(ids, active) {
  if (!ids?.length) return [];
  const { data, error } = await sb
    .from('items').update({ is_active: active }).in('id', ids).select('id');
  if (error) throw error;
  return data ?? [];
}

// ---------- 學習記錄（歷史）----------
/**
 * 逐筆答題記錄，新到舊。
 * @param before ISO 時間字串，用於分頁（取比它更早的）
 */
export async function listHistory(userId, { limit = 100, before = null, dir = null } = {}) {
  let q = sb.from('reviews')
    .select('id, direction, rating, is_correct, elapsed_ms, reviewed_at, source, items(id, ko, zh, romanization, item_type)')
    .eq('user_id', userId)
    .order('reviewed_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('reviewed_at', before);
  if (dir) q = q.eq('direction', dir);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).filter((r) => r.items);
}

// ---------- 自由練習 ----------
/**
 * 只寫答題記錄，不動 user_cards 的排程。
 *
 * ★ 為什麼分開：自由練習若也更新到期時間，臨時多背幾遍就會把
 *   下次複習日往後推，等於破壞了間隔重複的節奏。歷史與正確率照記，
 *   排程留給正規複習決定。
 */
export async function logPractice({ userId, item, direction, rating, elapsedMs }) {
  const { error } = await sb.from('reviews').insert({
    user_id: userId, item_id: item.id, direction, rating,
    elapsed_ms: elapsedMs ?? null,
  });
  if (error) throw error;
}

/** 自由練習取材：可依標籤／搜尋／指定 id 取任意條目，不看到期時間 */
export async function pickItems({ ids = null, tag = '', q = '', limit = 50 } = {}) {
  let query = sb.from('items')
    .select('id, ko, zh, romanization, pos, item_type, example_ko, example_zh, note, tags, audio_url, hanja')
    .eq('is_active', true);
  if (ids?.length) query = query.in('id', ids);
  if (tag) query = query.contains('tags', [tag]);
  if (q.trim()) {
    const k = q.trim().replace(/[%,()]/g, '');
    query = query.or(`ko.ilike.*${k}*,zh.ilike.*${k}*,romanization.ilike.*${k}*`);
  }
  const { data, error } = await query.limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ---------- 管理員：新增內容 ----------
/** 建立或取得詞庫 */
export async function ensureDeck(slug, title, level = null) {
  const { data, error } = await sb.from('decks')
    .upsert({ slug, title, level }, { onConflict: 'slug' })
    .select('id, slug, title').single();
  if (error) throw error;
  return data;
}

/**
 * 批次新增條目。slug 需全域唯一，這裡用「詞庫 slug + 時間戳 + 序號」，
 * 同一批不會撞，重跑也不會覆蓋既有資料。
 */
export async function insertItems(deckId, deckSlug, rows) {
  const stamp = Date.now().toString(36);
  const payload = rows.map((r, i) => ({
    deck_id: deckId,
    slug: `${deckSlug}-${stamp}-${String(i + 1).padStart(3, '0')}`,
    item_type: r.item_type || 'word',
    ko: r.ko, zh: r.zh,
    romanization: r.romanization || null,
    hanja: r.hanja || null,
    pos: r.pos || null,
    example_ko: r.example_ko || null,
    example_zh: r.example_zh || null,
    note: r.note || null,
    tags: r.tags || [],
    sort_order: 9000 + i,      // 排在既有內容之後
  }));
  const { data, error } = await sb.from('items').insert(payload).select('id');
  if (error) throw error;
  return data ?? [];
}

// ---------- 漢字詞 ----------
/**
 * 找出共享同一個漢字的其他詞。
 * 這是漢字詞真正的價值：學 학교(學校) 時順手看到 학생(學生)、
 * 대학(大學)，一個字帶出一串。
 */
export async function sharesHanja(char, excludeId = null, limit = 8) {
  const { data, error } = await sb.from('items')
    .select('id, ko, zh, hanja')
    .eq('is_active', true)
    .neq('item_type', 'sentence')   // 句子含此詞 ≠ 同源詞，會污染串聯
    .like('hanja', `%${char}%`)
    .limit(limit + 1);
  if (error) throw error;
  return (data ?? []).filter((x) => x.id !== excludeId).slice(0, limit);
}

/** 只列漢字詞（給「漢字詞」篩選用） */
export async function hanjaItems(limit = 300) {
  const { data, error } = await sb.from('items')
    .select('id, ko, zh, hanja, romanization, pos, item_type, tags')
    .eq('is_active', true).not('hanja', 'is', null)
    .order('sort_order').limit(limit);
  if (error) throw error;
  return data ?? [];
}
