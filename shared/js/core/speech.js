// =====================================================================
// 目標語言朗讀
//
// 【為什麼需要挑語音】
//   瀏覽器的 speechSynthesis 預設常挑到系統裡的「趣味語音」——
//   macOS 的 Eddy / Grandma / Rocko / Flo 等是刻意做成怪腔的角色音，
//   拿來學發音只會學歪。真正該用的是 Yuna（韓）、Kyoko（日）、
//   Google／Microsoft 那些播報級語音。
//
//   本模組替使用者排序挑選，並允許手動指定（存 localStorage）。
//
// 【為什麼語言相關的部分全部外包給 lang()】
//   要唸的語言碼、該優先挑哪些語音、怎麼數音節，三個語言各不相同，
//   但「排除趣味語音、短詞放慢、有音檔優先、唸完才 resolve」這些
//   完全一樣。所以差異走設定，邏輯留在這裡。
//
// 【根本解法】
//   真人錄音仍然最好。items.audio_url 已預留欄位，
//   有音檔時一律優先播音檔，這裡只是沒有音檔時的退路。
// =====================================================================

import { lang } from './lang.js';

const lsVoice = () => `${lang().storagePrefix}.voice`;
const lsRate  = () => `${lang().storagePrefix}.rate`;

// 明確排除的趣味／角色語音（聽起來機械或滑稽，不適合學語言）。
// 這份與語言無關 —— macOS 的角色音在哪個語言下都一樣不能拿來學。
const NOVELTY = /eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bells|bubbles|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|bahh|boing|bad news|good news/i;

let cached = null;

/** 系統可用的目標語言語音，已排序（最佳在前）、已濾掉趣味語音 */
export function targetVoices() {
  if (!('speechSynthesis' in window)) return [];
  const { voiceLangRe, preferredVoices } = lang();
  const all = speechSynthesis.getVoices().filter((v) => voiceLangRe.test(v.lang));
  const good = all.filter((v) => !NOVELTY.test(v.name));
  const pool = good.length ? good : all;      // 全被濾光就退回全部

  return pool.slice().sort((a, b) => rank(a) - rank(b));

  function rank(v) {
    for (let i = 0; i < preferredVoices.length; i++) {
      if (preferredVoices[i].test(v.name)) return i;
    }
    return preferredVoices.length + (v.localService ? 0 : 1);
  }
}

/** 目前採用的語音：使用者指定優先，否則取排序第一 */
export function currentVoice() {
  const list = targetVoices();
  if (!list.length) return null;
  const saved = localStorage.getItem(lsVoice());
  return list.find((v) => v.name === saved) || list[0];
}

export function setVoice(name) { localStorage.setItem(lsVoice(), name); }

export function rate() { return Number(localStorage.getItem(lsRate())) || 0.9; }
export function setRate(r) { localStorage.setItem(lsRate(), String(r)); }

/** 語音清單是非同步載入的，第一次呼叫可能拿到空陣列 */
export function onVoicesReady(cb) {
  if (!('speechSynthesis' in window)) return cb([]);
  const list = targetVoices();
  if (list.length) { cached = list; return cb(list); }
  speechSynthesis.addEventListener('voiceschanged', () => {
    cached = targetVoices();
    cb(cached);
  }, { once: true });
}

/**
 * 短詞自動放慢。
 *
 * 兩三個音節的詞在 TTS 下 0.5 秒就結束，又沒有上下文可以推敲，
 * 常常聽過去了還沒反應過來 —— 實際使用中 오빠 就卡了 23 秒。
 * 詞越短給的資訊越少，就該念得越慢。
 *
 * 怎麼算「一個音節」各語言不同（韓語一個諺文字＝一音節，日語得算假名），
 * 所以正則由 lang().syllableRe 提供，門檻與放慢幅度兩邊共用。
 */
