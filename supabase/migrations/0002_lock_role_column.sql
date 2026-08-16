-- =====================================================================
-- korean · 0002_lock_role_column
--
-- 修補 0001 的提權漏洞。
--
-- 【問題】
--   0001 的 profiles_self_update 是「行級」策略：
--       for update using (auth.uid() = id) with check (auth.uid() = id)
--   它只約束「你只能改自己那一行」，**不約束你能改哪些欄位**。
--   任何登入者都可以：
--       PATCH /rest/v1/profiles?id=eq.<自己> {"role":"admin"}
--   直接把自己升成管理員，進而取得 decks/items 的寫入權。
--   （0001 的註解宣稱「沒有提權路徑」，該註解是錯的。）
--
-- 【為什麼不能只靠 RLS 修】
--   Postgres 的 RLS 作用在「列」（row）層級，沒有欄位（column）粒度。
--   with check 也只能檢查新值本身，看不到舊值，寫不出「role 不得改變」。
--
-- 【修法】
--   BEFORE UPDATE 觸發器：只要不是 service_role 發起的更新，
--   一律把 role 強制還原成舊值。使用者可以照常改暱稱、學習偏好，
--   但 role 這一欄對他們形同唯讀。
--   靜默還原（而非報錯）是刻意的：不給探測者任何訊號。
-- =====================================================================

create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.role() 在 PostgREST 請求中回傳 'anon' / 'authenticated' / 'service_role'
  if coalesce(current_setting('request.jwt.claim.role', true),
              current_setting('role', true)) is distinct from 'service_role'
     and auth.role() is distinct from 'service_role'
  then
    new.role := old.role;   -- 靜默還原，不報錯
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row
  when (old.role is distinct from new.role)
  execute function public.guard_profile_role();

-- 保險起見再收一層：撤掉 authenticated 角色對 role 欄位的 UPDATE 權限。
-- 觸發器是主防線，這是縱深防禦 —— 兩者任一失效另一個仍擋得住。
revoke update on public.profiles from authenticated;
grant  update (display_name, study_mode, daily_new_limit, daily_review_limit)
  on public.profiles to authenticated;
