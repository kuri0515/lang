-- =====================================================================
-- 0024_round_pools — 輪次池可以有很多個，各自記各自的進度
--
-- 【要解決的事】
--   原本一個使用者一列，也就是「輪練」只有一個池。
--   現在多了精讀：挑定某一幕之後，那一幕的詞該是它自己的一個池。
--   共用一列的話，在兩個池之間切換會互相覆蓋 ——
--   而覆蓋不會報錯，它只會讓另一個池的進度悄悄回到某個舊位置，
--   使用者的體感是「我明明掃到一半，怎麼又從頭來」。
--
-- 【pool 是什麼】
--   一個字串鍵，由前端決定：
--     deck:<slug>          照詞庫掃（預設，例如 deck:kana-01）
--     scene:<epId>:<n>     精讀的某一幕
--   刻意用字串而不是外鍵：池的種類還會長（整集、整季、某個標籤），
--   每加一種就一次 migration 的話沒有人想動它。
--   代價是資料庫不幫忙驗證，所以前端讀到不認識的鍵要能容忍。
--
-- 【舊資料】
--   既有的那一列就是「預設的詞庫池」，直接標成 deck:<roundDeck>。
--   但 roundDeck 是前端的設定，SQL 這裡看不到 ——
--   所以標成 'default'，由前端在讀取時把它認成預設池（見 data/progress.js）。
--   不刪：那是使用者真的掃過的進度。
-- =====================================================================

alter table public.study_rounds
  add column if not exists pool text not null default 'default';

alter table public.study_rounds drop constraint if exists study_rounds_pkey;
alter table public.study_rounds
  add constraint study_rounds_pkey primary key (user_id, pool);

comment on column public.study_rounds.pool is
  '這一列是哪一個輪次池：deck:<slug> 照詞庫掃、scene:<epId>:<n> 精讀的一幕。'
  '用字串而不是外鍵 —— 池的種類還會長，每加一種就一次 migration 沒有人想動它。'
  '代價是資料庫不驗證，前端讀到不認識的鍵要能容忍。';
