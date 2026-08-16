// =====================================================================
// DOM 工具 —— 各模組共用，避免每個檔案各自抄一份 $ 和 esc
// =====================================================================

export const $ = (id) => document.getElementById(id);
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** HTML 轉義。所有插進 innerHTML 的使用者資料都必須經過這裡。 */
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

export function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** 骨架屏：切換畫面時先給結構，而非空白再跳出內容 */
export const skeleton = (n = 5) => `<div class="skel">${'<i></i>'.repeat(n)}</div>`;

export const emptyState = (icon, text) =>
  `<div class="empty"><span class="e-icon">${icon}</span>${text}</div>`;

let msgTimer = null;
export function msg(text, kind = 'err') {
  const host = $('msg');
  if (!host) return;
  host.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { host.innerHTML = ''; }, 6000);
}

/** 防抖：搜尋輸入等高頻事件用 */
export function debounce(fn, ms = 250) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
