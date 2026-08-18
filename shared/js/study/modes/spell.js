// =====================================================================
// 拼出來（產出型題型）
//
// 【為什麼需要這一種】
//   其他三種題型全部只測「認得」：
//     翻卡自評 → 自己說了算
//     四選一   → 四個裡面猜得到
//     聽音選義 → 也是選
//   認得 あ 和寫得出 あ 是兩種能力，而學習者可能覺得自己會了 92 個假名，
//   實際提筆一個都寫不出來 —— 因為他從來沒被要求產出過。
//
//   這一題要求真的把字拼出來，程式客觀比對，沒有自評的空間。
//
// 【為什麼不顯示答案有幾個字】
//   顯示長度就是送分，而且剛好送在最該練的地方：
//   きて（來）與 きって（郵票）的差別就是長度，
//   長度一給，促音那一課的核心對比就沒了。
//   所以用「完成」按鈕結束，不靠字數自動判定。
//
// 【為什麼鍵盤是調色盤，不是可消耗的詞塊】
//   きって 需要點兩次 き…不，需要 き・っ・て，而 ざっし 需要兩個以上相同字的詞
//   （こっき、がっき）也很常見。做成點掉就消失的話，
//   遇到疊字就拼不出來，而使用者會以為是自己記錯了。
//
// 【鍵盤從哪來】
//   正解的字 ＋ 形近組夥伴的字 ＋ 同批其他詞的字，打散後取十四個上下。
//   形近組是關鍵：拼 ぬ 的時候鍵盤上就該有 め，
//   否則「選對字」這一步根本不需要分辨。
// =====================================================================
import { esc, shuffle } from '../../core/dom.js';
import { lang } from '../../core/lang.js';
import { stripRuby } from '../../core/ruby.js';
import { confusableOf } from '../../core/taxonomy.js';
import * as speech from '../../core/speech.js';

/** 這個條目拼得出來嗎 —— 由站台宣告哪些字是「鍵盤打得出來的」 */
const target = (item) => stripRuby(item?.ko || '');
const typable = (item) => {
  const re = lang().spellRe;
  return !!re && re.test(target(item));
};

const KEYS_MAX = 14;

/** 組鍵盤：正解的字 + 形近組夥伴的字 + 同批其他詞的字 */
function buildKeys(item, pool) {
  const want = [...new Set(target(item).split(''))];
  const keys = new Set(want);

  // 形近組優先 —— 拼 ぬ 時鍵盤上要有 め，否則不必分辨就選得對
  const g = confusableOf(item.ko);
  for (const k of g?.keys || []) for (const c of k) keys.add(c);

  // 其餘用同批的字補滿。只取 typable 的條目，免得混進漢字
  for (const o of shuffle(pool.filter(typable))) {
    if (keys.size >= KEYS_MAX) break;
    for (const c of target(o)) { if (keys.size < KEYS_MAX) keys.add(c); }
  }
  return shuffle([...keys]);
}

export default {
  id: 'spell',
  label: '拼出來',
  // getter 而非字串：字串會把載入當下的語言快照起來（見 listen.js）
  get hint() {
    const L = lang();
    return `看中文，用鍵盤把${L.termLabel}拼出來。這一題不能自評 —— `
         + '認得跟寫得出來是兩回事。';
  },
  direction: 'zh2ko',        // 產出目標語言，方向固定
  needsPool: true,           // 鍵盤要從同批的字取材
  canUse: (item) => typable(item),

  mount(ctx) {
    const { item, els, reveal, grade, setFront, pool = [] } = ctx;
    const answer = target(item);
    const keys = buildKeys(item, pool);
    let typed = '';
    let answered = false;

    setFront(item.zh, (item.zh || '').length > 12);

    els.spell.classList.remove('hidden');
    els.spell.classList.remove('shake');
    els.spResult.className = 'sp-result hidden';
    els.spKeys.innerHTML = keys.map((c) => `<button class="sp-key" data-c="${esc(c)}">${esc(c)}</button>`).join('')
      + '<button class="sp-key sp-fn" data-back="1">⌫</button>'
      + '<button class="sp-key sp-go" data-done="1">完成</button>';

    // 每個字單獨一個 span：答錯時要逐字標紅，整串重畫就標不出「第幾個字錯」
    const draw = (flash = false) => {
      els.spTyped.innerHTML = [...typed]
        .map((c, i) => `<span class="sp-ch${flash && i === typed.length - 1 ? ' pop' : ''}">${esc(c)}</span>`)
        .join('');
    };
    draw();

    els.spKeys.querySelectorAll('[data-c]').forEach((b) => {
      b.onclick = () => { if (!answered) { typed += b.dataset.c; draw(true); } };
    });
    els.spKeys.querySelector('[data-back]').onclick = () => {
      if (!answered) { typed = typed.slice(0, -1); draw(); }
    };
    els.spKeys.querySelector('[data-done]').onclick = () => { if (!answered) check(); };

    function check() {
      answered = true;
      const correct = typed === answer;

      // ★ 逐字比對，而不是只說「錯了」。
      //   きて／きって、ぬ／め 這種錯，學習者往往不知道自己錯在哪一個字 ——
      //   指出「第 3 個字你寫成 つ，應該是 っ」才學得到東西。
      els.spTyped.innerHTML = [...typed].map((c, i) =>
        `<span class="sp-ch ${c === answer[i] ? 'ok' : 'no'}">${esc(c)}</span>`).join('');
      if (!correct) els.spell.classList.add('shake');

      els.spResult.className = `sp-result ${correct ? 'right' : 'wrong'}`;
      els.spResult.innerHTML = correct
        ? '✓ 正確'
        : `正確答案　<b>${[...answer].map((c, i) =>
             `<span class="${typed[i] === c ? '' : 'miss'}">${esc(c)}</span>`).join('')}</b>`;
      speech.speak(answer);
      reveal();
      els.grade.classList.add('hidden');
      // 客觀題不讓人自評 —— 自評的空間正是這一題要消滅的東西
      grade(correct ? 3 : 1);
    }
  },
};
