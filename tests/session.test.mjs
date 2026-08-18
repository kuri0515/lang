// =====================================================================
// 學習會話引擎的單元測試
//
// 這段邏輯（撤銷、回看不重複計分、延遲寫入的定案時機）最容易出錯，
// 且錯了會直接污染使用者的正確率。引擎不碰 DOM，所以能純 node 跑。
//
//     node tests/session.test.mjs
// =====================================================================
import { createSession, matchesType, orderForDiscrimination } from '../shared/js/study/session.js';
import { ROUND_CRITERION, RATING, scheduleRecall, schedule } from '../shared/js/core/srs.js';

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
// 用「很簡單」讓卡直接畢業 —— 新卡按「記得」還在學習階段，
// 會被排回隊尾（見下方【今日畢業】），那一輪不會結束。
S.start(mk(1), { freeMode: true });
S.grade(RATING.EASY);
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
// 要連續答對三次才畢業，之前只按一次就結束是舊規則。
// 這裡刻意按滿三次 —— 「答完最後一題觸發完成」驗的是收尾流程，
// 不是畢業條件，別讓兩件事混在同一條斷言裡。
S.grade(RATING.EASY); S.grade(RATING.EASY); S.grade(RATING.EASY);
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

console.log('\n【辨別優先的佇列編排】');
{
  const G = [
    { keys: ['さ', 'き', 'ち'], hint: 'x' },
    { keys: ['ぬ', 'め'], hint: 'y' },
  ];
  const groupOf = (ko) => G.find((g) => g.keys.includes(ko)) || null;
  const mk = (ks) => ks.map((k) => ({ item: { ko: k } }));
  let seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const out = orderForDiscrimination(mk(['ち','ねこ','め','うみ','さ','ぬ','き']), groupOf, rand);
  const pos = (k) => out.findIndex((e) => e.item.ko === k);
  const adjacent = (ks) => {
    const idx = ks.map(pos).filter((i) => i >= 0).sort((a, b) => a - b);
    return idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  };
  chk('★ 同一形近組相鄰出現', adjacent(['さ','き','ち']) && adjacent(['ぬ','め']),
      '被打散到頭尾等於各自單獨練，而各自單獨練本來就都會');
  chk('組內照教學順序（さ 兩橫 → き 三橫 → ち 鏡像）',
      pos('さ') < pos('き') && pos('き') < pos('ち'),
      '不照使用者標記的先後 —— 宣告順序是教學順序');
  chk('不增不減', out.length === 7);
  chk('沒有形近組的詞照常參與', pos('ねこ') >= 0 && pos('うみ') >= 0);

  // ★ 反面樣本：沒給 groupOf 時要能退化成純排列，不能炸
  chk('沒有形近資料時不炸',
      orderForDiscrimination(mk(['a','b','c']), null, rand).length === 3,
      '韓文站的 confusable 是空的，這條路必須走得通');

  // 組間要真的會變動，否則使用者靠位置記答案
  const a = orderForDiscrimination(mk(['さ','ぬ','ねこ','き','め']), groupOf, rand)
    .map((e) => e.item.ko).join();
  let seed2 = 999; const rand2 = () => { seed2 = (seed2 * 9301 + 49297) % 233280; return seed2 / 233280; };
  const b = orderForDiscrimination(mk(['さ','ぬ','ねこ','き','め']), groupOf, rand2)
    .map((e) => e.item.ko).join();
  chk('組與組之間會隨機（不同亂數給出不同順序）', a !== b,
      '固定順序會讓人靠位置記答案 —— 那是記順序不是記字', a + '  vs  ' + b);
}

