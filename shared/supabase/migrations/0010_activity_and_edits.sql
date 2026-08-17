-- =====================================================================
-- korean · 0010_activity_and_edits
--
-- 補兩種目前記不出來的事。
--
-- 【一、學習活動的類型】
--   現在只有 is_free 一個布林，四種活動被壓成兩類：
--     學新詞 與 正規複習     → 都是 is_free=false，分不出
--     一般自由練習 與 弱項修復 → 都是 is_free=true，分不出
--   但這四件事的意義完全不同：「今天修復了 8 個弱項」和
--   「今天隨手練了 8 個詞」是兩回事，記錄要能區分。
--
-- 【二、內容修正的留痕】
--   管理員改詞條目前不留任何痕跡 —— 改過哪條、改前是什麼、
--   誰改的、什麼時候改的，全查不到。發現一條翻譯被改壞了也無從回溯。
--   用 trigger 記錄而非前端寫入：items 有多條寫入路徑
--   （編輯器、批次匯入、腳本），只有 trigger 能全部涵蓋。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 一、學習活動類型
-- ---------------------------------------------------------------------
do $$ begin
  create type public.activity_kind as enum ('new', 'review', 'free', 'drill');
exception when duplicate_object then null; end $$;

alter table public.reviews
  add column if not exists activity public.activity_kind;

comment on column public.reviews.activity is
  'new=學新詞 review=到期複習 free=自由練習 drill=弱項修復。null=0010 之前的記錄。';

-- 舊資料能推的先推：is_free 至少能區分兩大類，
-- 但「學新詞 vs 複習」「自由 vs 修復」推不出來，不硬猜。
update public.reviews
set activity = case when is_free then 'free'::public.activity_kind
                    else 'review'::public.activity_kind end
where activity is null;

create index if not exists reviews_activity_idx
  on public.reviews(user_id, activity, reviewed_at desc);

-- 場次彙總帶上活動類型。
-- ★ 必須先 drop：create or replace view 不能改變欄位的順序或名稱，
--   在中間插一欄會讓後面的欄位位移，Postgres 會報
--   「cannot change name of view column」。view 沒有資料，drop 是安全的。
drop view if exists public.v_sessions;
create view public.v_sessions as
select
  user_id,
  session_id,
  min(mode)::text                       as mode,
  min(activity)::text                   as activity,
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

-- log_practice 帶上活動類型（自由練習或弱項修復）
create or replace function public.log_practice(
  p_item_id   uuid,
  p_direction public.study_direction,
  p_rating    smallint,
  p_elapsed_ms int default null,
  p_mode      public.study_mode_kind default null,
  p_session_id uuid default null,
  p_activity  public.activity_kind default 'free'
) returns void
language plpgsql security invoker set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  insert into public.reviews
    (user_id, item_id, direction, rating, elapsed_ms, mode, session_id, is_free, activity)
  values (v_uid, p_item_id, p_direction, p_rating, p_elapsed_ms, p_mode, p_session_id,
          true, coalesce(p_activity, 'free'));

  -- 只更新既有的卡，不建立新卡（見 0009）
  update public.user_cards
     set total_reviews    = total_reviews + 1,
         correct_reviews  = correct_reviews + case when p_rating >= 3 then 1 else 0 end,
         last_reviewed_at = now()
   where user_id = v_uid and item_id = p_item_id and direction = p_direction;
end;
$$;

grant execute on function public.log_practice(uuid, public.study_direction, smallint, int,
       public.study_mode_kind, uuid, public.activity_kind) to authenticated;

-- ---------------------------------------------------------------------
-- 二、內容修正留痕
-- ---------------------------------------------------------------------
create table if not exists public.item_edits (
  id         bigserial primary key,
  item_id    uuid not null references public.items(id) on delete cascade,
  editor_id  uuid references auth.users(id) on delete set null,
  action     text not null check (action in ('create', 'update', 'deactivate', 'restore')),
  changed    text[] not null default '{}',   -- 有變動的欄位名
  before     jsonb,                          -- 只存有變動的欄位，不存整列
  after      jsonb,
  edited_at  timestamptz not null default now()
);

create index if not exists item_edits_item_idx on public.item_edits(item_id, edited_at desc);
create index if not exists item_edits_time_idx on public.item_edits(edited_at desc);

-- 只記錄「內容欄位」的變動。sort_order、updated_at 這類機械欄位不記，
-- 否則一次批次匯入就會灌進幾百筆沒有意義的記錄。
create or replace function public.log_item_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fields text[] := array['ko','zh','romanization','hanja','pos','item_type',
                         'example_ko','example_zh','note','tags'];
  f text;
  ch text[] := '{}';
  b jsonb := '{}'::jsonb;
  a jsonb := '{}'::jsonb;
  act text;
begin
  if TG_OP = 'INSERT' then
    insert into public.item_edits(item_id, editor_id, action, changed, after)
    values (new.id, auth.uid(), 'create', fields, to_jsonb(new) - 'id' - 'deck_id');
    return new;
  end if;

  -- 上下架單獨記一種動作，比記成 is_active 欄位變動更好讀
  if old.is_active is distinct from new.is_active then
    insert into public.item_edits(item_id, editor_id, action, changed, before, after)
    values (new.id, auth.uid(),
            case when new.is_active then 'restore' else 'deactivate' end,
            array['is_active'],
            jsonb_build_object('is_active', old.is_active),
            jsonb_build_object('is_active', new.is_active));
  end if;

  foreach f in array fields loop
    if to_jsonb(old) -> f is distinct from to_jsonb(new) -> f then
      ch := ch || f;
      b := b || jsonb_build_object(f, to_jsonb(old) -> f);
      a := a || jsonb_build_object(f, to_jsonb(new) -> f);
    end if;
  end loop;

  if array_length(ch, 1) > 0 then
    insert into public.item_edits(item_id, editor_id, action, changed, before, after)
    values (new.id, auth.uid(), 'update', ch, b, a);
  end if;
  return new;
end;
$$;

drop trigger if exists items_audit on public.items;
create trigger items_audit
  after insert or update on public.items
  for each row execute function public.log_item_edit();

-- RLS：所有登入者可讀（內容是公共的，改動歷史也該透明）；
-- 寫入只由 trigger 進行，不開放任何直接寫入的 policy。
alter table public.item_edits enable row level security;

drop policy if exists item_edits_read on public.item_edits;
create policy item_edits_read on public.item_edits
  for select using (auth.uid() is not null);

-- 帶上詞條與編輯者，前端一次查得到
create or replace view public.v_item_edits as
select
  e.id, e.item_id, e.action, e.changed, e.before, e.after, e.edited_at,
  i.ko, i.zh, i.is_active,
  p.username as editor
from public.item_edits e
join public.items i on i.id = e.item_id
left join public.profiles p on p.id = e.editor_id;

alter view public.v_item_edits set (security_invoker = on);
