// 精讀測試用的解析攔截：把資料層換成固定的假資料。
// 攔的是「什麼被解析成精讀的資料層」，不是網址長相 —— 見 docs/LESSONS.md L-009。
const FAKE = new URL('./_script-data-stub.mjs', import.meta.url).href;
const SPEECH = new URL('./_speech-stub.mjs', import.meta.url).href;
const CONTENT = new URL('./_content-stub.mjs', import.meta.url).href;
const STUB = new URL('./_supabase-stub.mjs', import.meta.url).href;
const isSupabase = (s) => s.startsWith('https://esm.sh/')
  || /(^|\/)vendor\/supabase\.js$/.test(s) || s === '@supabase/supabase-js';

export function resolve(specifier, context, next) {
  if (/(^|\/)data\/script\.js$/.test(specifier)) return { url: FAKE, shortCircuit: true };
  if (/(^|\/)core\/speech\.js$/.test(specifier)) return { url: SPEECH, shortCircuit: true };
  if (/(^|\/)data\/content\.js$/.test(specifier)) return { url: CONTENT, shortCircuit: true };
  if (isSupabase(specifier)) return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
