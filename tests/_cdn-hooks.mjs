// 解析階段把 supabase-js 換成本地替身，載入階段就不會真的去連線。
//
// ★ 攔的是「什麼被解析成 supabase」，不是「網址長什麼樣」。
//   先前只攔 https://esm.sh/ —— supabase 改成自託管
//   （shared/vendor/supabase.js）之後那個條件就再也不成立，
//   於是測試靜靜地載入真的 supabase-js，開始打網路。
//   症狀是某一支測試在 10 秒後以 ConnectTimeout 整個掛掉，
//   而錯誤訊息裡完全看不出跟替身有關。
const STUB = new URL('./_supabase-stub.mjs', import.meta.url).href;
const isSupabase = (s) =>
  s.startsWith('https://esm.sh/')            // 舊路徑，留著擋回退
  || /(^|\/)vendor\/supabase\.js$/.test(s)   // 自託管的產物
  || s === '@supabase/supabase-js';          // 直接用套件名時

export function resolve(specifier, context, next) {
  if (isSupabase(specifier)) return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
