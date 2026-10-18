// 把 data/client.js 換成「什麼方法都接、全部記下來」的替身（見 _modules-client-stub.mjs）。
const CLIENT = new URL('./_modules-client-stub.mjs', import.meta.url).href;
export function resolve(specifier, context, next) {
  if (/(^|\/)client\.js$/.test(specifier)) return { url: CLIENT, shortCircuit: true };
  return next(specifier, context);
}
