// =====================================================================
// 學習模組（課本 A／Haerin's Schedule 並行入口）
//
//     node --import ./tests/_modules-stub.mjs tests/modules.test.mjs
//
// 【它守什麼】
//   這個功能壞掉的方式都是安靜的，而且全是同一種：
//   「限定範圍」在某個邊角悄悄變成「不限定」——
//     · 模組線上還沒有詞庫（deckIds 是空陣列）→ 被當成全部 → 複習混進別的內容
//     · 限定時少了 !inner → PostgREST 只把不符的列的 items 變成 null，
//       計數照樣是全站的
//   兩者畫面上都看不出來：數字是對的格式，只是不是這個模組的。
//   （docs/LESSONS.md L-001：空集合不是「全部」）
// =====================================================================
import { resolveModules, pickModule } from '../shared/js/core/modules.js';
import * as stub from './_modules-client-stub.mjs';
import * as progress from '../shared/js/data/progress.js';

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

const CFG = [
  { id: 'textbook', title: '課本 A', deckSlugs: null, roundDeck: 'vocab-01', courses: true },
  { id: 'haerin', title: "Haerin's Schedule", deckSlugs: ['haerin-schedule'], roundDeck: 'haerin-schedule' },
];
const D = (slug) => ({ id: 'id-' + slug, slug });
const TEXTBOOK = [D('daily-01'), D('vocab-01'), D('life-01')];

console.log('【模組怎麼認領詞庫】');
{
  const m = resolveModules(CFG, [...TEXTBOOK, D('haerin-schedule')]);
  chk('兩個模組', m.length === 2);
  chk('Haerin 只拿自己的詞庫', m[1].deckIds.join() === 'id-haerin-schedule', m[1].deckIds.join());
  chk('課本拿「沒被認領的全部」（含日後新增的詞庫）',
      m[0].deckIds.join() === 'id-daily-01,id-vocab-01,id-life-01', m[0].deckIds.join());
  chk('課本不含 Haerin 的詞庫（兩邊不重疊）',
      !m[0].deckIds.some((id) => m[1].deckIds.includes(id)));
  const later = resolveModules(CFG, [...TEXTBOOK, D('haerin-schedule'), D('brand-new')]);
  chk('新詞庫預設歸課本，不會哪個入口都看不到', later[0].deckIds.includes('id-brand-new'));
  chk('輪練詞庫與課程旗標照設定', m[1].roundDeck === 'haerin-schedule' && m[0].courses && !m[1].courses);
}

console.log('\n【Haerin 的詞庫還沒匯入】');
{
  const m = resolveModules(CFG, TEXTBOOK);
  chk('入口仍在（使用者要的是兩個並行入口）', m.length === 2);
  chk('★ deckIds 是空陣列，不是 null／全部', Array.isArray(m[1].deckIds) && m[1].deckIds.length === 0);
  chk('標成還沒有內容', m[1].available === false && m[0].available === true);
}

console.log('\n【沒有模組機制（日文站）】');
chk('空設定 → 沒有模組', resolveModules([], TEXTBOOK).length === 0);
chk('只有一個 → 不分入口', resolveModules([CFG[0]], TEXTBOOK).length === 0);
chk('沒宣告 → 沒有模組', resolveModules(undefined, TEXTBOOK).length === 0);
chk('沒有模組時 pickModule 回 null', pickModule([], 'x') === null);

console.log('\n【選模組】');
{
  const m = resolveModules(CFG, [...TEXTBOOK, D('haerin-schedule')]);
  chk('挑得到', pickModule(m, 'haerin').id === 'haerin');
  chk('偏好過期（認不得的 id）退回第一個', pickModule(m, 'gone').id === 'textbook');
  chk('沒存過偏好退回第一個', pickModule(m, null).id === 'textbook');
}

console.log('\n【到期查詢：限定範圍】');
{
  stub.reset();
  const r = await progress.dueCounts('u1', ['ko2zh'], ['d1', 'd2']);
  chk('回傳計數', r.total === 7);
  const base = stub.queries[0];
  const sel = base.calls.find((c) => c[0] === 'select');
  chk('★ 限定時用 items!inner（否則計數是全站的）', /items!inner/.test(sel[1]), sel[1]);
  const inn = base.calls.find((c) => c[0] === 'in' && c[1] === 'items.deck_id');
  chk('用詞庫 id 過濾', !!inn && inn[2].join() === 'd1,d2');
}
{
  stub.reset();
  await progress.dueCounts('u1', ['ko2zh']);
  const sel = stub.queries[0].calls.find((c) => c[0] === 'select');
  chk('不限定時查詢與從前一樣（不加 join）', !/items/.test(sel[1]), sel[1]);
  chk('不限定時沒有詞庫過濾', !stub.queries[0].calls.some((c) => c[1] === 'items.deck_id'));
}
{
  stub.reset();
  const r = await progress.dueCounts('u1', ['ko2zh'], []);
  chk('★ 空集合 → 0，不是全站', r.total === 0 && r.carried === 0);
  chk('空集合根本不發查詢', stub.queries.length === 0, `${stub.queries.length} 趟`);
}

console.log('\n【取到期的卡：限定範圍】');
{
  stub.reset();
  await progress.fetchDue('u1', ['ko2zh'], 50, ['d1']);
  const sel = stub.queries[0].calls.find((c) => c[0] === 'select');
  chk('限定時 join 並帶出 deck_id', /items!inner\(.*deck_id/.test(sel[1]), sel[1]);
  chk('用詞庫 id 過濾',
      stub.queries[0].calls.some((c) => c[0] === 'in' && c[1] === 'items.deck_id' && c[2].join() === 'd1'));
}
{
  stub.reset();
  const out = await progress.fetchDue('u1', ['ko2zh'], 50, []);
  chk('★ 空集合 → 沒有卡，不是全站', Array.isArray(out) && out.length === 0 && stub.queries.length === 0);
}
{
  stub.reset();
  await progress.fetchDue('u1', ['ko2zh'], 50);
  const sel = stub.queries[0].calls.find((c) => c[0] === 'select');
  chk('不限定時查詢與從前一樣', /items\(/.test(sel[1]) && !/!inner/.test(sel[1]), sel[1]);
}

if (fails) { console.log(`\n❌ ${fails} 項不通過`); process.exit(1); }
console.log('\n✅ 全部通過');
