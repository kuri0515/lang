-- =====================================================================
-- korean · 0003_username_login
--
-- 讓「帳號名登入」支援真實 email。
--
-- 【背景】
--   0001 的做法是把 kuri 機械映射成 kuri@kuri0515.local。
--   但用內部假網域收不到密碼重置信。改用真實 email 後，
--   映射規則就失效了 —— 前端拿不到 kuri 對應的真 email。
--
-- 【問題】
--   登入前使用者是 anon，而 profiles 的 RLS 只讓人讀自己那行，
--   所以匿名狀態下查不到 username → email 的對應。雞生蛋問題。
--
-- 【修法】
--   一個 security definer 函式，只回傳 email 一個欄位，
--   授權給 anon 呼叫。它繞過 RLS，但暴露面僅止於
--   「這個帳號名存不存在、對應哪個信箱」。
--
-- 【權衡】
--   這確實讓人可以枚舉帳號名。對本站可接受 ——
--   任何有註冊功能的站，帳號名本來就能靠「此帳號已被使用」探出來。
--   真正該保護的是密碼與學習資料，那些仍由 RLS 嚴格守住。
--   若日後要收緊：改成回傳 hash、或加上 rate limit。
-- =====================================================================

create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated;
