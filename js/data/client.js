// =====================================================================
// Supabase 客戶端與共用常量
// 只有本檔認識 supabase-js；其餘 data/* 透過 sb 使用它。
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** 條目欄位清單集中一處 —— 之前四個查詢各自抄一份，加欄位就會漏掉某個。 */
export const ITEM_FIELDS =
  'id, ko, zh, romanization, hanja, pos, item_type, example_ko, example_zh, note, tags, audio_url';

export const DIRECTIONS = ['ko2zh', 'zh2ko'];
export const DIR_LABEL = { ko2zh: '看韓文 → 想中文', zh2ko: '看中文 → 想韓文' };
export const DIR_SHORT = { ko2zh: '韓→中', zh2ko: '中→韓' };
export const TYPE_LABEL = { word: '單字', phrase: '詞組', sentence: '句子' };
export const STATE_LABEL = { new: '新', learning: '學習中', review: '複習中', suspended: '暫停' };
export const RATE_LABEL = { 1: '忘了', 2: '有點難', 3: '記得', 4: '很簡單' };

/**
 * 分頁撈完整個結果集。
 *
 * 【為什麼需要】
 *   PostgREST 有伺服器端的單次回傳上限（Supabase 預設 1000 列），
 *   前端再各自寫死 limit 300／400 這種數字，詞庫一長就靜默截斷 ——
 *   不會報錯，只是東西「不見了」。實際踩到：詞庫到 347 條時，
 *   瀏覽頁的 limit=300 讓 47 條查不到。
 *
 *   固定上限治不了本，只是把牆往後挪。改成分頁撈到沒有為止。
 *
 * @param {() => object} build 每次呼叫都要回傳「全新的」query builder
 *                             （PostgREST 的 builder 是可變的，重用會疊加條件）
 */
export async function fetchAll(build, { pageSize = 1000, hardCap = 50000 } = {}) {
  const out = [];
  for (let from = 0; from < hardCap; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;   // 撈完了
  }
  console.warn(`[fetchAll] 達到硬上限 ${hardCap}，結果可能不完整`);
  return out;
}
