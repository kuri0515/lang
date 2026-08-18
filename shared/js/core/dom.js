// =====================================================================
// DOM 工具 —— 各模組共用，避免每個檔案各自抄一份 $ 和 esc
// =====================================================================

export const $ = (id) => document.getElementById(id);
/**
 * 站台可選的元素。
 *
 * $() 取的是「每一站都必須有」的元素，架構檢查會盯著它 ——
 * 少一個就是 bug，因為那代表 JS 會拿到 null 然後在某個功能上炸掉。
 *
 * 但有些元素本來就只有某些站台有（日文站的五十音表；諺文是拼合而成，
 * 沒有等價的固定表格）。那種情況用 opt()，讓「可以不存在」
 * 在程式碼裡看得出來，而不是靠讀 render 函式開頭那行 if 才知道。
 */
export const opt = (id) => document.getElementById(id);

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

/**
 * 分頁渲染。
 *
 * 【為什麼不一次畫完】
 *   查詢已改為分頁撈完（見 data/client.js 的 fetchAll），
 *   但「撈得到」不等於「該一次畫出來」。詞庫上千條時，
 *   一次插入幾千個 DOM 節點會讓手機明顯卡頓，而且使用者
 *   一次也看不完那麼多。
 *
 *   採「先畫一批 + 載入更多」而非頁碼：清單是用來瀏覽與搜尋的，
 *   不是用來翻頁定位的；載入更多不會跳動捲軸位置。
 */
export function createPager({ list, footer, pageSize = 60, render, afterRender }) {
  let rows = [];
  let shown = 0;

  function paint() {
    const slice = rows.slice(0, shown);
    list.innerHTML = render(slice);
    const rest = rows.length - shown;
    if (rest > 0) {
      footer.innerHTML = `<button class="block ghost" id="${footer.id}-more">載入更多（還有 ${rest} 條）</button>`;
      footer.querySelector('button').onclick = () => { shown += pageSize; paint(); };
    } else {
      footer.innerHTML = rows.length > pageSize
        ? `<p class="hint center nomargin">已顯示全部 ${rows.length} 條</p>` : '';
    }
    // 每次重畫都要重掛事件 —— 「載入更多」會整份重繪
    afterRender?.(slice);
    return slice;
  }

  return {
    /** 換一批資料，回捲到第一頁 */
    set(next) { rows = next; shown = Math.min(pageSize, rows.length); return paint(); },
    /** 重畫目前這批（例如某列狀態變了） */
    repaint: paint,
    get total() { return rows.length; },
    get visible() { return rows.slice(0, shown); },
  };
}

/**
 * 一天的代號（YYYY-MM-DD），用**本地時區**。
 *
 * 【為什麼不能用 toISOString().slice(0, 10)】
 *   那個是 UTC 日期。在台北（UTC+8），早上 8 點以前的 UTC 日期是「昨天」——
 *   於是：
 *     · 七天條的「今天」那一格不會亮（它比對的是 UTC 的今天，
 *       而作答記錄是按本地日期分組的）
 *     · 「今日已掌握」的計數會在早上 8 點自己歸零
 *   兩者都不會報錯，而使用者的體感是「這個 App 有時候會忘記我學過」。
 *
 * 【為什麼統一在這裡】
 *   先前 dailyStats 用本地、首頁用 UTC —— 兩個地方各自定義「一天」，
 *   而它們的結果要互相比對。定義只能有一份。
 */
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 按下去之後要等網路的按鈕，一律包這個。
 *
 * 【為什麼需要】
 *   輪練第一次按下去要撈整個詞庫（韓文站 801 條，實測 964 ms），
 *   期間畫面完全沒有變化 —— 使用者的合理反應是再按幾下。
 *   而當時每按一下都會往前吃掉 10 個詞（見 docs/LESSONS.md L-002）。
 *
 *   那個 bug 已經修好了（重按現在是冪等的），但**原因還在**：
 *   沒有回饋的等待會製造重試。讓重試無害是防守，
 *   讓重試不必發生才是修好。
 *
 * 【為什麼用 class 而不是換文字】
 *   有些按鈕裡有子元素（btn-new 裡有 #e-new 顯示課名），
 *   改 textContent 會把它們整個清掉，回復時就回不來了。
 *
 * 【為什麼自己記 disabled】
 *   首頁的 render 會依到期數重設 disabled。忙完直接寫 false 的話，
 *   一顆本來就該是灰的按鈕會被點亮。
 */
export function busy(el, fn) {
  if (!el) return Promise.resolve(fn());
  if (el.dataset.busy) return Promise.resolve();   // 重按直接忽略，不排隊
  const wasDisabled = el.disabled;
  el.dataset.busy = '1';
  el.disabled = true;
  el.setAttribute('aria-busy', 'true');
  const done = () => {
    delete el.dataset.busy;
    el.disabled = wasDisabled;
    el.removeAttribute('aria-busy');
  };
  // ★ fn 要同步呼叫。用 Promise.resolve().then(fn) 的話，
  //   工作被推遲一個微任務才開始 —— 沒有任何好處，
  //   而且「按下去到工作真的開始」之間多了一段什麼都沒發生的空窗。
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  return Promise.resolve(out).finally(done);
}
