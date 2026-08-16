// 聽音選義：只給發音不給字，選出對應的中文
import choice from './choice.js';
import * as speech from '../../core/speech.js';

export default {
  id: 'listen',
  label: '聽音選義',
  hint: '只聽發音，選出對應的中文。答完會顯示韓文拼寫。方向固定為「韓 → 中」。',
  direction: 'ko2zh',        // 聽韓文選中文，方向固定
  needsPool: true,
  canUse: (item, ctx) => ctx.pool.length >= 4,

  mount(ctx) {
    const { item, els, setFront, reveal } = ctx;
    const play = (slow = false) => speech.speak(item.ko, item.audio_url, { slow });

    setFront('');                          // 作答時不給字
    els.listenBox.classList.remove('hidden');
    els.roman.classList.add('hidden');
    els.listen.onclick = () => play(false);
    els.listenSlow.onclick = () => play(true);
    play();                                // 進卡自動播一次

    /**
     * ★ 揭曉時把韓文補回正面。
     *   原本從頭到尾都不顯示韓文 —— 聽不清就只能猜，答完仍不知道
     *   那個詞怎麼拼，聲音與拼寫連不起來，等於白練。
     */
    const revealWithText = () => {
      setFront(item.ko, item.ko.length > 12);
      els.listenBox.classList.add('hidden');
      reveal();
    };

    // 選項邏輯與四選一相同，方向強制 ko2zh
    const inner = choice.mount({ ...ctx, direction: 'ko2zh', reveal: revealWithText });

    return {
      onKey: (key) => {
        const k = key.toLowerCase();
        if (k === 's') { play(false); return true; }
        if (k === 'd') { play(true); return true; }   // 慢速
        return inner.onKey(key);
      },
      teardown: () => { els.listenBox.classList.add('hidden'); inner.teardown(); },
    };
  },
};
