// 語音模組的替身：記下唸了什麼，並讓測試控制「一句唸完」的時機。
// 真的 speech 要 Web Speech API，node 裡沒有 —— 而這裡要驗的是
// 「換幕之後還會不會繼續唸」，那是排程邏輯，與發音無關。
export const IS_STUB = true;
export const spoken = [];
let pending = [];
export function reset() { spoken.length = 0; pending = []; }
/** 放行最早那一句（模擬它唸完了） */
export function finishOne() { pending.shift()?.(); }
export function speakAwait(text) {
  spoken.push(text);
  return new Promise((r) => pending.push(r));
}
export function speak(text) { spoken.push(text); }
export function cancel() { pending.forEach((r) => r()); pending = []; }
export function speakLines() {}
