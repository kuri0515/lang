// =====================================================================
// 輪次池的單元測試
//
// 這裡每一條都對應一個**真的發生過**的線上錯誤，不是想像出來的邊界。
// 線上狀態：某使用者 round_no=17、pos=70、queue=801 ——
// 也就是一輪都還沒走完，輪數卻跳了 16 次。
//
//     node tests/round.test.mjs
// =====================================================================
import { isUsable, isComplete, nextRound, deal, consume } from '../shared/js/study/round.js';

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const ids = (n) => Array.from({ length: n }, (_, i) => 'i' + i);
const asis = (a) => a;               // 定序，測試不要隨機
const rev = (a) => a.slice().reverse();

console.log('【空的 queue 不是「走完」】');
// ← 這就是 17 輪的成因。舊版寫的是 `pos < queue.length`，
//   空陣列時是 0 < 0 = false，於是被判成「走完了，開下一輪」。
const broken = { roundNo: 17, queue: [], pos: 0 };
chk('空 queue 判定為不可用', isUsable(broken) === false);
chk('空 queue 不算走完', isComplete(broken) === false);
chk('修復不推高輪數（仍是第 17 輪，不是第 18 輪）',
    nextRound(broken, ids(5), asis).roundNo === 17,
    `拿到 ${nextRound(broken, ids(5), asis).roundNo}`);
chk('空 queue 發不出牌', deal(broken, 10).length === 0);

console.log('\n【走完了才進下一輪】');
const done = { roundNo: 3, queue: ids(5), pos: 5 };
chk('pos 到底＝走完', isComplete(done) === true);
chk('走完才 +1 輪', nextRound(done, ids(5), asis).roundNo === 4);
const mid = { roundNo: 3, queue: ids(5), pos: 2 };
chk('沒走完就不算走完', isComplete(mid) === false);
chk('沒走完時重建維持原輪數', nextRound(mid, ids(5), asis).roundNo === 3);
chk('第一次建輪是第 1 輪', nextRound(null, ids(5), asis).roundNo === 1);
chk('新的一輪從頭開始', nextRound(done, ids(5), asis).pos === 0);
chk('新的一輪重新打散', nextRound(done, ids(3), rev).queue.join() === 'i2,i1,i0');
chk('沒有內容時直接丟錯，不會產生空輪次',
    (() => { try { nextRound(null, [], asis); return false; } catch { return true; } })());

console.log('\n【發牌不是消費】');
// ← 使用者的原話：「只有當這個池子裡的單詞全部被消費完了之後，才算是完成一輪」。
//   舊版在發牌時就 pos += 10，於是多按幾次輪練就吃掉幾十個詞。
let r = { roundNo: 1, queue: ids(30), pos: 0 };
const first = deal(r, 10);
chk('發牌拿到前 10 個', first.join() === ids(10).join());
chk('發牌不動指標', r.pos === 0);
chk('重按三次拿到同一組（不會吃掉詞庫）',
    deal(r, 10).join() === first.join() && deal(r, 10).join() === first.join() && r.pos === 0);
r = consume(r, 10);
chk('答完才推指標', r.pos === 10);
chk('下一組是接著的 10 個', deal(r, 10).join() === ids(20).slice(10).join());

console.log('\n【每個詞這一輪都輪得到】');
// 輪次池只承諾這一件事，直接把整輪跑完來驗
let full = { roundNo: 1, queue: ids(25), pos: 0 };
const seen = [];
let guard = 0;
while (!isComplete(full) && guard++ < 100) {
  const t = deal(full, 10);
  seen.push(...t);
  full = consume(full, t.length);
}
chk('走得完（沒有無限迴圈）', isComplete(full), `跑了 ${guard} 圈`);
chk('25 個全部發過，一個不漏', seen.length === 25 && new Set(seen).size === 25,
    `發出 ${seen.length} 個、去重後 ${new Set(seen).size} 個`);
chk('最後一組只發剩下的 5 個，不會超發', seen.length === 25);
chk('消費超過總數也不會越界', consume(full, 999).pos === 25);

console.log('\n【壞樣本自檢】');
// 上面的斷言若寫成恆真就什麼都抓不到，這裡證明它們會亮紅燈
const badIsUsable = (x) => !!x;                       // 忘了檢查長度＝原本的錯誤
const badConsume = (x, n) => ({ ...x, pos: x.pos });  // 忘了推指標
chk('假的 isUsable 會被這組測試判為錯', badIsUsable(broken) !== isUsable(broken));
chk('假的 consume 會被這組測試判為錯',
    badConsume({ queue: ids(30), pos: 0 }, 10).pos !== consume({ roundNo: 1, queue: ids(30), pos: 0 }, 10).pos);

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
