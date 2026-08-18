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
    // ★ 網路語音一律排在後面，即使名字符合偏好清單。
    //   Microsoft ... Online (Natural) 音質確實比較好，但在 Chrome 上
    //   經常送不出聲音（要連伺服器）。會出聲比好聽重要。
    const remote = v.localService === false ? 100 : 0;
    for (let i = 0; i < preferredVoices.length; i++) {
      if (preferredVoices[i].test(v.name)) return remote + i;
    }
    return remote + preferredVoices.length + 1;
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

/**
 * 這一輪要避開的語音（例如剛剛失敗的網路語音）。
 * 只存在記憶體裡 —— 重新整理後重新給它一次機會，
 * 網路語音失敗常常是暫時的（連不上伺服器），不該永久拉黑。
 */
const avoid = new Set();

/** 本機語音（localService）。網路語音失敗時退回這裡 */
function localVoice() {
  return targetVoices().find((v) => v.localService && !avoid.has(v.name)) || null;
}

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
/**
 * 失敗時把現場狀態一起說出來。
 *
 * 【為什麼要這麼囉嗦】
 *   「朗讀失敗」四個字對使用者沒有用，對我也沒有用 ——
 *   我在本機重現不出來（替身不會模擬瀏覽器的語音競態），
 *   而使用者能給我的只有畫面上的字。
 *   把語音數量、選中的是哪一個、引擎當下的狀態一起印出來，
 *   一句訊息就能定位，不必來回猜好幾輪。
 */
function diagnosis() {
  try {
    const list = targetVoices();
    const v = currentVoice();
    const ss = window.speechSynthesis || {};
    return `［可用語音 ${list.length}／選中 ${v ? v.name : '無'}`
      + `／引擎 speaking=${!!ss.speaking} pending=${!!ss.pending} paused=${!!ss.paused}`
      + `／其中本機 ${list.filter((x) => x.localService).length}`
      + `／全部語音 ${(ss.getVoices?.() || []).length}］`
      + '把這一段截圖給開發者最快。';
  } catch (e) { return `［診斷失敗：${e.message}］`; }
}

let warned = false;
function speakWarn(msg) {
  if (warned) return;
  warned = true;
  // 動態載入避免 core → views 的反向相依（dom.js 是 core，msg 在那裡）
  import('./dom.js').then((d) => d.msg?.(msg)).catch(() => {});
}

// 這一輪有沒有試過「完全不指定語音」的最後一招
let noVoiceTried = false;

function speakTTS(text, { rate: override, slow = false, retry = false, bare = false } = {}) {
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
  // ★ 取消之後不能在同一個 tick 內送出下一句。
  //
  //   使用者實測回報的現場：
  //     ［可用語音 3／選中 Kyoko／引擎 speaking=true pending=false paused=false］
  //   引擎自己認為「正在說話」，但沒有任何聲音 —— Chrome 會卡在這個狀態
  //   （切分頁、系統休眠、上一句被中斷都可能造成）。
  //
  //   卡住時我們必須 cancel() 把它清乾淨，但 cancel() 是非同步的：
  //   同一個 tick 內接著 speak()，那一句會連同被清掉的佇列一起消失。
  //   結果就是「按了完全沒有聲音」，而且不報錯 —— 或報 canceled。
  //
  //   所以：要清就清，然後等一拍再送。沒有東西在播時才直接送。
  const ss = window.speechSynthesis;
  const wedged = ss.speaking || ss.pending;
  if (wedged) ss.cancel();
  // Chrome 有時會卡在 paused（切分頁、系統休眠之後），
  // 卡住時 speak() 進得去佇列但不會出聲。
  if (ss.paused) ss.resume();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = L.ttsLang;
  const base = override ?? autoRate(text, rate());
  u.rate = slow ? Math.max(0.4, base - 0.25) : base;
  u.pitch = 1;
  // bare = 不指定語音，只靠 u.lang 讓瀏覽器挑引擎（最後一招，見 onerror）
  const v = bare ? null : currentVoice();
  if (v) u.voice = v;

  // canceled / interrupted 不是錯誤，是我們自己造成的：
  // 換頁會 cancel()、下一句也會蓋掉上一句。報成失敗是噪音，
  // 而噪音會讓真正的錯誤被忽略。
  //
  // 但「按一次、沒有別人要蓋掉它、卻仍然被取消」是真的失敗，
  // 那一種重試一次通常就會過。
  u.onerror = (e) => {
    const why = e.error || '未知原因';
    if (why === 'canceled' || why === 'interrupted') {
      // ★ 網路語音（Microsoft ... Online (Natural)）在這個瀏覽器上送不出聲音 ——
      //   它要連伺服器才發得出來，而那條路常常不通。
      //   使用者實測回報：
      //     ［選中 Microsoft 圭太 Online (Natural)／引擎 speaking=false…］
      //   引擎是閒置的，所以不是卡死，是這個語音本身沒有聲音。
      //
      //   自動退回本機語音，不要求使用者自己去猜 ——
      //   他已經「換了一個聲音」，而選單裡看不出哪個是網路語音。
      if (v && v.localService === false) {
        avoid.add(v.name);
        const fallback = localVoice();
        if (fallback) {
          setVoice(fallback.name);            // 記住，下次直接用會出聲的那個
          speakWarn(`「${v.name}」是網路語音，這個瀏覽器送不出聲音，`
            + `已自動改用「${fallback.name}」。`);
          setTimeout(() => speakTTS(text, { rate: override, slow }), 60);
          return;
        }
        // ★ 一個本機語音都沒有（使用者的實際情況：3 個日語語音全是 Online）。
        //   最後一招：完全不指定語音，只給 lang，讓瀏覽器自己挑引擎 ——
        //   有時候這樣反而發得出聲（不走那個連不上的網路語音）。
        if (!noVoiceTried) {
          noVoiceTried = true;
          setTimeout(() => speakTTS(text, { rate: override, slow, bare: true }), 60);
          return;
        }
      }
      if (retry || bare) {
        const L2 = lang();
        const locals = targetVoices().filter((x) => x.localService).length;
        return speakWarn(locals === 0
          ? `系統裡的${L2.langLabel}語音全是「Online」網路語音，`
            + '這個瀏覽器送不出聲音。請安裝本機語音：'
            + `Mac：系統設定 → 輔助使用 → 朗讀內容 → 系統聲音 → 管理聲音 → 下載${L2.langLabel}語音；`
            + 'Windows：設定 → 時間與語言 → 語音 → 新增語音。'
            + '最快的解法是換一個瀏覽器：Mac 用 Safari、Windows 用 Edge —— '
            + '它們直接用系統內建的語音，不必連網路。'
          : `朗讀被取消，重試也一樣。${diagnosis()}`);
      }
      setTimeout(() => speakTTS(text, { rate: override, slow, retry: true }), 120);
      return;
    }
    speakWarn(`朗讀失敗（${why}）。${diagnosis()}`);
  };

  // 卡住過就等一拍 —— cancel() 是非同步的，同一個 tick 送出會被一起清掉
  if (wedged) setTimeout(() => ss.speak(u), 120);
  else ss.speak(u);
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