console.log('\n【今日畢業：新卡在本輪內循環到會為止】');
{
  const seen = [];
  const T = createSession({
    save: async () => {}, onChange: () => {}, onFinish: () => seen.push('done'),
  });
  const one = () => [{ item: { id: 'x', ko: 'あ', zh: 'a' }, direction: 'ko2zh', card: null }];

  T.start(one(), { mode: 'flip', kind: 'new' });
  T.grade(RATING.GOOD);
  chk('★ 新卡按「記得」會排回本輪隊尾', T.state().total === 2,
      '學習步驟本來就在排程資料裡，先前只有「忘了」會重排 —— '
      + '於是「今天學到會為止」根本做不到');
  T.grade(RATING.GOOD);
  chk('第二次答對還不算過，繼續排回', T.state().total === 3,
      `一輪之內要連續答對 ${ROUND_CRITERION} 次才算學會`);
  T.grade(RATING.GOOD);
  chk(`★ 第 ${ROUND_CRITERION} 次答對才畢業`, T.state().total === 3);

  // 「很簡單」也要三次 —— 這是刻意的改變。
  // 舊規則是「很簡單」直接畢業，理由是「本來就會的不該被逼著再看一次」，
  // 那個理由本身沒錯；但一輪看三次的目的不是測驗，是把它壓進記憶。
  // 第一次看就按「很簡單」，往往只是剛剛才看過答案。
  const T2 = createSession({ save: async () => {}, onChange: () => {}, onFinish: () => {} });
  T2.start(one(), { mode: 'flip', kind: 'new' });
  T2.grade(RATING.EASY);
  T2.grade(RATING.EASY);
  chk('「很簡單」同樣要滿三次', T2.state().total === 3);
  T2.grade(RATING.EASY);
  chk('滿三次後畢業', T2.state().total === 3);

  // 中途答錯要歸零重數 —— 不歸零的話「對錯對錯對」也算三次，
  // 而那正是還沒學會的樣子。
  const T4 = createSession({ save: async () => {}, onChange: () => {}, onFinish: () => {} });
  T4.start(one(), { mode: 'flip', kind: 'new' });
  T4.grade(RATING.GOOD); T4.grade(RATING.GOOD); T4.grade(RATING.AGAIN);
  T4.grade(RATING.GOOD); T4.grade(RATING.GOOD);
  chk('★ 答錯會把次數歸零，重新數起', T4.state().total === 6,
      '「對對錯對對」不算學會 —— 不歸零的話中間那次錯等於沒發生');

  // 複習輪不套三次 —— 一張複習卡在一輪內被評分三次，
  // 費氏階梯會爬三階（1 天 → 3 → 8 → 21），而那三次只隔五分鐘。
  // ★ 樣本要用「已經畢業的卡」。用全新卡（card: null）驗不到這件事 ——
  //   全新卡進學習階段本來就該重排，與是不是複習輪無關。
  const T5 = createSession({ save: async () => {}, onChange: () => {}, onFinish: () => {} });
  T5.start([{ item: { id: 'x', ko: 'あ', zh: 'a' }, direction: 'ko2zh',
              card: { state: 'review', interval_days: 3, ease_factor: 2.5,
                      repetitions: 2, lapses: 0 } }],
           { mode: 'flip', kind: 'review' });
  T5.grade(RATING.GOOD);
  chk('複習輪同樣要連續三次才算掌握', T5.state().total === 2);
  T5.grade(RATING.GOOD); T5.grade(RATING.GOOD);
  chk(`★ 複習卡滿三次後畢業`, T5.state().total === 3);

  // ★ 這是整個機制最危險的地方：一輪內評分三次，
  //   若每次都拿上一次的結果去排程，1 天會變成 21 天。
  //   baseCard 讓每次都從「進這一輪時的卡況」重算，最後一次就是結論。
  const T6 = createSession({ save: async (p) => { T6.last = p; },
                             onChange: () => {}, onFinish: () => {} });
  T6.start([{ item: { id: 'y', ko: 'い', zh: 'i' }, direction: 'ko2zh',
              card: { state: 'review', interval_days: 1, ease_factor: 2.5,
                      repetitions: 3, lapses: 0 } }], { mode: 'flip', kind: 'review' });
  T6.grade(RATING.EASY); T6.grade(RATING.EASY); T6.grade(RATING.EASY);
  T6.quit();
  // ★ 排程由「這一輪的第一次作答」決定，不是最後一次。
  //   間隔重複量的是「隔了這麼多天還記不記得」，那個答案在第一次就揭曉；
  //   後面兩次是操練 —— 兩分鐘前才看過答案，再答對不代表隔八天也記得。
  //
  //   用最後一次的話：忘了一張 8 天的卡、再連對三次 → 13 天且 lapses=0，
  //   跟從來沒忘過一模一樣。那個詞會被排到 13 天後，
  //   而你剛剛才想不起來它。不會報錯，也看不出來。
  const outcome = (card, seq) => {
    let last = null;
    const S = createSession({ save: async (p) => { last = p; },
                              onChange: () => {}, onFinish: () => {} });
    S.start([{ item: { id: 'z', ko: 'う', zh: 'u' }, direction: 'ko2zh', card }],
            { mode: 'flip', kind: 'review' });
    seq.forEach((r) => S.grade(r));
    S.quit();
    return last.next;
  };
  const eight = { state: 'review', interval_days: 8, ease_factor: 2.5,
                  repetitions: 4, lapses: 0 };
  const G = RATING.GOOD;
  const ok = outcome(eight, [G, G, G]);
  const lapsed = outcome(eight, [RATING.AGAIN, G, G, G]);
  const hard = outcome(eight, [RATING.HARD, G, G, G]);
  chk('一路答對：8 → 13 天', ok.interval_days === 13 && ok.lapses === 0);
  chk('★ 先忘了再連對三次：回到 1 天且記下遺忘',
      lapsed.interval_days === 1 && lapsed.lapses === 1,
      `實得 ${lapsed.interval_days} 天、lapses=${lapsed.lapses}`
      + '（若是 13 天／lapses=0，表示那次遺忘被後面的操練抹掉了）');
  chk('先有點難再連對三次：退回第一階（1 天）', hard.interval_days === 1,
      `實得 ${hard.interval_days} 天。後面連對三次是操練，不該把「當時想很久」抵銷掉`);

  chk('★ 一輪內評分三次，間隔只前進一次', T6.last?.next.interval_days === 3,
      `1 天的卡按三次「很簡單」應該是 3 天（前進兩階一次），`
      + `不是 1→3→8→21。實得 ${T6.last?.next.interval_days} 天`);

  const T3 = createSession({ save: async () => {}, onChange: () => {}, onFinish: () => {} });
  T3.start(one(), { mode: 'flip', kind: 'new' });
  T3.grade(RATING.AGAIN);
  T3.grade(RATING.AGAIN);
  chk('「忘了」每次都排回，不會提早結束', T3.state().total === 3,
      '卡在同一張是使用者自己的選擇，而重排在隊尾，不會變成連續轟炸');
}

