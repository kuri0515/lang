-- =====================================================================
-- korean · 0005_hanja
--
-- 【為什麼加這一欄】
--   韓語約 60% 詞彙是漢字詞（한자어）。對中文母語者，這是別的語言
--   學習產品給不了的紅利：知道 학교=學校、학생=學生 共享 학(學)，
--   就能一次帶出 학년(學年)、대학(大學)、유학(留學)…
--
--   百詞斩教英語詞根詞綴，那對中文使用者是外來知識、要從頭學；
--   韓語的漢字詞則是你天生就懂一半。這是本站該有的獨門優勢。
--
-- 【欄位語意】
--   hanja 為 null  = 尚未標註，或本來就不是漢字詞（固有語／外來語）
--   兩者刻意不區分：標註是漸進的，硬要區分會逼人現在就把每條分類完，
--   而錯誤的分類比空著更糟。要查固有語請看 scripts/annotate_hanja.py
--   裡明確列舉的清單。
--
--   混合詞保留韓文部分，例如 공부하다 → 工夫하다、선생님 → 先生님，
--   讓人看得出哪一段是漢字、哪一段是固有語法成分。
-- =====================================================================

alter table public.items
  add column if not exists hanja text;

comment on column public.items.hanja is
  '漢字詞寫法（正體）。混合詞保留韓文部分，如 工夫하다。null = 未標註或非漢字詞。';

-- 「找出所有共享某個漢字的詞」的查詢路徑。
-- 用 trigram 索引才能吃到 hanja like '%學%' 這種中間比對。
create extension if not exists pg_trgm;
create index if not exists items_hanja_trgm_idx
  on public.items using gin (hanja gin_trgm_ops)
  where hanja is not null;
