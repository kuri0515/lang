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
import * as speech from '../../core/speech.js';
import { confusableOf } from '../../core/taxonomy.js';

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

  // ★ 這一題只要連對兩次就算掌握（其他題型是三次）。
  //
  //   三次的理由是「認得」很廉價：四選一答對可能是猜的，
  //   翻卡自評答對可能是自己放水，單次不足為證。
  //   但拼對一次是強得多的證據 —— 沒有人能靠猜拼出 きって。
  //   同一輪內再拼第三次幾乎不帶新資訊。
  //
  //   代價是實打實的：實測一輪 10 個詞，
  //     正確率 100% → 123 次點擊
  //     正確率  80% → 189 次
  //     正確率  50% → 358 次   ← 這不是練習，是折磨
  //   （對照：四選一每題一下，一輪 30–87 次。）
  //   從三次降到兩次，最痛的那一格砍掉約三分之一。
  criterion: 2,
  needsPool: true,           // 鍵盤要從同批的字取材
  canUse: (item) => typable(item),

  mount(ctx) {
    const { item, els, reveal, grade, setFront, pool = [] } = ctx;
    const answer = target(item);
    const keys = buildKeys(item, pool);
    let typed = '';
    let answered = false;
    let committed = false;   // 成績交出去了沒（避免 → 連按兩次跳兩題）

    setFront(item.zh, (item.zh || '').length > 12);

    // ★ 同一個中文對到好幾個詞時，這一題本來是答不出來的。
    //
    //   實測日文站 985 張卡（14%）與別張共用同一個中文：
    //   「道歉」可以是 謝る／わび／詫び／謝罪，而這一題不能自評、
    //   程式只認一個答案 —— 那不是難度，是題目沒有唯一解。
    //
    //   解法是給讀音：聽得到唸的是哪一個，就知道要拼哪一個，
    //   而「聽到音、寫得出字」本身正是這一題要練的能力（聽寫）。
    //
    //   不自動播：這個站的原則是「主動聽是複習，被動聽是干擾」。
    //   但把話說清楚 —— 不說的話，學習者只會覺得自己一直被判錯。
    //
    //   同義詞是從干擾項池裡數的，不另外查一次 ——
    //   那個池本來就為了四選一整份載入，裡面已經有每一張卡的中文。
    const alts = pool.filter((o) => o.zh && o.zh === item.zh
                                 && stripRuby(o.ko || '') !== answer).length;
    els.spHint.classList.toggle('hidden', !alts);
    if (alts) {
      els.spHint.innerHTML = `「${esc(item.zh)}」有 ${alts + 1} 種說法`
        + '<button class="sp-hint-say" data-say="1">🔊 聽讀音</button>';
      els.spHint.querySelector('[data-say]').onclick = () => speech.speak(answer);
    }

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
      els.spResult.innerHTML = (correct
        ? '✓ 正確'
        : `正確答案　<b>${[...answer].map((c, i) =>
             `<span class="${typed[i] === c ? '' : 'miss'}">${esc(c)}</span>`).join('')}</b>`)
        + '<button class="sp-next" data-next="1">下一個 →</button>';

      // ★ 不自動朗讀。
      //   先前答完就唸出答案，但這一題的重點是「你寫不寫得出來」，
      //   而聲音會在下一次遇到同一個詞時變成提示。
      //   要聽隨時可以按 🔊 朗讀（或按 s）—— 主動聽是複習，被動聽是干擾。

      // ★ 也不自動跳到下一題。
      //   答完之後才是看卡片的時候：漢字讀音、例句、備註、過往正確率。
      //   自動跳走等於把最該看的那一秒拿掉，而拼對一個詞的當下
      //   正是最有動機多看兩眼的時刻。
      reveal();                                   // 完全展開這張卡
      els.grade.classList.add('hidden');           // 客觀題不自評

      els.spResult.querySelector('[data-next]').onclick = () => next();
    }

    /** 把成績交出去並前進。由使用者按「下一個」或 → 觸發 */
    function next() {
      if (!answered || committed) return;
      committed = true;
      grade(typed === answer ? 3 : 1);
    }

    return {
      // → 與 Enter 都當「下一個」；還沒作答時不攔，讓 → 維持原本的回看行為
      onKey: (key) => {
        if (!answered || committed) return false;
        if (key === 'ArrowRight' || key === 'Enter') { next(); return true; }
        return false;
      },
      teardown: () => {
        els.spell.classList.add('hidden');
        els.spell.classList.remove('shake');
      },
    };
  },
};