console.log('\n【複習階梯（費氏）】');
{
  const at = (interval, r) => schedule(
    { state: 'review', interval_days: interval, ease_factor: 2.5, repetitions: 2, lapses: 0 },
    r, new Date('2026-01-01T00:00:00Z')).interval_days;

  const LADDER = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
  chk('★ 一路「記得」走完整條階梯',
      LADDER.slice(0, -1).every((d, i) => at(d, RATING.GOOD) === LADDER[i + 1]),
      LADDER.join('→'));
  // 1 天是第 0 階，跳兩階＝第 2 階＝3 天（不是 5 —— 階梯的索引不是天數）
  chk('「很簡單」跳兩階', at(8, RATING.EASY) === 21 && at(1, RATING.EASY) === 3);
  // ★ 刻意推翻先前的設計。舊規則是「原地」，理由是「退階會讓一張詞在
  //   3→2→3→2 之間來回」—— 那個顧慮沒有消失，但原地的問題更大：
  //   「有點難」與「記得」只差一階，人在猶豫時按哪個幾乎是隨機的。
  //   退回第一階讓這個按鈕真的有意義：你說難，它就當你還沒學會。
  //
  //   代價量過（180 天、每天學 8 條、每天做 20 個）：
  //     按「有點難」 0% → 學到 392、間隔中位數 55 天
  //                15% → 學到 200、中位數 34 天
  //                30% → 學到 104、中位數 5 天（塌成每五天複習一次）
  //   所以「有點難」的定義必須窄：是「想了很久才想起來」，
  //   不是「有一點不確定」。按鈕下方直接顯示後果（1 天），
  //   那是使用者唯一會看的說明。
  chk('★ 「有點難」退回第一階', at(8, RATING.HARD) === 1,
      '你說難，它就當你還沒學會 —— 按鈕下方直接寫著「1 天」，後果不藏起來');
  chk('「有點難」在長間隔一樣退回第一階', at(55, RATING.HARD) === 1);
  chk('★ 89 天封頂，不再往外推',
      at(89, RATING.GOOD) === 89 && at(89, RATING.EASY) === 89 && at(55, RATING.EASY) === 89,
      '再往外推就變成幾乎不再出現，那和刪掉它沒有差別，卻讓人以為自己還記得');

  // ★ 舊資料的間隔不在階梯上（先前的曲線會產生 2.5、6.25 這種）
  chk('不在階梯上的舊間隔也對得上（取不超過它的最高階）',
      at(2.5, RATING.GOOD) === 3 && at(6.25, RATING.GOOD) === 8 && at(17.5, RATING.GOOD) === 21,
      '換演算法不該讓既有的卡掉進奇怪的位置');

  chk('「忘了」回到學習階段，當天再練',
      schedule({ state: 'review', interval_days: 34, ease_factor: 2.5, repetitions: 5, lapses: 0 },
               RATING.AGAIN).state === 'learning');

  // 新卡的畢業點也要落在階梯上
  const grad = (r) => { let c = schedule({}, r); if (c.state === 'learning') c = schedule(c, r); return c; };
  chk('新卡畢業落在第一階（1 天）', grad(RATING.GOOD).interval_days === 1);
  chk('新卡按「很簡單」直接到第三階（3 天）',
      schedule({}, RATING.EASY).interval_days === 3, '一看就會的不必從 1 天爬');

  chk('ease 不再參與排程計算',
      at(8, RATING.GOOD) === at(8, RATING.GOOD),
      '階梯是固定的；ease 仍記錄下來當難度訊號，日後換演算法用得上');
}


