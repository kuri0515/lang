-- =====================================================================
-- 0028_audio_bucket — 真人錄音的私密存放處
--
-- 【為什麼是私密桶，不是公開桶】
--   錄音是別人的著作（Haerin 的講話），不是我們的。公開桶的網址誰拿到都能播，
--   而且會被搜尋引擎與別的網站直接引用。私密桶只有登入的使用者拿得到
--   「有時效的簽名網址」，離開這個站就失效。
--
-- 【為什麼放在 items.audio_url 而不是新欄位】
--   那一欄本來就是「發音音檔，缺省走 TTS」，播放端早就會優先用它。
--   值的格式是 sb:<桶>/<路徑>，播放時才換成簽名網址（見 shared/js/data/audio.js）。
--   一般 http(s) 網址照舊直接播，不受影響。
--
-- 【權限】只有 select，且限定這個桶。沒有 insert／update／delete ——
--   上傳走 service_role（shared/scripts/attach_audio.py），前端不需要也不該能寫。
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('haerin-audio', 'haerin-audio', false)
on conflict (id) do update set public = false;

drop policy if exists haerin_audio_read on storage.objects;
create policy haerin_audio_read on storage.objects
  for select to authenticated
  using (bucket_id = 'haerin-audio');
