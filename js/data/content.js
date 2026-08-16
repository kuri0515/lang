// =====================================================================
// 內容層（decks / items）—— 唯讀為主，寫入在 admin.js
// =====================================================================
import { sb, ITEM_FIELDS } from './client.js';

export async function listDecks() {
  const { data, error } = await sb.from('decks')
    .select('id, slug, title, title_ko, description, level, sort_order')
    .order('sort_order').order('slug');
  if (error) throw error;
  return data ?? [];
}

export async function countItems(deckId) {
  const { count, error } = await sb.from('items')
    .select('id', { count: 'exact', head: true })
    .eq('deck_id', deckId).eq('is_active', true);
  if (error) throw error;
  return count ?? 0;
}

/** 搜尋條件收斂在此，瀏覽與自由練習共用同一套語意 */
function applyFilters(q, { tag, search, deckId, ids }) {
  if (deckId) q = q.eq('deck_id', deckId);
  if (tag) q = q.contains('tags', [tag]);
  if (ids?.length) q = q.in('id', ids);
  if (search?.trim()) {
    // 這些字元會擾亂 PostgREST 的 or 語法
    const k = search.trim().replace(/[%,()]/g, '');
    q = q.or(`ko.ilike.*${k}*,zh.ilike.*${k}*,romanization.ilike.*${k}*`);
  }
  return q;
}

/** 任意取材：瀏覽、自由練習、弱項集中練都走這裡 */
export async function pickItems({ ids = null, tag = '', search = '', deckId = null, limit = 300 } = {}) {
  const q = applyFilters(
    sb.from('items').select(ITEM_FIELDS).eq('is_active', true),
    { tag, search, deckId, ids });
  const { data, error } = await q.order('sort_order').limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** 所有標籤與各自條目數 */
export async function listTags() {
  const { data, error } = await sb.from('items').select('tags').eq('is_active', true);
  if (error) throw error;
  const count = {};
  for (const r of data ?? []) for (const t of r.tags || []) count[t] = (count[t] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]);
}

/**
 * 共享同一個漢字的其他詞。
 * 排除句子 —— 句子含此詞 ≠ 同源詞，會污染串聯。
 */
export async function sharesHanja(char, excludeId = null, limit = 5) {
  const { data, error } = await sb.from('items')
    .select('id, ko, zh, hanja')
    .eq('is_active', true).neq('item_type', 'sentence')
    .like('hanja', `%${char}%`).limit(limit + 1);
  if (error) throw error;
  return (data ?? []).filter((x) => x.id !== excludeId).slice(0, limit);
}

/** 選擇題干擾項池：一次抓好放記憶體，避免每題都打一次 API */
export async function distractorPool(deckId = null, limit = 400) {
  let q = sb.from('items').select('id, ko, zh, pos, tags, item_type, example_ko, example_zh, hanja')
    .eq('is_active', true);
  if (deckId) q = q.eq('deck_id', deckId);
  const { data, error } = await q.limit(limit);
  if (error) throw error;
  return data ?? [];
}
