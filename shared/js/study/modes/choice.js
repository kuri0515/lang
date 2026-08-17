// 四選一：從條目池挑 3 個干擾項
import { esc, shuffle } from '../../core/dom.js';
import { RATING } from '../../core/srs.js';

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

  const score = (o) => {
    let s = 0;
    if ((o.tags || []).some((t) => tags.has(t))) s += 4;
    if (o.pos && o.pos === item.pos) s += 2;
    if (o.item_type === item.item_type) s += 1;
    return s;
  };

  const cands = pool
    .filter((o) =>
      o.id !== item.id && o[key] && o[key] !== answer &&
      // ★ 同義詞排除：題面相同的條目不能當干擾項。
      //   감사합니다 與 고맙습니다 中文都是「謝謝」，中→韓問「謝謝」時
      //   兩者都對，拿其一當干擾項會把正確答案判成錯。
      o[ask] !== item[ask])
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
  return { options: shuffle([answer, ...picked]), answer, filled: picked.length };
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
    const { options, answer } = buildChoices(item, direction, pool);
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
        // 停一下讓人看清答案再翻頁；答錯多停一會
        setTimeout(() => grade(correct ? RATING.GOOD : RATING.AGAIN), correct ? 750 : 1900);
      };
    });

    return {
      // 鍵盤 1-4 對應選項
      onKey: (key) => {
        const i = Number(key) - 1;
        if (i >= 0 && i < 4) { els.choices.querySelectorAll('button')[i]?.click(); return true; }
        return false;
      },
      teardown: () => { els.choices.classList.add('hidden'); els.choices.innerHTML = ''; },
    };
  },
};
