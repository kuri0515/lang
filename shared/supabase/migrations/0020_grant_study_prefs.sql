-- =====================================================================
-- 0018_grant_study_prefs — 補上 study_prefs 的 UPDATE 權限
--
-- 【症狀】
--   使用者把方向設成「中→外語」，下次打開又跳回「外語→中」。
--   0017 就是為了解決這件事而加的欄位，但它從來沒有被寫進去過 ——
--   雲端的 study_prefs 一直是 '{}'。
--
-- 【原因：兩個 migration 之間的斷層】
--   0002 為了鎖住 role 欄位，撤銷了整表的 UPDATE、改成逐欄授權：
--       revoke update on profiles from authenticated;
--       grant  update (display_name, study_mode, daily_new_limit,
--                      daily_review_limit) on profiles to authenticated;
--   0017 新增 study_prefs 欄位時沒有回頭補這份清單，
--   於是前端的 update 一直被欄位層權限擋下。
--
--   而前端的 savePrefs 用 catch {} 吞掉錯誤（理由是「存不上頂多下次重設」），
--   所以這件事沒有任何地方會說出來 —— 靜靜壞了不知道多久。
--
-- 【給之後的人】
--   ★ 往 profiles 加欄位時，如果那個欄位要讓使用者自己改，
--     一定要回到這裡把它加進 grant 清單。逐欄授權的代價就是這個：
--     安全，但每加一欄都要記得。
-- =====================================================================

grant update (display_name, study_mode, daily_new_limit, daily_review_limit,
              study_prefs)
  on public.profiles to authenticated;
