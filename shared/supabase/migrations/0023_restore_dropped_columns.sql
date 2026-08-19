-- =====================================================================
-- 0023_restore_dropped_columns — 把 0022 刪掉的欄位加回來
--
-- 【事故】
--   0022 刪掉 study_mode / daily_new_limit / daily_review_limit，
--   理由是「前端沒有任何地方在用」。前端確實已經改好了 ——
--   但**使用者瀏覽器裡還快取著舊版 JS**（GitHub Pages max-age=600），
--   而舊版的 auth.js 仍然 select 那三個欄位。
--   欄位一沒，查詢就回 42703，myProfile 失敗，兩站都打不開。
--
-- 【我判斷錯在哪】
--   我驗證了「程式碼有沒有在用」，卻沒問「**線上跑的是哪一份程式碼**」。
--   靜態站的部署不是原子的：新版推上去之後，
--   舊版仍會在使用者的瀏覽器裡活十分鐘，甚至更久（分頁沒關就一直是舊的）。
--
--   ★ 刪欄位必須是兩階段：
--       第一階段  程式碼停止使用該欄位 → 部署 → 等所有快取過期
--       第二階段  才刪欄位
--     兩件事放在同一次做，等於賭沒有人正開著舊版。
--
-- 【現在的處置】
--   加回來，型別與預設值照 0001／0011 原樣。
--   資料不必還原：那三欄從未被寫入過，值全是預設。
--   真正的移除留到之後 —— 至少要等新版 JS 上線超過一天。
-- =====================================================================

alter table public.profiles
  add column if not exists study_mode          text    not null default 'both',
  add column if not exists daily_new_limit     integer not null default 20,
  add column if not exists daily_review_limit  integer not null default 200;

-- grant 也回復成 0020 的樣子（0022 收窄過）
grant update (display_name, study_mode, daily_new_limit, daily_review_limit,
              study_prefs)
  on public.profiles to authenticated;
