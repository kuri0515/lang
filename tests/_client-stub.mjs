// data/client.js 的替身：記下每一次查詢，讓測試數得出「打了幾趟」。
//
// 趟數是這裡唯一要驗的東西 —— 它會隨著詞庫長大而爆炸，
// 而爆炸的徵兆在功能上完全看不出來（畫面一樣對，只是很久才出現）。
export const ITEM_FIELDS = 'id, ko, zh';
export const DIRECTIONS = ['ko2zh', 'zh2ko'];
export const dirLabel = () => ({ ko2zh: '', zh2ko: '' });

export const queries = [];
export const reset = () => { queries.length = 0; rows = []; };
let rows = [];
/** 設定 user_cards 表裡有哪些列 */
export const setCards = (r) => { rows = r; };

function builder(table) {
  const q = { table, filters: {} };
  const self = {
    select(f) { q.select = f; return self; },
    eq(k, v) { q.filters[k] = v; return self; },
    in(k, v) { q.filters[k] = v; q.inCount = v.length; return self; },
    range(a, b) { q.range = [a, b]; return self; },
    order() { return self; },
    limit() { return self; },
    then(res, rej) { return run(q).then(res, rej); },
  };
  return self;
}

async function run(q) {
  queries.push(q);
  let out = rows.filter((r) => r.user_id === q.filters.user_id);
  if (Array.isArray(q.filters.item_id)) {
    const want = new Set(q.filters.item_id);
    out = out.filter((r) => want.has(r.item_id));
  }
  if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
  return { data: out, error: null };
}

export const sb = { from: (t) => builder(t) };

// 與正式的 fetchAll 同樣的分頁語意：一頁 1000 列，撈到不足一頁為止
export async function fetchAll(build, page = 1000) {
  const all = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return all;
}
