-- =====================================================================
-- 0027_tag_counts — 標籤與各自的條目數，由資料庫算
--
-- 【要解決的事】
--   詞庫的篩選列要「有哪些標籤、各幾條」。前端的做法是把
--   **每一條的 tags 欄位**都撈回來再自己數 ——
--   日文站 7049 條之後，那是 8 趟連續往返、實測約 2.4 秒，
--   而算出來的結果只有三十來列。
--
--   資料量會一直長，答案卻不會 —— 這種形狀就該讓資料庫算。
--
-- 【為什麼是 view 不是物化 view】
--   標籤會隨著匯入而變（每加一集就多一個 S1E**）。
--   物化 view 要記得 refresh，而忘記 refresh 的症狀是
--   「新的一集不出現在篩選列」—— 不報錯，只是看起來還沒匯入。
--   這個查詢只掃 items 的 tags 欄，成本遠低於把整份搬到前端。
--
-- 【為什麼要 security_invoker】
--   view 預設用建立者的權限跑，會繞過 items 的 RLS。
--   這裡的內容本來就是公開可讀的，但「view 悄悄放寬了權限」
--   是一種不會報錯的漏法，所以明講。
-- =====================================================================

create or replace view public.v_tag_counts
with (security_invoker = true) as
select t.tag, count(*)::int as n
from public.items i
cross join lateral unnest(i.tags) as t(tag)
where i.is_active
group by t.tag;

comment on view public.v_tag_counts is
  '篩選列用：有哪些標籤、各幾條。前端不要再把每一條的 tags 撈回來自己數 —— '
  '那是 8 趟往返約 2.4 秒，而答案只有三十來列。';

grant select on public.v_tag_counts to anon, authenticated;
