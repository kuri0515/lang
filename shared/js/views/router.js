// =====================================================================
// 視圖切換 + 底部 Tab + 網址同步
//
// 【為什麼用 hash 而不是 localStorage 記住當前頁】
//   hash 同時解決三件事：重新整理回到原頁、瀏覽器上一頁／下一頁可用、
//   網址可分享。localStorage 只能解決第一件，而且會在多分頁間互相打架。
//
//   學習中的畫面刻意不寫進網址 —— 重新整理後那一輪的佇列已經不在了，
//   把人丟回一個空的學習畫面比丟回首頁更糟。
// =====================================================================
import { $, qsa } from '../core/dom.js';
import * as speech from '../core/speech.js';

const VIEWS = ['view-auth', 'view-home', 'view-study', 'view-done',
               'view-browse', 'view-history', 'view-me', 'view-import'];
// 學習中隱藏 Tab，避免誤觸中斷（要離開請按 ✕）
const NO_TAB = ['view-auth', 'view-study'];
// 可透過網址還原的畫面
const HASH = { home: 'view-home', browse: 'view-browse', history: 'view-history',
               me: 'view-me', import: 'view-import' };
const TO_HASH = Object.fromEntries(Object.entries(HASH).map(([k, v]) => [v, k]));

const enterHooks = new Map();
let current = null;
let syncingHash = false;

/** 註冊「進入這個畫面時要做的事」 */
export const onEnter = (view, fn) => enterHooks.set(view, fn);

export async function show(view, { push = true } = {}) {
  // 換畫面就停朗讀 —— 聲音不該跟著人跑到別的頁面。
  // 放在 router 而不是各畫面自理：新增畫面時不會忘記做這件事。
  if (current !== view) speech.cancel();
  current = view;
  VIEWS.forEach((v) => $(v)?.classList.toggle('hidden', v !== view));
  $('tabbar')?.classList.toggle('hidden', NO_TAB.includes(view));
  qsa('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === view));
  window.scrollTo?.({ top: 0 });

  if (push && TO_HASH[view]) {
    const h = '#' + TO_HASH[view];
    if (window.location.hash !== h) {
      syncingHash = true;
      // replaceState 而非 pushState：Tab 切換不該塞滿上一頁堆疊，
      // 否則按返回要按十幾次才離得開。
      window.history.replaceState(null, '', h);
      syncingHash = false;
    }
  }
  await enterHooks.get(view)?.();
}

/** 重新整理後回到原本那一頁；沒有 hash 或指向學習中就回首頁 */
export const viewFromHash = () => HASH[window.location.hash.slice(1)] || 'view-home';

export function initTabs() {
  qsa('#tabbar button').forEach((b) => { b.onclick = () => show(b.dataset.tab); });

  // 瀏覽器上一頁／下一頁
  window.addEventListener('hashchange', () => {
    if (syncingHash) return;
    const v = viewFromHash();
    if (v !== current) show(v, { push: false });
  });
}
