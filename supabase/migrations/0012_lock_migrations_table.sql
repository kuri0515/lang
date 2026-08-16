-- =====================================================================
-- korean · 0012_lock_migrations_table
--
-- schema_migrations 由 scripts/migrate.sh 以 postgres 身分寫入，
-- 但它建在 public schema 下，PostgREST 會照樣把它暴露成 API 端點。
-- 沒開 RLS 等於任何拿到 anon key 的人都讀得到我們的 migration 清單 ——
-- 那是內部維運資訊，會洩漏 schema 的演進過程與功能藍圖。
--
-- 開 RLS 且不建任何 policy = 除了 service_role 與表擁有者之外誰都讀不到。
-- =====================================================================

alter table public.schema_migrations enable row level security;

revoke all on public.schema_migrations from anon, authenticated;

comment on table public.schema_migrations is
  '維運用：已套用的 migration。由 scripts/migrate.sh 維護，不對外開放。';
