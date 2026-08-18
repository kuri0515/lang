// =====================================================================
// 外觀主題（跟隨系統／淺色／深色）
//
// 三態而非開關：使用者可能想固定一種，也可能想跟著系統日夜切換。
// 「跟隨系統」不寫 data-theme，讓 CSS 的 prefers-color-scheme 生效。
// =====================================================================
import { $, qs } from '../core/dom.js';
import { lsKey } from '../core/lang.js';

// ★ 曾經寫死 'kr.theme' —— 日文站也在寫同一格（兩站同網域）
const LS_THEME = () => lsKey('theme');

export function applyTheme(t) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  // 讓瀏覽器 UI（iOS 狀態列等）跟著換色
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  qs('meta[name=theme-color]')?.setAttribute('content', bg || '#4c6ef5');
}

export function initTheme() {
  const saved = localStorage.getItem(LS_THEME()) || 'system';
  applyTheme(saved);
  const el = qs(`#theme-pick input[value="${saved}"]`);
  if (el) el.checked = true;
  $('theme-pick')?.addEventListener('change', (e) => {
    localStorage.setItem(LS_THEME(), e.target.value);
    applyTheme(e.target.value);
  });
}
