-- =====================================================================
-- 0014_tag_progress — 課程進度改在資料庫算
--
-- 【問題】
--   首頁要顯示「每一課有幾條、我碰過幾條、掌握幾條」。
--   原本的做法是把**全部條目的標籤**撈到前端再分組數 ——
--   實測 894 ms、75 KB，而且會隨內容增加而線性變差。
--   日文站現在 826 條就已經這樣，之後加新書只會更慢。
--
--   答案本身只有「課數」那麼大（約 100 列小資料），
--   卻要為它搬 75 KB，那是把資料庫的工作搬到前端做。
--
-- 【修法】
--   一支函式回傳每個標籤的 total / started / mastered。
--   計數在資料庫做，網路上只走結果。
--
-- 【為什麼用 security invoker + auth.uid()】
--   不接受 user_id 參數 —— 那等於開一個「填別人 id 就看得到別人進度」的洞。
--   由函式自己取 auth.uid()，RLS 也照常生效，兩層都擋。
--
-- 【為什麼 total 不看使用者】
--   「這一課有幾條」是內容的屬性，與誰在學無關。
--   started / mastered 才是個人的。混在一起算會讓沒學過的課顯示 0/0，
--   而那與「這課沒有內容」看起來一樣。
-- =====================================================================

create or replace function public.tag_progress(p_tags text[])
returns table (tag text, total bigint, started bigint, mastered bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.tag,
    count(distinct i.id)                                            as total,
    count(distinct uc.item_id)                                      as started,
    count(distinct uc.item_id) filter (where uc.mastered_at is not null) as mastered
  from unnest(p_tags) as t(tag)
  join public.items i
    on i.is_active and i.tags @> array[t.tag]
  left join public.user_cards uc
    on uc.item_id = i.id and uc.user_id = auth.uid()
  group by t.tag;
$$;

comment on function public.tag_progress(text[]) is
  '每個標籤的 total / started / mastered。計數在資料庫做，避免把全部條目搬到前端。';

grant execute on function public.tag_progress(text[]) to authenticated;

-- 標籤查詢會用到 GIN；items.tags 若還沒有索引，這裡補上。
-- 沒有索引時 @> 會走全表掃描 —— 條目多了之後這支函式自己會變成瓶頸。
create index if not exists items_tags_gin on public.items using gin (tags);
