// supabase-js 的替身。
//
// 【為什麼要能回傳真實資料】
//   第一版只讓 createClient() 不炸，查詢一律回空 ——
//   那足以載入模組，但渲染不出東西：對話、詞庫、記錄都是空白，
//   等於還是看不到畫面。而「看不到畫面」正是這個專案一再吃虧的地方。
//
//   現在從 STUB_POOL 指定的檔案讀真實條目，讓 .from('items') 有東西回。
//   其餘資料表回空陣列 —— 那是「新使用者」的真實狀態，本來就該顯示得出來。
import fs from 'fs';

let callNo = 0;
const pool = process.env.STUB_POOL && fs.existsSync(process.env.STUB_POOL)
  ? JSON.parse(fs.readFileSync(process.env.STUB_POOL, 'utf8'))
  : [];

/**
 * PostgREST 的 builder 是可鏈可 await 的，替身也要同時是這兩者。
 *
 * ★ range()／limit()／count 一定要照做，不能一律回整份。
 *   替身比正式程式寬鬆時，測試會綠著守一個它抓不到的 bug ——
 *   伺服器端分頁若壞了（每頁都回同一批、或總數算錯），
 *   在「永遠回整份」的替身底下看起來完全正常。（docs/LESSONS.md L-012）
 */
function query(table) {
  const all = () => (table === 'items' ? pool : []);
  const q = { range: null, limit: null, count: false, search: null };
  const result = () => {
    let rows = all();
    // ★ 搜尋也要照做。不照做的話，「換了關鍵字卻拿到舊結果」這種錯
    //   在替身底下看起來完全正常 —— 兩次查詢本來就回一樣的東西。
    if (q.search) {
      const k = q.search.toLowerCase();
      rows = rows.filter((r) => ['ko', 'zh', 'romanization']
        .some((f) => String(r[f] ?? '').toLowerCase().includes(k)));
    }
    const total = rows.length;
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) rows = rows.slice(0, q.limit);
    return { data: rows, error: null, count: q.count ? total : null };
  };
  // 測試可以指定「第 n 趟慢多少毫秒」，用來造出回應順序顛倒的現場
  // （打字打到一半換關鍵字時，先送的那趟可能後回來）。
  const delayed = async () => {
    const ms = globalThis.__stubDelay?.(++callNo) || 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    return result();
  };
  const self = new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'then') {
        return (res, rej) => (globalThis.__stubDelay ? delayed().then(res, rej) : res(result()));
      }
      if (prop === 'data') return result().data;
      if (prop === 'error') return null;
      if (prop === 'range') return (a, b) => { q.range = [a, b]; return self; };
      if (prop === 'limit') return (n) => { q.limit = n; return self; };
      if (prop === 'select') return (_f, o) => { if (o?.count) q.count = true; return self; };
      // content.js 送的是 `ko.ilike.*關鍵字*,zh.ilike.*…`，取第一段的關鍵字就夠
      if (prop === 'or') return (s) => {
        q.search = String(s).match(/ilike\.\*([^*]*)\*/)?.[1] ?? null;
        return self;
      };
      return () => self;                       // eq/or/like/order… 一律回自己
    },
    apply() { return self; },
  });
  return self;
}

// ★ 蓋一個印，讓測試驗得出「載到的真的是替身」。
//   沒有這個印的話，攔截條件哪天失效（例如 import 路徑改了）
//   測試會靜靜地載入真的 supabase-js 去打網路 ——
//   而症狀是十秒後的 ConnectTimeout，看不出跟替身有關。
export const IS_STUB = true;

export const createClient = () => ({
  __stub: true,
  from: (t) => query(t),
  rpc: () => query(null),
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
});
