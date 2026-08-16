-- =====================================================================
-- korean · 0011_drop_stale_overload
--
-- 【問題】
--   0010 為 log_practice 加了第 7 個參數 p_activity。但
--   create or replace function 遇到不同的參數簽名時會「新建一個」
--   而非替換 —— 於是資料庫裡同時存在兩個 log_practice：
--     6 參數版（0008 建立，不寫 activity）
--     7 參數版（0010 建立）
--
--   前端目前傳 7 個參數，命中新版沒問題。但舊版留著是隱患：
--   任何漏傳 p_activity 的呼叫都會靜默命中舊版，activity 變成 null，
--   而且不會報錯 —— 是那種「資料悄悄變髒」的問題。
--
--   這是取得資料庫直連後第一個查出來的問題。先前只能透過 PostgREST
--   看功能是否可用，看不到底層有幾個同名函式。
-- =====================================================================

drop function if exists public.log_practice(
  uuid, public.study_direction, smallint, int, public.study_mode_kind, uuid);
