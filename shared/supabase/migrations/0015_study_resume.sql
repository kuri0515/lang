-- =====================================================================
-- 0015_study_resume — 學習中斷後的續跑狀態（雲端備份）
--
-- 【要解決的事】
--   一輪要答三十到八十題。重新整理、切到別的 App、手機把分頁回收，
--   原本都是整輪重來 —— 那個代價足以讓人今天不想再開。
--   已經先做了瀏覽器端的暫存；這張表是為了「換一台裝置也接得上」。
--
-- 【為什麼一個使用者只有一列】
--   續跑狀態不是歷史，是「現在做到哪」。留多列會製造一個問題：
--   回來時要挑哪一列？挑錯就是接到三天前的那一輪。
--   一列、直接覆蓋，沒有可挑錯的東西。
--
-- 【為什麼用 jsonb 而不是拆成欄位】
--   內容是前端的會話快照（佇列、第幾題、每張卡連對幾次…），
--   它會跟著學習邏輯一起演進。拆成欄位的話，每次改規則都要一次 migration，
--   而這份資料本來就是可拋棄的 —— 讀不懂就丟掉重來，不值得為它綁上 schema。
--   代價是資料庫不會幫忙驗證，所以前端讀取時一定要能容忍壞資料。
--
-- 【為什麼要存 saved_at 而不是只靠 updated_at】
--   要比較的是「哪一台裝置的進度比較新」，那是用戶端的時間點。
--   updated_at 是伺服器寫入時間，網路慢的那一台會後到 ——
--   拿它比較會讓「先操作的」蓋掉「後操作的」。
-- =====================================================================

create table if not exists public.study_resume (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null,
  saved_at   timestamptz not null,      -- 用戶端拍快照的時間，用來比新舊
  updated_at timestamptz not null default now()
);

comment on table public.study_resume is
  '學習中斷後的續跑狀態。每個使用者一列，直接覆蓋。內容可拋棄：讀不懂就丟掉重來。';
comment on column public.study_resume.saved_at is
  '用戶端拍快照的時間。比新舊要用它，不能用 updated_at（那是伺服器寫入時間，網路慢的會後到）。';

alter table public.study_resume enable row level security;

-- 只能讀寫自己的。這份資料裡有學到哪、哪些詞卡住 ——
-- 不是機密，但也沒有任何理由讓別人看得到。
drop policy if exists "own resume" on public.study_resume;
create policy "own resume" on public.study_resume
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
