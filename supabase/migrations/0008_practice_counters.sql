-- =====================================================================
-- korean · 0008_practice_counters
--
-- 【問題】
--   user_cards.total_reviews / correct_reviews 只在「正規複習」時更新；
--   自由練習只寫 reviews、不動 user_cards。造成兩個後果：
--
--   1. 同一件事有兩個數字。實測：user_cards 算出 韓→中 87%、中→韓 90%，
--      而 reviews 的真實作答是 76% 與 57%。放在同一個畫面上會互相打架。
--   2. 弱項判定失效。v_item_accuracy 建在 user_cards 上，
--      一個詞若只在自由練習裡反覆答錯，永遠不會被標成弱項。
--
-- 【修法】
--   釐清兩組欄位的語意：
--     排程欄位（due_at / interval_days / ease_factor / state / repetitions）
--       = 間隔重複的節奏。自由練習絕不可動，否則臨時多背幾遍就會把
--         下次複習日往後推。
--     計數欄位（total_reviews / correct_reviews / last_reviewed_at）
--       = 「這張卡我答過幾次、對幾次」。這與用什麼方式練無關，
--         自由練習理當計入。
--
--   用一個 RPC 同時寫 reviews 與計數，兩者在同一個交易裡，
--   不會出現「記錄寫了但計數沒加」的半套狀態。
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
security invoker          -- 沿用呼叫者身分，RLS 照常生效
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

  -- 只加計數與最近作答時間，排程欄位一律不碰
  insert into public.user_cards
    (user_id, item_id, direction, total_reviews, correct_reviews, last_reviewed_at)
  values (v_uid, p_item_id, p_direction, 1, case when p_rating >= 3 then 1 else 0 end, now())
  on conflict (user_id, item_id, direction) do update
    set total_reviews   = public.user_cards.total_reviews + 1,
        correct_reviews = public.user_cards.correct_reviews
                          + case when p_rating >= 3 then 1 else 0 end,
        last_reviewed_at = now();
end;
$$;

grant execute on function public.log_practice(uuid, public.study_direction, smallint, int,
                                              public.study_mode_kind, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 回填：用 reviews 重算所有卡的計數
--
-- reviews 是只追加的真實日誌，是這兩個數字的權威來源。
-- 現有計數是「只算了正規複習」的殘缺值，直接以日誌為準重算。
-- ---------------------------------------------------------------------
update public.user_cards c
set total_reviews   = r.n,
    correct_reviews = r.ok
from (
  select user_id, item_id, direction,
         count(*)                           as n,
         count(*) filter (where is_correct) as ok
  from public.reviews
  group by user_id, item_id, direction
) r
where c.user_id = r.user_id
  and c.item_id = r.item_id
  and c.direction = r.direction
  and (c.total_reviews <> r.n or c.correct_reviews <> r.ok);
