// =====================================================================
// 分頁撈完（shared/js/data/paginate.js）
//
// 【為什麼值得一支純測試】
//   這段邏輯壞掉的方式全部都是「安靜的」：
//     · 少一頁 → 筆數少了，但畫面看起來只是內容比較少
//     · 多一頁 → 有些列出現兩次，計數與清單對不上
//     · 沒有唯一排序 → 兩者同時發生，而總筆數看起來是對的（L-013）
//   它不碰 supabase，所以能純 node 跑，把邊界一次驗完。
//
//     node tests/paginate.test.mjs
// =====================================================================
import { fetchAll } from '../shared/js/data/paginate.js';

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

/** 假的 builder：記下每一次 range，並照 order 排好再切頁 */
function makeSource(total, { pageSize = 1000 } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls = [];
  const build = () => {
    const q = { ordered: [] };
    q.order = (c) => { q.ordered.push(c); return q; };
    q.range = async (a, b) => {
      calls.push([a, b, q.ordered.join(',')]);
      return { data: rows.slice(a, Math.min(b + 1, a + pageSize)), error: null };
    };
    return q;
  };
  return { build, calls };
}

console.log('【邊界：頁數剛好與不剛好】');
for (const total of [0, 1, 999, 1000, 1001, 2000, 4000, 7049]) {
  const { build, calls } = makeSource(total);
  const out = await fetchAll(build, { tiebreak: 'id' });
  const ok = out.length === total && new Set(out.map((r) => r.id)).size === total;
  chk(`${total} 列全部撈到且不重複`, ok,
      `拿到 ${out.length} 列、不重複 ${new Set(out.map((r) => r.id)).size} · ${calls.length} 個請求`);
}

console.log('\n【小結果不該多打請求】');
{
  const { build, calls } = makeSource(58);
  await fetchAll(build, { tiebreak: 'id' });
  chk('★ 只打一個請求', calls.length === 1,
      `打了 ${calls.length} 個 —— 從第一頁就成批的話，58 列也會打 4 個（3 個是空的），`
      + '而「結果很小」才是多數情況');
}

console.log('\n【大結果要並行，不是一頁一頁等】');
{
  const { build, calls } = makeSource(7049);
  await fetchAll(build, { tiebreak: 'id', concurrency: 4 });
  // 第一頁單獨一趟，其餘 7 頁分成 4+3 兩批 → 3 個來回
  chk('★ 來回次數遠少於頁數', calls.length >= 8 && calls.length <= 12,
      `${calls.length} 個請求（8 頁資料）—— 成本是趟數×延遲，而趟數會跟著資料量長`);
}

console.log('\n【沒有唯一排序就拒絕】');
{
  const { build } = makeSource(10);
  let threw = '';
  await fetchAll(build).catch((e) => { threw = e.message; });
  chk('★ 沒給 tiebreak 直接丟例外', /tiebreak/.test(threw),
      threw || '（沒有丟）—— 沒有唯一排序的分頁會重複或漏掉列，而筆數看起來是對的');
}

console.log('\n【每一頁都要帶上排序】');
{
  const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
  const orders = [];
  const build = () => {
    const q = { ordered: [] };
    q.order = (c) => { q.ordered.push(c); return q; };
    q.range = async (a, b) => {
      orders.push(q.ordered.join(','));
      return { data: rows.slice(a, b + 1), error: null };
    };
    return q;
  };
  await fetchAll(build, { tiebreak: ['a', 'b'] });
  chk('★ 每一次查詢都帶了完整的排序鍵',
      orders.length > 1 && orders.every((o) => o === 'a,b'),
      orders.join(' | ') + ' —— 只有第一頁排序的話，後面幾頁的順序仍然是未定義的');
}

console.log('\n【錯誤要往上丟，不能當成撈完了】');
{
  const build = () => ({
    order() { return this; },
    async range() { return { data: null, error: new Error('boom') }; },
  });
  let threw = '';
  await fetchAll(build, { tiebreak: 'id' }).catch((e) => { threw = e.message; });
  chk('★ 查詢出錯時丟例外', threw === 'boom',
      '回空陣列的話，呼叫端會把「查詢失敗」讀成「這個人沒有資料」');
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
