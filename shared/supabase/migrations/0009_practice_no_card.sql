-- =====================================================================
-- korean · 0009_practice_no_card
--
-- 【0008 留下的問題】
--   0008 的 log_practice 用 insert ... on conflict，等於自由練習會替
--   還沒學過的詞建卡。但建出來的卡吃預設值 due_at = now()、state='new'，
--   會立刻擠進「待複習」，而且繞過每日新卡上限 ——
--   自由練 60 個詞，明天就多 60 個複習任務，正是那個上限要防的事。
--
-- 【定案】
--   自由練習只做兩件事：
--     1. 寫答題記錄（reviews）
--     2. 若那張卡已在輪轉中，累加計數（total/correct/last_reviewed_at）
--   絕不建卡、絕不改排程。要讓一個詞進入複習輪轉，只能透過「學新的」，
--   那條路徑才受每日新卡上限管控。
--
--   那些「練過但沒建卡」的詞不會被埋沒：前端把它們標為「練習過」，
--   與「未開始」分開顯示；同時因為沒有 user_cards 列，
--   它們仍然符合「新詞」的資格，之後照樣會被排進來正式學。
-- =====================================================================

create or replace function public.log_practice(
  p_item_id   uuid,
  p_direction public.study_direction,
  p_rating    smallint,
  p_elapsed_ms int default null,
  p_mode      public.study_mode_kind default null,
  p_session_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.reviews
    (user_id, item_id, direction, rating, elapsed_ms, mode, session_id, is_free)
  values (v_uid, p_item_id, p_direction, p_rating, p_elapsed_ms, p_mode, p_session_id, true);

  -- ★ 只更新既有的卡，不建立新卡。
  --   沒有 update 到任何列是正常情況（該詞尚未進入複習輪轉）。
  update public.user_cards
     set total_reviews    = total_reviews + 1,
         correct_reviews  = correct_reviews + case when p_rating >= 3 then 1 else 0 end,
         last_reviewed_at = now()
   where user_id = v_uid
     and item_id = p_item_id
     and direction = p_direction;
end;
$$;

-- ---------------------------------------------------------------------
-- 「練習過但未進輪轉」的詞
-- 前端用它把這批詞與「完全沒碰過」的區分開來。
-- ---------------------------------------------------------------------
create or replace view public.v_practiced_only as
select
  r.user_id,
  r.item_id,
  r.direction,
  i.ko, i.zh, i.hanja, i.item_type,
  count(*)                            as attempts,
  count(*) filter (where r.is_correct) as correct,
  round(avg(r.is_correct::int)::numeric, 4) as accuracy,
  min(r.reviewed_at)                  as first_at,
  max(r.reviewed_at)                  as last_at
from public.reviews r
join public.items i on i.id = r.item_id
left join public.user_cards c
       on c.user_id = r.user_id and c.item_id = r.item_id and c.direction = r.direction
where c.item_id is null              -- 只留沒有卡片的
group by r.user_id, r.item_id, r.direction, i.ko, i.zh, i.hanja, i.item_type;

alter view public.v_practiced_only set (security_invoker = on);
