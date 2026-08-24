-- =====================================================================
-- 0025_script_line_grammar — 每一行命中的句型
--
-- 【與 tokens 同一個道理】
--   句型偵測在抽取階段做（看詞形與詞性的序列），結果存下來。
--   前端不要用字串比對去猜 —— 「の」「が」這兩個高頻助詞
--   若不看前後詞性，會把所有格與主格全部誤判成說明語氣與逆接。
--   實測誤中：の 109 行、が 59 行，而那種錯看起來完全合理。
--
-- 【寧可漏，不可錯】
--   目前覆蓋 36% 的行。分不出來的一律不標 ——
--   標錯一個句型比沒標更糟，因為學習者沒有辦法察覺它是錯的。
--   代號的解說放在站台設定（japanese/grammar.js），
--   資料庫只存「這一行命中了哪幾個代號」。
-- =====================================================================

alter table public.script_lines
  add column if not exists grammar text[] not null default '{}';

comment on column public.script_lines.grammar is
  '這一行命中的句型代號（解說在站台設定裡）。抽取階段以詞形＋詞性序列判定，'
  '不用字串比對 —— 「の」「が」不看前後詞性會大量誤中，而那種錯看起來很合理。';

create index if not exists script_lines_grammar_idx
  on public.script_lines using gin (grammar);
