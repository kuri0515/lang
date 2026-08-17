// 朗讀語音設定（語音選擇 + 語速）
import { $, esc } from '../core/dom.js';
import * as speech from '../core/speech.js';
import { lang } from '../core/lang.js';

export function initVoiceUI() {
  speech.onVoicesReady((list) => {
    const sel = $('voice-pick');
    if (!sel) return;
    if (!list.length) {
      sel.innerHTML = `<option>（系統沒有${lang().langLabel}語音）</option>`;
      sel.disabled = true;
      $('voice-test').disabled = true;
      return;
    }
    const cur = speech.currentVoice();
    sel.innerHTML = list.map((v, i) =>
      `<option value="${esc(v.name)}"${v.name === cur?.name ? ' selected' : ''}>${esc(v.name)}${i === 0 ? '（推薦）' : ''}</option>`
    ).join('');
    sel.onchange = () => { speech.setVoice(sel.value); speech.speak('안녕하세요'); };
  });

  const r = $('voice-rate');
  if (!r) return;
  r.value = speech.rate();
  $('rate-label').textContent = speech.rate().toFixed(2) + '×';
  r.oninput = () => {
    speech.setRate(Number(r.value));
    $('rate-label').textContent = Number(r.value).toFixed(2) + '×';
  };
  // ★ 試聽用的句子必須是「本站語言」的。
  //   這裡原本寫死韓文 —— 在日文站按試聽，會用日語語音去唸韓文字，
  //   出來是一串亂音，而使用者只會以為語音功能壞了。
  r.onchange = () => speech.speak(lang().voiceSampleShort);
  $('voice-test').onclick = () => speech.speak(lang().voiceSampleLong);
}
