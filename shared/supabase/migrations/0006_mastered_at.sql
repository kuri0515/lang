-- =====================================================================
-- korean · 0006_mastered_at
--
-- 【問題】
--   「已經記住哪些詞」目前是即時算出來的（state='review' 且間隔 ≥21 天），
--   算得出「現在哪些掌握了」，但答不出「我是什麼時候記住這個詞的」——
--   那個時刻沒有被記下來，事後也無從還原。
--
-- 【修法】
--   加 mastered_at，由 trigger 維護而非前端寫入：
--     * 跨過門檻的那一刻蓋上時間戳
--     * 已經有值就不再更新（記的是「第一次達成」）
--     * 若之後遺忘掉出門檻，清空 —— 重新達成時會蓋上新的時間
--
--   規則放在 trigger 而不是前端，是因為 user_cards 有兩條寫入路徑
--   （正規複習、未來可能的匯入／修正），規則寫在資料庫才只有一份，
--   也不必信任客戶端。
--
-- 【門檻定義】
--   間隔拉到 21 天以上才算「記住」。這是間隔重複的慣例：
--   能隔三週還想得起來，才算進入長期記憶，而不是短期硬記。
-- =====================================================================

alter table public.user_cards
  add column if not exists mastered_at timestamptz;

comment on column public.user_cards.mastered_at is
  '第一次達到掌握門檻（state=review 且 interval_days>=21）的時刻；掉出門檻時清空。由 trigger 維護。';

-- 門檻只定義一次，view 與 trigger 共用
create or replace function public.is_mastered(p_state text, p_interval numeric)
returns boolean language sql immutable as $$
  select p_state = 'review' and p_interval >= 21;
$$;

create or replace function public.touch_mastered_at()
returns trigger language plpgsql as $$
begin
  if public.is_mastered(new.state, new.interval_days) then
    -- 只記第一次達成，之後複習不覆蓋
    if new.mastered_at is null then new.mastered_at := now(); end if;
  else
    -- 遺忘掉出門檻 → 清空，重新達成時會是新的時間
    new.mastered_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists user_cards_mastered on public.user_cards;
create trigger user_cards_mastered
  before insert or update on public.user_cards
  for each row execute function public.touch_mastered_at();

-- ---------------------------------------------------------------------
-- 回填既有資料
--
-- 已經掌握但沒有 mastered_at 的卡，用 last_reviewed_at 當作達成時刻。
-- 那是「最後一次複習」而非「首次跨過門檻」，是近似值 ——
-- 但原始時刻確實沒被記錄過，這是能取得的最接近的真實時間。
-- ---------------------------------------------------------------------
update public.user_cards
set mastered_at = coalesce(last_reviewed_at, updated_at)
where mastered_at is null
  and public.is_mastered(state, interval_days);

-- ---------------------------------------------------------------------
-- 「我的學習軌跡」：每個詞什麼時候開始學、最近何時複習、何時記住
-- ---------------------------------------------------------------------
create or replace view public.v_learning_timeline as
select
  c.user_id,
  c.item_id,
  c.direction,
  i.ko,
  i.zh,
  i.hanja,
  i.item_type,
  c.state,
  c.created_at        as first_learned_at,   -- 第一次學這個詞（這個方向）
  c.last_reviewed_at,                        -- 最近一次複習
  c.mastered_at,                             -- 何時記住的（未達成則為 null）
  c.due_at,                                  -- 下次該複習的時間
  c.interval_days,
  c.total_reviews,
  c.correct_reviews,
  case when c.total_reviews = 0 then null
       else round(c.correct_reviews::numeric / c.total_reviews, 4) end as accuracy,
  public.is_mastered(c.state, c.interval_days) as mastered
from public.user_cards c
join public.items i on i.id = c.item_id;

alter view public.v_learning_timeline set (security_invoker = on);

create index if not exists user_cards_mastered_idx
  on public.user_cards(user_id, mastered_at desc)
  where mastered_at is not null;
