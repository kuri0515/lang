// =====================================================================
// cardsByItem 的往返趟數
//
// 【為什麼要專門測一個「效能」的東西】
//   因為它壞掉時功能完全正常 —— 只是慢，而且是**隨著內容長大才慢**。
//   分批查 id 的成本是趟數：詞庫 7049 條時，瀏覽頁開一次要
//   7049÷80 ＝ 89 趟連續往返；手機一趟 150 ms，就是十幾秒。
//   沒有人會把它當 bug 回報，只會覺得「這個 app 很慢」。
//
//   一個人的卡是跟著他學過多少走的，與詞庫多大無關。
//   所以問的條目一多就改成照 user_id 撈完再自己過濾。
//
//     node --import ./tests/_cards-hooks.mjs tests/cards.test.mjs
// =====================================================================
import * as stub from './_client-stub.mjs';
import * as progress from '../shared/js/data/progress.js';

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const ids = (n) => Array.from({ length: n }, (_, i) => `i${i}`);
const card = (id, dir = 'ko2zh') => ({
  user_id: 'u1', item_id: id, direction: dir, state: 'learning',
  total_reviews: 2, correct_reviews: 1,
});

console.log('【條目少：照 id 問】');
{
  stub.reset();
  stub.setCards([card('i3'), card('i3', 'zh2ko')]);
  const out = await progress.cardsByItem('u1', ids(100));
  chk('答案正確', !!out.i3?.ko2zh && !!out.i3?.zh2ko, JSON.stringify(out));
  chk('走 in.() 這條路', stub.queries.every((q) => Array.isArray(q.filters.item_id)));
  chk('趟數＝批數', stub.queries.length === 2, `${stub.queries.length} 趟`);
}

console.log('【條目多：改成照這個人撈】');
{
  stub.reset();
  stub.setCards([card('i5'), card('i9999')]);   // i9999 不在問的範圍裡
  const out = await progress.cardsByItem('u1', ids(7049));
  chk('★ 趟數不隨詞庫長大', stub.queries.length === 1,
      `打了 ${stub.queries.length} 趟 —— 舊的分批寫法在這裡是 89 趟`);
  chk('沒有把 id 塞進 URL', stub.queries.every((q) => !Array.isArray(q.filters.item_id)));
  chk('答案正確', !!out.i5?.ko2zh, JSON.stringify(out));
  chk('★ 不在詢問範圍內的卡要濾掉', !out.i9999,
      '整份撈回來之後若不過濾，瀏覽頁會標到根本沒列出來的條目');
}

console.log('【這個人有很多卡：仍要撈完，不能只拿第一頁】');
{
  stub.reset();
  // 1200 列 → 超過一頁（1000），沒有分頁就會少掉 200 列
  stub.setCards(ids(1200).map((id) => card(id)));
  const out = await progress.cardsByItem('u1', ids(7049));
  chk('★ 撈滿 1200 列', Object.keys(out).length === 1200,
      `只拿到 ${Object.keys(out).length} 列 —— PostgREST 單次上限 1000，少掉的那截看不出來`);
}

console.log('【沒有使用者就別問】');
{
  stub.reset();
  const out = await progress.cardsByItem(null, ids(7049));
  chk('不打任何一趟', stub.queries.length === 0 && Object.keys(out).length === 0);
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
