// =====================================================================
// 管理員寫入 —— 權限由 RLS 的 items_admin_write 把關，
// 非管理員呼叫會拿到錯誤或空結果，前端的 isAdmin 僅供 UX。
// =====================================================================
import { sb, ITEM_FIELDS } from './client.js';

/**
 * 更新條目。回傳資料庫回讀的那一行 —— 呼叫端拿到什麼，
 * 就是雲端真正存了什麼，不靠斷言。
 */
export async function updateItem(id, patch) {
  const { data, error } = await sb.from('items')
    .update(patch).eq('id', id).select(ITEM_FIELDS).single();
  if (error) throw error;
  return data;
}

/**
 * 批次下架／恢復。
 * ★ 刻意是軟刪除：真刪 items 會 cascade 掉 user_cards 與 reviews，
 *   使用者累積的學習記錄與正確率會一起消失且無法復原。
 */
export async function setItemsActive(ids, active) {
  if (!ids?.length) return [];
  const { data, error } = await sb.from('items')
    .update({ is_active: active }).in('id', ids).select('id');
  if (error) throw error;
  return data ?? [];
}

export async function ensureDeck(slug, title, level = null) {
  const { data, error } = await sb.from('decks')
    .upsert({ slug, title, level }, { onConflict: 'slug' })
    .select('id, slug, title').single();
  if (error) throw error;
  return data;
}

/**
 * 批次新增。slug 需全域唯一，用「詞庫 slug + 時間戳 + 序號」，
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
    sort_order: 9000 + i,     // 排在既有內容之後
  }));
  const { data, error } = await sb.from('items').insert(payload).select(ITEM_FIELDS);
  if (error) throw error;
  return data ?? [];
}
