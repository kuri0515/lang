-- =====================================================================
-- 0019_study_rounds — 輪次池：把全部內容掃過一遍，一輪接一輪
--
-- 【它與複習池的分工】
--   複習池（user_cards）回答「哪些快忘了」—— 由到期日決定順序。
--   輪次池回答「我掃到哪了」—— 由一個固定的打散順序決定。
--   兩者互不干涉：輪次池不看到期日，複習池不看輪次進度。
--
--   使用者已經學完第一輪，現在要的是「不斷地把全部內容輪過」，
--   而那件事光靠到期日做不到 —— 到期日只會端出「該複習的」，
--   永遠不保證每個詞都輪得到。
--
-- 【為什麼存整份順序，而不是存一個亂數種子】
--   種子加演算法可以推出順序，看起來更省。但內容會增加：
--   新加的詞會讓「同一個種子算出來的順序」整個變掉，
--   而那會讓進行中的一輪突然換順序、剩餘數跳動。
--   存下來的那一份是這一輪的約定，內容再變也不影響它 ——
--   新詞加入下一輪。
--
-- 【為什麼用 pos 而不是把做過的從陣列刪掉】
--   刪掉的話 queue.length 會一直縮，算不出「這一輪共有幾個」。
--   而「還剩 40 / 共 826」正是使用者要看的東西。
--
-- 【大小】
--   一個 uuid 約 38 位元組，韓文站 1282 條約 49 KB。
--   一個使用者一列、只在切換組別時寫入，這個量級沒有問題。
-- =====================================================================

create table if not exists public.study_rounds (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  round_no   int  not null default 1,
  queue      jsonb not null default '[]'::jsonb,   -- 這一輪的完整順序（item id）
  pos        int  not null default 0,              -- 已經取出幾個
  updated_at timestamptz not null default now()
);

comment on table public.study_rounds is
  '輪次池：把全部內容打散後掃一遍，掃完重新打散進入下一輪。'
  '與複習池（user_cards）互不干涉 —— 前者回答「掃到哪了」，後者回答「哪些快忘了」。';
comment on column public.study_rounds.queue is
  '這一輪的完整順序。存整份而不是存亂數種子：內容增加會讓種子算出來的順序整個變掉，'
  '而那會讓進行中的一輪剩餘數跳動。新詞加入下一輪。';
comment on column public.study_rounds.pos is
  '已取出幾個。用指標而不是把做過的刪掉 —— 刪掉就算不出「這一輪共有幾個」。';

alter table public.study_rounds enable row level security;

drop policy if exists "own rounds" on public.study_rounds;
create policy "own rounds" on public.study_rounds
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
