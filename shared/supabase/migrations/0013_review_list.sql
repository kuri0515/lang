-- =====================================================================
-- 0013_review_list — 手動回顧清單
--
-- 【解決什麼】
--   SRS 給的是一套統一的節奏，但學習者自己知道哪幾個詞特別卡 ——
--   「不同詞的記憶週期不一樣」這件事，演算法只能從作答結果事後推斷，
--   本人卻是當下就知道的。這張表讓那個判斷有地方放。
--
-- 【為什麼不直接改 user_cards 的到期時間】
--   臨時多背幾遍就把下次複習日往後推，會破壞間隔重複的節奏 ——
--   那正是 logPractice 刻意不動排程的理由（見 data/progress.js）。
--   手動回顧走自由練習：答題與正確率照記，排程留給正規複習決定。
--   所以清單是「另一條並行的路」，不是對排程的覆寫。
--
-- 【為什麼要留 removed_at 而不是直接刪列】
--   「我曾經覺得這個詞難」本身就是學習歷史的一部分。
--   直接刪掉的話，之後想回答「哪些詞我反覆標記過」就無從查起 ——
--   而那正是最該多練的一批。軟移除也讓「加回來」不會產生重複列。
--
-- 【方向為什麼不進主鍵】
--   標記的是「這個詞我不熟」，不是「這個方向不熟」。
--   人在標記當下不會分方向想，硬要他選只是增加摩擦。
--   真要分方向的資訊，reviews 裡本來就有。
-- =====================================================================

create table if not exists public.review_list (
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  note       text,                     -- 為什麼標它（可留空）
  added_at   timestamptz not null default now(),
  removed_at timestamptz,              -- 軟移除；null = 目前在清單上
  primary key (user_id, item_id)
);

comment on table public.review_list is
  '使用者手動標記「想再回顧」的條目。走自由練習，不影響 SRS 排程。';

-- 目前在清單上的條目：這是最常查的一組，且清單通常很短
create index if not exists review_list_active_idx
  on public.review_list(user_id, added_at desc)
  where removed_at is null;

alter table public.review_list enable row level security;

-- 每個人只碰得到自己的清單。與 user_cards / reviews 同一套邊界 ——
-- 前端過濾可以被繞過，真正的門檻只有 RLS。
drop policy if exists review_list_own on public.review_list;
create policy review_list_own on public.review_list
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 加入／移除都做成冪等：重複按不該報錯，也不該產生第二列。
-- 前端會在清單與卡片兩處都放按鈕，兩邊都按到是正常的。
-- ---------------------------------------------------------------------
create or replace function public.review_list_add(p_item_id uuid, p_note text default null)
returns void language sql security invoker as $$
  insert into public.review_list (user_id, item_id, note)
  values (auth.uid(), p_item_id, p_note)
  on conflict (user_id, item_id) do update
    set removed_at = null,
        added_at   = now(),
        note       = coalesce(excluded.note, public.review_list.note);
$$;

create or replace function public.review_list_remove(p_item_id uuid)
returns void language sql security invoker as $$
  update public.review_list set removed_at = now()
  where user_id = auth.uid() and item_id = p_item_id and removed_at is null;
$$;

grant execute on function public.review_list_add(uuid, text) to authenticated;
grant execute on function public.review_list_remove(uuid) to authenticated;
