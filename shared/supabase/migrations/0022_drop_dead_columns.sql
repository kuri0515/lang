-- =====================================================================
-- 0022_drop_dead_columns — 清掉三個「開了欄位、沒有接上」的設定
--
-- 【使用者回報】
--   「admin 裡邊我看到有些設置好像沒有連接上」——
--   在 Supabase 後台看到 profiles 有這些欄位，但前端沒有任何地方在用。
--
-- 【查證結果：三個都是死欄位】
--   study_mode          只出現在 auth.js 的 select 清單裡，從未被讀取或寫入。
--                       0017 的註解本來就寫了「它從來沒有被套用或儲存過」，
--                       當時選擇「留著不動」，但留著的代價就是現在這個困惑。
--   daily_new_limit     同上。每日新卡上限已於 2026-08-18 取消（使用者的決定），
--                       這個欄位跟著失去意義。
--   daily_review_limit  前端完全沒有提到過，一次都沒有。
--
--   練習方式的設定現在全部走 study_prefs（見 0017）。
--
-- 【為什麼要刪而不是繼續留著】
--   假資料比沒有資料更糟：後台看得到、值也長得像真的，
--   於是每個看到它的人都要重新查一次「這個到底有沒有在用」。
--   0017 當時的判斷是「刪掉要另外確認沒有其他依賴，不是這次的範圍」——
--   這次確認過了：三個欄位在 shared/ 底下的引用只有 select 清單那一行。
--
-- 【風險】
--   刪欄位不可逆。但這三欄從未被寫入，值全是預設值，
--   不含任何使用者產生的內容。備份裡也有一份。
-- =====================================================================

-- 先從 select 清單移除（0020 的 grant 也一併重下，不再包含這些欄位）
grant update (display_name, study_prefs) on public.profiles to authenticated;

alter table public.profiles drop column if exists study_mode;
alter table public.profiles drop column if exists daily_new_limit;
alter table public.profiles drop column if exists daily_review_limit;