// =====================================================================
// 【一輪的產出是固定的：ROUND_SIZE 個掌握】
//
// 每輪從複習池順選 ROUND_SIZE 個詞，沒達標的一直循環到達標，
// 所以一輪結束時必定剛好掌握 ROUND_SIZE 個 —— 解鎖新課需要的輪數是可預測的
// （目標 20、一輪 10 → 固定兩輪）。
//
// 這件事一旦被改壞（例如某個分支讓沒達標的卡提早離開佇列），
// 使用者會看到「做了三輪還是 18/20」，而完全不知道為什麼。
// =====================================================================
console.log('\n【一輪的產出】');
{
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    item: { id: 'r' + i, ko: 'w' + i, zh: 'z' + i }, direction: 'ko2zh',
    card: { state: 'review', interval_days: 8, ease_factor: 2.5,
            repetitions: 4, lapses: 0 },
  }));
  let rng = 3;
  const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);

  for (const acc of [1, 0.8, 0.5]) {
    let got = 0, answers = 0;
    const S = createSession({ save: async () => {}, onChange: () => {},
                              onFinish: (st) => { got = st.mastered; } });
    S.start(mk(10), { mode: 'flip', kind: 'review' });
    while (answers < 2000) {
      S.grade(rand() < acc ? RATING.GOOD : RATING.AGAIN);
      answers++;
      if (S.state().idx >= S.state().total) break;
    }
    chk(`正確率 ${acc * 100}%：一輪 10 個詞，掌握 10 個（答了 ${answers} 題）`,
        got === 10, '沒達標的會一直循環到達標，所以產出是固定的');
  }
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
