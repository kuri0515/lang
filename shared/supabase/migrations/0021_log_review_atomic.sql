-- =====================================================================
-- 0021_log_review_atomic — 正規複習也走 RPC，計數在資料庫裡累加
--
-- 【症狀】
--   韓文站稽核報 108 筆「user_cards 計數與 reviews 日誌不符」，
--   而且全部是同一個方向：卡片的次數**少於**日誌（卡片 2 / 日誌 10）。
--
-- 【原因：把「加一」算在客戶端】
--   saveReview 原本這樣寫卡片：
--       total_reviews: (prevCard.total_reviews ?? 0) + 1
--   prevCard 是這一輪開始時讀到的那張。而「新卡在同一輪內循環到會為止」
--   會把同一張卡排回隊尾再答一次，重排時只把排程欄位覆蓋上去：
--       card: { ...entry.card, ...next }        // next 沒有計數
--   於是同一輪內答第 2、3、4 次時，prev 都還是最初那個值，
--   每次都寫成 prev+1 —— 計數停在同一個數，日誌卻一筆筆累積。
--
--   這是典型的 read-modify-write：把累加算在讀到舊值的那一端，
--   只要中間有第二個寫入（或同一個寫入重複發生），就會覆蓋掉。
--
-- 【修法】
--   跟 log_practice 一樣改走 RPC，計數用 total_reviews + 1 在資料庫裡算。
--   排程欄位仍由前端算好帶進來 —— SM-2 的計算需要完整的卡片狀態，
--   放進 SQL 只會把演算法拆成兩半、兩邊各自漂移。
--   這裡要的只是「計數不要由客戶端決定」。
--
--   與 log_practice 的差別：這支會建立新卡（第一次學某個詞時），
--   而 log_practice 刻意不建（見 0009）。
-- =====================================================================

create or replace function public.log_review(
  p_item_id       uuid,
  p_direction     public.study_direction,
  p_rating        smallint,
  p_state         text,
  p_due_at        timestamptz,
  p_interval_days numeric,
  p_ease_factor   numeric,
  p_repetitions   int,
  p_lapses        int,
  p_elapsed_ms    int default null,
  p_mode          public.study_mode_kind default null,
  p_session_id    uuid default null,
  p_activity      public.activity_kind default 'review',
  p_prev_interval numeric default 0,
  p_prev_ease     numeric default 2.5
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok  int  := case when p_rating >= 3 then 1 else 0 end;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  insert into public.reviews
    (user_id, item_id, direction, rating, elapsed_ms, mode, session_id,
     is_free, activity, prev_interval_days, prev_ease_factor)
  values (v_uid, p_item_id, p_direction, p_rating, p_elapsed_ms, p_mode, p_session_id,
          false, coalesce(p_activity, 'review'), p_prev_interval, p_prev_ease);

  -- ★ 計數用 +1，不接受客戶端算好的值。
  --   排程欄位照收 —— 那是 SM-2 的結果，前端才有完整狀態可以算。
  insert into public.user_cards as c
    (user_id, item_id, direction, state, due_at, interval_days, ease_factor,
     repetitions, lapses, total_reviews, correct_reviews, last_reviewed_at)
  values (v_uid, p_item_id, p_direction, p_state, p_due_at, p_interval_days,
          p_ease_factor, p_repetitions, p_lapses, 1, v_ok, now())
  on conflict (user_id, item_id, direction) do update
    set state            = excluded.state,
        due_at           = excluded.due_at,
        interval_days    = excluded.interval_days,
        ease_factor      = excluded.ease_factor,
        repetitions      = excluded.repetitions,
        lapses           = excluded.lapses,
        total_reviews    = c.total_reviews + 1,
        correct_reviews  = c.correct_reviews + v_ok,
        last_reviewed_at = now();
end;
$$;

grant execute on function public.log_review(uuid, public.study_direction, smallint,
       text, timestamptz, numeric, numeric, int, int, int,
       public.study_mode_kind, uuid, public.activity_kind, numeric, numeric)
  to authenticated;
