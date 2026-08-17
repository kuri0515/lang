-- =====================================================================
-- korean · 0007_session_mode
--
-- 【問題】
--   記錄頁答不出「今天以什麼方式學了什麼」——
--   reviews 記了時間、方向、對錯、耗時，但沒記：
--     * 題型：翻卡自評／四選一／詞序重組／聽音選義
--     * 場次：哪幾題屬於同一輪（現在只能按「天」分組，
--             一天分好幾次學就全糊在一起）
--     * 是否自由練習：只能靠 user_cards 有沒有變動間接推測
--
-- 【修法】
--   三個欄位。session_id 由前端在每輪開始時產生（uuid），
--   同一輪的每一筆帶同一個值 —— 這樣「一次學習」才是可查詢的單位。
--
--   既有 217 筆維持 null：那些是加欄位前產生的，事後補題型只能用猜的，
--   而猜錯的資料比沒有更糟。前端對 null 顯示為「未分場次」。
-- =====================================================================

do $$ begin
  create type public.study_mode_kind as enum ('flip', 'choice', 'scramble', 'listen');
exception when duplicate_object then null; end $$;

alter table public.reviews
  add column if not exists mode public.study_mode_kind,
  add column if not exists session_id uuid,
  add column if not exists is_free boolean not null default false;

comment on column public.reviews.mode is
  '題型。null = 0007 之前的記錄，當時沒有記錄此資訊。';
comment on column public.reviews.session_id is
  '同一輪學習共用一個 id，由前端在該輪開始時產生。null = 0007 之前的記錄。';
comment on column public.reviews.is_free is
  'true = 自由練習（只記成績、不動複習排程）。';

create index if not exists reviews_session_idx
  on public.reviews(user_id, session_id, reviewed_at)
  where session_id is not null;

-- ---------------------------------------------------------------------
-- 場次彙總：一輪學習一列
-- 記錄頁靠它一次拿到「幾點到幾點、什麼題型、幾題、正確率多少」，
-- 不必把幾百筆明細全撈回前端再自己 group by。
-- ---------------------------------------------------------------------
create or replace view public.v_sessions as
select
  user_id,
  session_id,
  min(mode)::text                       as mode,
  min(direction)::text                  as direction,
  bool_or(is_free)                      as is_free,
  count(*)                              as answered,
  count(*) filter (where is_correct)    as correct,
  round(avg(is_correct::int)::numeric, 4) as accuracy,
  min(reviewed_at)                      as started_at,
  max(reviewed_at)                      as ended_at,
  extract(epoch from (max(reviewed_at) - min(reviewed_at)))::int as duration_sec,
  sum(elapsed_ms)                       as total_elapsed_ms
from public.reviews
where session_id is not null
group by user_id, session_id;

alter view public.v_sessions set (security_invoker = on);
