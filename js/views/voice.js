// 朗讀語音設定（語音選擇 + 語速）
import { $, esc } from '../core/dom.js';
import * as speech from '../core/speech.js';

export function initVoiceUI() {
  speech.onVoicesReady((list) => {
    const sel = $('voice-pick');
    if (!sel) return;
    if (!list.length) {
      sel.innerHTML = '<option>（系統沒有韓語語音）</option>';
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
  r.onchange = () => speech.speak('한국어를 배우고 있어요');
  $('voice-test').onclick = () => speech.speak('안녕하세요. 만나서 반갑습니다.');
}
