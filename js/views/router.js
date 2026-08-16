// =====================================================================
// 視圖切換 + 底部 Tab
// 各畫面只註冊「我叫什麼、進來時做什麼」，不互相認識。
// =====================================================================
import { $, qsa } from '../core/dom.js';

const VIEWS = ['view-auth', 'view-home', 'view-study', 'view-done',
               'view-browse', 'view-history', 'view-me', 'view-import'];
// 學習中隱藏 Tab，避免誤觸中斷（要離開請按 ✕）
const NO_TAB = ['view-auth', 'view-study'];

const enterHooks = new Map();

/** 註冊「進入這個畫面時要做的事」 */
export const onEnter = (view, fn) => enterHooks.set(view, fn);

export async function show(view) {
  VIEWS.forEach((v) => $(v)?.classList.toggle('hidden', v !== view));
  $('tabbar')?.classList.toggle('hidden', NO_TAB.includes(view));
  qsa('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === view));
  window.scrollTo({ top: 0 });
  await enterHooks.get(view)?.();
}

export function initTabs() {
  qsa('#tabbar button').forEach((b) => { b.onclick = () => show(b.dataset.tab); });
}
