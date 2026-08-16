// 聽音選義：只給發音不給字，選出對應的中文
import choice from './choice.js';
import * as speech from '../../core/speech.js';

export default {
  id: 'listen',
  label: '聽音選義',
  hint: '只聽發音，選出對應的中文。方向固定為「韓 → 中」。',
  direction: 'ko2zh',        // 聽韓文選中文，方向固定
  needsPool: true,
  canUse: (item, ctx) => ctx.pool.length >= 4,

  mount(ctx) {
    const { item, els, setFront } = ctx;

    setFront('');                          // 不給字
    els.listen.classList.remove('hidden');
    els.roman.classList.add('hidden');
    els.listen.onclick = () => speech.speak(item.ko, item.audio_url);
    speech.speak(item.ko, item.audio_url); // 進卡自動播一次

    // 選項邏輯與四選一相同，方向強制 ko2zh
    const inner = choice.mount({ ...ctx, direction: 'ko2zh' });

    return {
      onKey: (key) => {
        if (key.toLowerCase() === 's') { speech.speak(item.ko, item.audio_url); return true; }
        return inner.onKey(key);
      },
      teardown: () => { els.listen.classList.add('hidden'); inner.teardown(); },
    };
  },
};
