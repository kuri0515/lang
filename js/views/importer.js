// 批次匯入（管理員）：貼上 CSV／TSV → 預覽 → 寫入
import { $, esc, msg } from '../core/dom.js';
import { emit, EVENTS } from '../core/bus.js';
import { TYPE_LABEL } from '../data/client.js';
import { parseTable } from '../core/parse-table.js';
import * as admin from '../data/admin.js';
import { loadDecksInto, resolveDeck, invalidateDecks } from './editor.js';

let parsed = null;

export function initImporter() {
  $('i-parse').onclick = preview;
  $('i-apply').onclick = apply;
}

export async function open() { await loadDecksInto($('i-deck')); }

function preview() {
  const res = parseTable($('i-text').value);
  $('i-preview-card').classList.remove('hidden');

  if (res.error) {
    parsed = null;
    $('i-apply').disabled = true;
    $('i-summary').innerHTML = `<span style="color:var(--again)">${esc(res.error)}</span>`;
    $('i-preview').innerHTML = '';
    return;
  }

  parsed = res.rows;
  const warns = res.rows.filter((r) => r.warn).length;
  $('i-apply').disabled = !res.rows.length;
  $('i-summary').innerHTML =
    `解析出 <b>${res.rows.length}</b> 列（跳過 ${res.skipped} 列缺欄位的）· `
    + `分隔符 ${res.sep === '\t' ? 'Tab' : '逗號'} · 欄位對應：${esc(JSON.stringify(res.headers))}`
    + (warns ? `<br><span style="color:var(--hard)">⚠️ ${warns} 列的韓文欄裡沒有諺文字元，請確認欄位沒錯位</span>` : '');

  $('i-preview').innerHTML = res.rows.slice(0, 30).map((r) =>
    `<div class="i-row${r.warn ? ' warn' : ''}">
       <b>${esc(r.ko)}</b> — ${esc(r.zh)}
       <span class="t">${[r.romanization, r.hanja, r.pos, TYPE_LABEL[r.item_type], (r.tags || []).join('/')]
         .filter(Boolean).map(esc).join(' · ')}</span>
       ${r.warn ? `<span class="t"> ⚠️ ${esc(r.warn)}</span>` : ''}
     </div>`).join('')
    + (res.rows.length > 30 ? `<p class="muted">…以下省略 ${res.rows.length - 30} 列</p>` : '');
}

async function apply() {
  if (!parsed?.length) return;
  const [deckId, deckSlug] = await resolveDeck($('i-deck'));
  if (!deckId) return;
  const deckName = $('i-deck').selectedOptions[0].textContent;
  if (!confirm(`確定匯入 ${parsed.length} 條到「${deckName}」？`)) return;

  $('i-apply').disabled = true;
  $('i-summary').innerHTML = '匯入中…';
  try {
    const done = await admin.insertItems(deckId, deckSlug, parsed);
    // 回讀筆數核對，不靠斷言
    $('i-summary').innerHTML =
      `<span style="color:var(--good)">✓ 已匯入 ${done.length} 條`
      + `${done.length !== parsed.length ? `（送出 ${parsed.length} 條，請檢查）` : ''}</span>`;
    $('i-text').value = '';
    $('i-preview').innerHTML = '';
    parsed = null;
    invalidateDecks();
    emit(EVENTS.ITEMS_CHANGED);
  } catch (e) {
    $('i-summary').innerHTML = `<span style="color:var(--again)">匯入失敗：${esc(e.message || e)}</span>`;
    $('i-apply').disabled = false;
  }
}
