-- =====================================================================
-- korean · 0004_review_source
--
-- 【背景】
--   2026-08-16 開發過程中，清理測試資料時用了過寬的刪除條件
--   （DELETE /reviews?user_id=eq.<kuri>），把 kuri 帳號的全部答題
--   記錄一併刪掉，共 20 筆。user_cards 未受影響，複習排程與每張卡
--   的正確率都完整倖存。
--
--   隨後從 user_cards 的 last_reviewed_at / correct_reviews 反推重建
--   了那 20 筆：時間與對錯是真實的，elapsed_ms 無法還原故留空。
--   重建結果與 user_cards 彙總交叉比對一致（17/20 答對）。
--
-- 【本 migration 做什麼】
--   替 reviews 加一個 source 欄位，把那 20 筆標為 'reconstructed'，
--   讓日後看記錄或做數據分析時能分辨哪些是原始日誌、哪些是事後補的。
--   之後所有新記錄預設為 'live'。
-- =====================================================================

alter table public.reviews
  add column if not exists source text not null default 'live'
  check (source in ('live', 'reconstructed', 'import'));

comment on column public.reviews.source is
  'live=作答當下寫入；reconstructed=事後從 user_cards 反推補回；import=外部匯入';

-- 標記那批重建的記錄。
-- 判準：真實作答一定會帶 elapsed_ms（前端每次都送），
-- 重建的因為無從還原而為 null，兩者可以乾淨區分。
update public.reviews r
set source = 'reconstructed'
from public.profiles p
where p.id = r.user_id
  and p.username = 'kuri'
  and r.elapsed_ms is null
  and r.reviewed_at < '2026-08-17'::timestamptz;

create index if not exists reviews_source_idx on public.reviews(source)
  where source <> 'live';
