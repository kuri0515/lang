// 記下查詢鏈上每一個呼叫（方法名＋參數），測試才看得到「到底問了什麼」。
// 與 _client-stub.mjs 不同：那份只懂 eq/in/range，而到期查詢還用 neq/lte/lt。
export const ITEM_FIELDS = 'id, ko, zh';
export const DIRECTIONS = ['ko2zh', 'zh2ko'];
export const dirLabel = () => ({ ko2zh: '', zh2ko: '' });

export const queries = [];
export const reset = () => { queries.length = 0; };

function builder(table) {
  const calls = [];
  const q = { table, calls };
  queries.push(q);
  const self = new Proxy({}, {
    get(_, name) {
      if (name === 'then') return (res) => Promise.resolve({ data: [], count: 7, error: null }).then(res);
      return (...args) => { calls.push([String(name), ...args]); return self; };
    },
  });
  return self;
}
export const storageCalls = [];
export let storageFail = false;
export const setStorageFail = (v) => { storageFail = v; };
export const sb = {
  from: (t) => builder(t),
  // 簽名網址：照路徑回 https://signed.test/<桶>/<路徑>?t=1，並記下每一趟
  storage: { from: (bucket) => ({
    createSignedUrls: async (paths, ttl) => {
      storageCalls.push({ bucket, paths, ttl });
      if (storageFail) return { data: null, error: new Error('boom') };
      return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${bucket}/${p}?t=1` })), error: null };
    },
  }) },
};
export { fetchAll } from '../shared/js/data/paginate.js';
