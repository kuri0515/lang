// =====================================================================
// 內容修改記錄（管理員）
//
// 資料由資料庫 trigger 產生，涵蓋編輯器、批次匯入、腳本所有路徑 ——
// 前端沒有「忘了記」的可能。這裡只負責把它讀出來畫。
// =====================================================================
import { $, esc, skeleton, emptyState, qs } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import * as admin from '../data/admin.js';
import { lang } from '../core/lang.js';

const ACTION = {
  create:     { label: '新增', },
  update:     { label: '修改', },
  deactivate: { label: '下架', },
  restore:    { label: '恢復', },
};
// 函式而不是常量：物件字面值會在模組載入當下就把語言快照起來
// （同樣的坑見 study/modes/listen.js 的 hint）。
const fieldLabels = () => {
  const L = lang();
  return {
    ko: L.termLabel, zh: '中文', romanization: L.readingLabel, hanja: L.hanjaLabel,
    pos: '詞性', item_type: '類型', example_ko: `例句(${L.termShort})`,
    example_zh: '例句(中)', note: '備註', tags: '標籤', is_active: '上架狀態',
  };
};

let loaded = false;

export function initEdits() {
  const box = qs('#admin-card .mini-details');
  if (!box) return;
  box.addEventListener('toggle', () => { if (box.open && !loaded) load(); });
  // 有人改了內容 → 下次展開重新載入
  on(EVENTS.ITEM_UPDATED, () => { loaded = false; });
  on(EVENTS.ITEMS_CHANGED, () => { loaded = false; });
}

const fmt = (s) => new Date(s).toLocaleString('zh-TW',
  { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const short = (v) => {
  if (v === null || v === undefined || v === '') return '（空）';
  const t = Array.isArray(v) ? v.join(', ') : String(v);
  return t.length > 42 ? t.slice(0, 42) + '…' : t;
};

async function load() {
  $('edits-list').innerHTML = skeleton(4);
  try {
    const rows = await admin.listEdits(50);
    loaded = true;
    $('edits-count').textContent = rows.length ? `最近 ${rows.length} 筆` : '';
    if (!rows.length) {
      $('edits-list').innerHTML = emptyState('📝', '還沒有修改記錄');
      return;
    }
    $('edits-list').innerHTML = rows.map((r) => {
      const diff = (r.changed || [])
        .filter((f) => f !== 'is_active')
        .map((f) => `<div><span class="muted">${fieldLabels()[f] || f}</span>
            <span class="old">${esc(short(r.before?.[f]))}</span> →
            <span class="new">${esc(short(r.after?.[f]))}</span></div>`).join('');
      return `<div class="edit-row">
        <div class="edit-head">
          <span><span class="edit-act">${ACTION[r.action]?.label || r.action}</span>
            <b>${esc(r.ko)}</b> <span class="muted">${esc(r.zh)}</span></span>
          <span class="edit-when">${esc(fmt(r.edited_at))}${r.editor ? ` · ${esc(r.editor)}` : ''}</span>
        </div>
        ${diff ? `<div class="edit-diff">${diff}</div>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    $('edits-list').innerHTML = `<p class="muted center">載入失敗：${esc(e.message || e)}</p>`;
  }
}
