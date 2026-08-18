-- =====================================================================
-- 0018_resume_per_mode — 續跑進度改成「每個使用者 × 每個題型」一份
--
-- 【要解決的事】
--   原本一個使用者只有一份續跑進度。
--   於是：用翻卡做到一半 → 到設定換成拼出來 → 回學習畫面，
--   接到的是翻卡那一輪。使用者換了題型，卻回到舊題型的進度。
--
--   每個題型是一種不同的練習（認得／選得出來／寫得出來），
--   各自的進度本來就該分開。換題型是「換一件事做」，不是「同一件事換個樣子」。
--
-- 【為什麼改主鍵而不是把 mode 塞進 state】
--   塞進 jsonb 的話，讀一個題型的進度要把所有題型的都撈下來，
--   而且兩個分頁同時寫不同題型會互相覆蓋（後寫的整包蓋掉先寫的）。
--   拆成一列一個題型，各寫各的，沒有這個問題。
--
-- 【舊資料怎麼辦】
--   直接刪。它是「做到一半」的暫存，最多值一輪；
--   而要猜它屬於哪個題型只能瞎猜，猜錯的後果是使用者接到一輪
--   不屬於當前題型的內容 —— 比重做一輪更糟。
-- =====================================================================

-- 舊資料無法歸屬到題型，清掉重來（見檔頭）
truncate table public.study_resume;

alter table public.study_resume drop constraint if exists study_resume_pkey;

alter table public.study_resume
  add column if not exists mode public.study_mode_kind not null default 'flip';

alter table public.study_resume
  add constraint study_resume_pkey primary key (user_id, mode);

comment on column public.study_resume.mode is
  '這份進度屬於哪個題型。每個題型是一種不同的練習，進度本來就該分開 —— '
  '換題型是「換一件事做」，不是「同一件事換個樣子」。';
