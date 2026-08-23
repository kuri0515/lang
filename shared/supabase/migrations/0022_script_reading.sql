-- =====================================================================
-- 0022_script_reading — 精讀：照影片台詞一幕一幕讀
--
-- 【為什麼台詞不放進 items】
--   items 同時餵三個地方：詞庫瀏覽、輪練池、複習池。
--   把一集 479 句台詞塞進去，那三個地方全部會被單一集淹沒 ——
--   而使用者的決定是「核心詞進複習池，台詞不進」。
--   台詞要的是「讀到哪一幕」，不是「什麼時候該再看一次」，
--   那是兩種不同的進度，硬用同一張表會讓兩邊都彆扭。
--
--   核心詞仍然走 items（deck = 該作品那一組），所以它們照常
--   進複習池、照常出現在輪練裡，跟其他來源的詞一起排程。
--
-- 【幕（scene）為什麼只是一個整數欄位，不另立一張表】
--   幕沒有自己的屬性 —— 它就是「連續的一段行」。
--   另立一張表要多維護一組邊界，而邊界一旦與行不同步
--   （改了行卻沒改邊界）就會出現讀不到的幕，而且不會報錯。
--   存在行上，行就是唯一的真相。
--
-- 【時間碼留著做什麼】
--   目前沒有播放器。留著是因為它是**從字幕來的原始事實**，
--   丟掉就再也回不來了 —— 而日後要接影片、要排序、要重新切幕，
--   全都需要它。存一個 float 的成本可以忽略。
-- =====================================================================

create table if not exists public.script_episodes (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,          -- 冪等鍵，如 'spy-s1e01'
  work        text not null,                 -- 作品代號，如 'spy'
  work_title  text not null,                 -- 顯示用，如 'SPY×FAMILY'
  season      int  not null,
  episode     int  not null,
  title       text,                          -- 該集標題，可留空
  line_count  int  not null default 0,
  scene_count int  not null default 0,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (work, season, episode)
);

create table if not exists public.script_lines (
  id         uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.script_episodes(id) on delete cascade,
  idx        int  not null,                  -- 這一集裡的第幾行，從 0 起
  scene      int  not null,                  -- 第幾幕，從 1 起
  start_s    real,                           -- 原字幕的時間碼（秒）
  end_s      real,
  ja         text not null,                  -- 日文原句
  ruby       text not null,                  -- 注音版：漢字[かんじ]
  zh         text not null,                  -- 繁中對照
  unique (episode_id, idx)
);

create index if not exists script_lines_scene_idx
  on public.script_lines (episode_id, scene, idx);

-- 讀到哪。一幕一列 —— 用一個「最遠讀到第幾幕」的數字看似更省，
-- 但那假設了人一定照順序讀。實際上會跳著讀、會回頭重讀，
-- 而「哪幾幕讀過」是那個數字答不出來的。
create table if not exists public.script_progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  episode_id uuid not null references public.script_episodes(id) on delete cascade,
  scene      int  not null,
  done_at    timestamptz not null default now(),
  primary key (user_id, episode_id, scene)
);

comment on table public.script_episodes is
  '精讀的一集。台詞不進 items —— items 同時餵詞庫/輪練/複習三處，'
  '一集 479 句會把它們全部淹沒。核心詞仍走 items。';
comment on column public.script_lines.scene is
  '第幾幕。幕沒有自己的屬性，就是「連續的一段行」，所以存在行上而不另立表：'
  '另立表要多維護一組邊界，而邊界與行不同步時會出現讀不到的幕，且不報錯。';
comment on column public.script_lines.ruby is
  '注音只標在漢字上（読[よ]んで，不是 読んで[よんで]）—— '
  '把送り仮名算進讀音會讓學習者記錯。';
comment on table public.script_progress is
  '哪幾幕讀過。一幕一列而不是存「最遠第幾幕」：後者假設人照順序讀，'
  '而實際上會跳著讀、回頭重讀。';

alter table public.script_episodes enable row level security;
alter table public.script_lines    enable row level security;
alter table public.script_progress enable row level security;

-- 內容表：登入者可讀，寫入只有 admin（與 items 同一套規矩）
drop policy if exists "read episodes" on public.script_episodes;
create policy "read episodes" on public.script_episodes
  for select using (auth.role() = 'authenticated');

drop policy if exists "read lines" on public.script_lines;
create policy "read lines" on public.script_lines
  for select using (auth.role() = 'authenticated');

drop policy if exists "admin writes episodes" on public.script_episodes;
create policy "admin writes episodes" on public.script_episodes
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin writes lines" on public.script_lines;
create policy "admin writes lines" on public.script_lines
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own script progress" on public.script_progress;
create policy "own script progress" on public.script_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
