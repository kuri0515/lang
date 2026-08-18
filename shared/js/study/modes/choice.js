// 四選一：從條目池挑 3 個干擾項
import { esc, shuffle } from '../../core/dom.js';
import { RATING } from '../../core/srs.js';
import { confusableOf } from '../../core/taxonomy.js';

/**
 * 干擾項挑選（由嚴到寬）：同標籤 → 同詞性 → 同類型 → 任意。
 * 干擾項要「像但不對」才有訓練價值；隨機亂挑會讓人靠排除法猜對，
 * 練不到真正的辨義。
 */
export function buildChoices(item, direction, pool) {
  const key = direction === 'ko2zh' ? 'zh' : 'ko';   // 答案面
  const ask = direction === 'ko2zh' ? 'ko' : 'zh';   // 題面
  const answer = item[key];
  const tags = new Set(item.tags || []);

  // ★ 形近組優先，而且是壓倒性的。
  //
  //   干擾項要「像但不對」才有訓練價值。對假名來說，「像」不是同標籤 ——
  //   所有假名都掛著「清音／平假名」，同標籤等於隨機挑。
  //   於是看到 ぬ 時選項可能是 ぬ/か/せ/ほ：不必分辨 ぬ 和 め 就能答對，
  //   而 ぬ/め 正是唯一會錯的地方。練了很多次，沒練到會錯的那一下。
  //
  //   初學者卡住的是「分不出來」，不是「記不住」——
  //   ぬ 單獨看認得、め 單獨看也認得，並排才開始猶豫。
  //   那是辨別問題，只有把它們放在同一題裡才練得到。
  // ★ 形近是「目標語言那一面」的性質，與問答方向無關。
  //   ぬ／め 長得像；它們的中文面（nu ·平假名／me ·平假名）一點都不像。
  //   所以查組要固定用 ko，不能用題面 —— 用題面的話，
  //   中→日 方向會拿中文去查形近組，永遠查不到，功能靜靜地失效。
  const group = confusableOf(item.ko);
  const inGroup = (o) => !!group && group.keys.includes(o.ko);

  const score = (o) => {
    let s = 0;
    if (inGroup(o)) s += 20;                 // 遠高於其他權重，確保同組必定入選
    if ((o.tags || []).some((t) => tags.has(t))) s += 4;
    if (o.pos && o.pos === item.pos) s += 2;
    if (o.item_type === item.item_type) s += 1;
    return s;
  };

  // ★ 同義詞排除：問這一題時，所有「同樣題面」的條目，它們的答案面都是對的。
  //
  //   감사합니다 與 고맙습니다 中文都是「謝謝」。中→韓問「謝謝」時，
  //   兩個都是正解 —— 拿其中一個當干擾項，學習者答對了卻被判錯。
  //
  //   先前只排除「候選自己的題面相同」，那不夠：
  //   候選 A 的題面可能不同（於是放行），但另有一個 B 題面相同、
  //   而 B 的答案面剛好等於 A 的答案面 —— 那個選項還是對的。
  //   實測 826 條資料裡，這個縫隙每跑幾次就會漏一次
  //   （干擾項是隨機挑的，所以時中時不中，測試看起來像 flaky）。
  //
  //   正確的判準是「這個字串會不會也是正解」，與它從哪一條來無關。
  const alsoCorrect = new Set(
    pool.filter((o) => o[ask] === item[ask] && o[key]).map((o) => o[key]));

  const cands = pool
    .filter((o) => o.id !== item.id && o[key] && !alsoCorrect.has(o[key]))
    .map((o) => ({ o, s: score(o) + Math.random() }))   // 隨機打破同分僵局
    .sort((a, b) => b.s - a.s)
    .map((x) => x.o);

  const seen = new Set([answer]);
  const picked = [];
  for (const c of cands) {
    if (seen.has(c[key])) continue;
    seen.add(c[key]);
    picked.push(c[key]);
    if (picked.length === 3) break;
  }
  return {
    options: shuffle([answer, ...picked]), answer, filled: picked.length,
    // 揭曉後才給「怎麼分」—— 提前給等於送分，答錯當下才是最記得住的時機
    // picked 裝的是答案面的字串，要比對回 ko 才知道是不是同組
    hint: group && cands.some((o) => inGroup(o) && picked.includes(o[key]))
      ? group.hint : '',
  };
}

export default {
  id: 'choice',
  label: '四選一',
  hint: '四選一，答對記「記得」、答錯記「忘了」。',
  direction: null,
  needsPool: true,
  canUse: (item, ctx) => ctx.pool.length >= 4,

  mount(ctx) {
    const { item, direction, els, pool, reveal, grade } = ctx;
    const { options, answer, hint } = buildChoices(item, direction, pool);
    let answered = false;

    els.choices.innerHTML = options.map((t, i) =>
      `<button data-val="${esc(t)}"><span class="idx">${i + 1}</span>${esc(t)}</button>`).join('');
    els.choices.classList.remove('hidden');

    els.choices.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        if (answered) return;
        answered = true;
        const correct = b.dataset.val === answer;
        els.choices.querySelectorAll('button').forEach((x) => {
          if (x.dataset.val === answer) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
          else x.classList.add('dim');
          x.disabled = true;
        });
        reveal();
        els.grade.classList.add('hidden');     // 選擇題不手動評分

        // ★ 「怎麼分」只在答錯時給，而且是答錯的當下。
        //   答對還講一遍是噪音；提前給等於送分。
        //   答錯那一刻是唯一真正記得住的時機 —— 人正想著「我怎麼會選錯」。
        let wait = correct ? 750 : 1900;
        if (!correct && hint) {
          const tip = document.createElement('div');
          tip.className = 'discern-tip';
          tip.textContent = hint;
          els.choices.after(tip);
          wait = 3600;                          // 給時間讀完那一句
        }
        setTimeout(() => grade(correct ? RATING.GOOD : RATING.AGAIN), wait);
      };
    });

    return {
      // 鍵盤 1-4 對應選項
      onKey: (key) => {
        const i = Number(key) - 1;
        if (i >= 0 && i < 4) { els.choices.querySelectorAll('button')[i]?.click(); return true; }
        return false;
      },
      teardown: () => {
        els.choices.classList.add('hidden'); els.choices.innerHTML = '';
        els.choices.parentNode?.querySelector('.discern-tip')?.remove();
      },
    };
  },
};
