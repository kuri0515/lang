// =====================================================================
// 韓語朗讀
//
// 【為什麼需要挑語音】
//   瀏覽器的 speechSynthesis 預設常挑到系統裡的「趣味語音」——
//   macOS 的 Eddy / Grandma / Rocko / Flo 等是刻意做成怪腔的角色音，
//   拿來學發音只會學歪。真正該用的是 Yuna（Apple 正規韓語語音）、
//   Google 한국의、Microsoft SunHi 這類播報級語音。
//
//   本模組替使用者排序挑選，並允許手動指定（存 localStorage）。
//
// 【根本解法】
//   真人錄音仍然最好。items.audio_url 已預留欄位，
//   有音檔時一律優先播音檔，這裡只是沒有音檔時的退路。
// =====================================================================

const LS_VOICE = 'kr.voice';
const LS_RATE  = 'kr.rate';

// 明確排除的趣味／角色語音（聽起來機械或滑稽，不適合學語言）
const NOVELTY = /eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bells|bubbles|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|bahh|boing|bad news|good news/i;

// 越前面權重越高
const PREFERRED = [
  /yuna|유나/i,                    // Apple 正規韓語女聲
  /premium|enhanced|neural|natural/i,
  /google/i,                       // Chrome 的 Google 한국의
  /sunhi|heami|microsoft/i,        // Windows / Edge
];

let cached = null;

/** 系統可用的韓語語音，已排序（最佳在前）、已濾掉趣味語音 */
export function koreanVoices() {
  if (!('speechSynthesis' in window)) return [];
  const all = speechSynthesis.getVoices()
    .filter((v) => /^ko(-|_)?/i.test(v.lang));
  const good = all.filter((v) => !NOVELTY.test(v.name));
  const pool = good.length ? good : all;      // 全被濾光就退回全部

  return pool.slice().sort((a, b) => rank(a) - rank(b));

  function rank(v) {
    for (let i = 0; i < PREFERRED.length; i++) if (PREFERRED[i].test(v.name)) return i;
    return PREFERRED.length + (v.localService ? 0 : 1);
  }
}

/** 目前採用的語音：使用者指定優先，否則取排序第一 */
export function currentVoice() {
  const list = koreanVoices();
  if (!list.length) return null;
  const saved = localStorage.getItem(LS_VOICE);
  return list.find((v) => v.name === saved) || list[0];
}

export function setVoice(name) { localStorage.setItem(LS_VOICE, name); }

export function rate() { return Number(localStorage.getItem(LS_RATE)) || 0.9; }
export function setRate(r) { localStorage.setItem(LS_RATE, String(r)); }

/** 語音清單是非同步載入的，第一次呼叫可能拿到空陣列 */
export function onVoicesReady(cb) {
  if (!('speechSynthesis' in window)) return cb([]);
  const list = koreanVoices();
  if (list.length) { cached = list; return cb(list); }
  speechSynthesis.addEventListener('voiceschanged', () => {
    cached = koreanVoices();
    cb(cached);
  }, { once: true });
}

/**
 * 短詞自動放慢。
 *
 * 兩三個音節的詞在 TTS 下 0.5 秒就結束，又沒有上下文可以推敲，
 * 常常聽過去了還沒反應過來 —— 實際使用中 오빠 就卡了 23 秒。
 * 詞越短給的資訊越少，就該念得越慢。
 */
function autoRate(text, base) {
  const syllables = (String(text).match(/[\uac00-\ud7af]/g) || []).length;
  if (syllables <= 2) return Math.max(0.45, base - 0.25);
  if (syllables <= 4) return Math.max(0.5, base - 0.12);
  return base;
}

/**
 * 朗讀韓文。有音檔優先播音檔。
 * @param {string} text
 * @param {string|null} audioUrl
 * @param {{rate?:number, slow?:boolean}} opts  slow=true 時再放慢一檔
 */
export function speak(text, audioUrl = null, opts = {}) {
  if (audioUrl && !opts.slow) {
    // 慢速播放 TTS 才做得到，有音檔時的慢速仍走 TTS
    new Audio(audioUrl).play().catch(() => speakTTS(text, opts));
    return;
  }
  speakTTS(text, opts);
}

function speakTTS(text, { rate: override, slow = false } = {}) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();                    // 打斷上一句，避免排隊堆積
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const base = override ?? autoRate(text, rate());
  u.rate = slow ? Math.max(0.4, base - 0.25) : base;
  u.pitch = 1;
  const v = currentVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

export { cached as _cached };
