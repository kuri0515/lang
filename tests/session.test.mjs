// =====================================================================
// 學習會話引擎的單元測試
//
// 這段邏輯（撤銷、回看不重複計分、延遲寫入的定案時機）最容易出錯，
// 且錯了會直接污染使用者的正確率。引擎不碰 DOM，所以能純 node 跑。
//
//     node tests/session.test.mjs
// =====================================================================
import { createSession, matchesType } from '../shared/js/study/session.js';
import { RATING, scheduleRecall } from '../shared/js/core/srs.js';

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const mk = (n) => Array.from({ length: n }, (_, i) =>
  ({ item: { id: 'i' + i, ko: 'k' + i, zh: 'z' + i }, direction: 'ko2zh', card: null }));

const saved = [];
let finished = null;
const last = () => saved[saved.length - 1];
const S = createSession({
  save: (p) => saved.push(p),
  onChange: () => {},
  onFinish: (s, fr) => { finished = { ...s, free: fr }; },
});

console.log('【基本流程】');
S.start(mk(3));
chk('起始 idx=0 總數 3', S.state().idx === 0 && S.state().total === 3);
S.grade(RATING.GOOD);
chk('評分後前進', S.state().idx === 1);
chk('尚未寫庫（延遲中）', saved.length === 0);
chk('可撤銷', S.state().canUndo);

console.log('【撤銷 = 這題根本沒答過】');
S.undo();
chk('回到 idx=0', S.state().idx === 0);
chk('撤銷後不寫庫', saved.length === 0,
    'reviews 是只追加日誌，寫了就洗不掉，故必須延遲而非寫了再刪');
chk('統計歸零', S.state().stats.n === 0);
chk('不可再撤銷', !S.state().canUndo);

console.log('【AGAIN 補回佇列】');
S.start(mk(2));
S.grade(RATING.AGAIN);
chk('忘了 → 佇列變 3', S.state().total === 3);
S.undo();
chk('撤銷後佇列恢復 2', S.state().total === 2, '避免撤銷留下幽靈卡');

console.log('【回看不重複計分】');
S.start(mk(3));
S.grade(RATING.GOOD);
S.grade(RATING.GOOD);
chk('答了 2 題', S.state().stats.n === 2);
S.go(-1);
chk('回看標記為已答', S.state().isGraded);
S.grade(RATING.AGAIN);
chk('重複評分被忽略', S.state().stats.n === 2, '否則同一題記兩次，污染正確率');

console.log('【定案時機】');
saved.length = 0;
S.start(mk(3));
S.grade(RATING.GOOD);
S.grade(RATING.GOOD);
chk('答新題會定案舊題', saved.length === 1, '只有最近一題可撤銷');
S.start(mk(1));
chk('開新一輪也會定案未寫的那題', saved.length === 2, '換一輪不該丟掉上一輪的最後一答');

console.log('【自由練習標記】');
saved.length = 0;
S.start(mk(1), { freeMode: true });
S.grade(RATING.GOOD);
chk('payload 帶 free=true', last()?.free === true, '資料層據此決定要不要動排程');
chk('完成回呼帶 free', finished?.free === true);

console.log('【過濾 / 同步 / 邊界】');
S.start(mk(5));
const r = S.filter((e) => !['i0', 'i1'].includes(e.item.id));
chk('過濾掉 2 題', r.kept === 3 && r.dropped === 2);

S.start(mk(2));
S.syncItem({ id: 'i0', ko: '改過', zh: '新義' });
chk('編輯後佇列內條目同步', S.queue[0].item.ko === '改過');

S.start(mk(1));
chk('第一題不可上一個', !S.state().canPrev);
chk('唯一一題不可下一個', !S.state().canNext);
chk('越界導覽回 false', S.go(-1) === false && S.go(99) === false);
finished = null;
S.grade(RATING.GOOD);
chk('答完最後一題觸發完成', finished !== null);

console.log('\n【內容類型過濾】');
{
  const word = { item_type: 'word' };
  const phrase = { item_type: 'phrase' };
  const sent = { item_type: 'sentence' };
  chk('全部：三種都收', ['all', undefined, ''].every((t) =>
      [word, phrase, sent].every((i) => matchesType(i, t))));
  chk('只練句子：只留句子',
      matchesType(sent, 'sentence') && !matchesType(word, 'sentence') && !matchesType(phrase, 'sentence'));
  chk('只練單字：詞組算單字，句子排除',
      matchesType(word, 'word') && matchesType(phrase, 'word') && !matchesType(sent, 'word'),
      '詞組（かき氷）在使用上更接近單字，不是要練語序的對象');
}

console.log('\n【手動回顧的排程：只縮不放】');
{
  const now = new Date('2026-08-17T00:00:00Z');
  const mk = (interval, dueInDays) => ({
    state: 'review', interval_days: interval, ease_factor: 2.5,
    repetitions: 3, lapses: 0,
    due_at: new Date(now.getTime() + dueInDays * 86400000).toISOString(),
  });
  const card = mk(10, 10);

  chk('★ 答得好時完全不動排程',
      scheduleRecall(card, RATING.GOOD, now) === null &&
      scheduleRecall(card, RATING.EASY, now) === null,
      '臨時多背幾遍就把複習日推遠，會往「看起來更熟、實際更容易忘」的方向壞');

  const hard = scheduleRecall(card, RATING.HARD, now);
  chk('「有點難」把到期日拉近', hard && hard.interval_days === 5, `→ ${hard?.interval_days} 天`);
  chk('「有點難」不動 ease、不算遺忘',
      hard && hard.ease_factor === 2.5 && hard.lapses === 0,
      '它只是「比我以為的更需要再看一眼」，不是忘了');

  const again = scheduleRecall(card, RATING.AGAIN, now);
  chk('「忘了」照正規遺忘處理', again && again.state === 'learning' && again.lapses === 1,
      '真的忘了就是忘了，隱瞞它沒有意義');

  // ★ 反面樣本：短間隔的卡不該被「拉近」反而推遠
  chk('★ 只縮不放：算出來比原訂更晚就不動',
      scheduleRecall(mk(1, 0.5), RATING.HARD, now) === null,
      '缺了這條，短間隔的卡按「有點難」會被推到更遠，與用意完全相反');

  chk('還在學習階段的卡不動', scheduleRecall({ state: 'learning' }, RATING.HARD, now) === null,
      '它本來就很快會再出現');
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
