-- =====================================================================
-- korean · 0001_init
-- MVP: 韓文 ↔ 中文(繁體) 雙向單字卡 + 間隔重複(SRS) + 答題記錄/正確率
--
-- 設計原則（沿用 25Maths 紀律）：
--   1. 內容層(decks/items) 與 學習狀態層(user_cards/reviews) 完全解耦
--      —— 換 SRS 演算法、換詞表來源，互不影響。
--   2. 門禁真邊界 = RLS。前端任何判斷只做 UX，不做安全。
--   3. items 用穩定業務鍵 slug，匯入腳本冪等 upsert，詞表可反覆更新。
--   4. ★ 雙向獨立：user_cards 主鍵含 direction。
--      「看韓文想中文」與「看中文想韓文」是兩種不同能力，
--      各自有各自的到期時間與熟練度，絕不互相污染。
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 列舉：學習方向 / 條目類型
-- ---------------------------------------------------------------------
do $$ begin
  create type public.study_direction as enum ('ko2zh', 'zh2ko');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.item_type as enum ('word', 'phrase', 'sentence');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique,                  -- 登入用帳號名（前端映射成 email）
  display_name text,
  role         text not null default 'user'
               check (role in ('user', 'admin')),
  daily_new_limit    int not null default 20,
  daily_review_limit int not null default 200,
  -- 學習方向偏好：both = 一個條目產生兩張卡
  study_mode   text not null default 'both'
               check (study_mode in ('ko2zh', 'zh2ko', 'both')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    -- 角色只認 metadata；而 metadata 只有 service_role 建號時能設，
    -- 一般註冊走 anon key 無法偽造，故不會被提權。
    case when new.raw_user_meta_data->>'role' = 'admin' then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 管理員判定：給 RLS policy 用。
-- security definer 才能繞過 profiles 自身的 RLS，避免遞迴。
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- decks：詞庫 / 單元
-- ---------------------------------------------------------------------
create table if not exists public.decks (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  title_ko    text,
  description text,
  level       text,
  sort_order  int not null default 0,
  is_public   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- items：條目（單字 / 詞組 / 句子 —— 同一張表，靠 item_type 區分）
-- 這是內容真理源。詞表更新 = 對本表 upsert。
-- ---------------------------------------------------------------------
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references public.decks(id) on delete cascade,
  slug        text unique not null,          -- 冪等鍵，如 'topik1-u01-0007'
  item_type   public.item_type not null default 'word',

  ko          text not null,                 -- 韓文（한글）
  zh          text not null,                 -- 中文（繁體）
  romanization text,                          -- 羅馬音
  pos         text,                          -- 詞性 명사/동사/형용사…

  -- 例句：單字/詞組用；item_type='sentence' 時本身即是句子，可留空
  example_ko  text,
  example_zh  text,

  note        text,                          -- 補充說明（語感、慣用法）
  audio_url   text,                          -- 發音音檔，可後補；缺省前端用 TTS
  tags        text[] not null default '{}',
  sort_order  int not null default 0,
  is_active   boolean not null default true, -- 詞表變更時軟下架，不刪資料
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists items_deck_idx on public.items(deck_id, sort_order);
create index if not exists items_type_idx on public.items(item_type);
create index if not exists items_tags_idx on public.items using gin(tags);

-- ---------------------------------------------------------------------
-- user_cards：★ 每個 (使用者 × 條目 × 方向) 一張獨立的卡
-- ---------------------------------------------------------------------
create table if not exists public.user_cards (
  user_id      uuid not null references auth.users(id) on delete cascade,
  item_id      uuid not null references public.items(id) on delete cascade,
  direction    public.study_direction not null,

  state        text not null default 'new',   -- new | learning | review | suspended
  due_at       timestamptz not null default now(),
  interval_days numeric not null default 0,
  ease_factor  numeric not null default 2.5,
  repetitions  int not null default 0,
  lapses       int not null default 0,

  -- 累計答題統計（正確率的快取，避免每次掃 reviews）
  total_reviews  int not null default 0,
  correct_reviews int not null default 0,      -- rating >= 3 記為答對

  last_reviewed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, item_id, direction)
);

-- 「今日待複習」主查詢路徑
create index if not exists user_cards_due_idx
  on public.user_cards(user_id, direction, due_at)
  where state <> 'suspended';

-- ---------------------------------------------------------------------
-- reviews：答題記錄（只追加，永不改）
-- 用途：正確率、學習曲線、演算法調參重放
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  direction  public.study_direction not null,
  rating     smallint not null check (rating between 1 and 4), -- 1忘 2難 3記得 4簡單
  is_correct boolean generated always as (rating >= 3) stored,
  elapsed_ms int,
  -- 快照：複習當下的狀態，便於事後重放演算法
  prev_interval_days numeric,
  prev_ease_factor   numeric,
  reviewed_at timestamptz not null default now()
);

