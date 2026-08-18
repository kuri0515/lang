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
// 只有登入頁不顯示分頁列 —— 沒登入的話每個分頁都是空的，
// 給了也只能點到空畫面。
//
// ★ 學習中原本也隱藏，理由是「避免誤觸中斷」。那個理由已經不成立：
//   續跑做好之後，離開不會弄丟進度（每答一題就存本機＋雲端）。
//   而隱藏的代價是真的：學到一半想查個詞、想看看記錄，都得先結束這一輪。
//
//   打開的前提是「回得去」—— 首頁會顯示「繼續這一輪」，見 views/home.js。
//   沒有那個入口就打開分頁列，等於讓人把自己鎖在外面。
const NO_TAB = ['view-auth'];
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
  //
  // ★ 學習 → 結束 是例外。
  //   答完最後一題時，題型會先唸出答案、緊接著這一輪就結束 ——
  //   跳到結束畫面時把剛開始唸的那句切掉，使用者的體感是「最後一題沒有聲音」。
  //   而那兩個畫面屬於同一個流程，不是「跑到別的頁面」。
  const sameFlow = current === 'view-study' && view === 'view-done';
  if (current !== view && !sameFlow) speech.cancel();
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
