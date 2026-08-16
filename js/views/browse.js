// 詞庫瀏覽：搜尋、標籤、雙向學習狀態、批次下架（管理員）
import { $, esc, msg, qsa, debounce, skeleton, emptyState } from '../core/dom.js';
import { on, emit, EVENTS } from '../core/bus.js';
import { STATE_LABEL, TYPE_LABEL, DIR_SHORT } from '../data/client.js';
import * as content from '../data/content.js';
import * as admin from '../data/admin.js';
import * as progress from '../data/progress.js';
import { openEditor } from './editor.js';
import * as speech from '../core/speech.js';

let deps = null;              // { user, isAdmin, onPractice }
let tag = '';
const picked = new Set();

export function initBrowse(d) {
  deps = d;
  $('b-search').addEventListener('input', debounce(render, 250));
  $('btn-study-tag').onclick = () => { if (tag) deps.onStudyTag(tag); };
  $('btn-practice-sel').onclick = () => {
    if (!picked.size) return msg('先勾選要練的條目');
    deps.onPractice([...picked]);
  };
  on(EVENTS.ITEM_UPDATED, () => { if (!$('view-browse').classList.contains('hidden')) render(); });
  on(EVENTS.ITEMS_CHANGED, () => { tagsLoaded = false; });
}

let tagsLoaded = false;

export async function open() {
  if (!tagsLoaded) {
    try {
      const tags = await content.listTags();
      $('b-tags').innerHTML = '<button class="tag on" data-tag="">全部</button>'
        + tags.map(([t, n]) => `<button class="tag" data-tag="${esc(t)}">${esc(t)} ${n}</button>`).join('');
      qsa('.tag', $('b-tags')).forEach((b) => {
        b.onclick = () => {
          tag = b.dataset.tag;
          qsa('.tag', $('b-tags')).forEach((x) => x.classList.toggle('on', x === b));
          render();
        };
      });
      tagsLoaded = true;
    } catch (e) { msg(e.message || e); }
  }
  await render();
}

export async function render() {
  if (!$('b-list').querySelector('.b-row')) $('b-list').innerHTML = skeleton(6);
  try {
    const user = deps.user();
    const raw = await content.pickItems({ tag, search: $('b-search').value });
    const byItem = await progress.cardsByItem(user?.id, raw.map((i) => i.id));
    const rows = raw.map((i) => ({ ...i, cards: byItem[i.id] || {} }));

    $('b-count').textContent = `${rows.length} 條${tag ? ` · ${tag}` : ''}`;
    $('btn-study-tag').classList.toggle('hidden', !tag);
    $('btn-study-tag').textContent = `學「${tag}」`;
    $('btn-practice-sel').classList.toggle('hidden', !picked.size);

    if (!rows.length) { $('b-list').innerHTML = emptyState('🔍', '沒有符合的條目'); return; }

    const admin_ = deps.isAdmin();
    $('b-list').innerHTML = rows.map((r) => {
      const badge = (dir) => {
        const c = r.cards[dir];
        const acc = c?.total_reviews ? ` ${Math.round(c.correct_reviews / c.total_reviews * 100)}%` : '';
        return `<span class="dot ${c ? c.state : ''}" title="${DIR_SHORT[dir]}：${c ? STATE_LABEL[c.state] : '未學'}">${DIR_SHORT[dir]}${acc}</span>`;
      };
      return `<div class="b-row" data-id="${r.id}">
        <div class="b-main">
          <div>
            ${admin_ ? `<input type="checkbox" class="b-check" data-pick="${r.id}">` : ''}
            <span class="b-ko">${esc(r.ko)}</span><span class="muted"> — </span><span class="b-zh">${esc(r.zh)}</span>
          </div>
          <div class="b-badges">${badge('ko2zh')}${badge('zh2ko')}
            <button class="b-speak" data-ko="${esc(r.ko)}" title="朗讀">🔊</button>
            ${admin_ ? `<button class="b-speak" data-edit="${r.id}" title="編輯">✏️</button>` : ''}
          </div>
        </div>
        <div class="b-sub">${[r.romanization, r.pos, TYPE_LABEL[r.item_type]].filter(Boolean).map(esc).join(' · ')}
          ${r.hanja ? `<span class="b-hanja"> · 漢 ${esc(r.hanja)}</span>` : ''}</div>
        ${r.example_ko ? `<div class="b-ex">${esc(r.example_ko)}<br>${esc(r.example_zh || '')}</div>` : ''}
        ${r.note ? `<div class="b-sub">💡 ${esc(r.note)}</div>` : ''}
      </div>`;
    }).join('');

    qsa('[data-ko]', $('b-list')).forEach((b) => { b.onclick = () => speech.speak(b.dataset.ko); });
    qsa('[data-edit]', $('b-list')).forEach((b) => {
      b.onclick = () => openEditor(rows.find((r) => r.id === b.dataset.edit));
    });
    qsa('[data-pick]', $('b-list')).forEach((c) => {
      c.checked = picked.has(c.dataset.pick);
      c.closest('.b-row').classList.toggle('sel', c.checked);
      c.onchange = () => {
        c.checked ? picked.add(c.dataset.pick) : picked.delete(c.dataset.pick);
        c.closest('.b-row').classList.toggle('sel', c.checked);
        renderBulkBar();
        $('btn-practice-sel').classList.toggle('hidden', !picked.size);
      };
    });
    renderBulkBar();
  } catch (e) {
    $('b-list').innerHTML = '';
    msg('載入失敗：' + (e.message || e));
  }
}

function renderBulkBar() {
  let bar = $('bulk-bar');
  if (!picked.size) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulk-bar';
    bar.className = 'bulk-bar';
    $('b-list').after(bar);
  }
  bar.innerHTML = `<span>已選 ${picked.size} 條</span>
    <button id="bulk-clear">取消</button>
    <button id="bulk-del" class="primary">下架所選</button>`;
  $('bulk-clear').onclick = () => { picked.clear(); render(); };
  $('bulk-del').onclick = bulkDeactivate;
}

async function bulkDeactivate() {
  const ids = [...picked];
  if (!confirm(`確定要下架這 ${ids.length} 條嗎？\n\n它們不會再出現在學習與瀏覽中，`
             + '但資料與你的學習記錄都會保留，之後可以還原。')) return;
  try {
    const done = await admin.setItemsActive(ids, false);
    picked.clear();
    msg(`已下架 ${done.length} 條${done.length !== ids.length ? `（送出 ${ids.length} 條）` : ''}`, 'ok');
    emit(EVENTS.ITEMS_CHANGED);
    await render();
  } catch (e) { msg('下架失敗：' + (e.message || e)); }
}
