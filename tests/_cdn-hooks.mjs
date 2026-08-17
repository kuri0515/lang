// 解析階段把 esm.sh 的網址換成本地替身；載入階段就不會碰到 https:。
const STUB = new URL('./_supabase-stub.mjs', import.meta.url).href;

export function resolve(specifier, context, next) {
  if (specifier.startsWith('https://esm.sh/')) {
    return { url: STUB, shortCircuit: true };
  }
  return next(specifier, context);
}
