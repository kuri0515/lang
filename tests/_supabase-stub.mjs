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

const pool = process.env.STUB_POOL && fs.existsSync(process.env.STUB_POOL)
  ? JSON.parse(fs.readFileSync(process.env.STUB_POOL, 'utf8'))
  : [];

/** PostgREST 的 builder 是可鏈可 await 的，替身也要同時是這兩者 */
function query(table) {
  const rows = () => (table === 'items' ? pool : []);
  const result = () => ({ data: rows(), error: null });
  const self = new Proxy(function () {}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res(result());
      if (prop === 'data') return rows();
      if (prop === 'error') return null;
      return () => self;                       // select/eq/order/limit… 一律回自己
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
