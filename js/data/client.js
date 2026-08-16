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
