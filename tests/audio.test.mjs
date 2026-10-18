// =====================================================================
// 私密音檔：簽名網址的預先換好與播放分流
//
//     node --import ./tests/_modules-stub.mjs tests/audio.test.mjs
//
// 【它守什麼】
//   這個功能壞掉的方式全是安靜的：
//     · 沒注入「怎麼換」→ 有錄音的卡悄悄退回機器朗讀，永遠聽不到真人
//     · 點下去才換網址 → 手機不認那是點擊當下，拒絕出聲，只在手機上發生
//     · 一個網址換一趟 → 一輪 20 張就是 20 趟往返
//   還有一條不能壞：一般 http(s) 音檔照舊直接播，不經過這裡。
// =====================================================================
import * as stub from './_modules-client-stub.mjs';
import * as audio from '../shared/js/data/audio.js';
import { setLang, _resetLang } from '../shared/js/core/lang.js';

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

console.log('【網址格式】');
chk('認得 sb:<桶>/<路徑>', JSON.stringify(audio.parseStored('sb:haerin-audio/p06-05.mp3'))
    === JSON.stringify({ bucket: 'haerin-audio', path: 'p06-05.mp3' }));
chk('路徑可以有子目錄', audio.parseStored('sb:b/a/b/c.mp3')?.path === 'a/b/c.mp3');
chk('★ 一般網址不是私密音檔（照舊直接播）', !audio.isStored('https://cdn.test/x.mp3'));
chk('空值／壞值不是', !audio.isStored(null) && !audio.isStored('') && !audio.isStored('sb:'));

console.log('\n【預先換好：一批一趟】');
{
  audio._clear(); stub.storageCalls.length = 0;
  const urls = ['sb:haerin-audio/a.mp3', 'sb:haerin-audio/b.mp3', 'sb:haerin-audio/a.mp3',
                'https://cdn.test/plain.mp3', null];
  await audio.prefetch(urls);
  chk('★ 同一個桶只問一趟', stub.storageCalls.length === 1, `${stub.storageCalls.length} 趟`);
  chk('重複的只問一次、一般網址不問', stub.storageCalls[0].paths.join() === 'a.mp3,b.mp3',
      stub.storageCalls[0].paths.join());
  chk('有效期是一小時', stub.storageCalls[0].ttl === 3600);
  chk('★ 換好後可以同步取（保留在點擊當下）',
      audio.cachedUrl('sb:haerin-audio/a.mp3') === 'https://signed.test/haerin-audio/a.mp3?t=1');
  chk('沒換過的取不到', audio.cachedUrl('sb:haerin-audio/zzz.mp3') === null);
  await audio.prefetch(urls);
  chk('已有快取就不再問', stub.storageCalls.length === 1, `${stub.storageCalls.length} 趟`);
}

console.log('\n【換不到：退路】');
{
  audio._clear(); stub.storageCalls.length = 0; stub.setStorageFail(true);
  let threw = false;
  try { await audio.prefetch(['sb:haerin-audio/a.mp3']); } catch { threw = true; }
  chk('★ 換失敗不丟錯（不能擋住開始一輪）', !threw);
  chk('也沒有留下壞快取', audio.cachedUrl('sb:haerin-audio/a.mp3') === null);
  stub.setStorageFail(false);
  chk('signedUrl 對一般網址原樣回傳', (await audio.signedUrl('https://cdn.test/x.mp3')) === 'https://cdn.test/x.mp3');
  chk('signedUrl 保底現換', (await audio.signedUrl('sb:haerin-audio/c.mp3')) === 'https://signed.test/haerin-audio/c.mp3?t=1');
}

console.log('\n【播放分流（core/speech.js）】');
{
  const played = [];
  globalThis.Audio = class { constructor(u) { this.u = u; } play() { played.push(this.u); return Promise.resolve(); } };
  const warned = [];
  globalThis.window = { };                         // 沒有 speechSynthesis → TTS 會走 speakWarn
  globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  _resetLang();
  setLang({ code: 'ko', storagePrefix: 'kr', ttsLang: 'ko-KR', voiceLangRe: /^ko/i, preferredVoices: [], syllableRe: /[가-힣]/g, termLabel: '韓文', langLabel: '韓語' });
  const speech = await import('../shared/js/core/speech.js');
  const origWarn = console.warn; console.warn = (...a) => warned.push(a.join(' '));

  audio._clear();
  speech.speak('안녕', 'https://cdn.test/plain.mp3');
  chk('一般網址：直接播', played.at(-1) === 'https://cdn.test/plain.mp3', String(played.at(-1)));

  // 沒注入來源 → 私密網址不能被當成一般網址丟給 <audio>
  played.length = 0;
  speech.speak('안녕', 'sb:haerin-audio/a.mp3');
  chk('★ 沒注入來源時，私密網址不會被直接丟給 <audio>', played.length === 0, played.join());

  speech.setAudioSource({ peek: audio.cachedUrl, get: audio.signedUrl });
  await audio.prefetch(['sb:haerin-audio/a.mp3']);
  played.length = 0;
  speech.speak('안녕', 'sb:haerin-audio/a.mp3');
  chk('★ 有快取：同步播簽名網址（仍在點擊當下）',
      played.length === 1 && played[0] === 'https://signed.test/haerin-audio/a.mp3?t=1', played.join());

  played.length = 0;
  speech.speak('안녕', 'sb:haerin-audio/new.mp3');
  await new Promise((r) => setTimeout(r, 20));
  chk('沒有快取：保底現換再播', played.length === 1 && /new\.mp3/.test(played[0]), played.join());

  played.length = 0;
  speech.speak('안녕', 'sb:haerin-audio/a.mp3', { slow: true });
  chk('慢速仍走 TTS（錄音放不慢）', played.length === 0);

  console.warn = origWarn;
}

if (fails) { console.log(`\n❌ ${fails} 項不通過`); process.exit(1); }
console.log('\n✅ 全部通過');
