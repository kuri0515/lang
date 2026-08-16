// 詞序重組：看中文，把打散的韓文詞塊排回正確語序
import { esc, shuffle } from '../../core/dom.js';
import { RATING } from '../../core/srs.js';
import * as speech from '../../core/speech.js';

// 句末標點要剝掉再切塊：帶著「.」或「?」的詞塊一眼就能看出是最後一塊，
// 等於白送答案，練不到語序判斷。標點只在對答案時顯示。
const TAIL_PUNCT = /[.?!。？！]+$/;
const tokenize = (t) => t.trim().replace(TAIL_PUNCT, '').split(/\s+/).filter(Boolean);

/**
 * 素材來源：條目本身若有 2 個以上詞塊就用本身，否則退而用例句。
 * 只用條目本身可拆的很少且多半只有 2 塊、太簡單；
 * 加上例句後數量與難度才夠。
 */
export function scrambleSource(item) {
  const self = (item.ko || '').trim();
  const selfTok = tokenize(self);
  if (selfTok.length >= 2) return { ko: self, zh: item.zh, tokens: selfTok, from: 'self' };

  const ex = (item.example_ko || '').trim();
  const exTok = tokenize(ex);
  if (exTok.length >= 2) return { ko: ex, zh: item.example_zh || item.zh, tokens: exTok, from: 'example' };

  return null;
}

export default {
  id: 'scramble',
  label: '詞序重組',
  hint: '看中文，把打散的韓文詞塊排回正確語序。方向固定為「中 → 韓」。',
  direction: 'zh2ko',        // 產出韓文，方向固定
  needsPool: false,
  canUse: (item) => !!scrambleSource(item),

  mount(ctx) {
    const { item, els, reveal, grade, setFront } = ctx;
    const src = scrambleSource(item);
    const placed = [];
    let answered = false;

    setFront(src.zh, src.zh.length > 12);

    // 打亂到與正解不同。2 塊時隨機有 1/2 機率原樣，光靠重試不保險，
    // 最後兜底直接交換前兩塊，保證一定被打亂。
    let order = shuffle(src.tokens.map((_, i) => i));
    for (let i = 0; i < 6 && order.every((v, k) => v === k); i++) {
      order = shuffle(src.tokens.map((_, j) => j));
    }
    if (order.every((v, k) => v === k)) [order[0], order[1]] = [order[1], order[0]];

    els.scramble.classList.remove('hidden');
    els.sAnswer.innerHTML = '';
    els.sResult.className = 's-result hidden';
    els.sPool.innerHTML = order.map((oi) =>
      `<button class="tok" data-oi="${oi}">${esc(src.tokens[oi])}</button>`).join('');

    els.sPool.querySelectorAll('.tok').forEach((btn) => { btn.onclick = () => place(btn); });

    function place(btn) {
      if (answered) return;
      btn.classList.add('used');
      const oi = Number(btn.dataset.oi);
      placed.push(oi);

      const chip = document.createElement('button');
      chip.className = 'tok';
      chip.textContent = src.tokens[oi];
      chip.onclick = () => {                   // 點答案區的塊可退回
        if (answered) return;
        const pos = placed.lastIndexOf(oi);
        if (pos >= 0) placed.splice(pos, 1);
        chip.remove();
        btn.classList.remove('used');
      };
      els.sAnswer.appendChild(chip);

      if (placed.length === src.tokens.length) check();
    }

    function check() {
      answered = true;
      const correct = placed.map((i) => src.tokens[i]).join(' ') === src.tokens.join(' ');
      els.sResult.className = `s-result ${correct ? 'right' : 'wrong'}`;
      els.sResult.innerHTML = correct
        ? `✓ 正確<b>${esc(src.ko)}</b>`
        : `✗ 正確語序是<b>${esc(src.ko)}</b>`;
      speech.speak(src.ko);
      reveal();
      els.grade.classList.add('hidden');
      setTimeout(() => grade(correct ? RATING.GOOD : RATING.AGAIN), correct ? 1400 : 2800);
    }

    return {
      onKey: () => false,
      teardown: () => {
        els.scramble.classList.add('hidden');
        els.sAnswer.innerHTML = ''; els.sPool.innerHTML = '';
        els.sResult.className = 's-result hidden';
      },
    };
  },
};
