// 把 data/client.js 換成會記帳的替身（見 _client-stub.mjs）。
const CLIENT = new URL('./_client-stub.mjs', import.meta.url).href;
export function resolve(specifier, context, next) {
  // progress.js 寫的是 './client.js' —— 攔的要是「解析成哪個模組」，
  // 不是它被寫成什麼樣子（docs/LESSONS.md L-009）。專案裡只有一個 client.js。
  if (/(^|\/)client\.js$/.test(specifier)) return { url: CLIENT, shortCircuit: true };
  return next(specifier, context);
}