create index if not exists reviews_user_time_idx on public.reviews(user_id, reviewed_at desc);
create index if not exists reviews_user_item_idx on public.reviews(user_id, item_id, direction);

-- ---------------------------------------------------------------------
-- 統計：正確率
-- ---------------------------------------------------------------------

-- 逐條目 × 方向的正確率（給「我的弱項」清單用）
create or replace view public.v_item_accuracy as
select
  c.user_id,
  c.item_id,
  c.direction,
  i.ko,
  i.zh,
  i.item_type,
  c.total_reviews,
  c.correct_reviews,
  case when c.total_reviews = 0 then null
       else round(c.correct_reviews::numeric / c.total_reviews, 4)
  end as accuracy,
  c.state,
  c.due_at,
  c.lapses
from public.user_cards c
join public.items i on i.id = c.item_id;

-- 每日彙總（給學習曲線 / 首頁統計用）
create or replace view public.v_daily_stats as
select
  user_id,
  (reviewed_at at time zone 'Asia/Taipei')::date as study_date,
  direction,
  count(*)                                   as reviewed,
  count(*) filter (where is_correct)          as correct,
  round(avg(is_correct::int)::numeric, 4)     as accuracy
from public.reviews
group by 1, 2, 3;

-- =====================================================================
-- RLS —— 真正的門禁邊界
-- =====================================================================
alter table public.profiles   enable row level security;
alter table public.decks      enable row level security;
alter table public.items      enable row level security;
alter table public.user_cards enable row level security;
alter table public.reviews    enable row level security;

-- profiles：自己可讀寫；管理員可讀全部（後台看使用者用）
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ⚠️ 沒有給一般使用者 update role 的路徑：role 欄位只能由 service_role 改，
--    否則任何人都能把自己升成 admin。

-- 內容：所有人唯讀（含未登入 anon）
drop policy if exists decks_public_read on public.decks;
create policy decks_public_read on public.decks
  for select using (is_public = true or auth.uid() is not null);

drop policy if exists items_public_read on public.items;
create policy items_public_read on public.items
  for select using (
    is_active = true and exists (
      select 1 from public.decks d
      where d.id = items.deck_id
        and (d.is_public = true or auth.uid() is not null)
    )
  );

-- 內容寫入：管理員可在網站上直接增刪改詞表；一般使用者完全不能寫。
-- （批次匯入仍走 service_role 腳本，兩條路互不影響）
drop policy if exists decks_admin_write on public.decks;
create policy decks_admin_write on public.decks
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists items_admin_write on public.items;
create policy items_admin_write on public.items
  for all using (public.is_admin()) with check (public.is_admin());

-- 學習狀態：嚴格 owner-only
drop policy if exists user_cards_owner_all on public.user_cards;
create policy user_cards_owner_all on public.user_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 答題記錄：可讀可插入；不可改不可刪（日誌只追加）
drop policy if exists reviews_owner_select on public.reviews;
create policy reviews_owner_select on public.reviews
  for select using (auth.uid() = user_id);

drop policy if exists reviews_owner_insert on public.reviews;
create policy reviews_owner_insert on public.reviews
  for insert with check (auth.uid() = user_id);

-- view 繼承底表 RLS
alter view public.v_item_accuracy set (security_invoker = on);
alter view public.v_daily_stats   set (security_invoker = on);

-- =====================================================================
-- updated_at 自動維護
-- =====================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch   on public.profiles;
create trigger profiles_touch   before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists items_touch      on public.items;
create trigger items_touch      before update on public.items
  for each row execute function public.touch_updated_at();

drop trigger if exists user_cards_touch on public.user_cards;
create trigger user_cards_touch before update on public.user_cards
  for each row execute function public.touch_updated_at();