function autoRate(text, base) {
  const syllables = (String(text).match(lang().syllableRe) || []).length;
  if (syllables <= 2) return Math.max(0.45, base - 0.25);
  if (syllables <= 4) return Math.max(0.5, base - 0.12);
  return base;
}

/**
 * 朗讀目標語言。有音檔優先播音檔。
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

/**
 * 朗讀失敗時要說出來，而不是靜靜地什麼都不做。
 *
 * 【為什麼】
 *   先前失敗一律 return —— 使用者按下去沒反應，也沒有任何線索：
 *   是壞了？是沒有語音？是要開音量？他無從判斷，我也無從查
 *   （實際發生過：使用者回報「完全按了之後沒有聲音」，
 *    而我在測試環境怎麼跑都是正常的）。
 *
 * 【為什麼只講一次】
 *   一輪要唸三十到八十次。每次都彈訊息會把畫面洗掉，
 *   而第二次之後也不帶新資訊。
 */
let warned = false;
function speakWarn(msg) {
  if (warned) return;
  warned = true;
  // 動態載入避免 core → views 的反向相依（dom.js 是 core，msg 在那裡）
  import('./dom.js').then((d) => d.msg?.(msg)).catch(() => {});
}

function speakTTS(text, { rate: override, slow = false } = {}) {
  if (!('speechSynthesis' in window)) {
    return speakWarn('這個瀏覽器不支援朗讀。換 Safari 或 Chrome 試試。');
  }
  const L = lang();
  // 系統一個目標語言的語音都沒有 → 唸出來的會是英文腔或完全沒聲音。
  // 這不是程式的問題，但使用者只看得到「按了沒反應」，所以要指路。
  if (!targetVoices().length) {
    return speakWarn(`系統裡沒有${L.langLabel}語音。`
      + 'iPhone：設定 → 輔助使用 → 朗讀內容 → 聲音；'
      + 'Mac：系統設定 → 輔助使用 → 朗讀內容 → 系統聲音 → 管理聲音。');
  }
  speechSynthesis.cancel();                    // 打斷上一句，避免排隊堆積
  const u = new SpeechSynthesisUtterance(text);
  u.lang = L.ttsLang;
  const base = override ?? autoRate(text, rate());
  u.rate = slow ? Math.max(0.4, base - 0.25) : base;
  u.pitch = 1;
  const v = currentVoice();
  if (v) u.voice = v;
  u.onerror = (e) => speakWarn(`朗讀失敗（${e.error || '未知原因'}）。`
    + '到「我的 → 語音」換一個聲音試試。');
  speechSynthesis.speak(u);
}

/**
 * 唸完才 resolve。整段對話朗讀要靠它 ——
 * 用 speak() 連續呼叫會同時觸發，四句疊在一起變成噪音。
 *
 * 有音檔走 <audio> 的 ended／error；沒有就走 TTS 的 onend。
 * 兩邊都要保底：瀏覽器不支援語音合成時直接 resolve，
 * 否則整段朗讀會卡在第一句等一個永遠不來的事件。
 */
export function speakAwait(text, audioUrl = null, opts = {}) {
  return new Promise((resolve) => {
    if (audioUrl && !opts.slow) {
      const a = new Audio(audioUrl);
      a.onended = resolve;
      a.onerror = () => ttsAwait(text, opts).then(resolve);
      a.play().catch(() => ttsAwait(text, opts).then(resolve));
      return;
    }
    ttsAwait(text, opts).then(resolve);
  });
}

function ttsAwait(text, { rate: override, slow = false } = {}) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang().ttsLang;
    const base = override ?? autoRate(text, rate());
    u.rate = slow ? Math.max(0.4, base - 0.25) : base;
    const v = currentVoice();
    if (v) u.voice = v;
    u.onend = resolve;
    u.onerror = resolve;          // 唸失敗也要往下走，不能卡住整段
    speechSynthesis.speak(u);
  });
}

/** 停止朗讀。切換畫面或按停止時用 —— 聲音不該跟著人跑到別的頁面 */
export function cancel() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export { cached as _cached };
