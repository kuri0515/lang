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
/**
 * ★ 真的 speak() 會先清掉卡住的引擎（`if (ss.speaking||ss.pending) ss.cancel()`），
 *   而 cancel() 會把還在等的 promise 放行 —— 這正是「點單句會讓整幕迴圈往下跳」
 *   的成因。替身若只是 push 一筆，這條測試就永遠是綠的，
 *   守著一個它其實抓不到的 bug（比沒有測試更危險）。
 */
export function speak(text) { cancel(); spoken.push(text); }
export function cancel() { pending.forEach((r) => r()); pending = []; }
export function speakLines() {}
