// 詞庫瀏覽：搜尋、標籤、雙向學習狀態、批次下架（管理員）
import { $, esc, msg, qsa, debounce, skeleton, emptyState, createPager } from '../core/dom.js';
import { on, emit, EVENTS } from '../core/bus.js';
import { STATE_LABEL, TYPE_LABEL, DIR_SHORT } from '../data/client.js';
import * as content from '../data/content.js';
import { groupTags, GROUPS } from '../core/taxonomy.js';
import * as dialogue from './dialogue.js';
import * as admin from '../data/admin.js';
import * as progress from '../data/progress.js';
import { openEditor } from './editor.js';
import * as speech from '../core/speech.js';

let deps = null;              // { user, isAdmin, onPractice }
let tag = '';
const picked = new Set();
let pager = null;
let lastRows = [];

export function initBrowse(d) {
  deps = d;
  $('b-search').addEventListener('input', debounce(render, 250));
  $('btn-study-tag').onclick = () => { if (tag) deps.onStudyTag(tag); };
  $('btn-practice-sel').onclick = () => {
    if (!picked.size) return msg('先勾選要練的條目');
    deps.onPractice([...picked]);
  };
  on(EVENTS.ITEM_UPDATED, () => { if (!$('view-browse').classList.contains('hidden')) render(); });
  // 內容變動時兩邊都要作廢，否則對話畫面會停在舊句子
  on(EVENTS.ITEMS_CHANGED, () => { tagsLoaded = false; dialogue.invalidate(); });
  initTabs();
  dialogue.initDialogue(d);
}

let tagsLoaded = false;

/** 單字／對話 子分頁。對話是另一種學習形態，不該混在單字清單裡 */
function initTabs() {
  qsa('input[name="btab"]').forEach((r) => {
    r.onchange = () => {
      const dlg = r.value === 'dialogue';
      $('b-pane-words').classList.toggle('hidden', dlg);
      $('b-pane-dialogue').classList.toggle('hidden', !dlg);
      if (dlg) dialogue.open().catch((e) => msg(e.message || e));
    };
  });
}

export async function open() {
  if (!tagsLoaded) {
    try {
      const tags = await content.listTags();
      // 分組呈現：主題是篩選器，發音是課程。平鋪在一起，
      // 想找「食物」得先滑過「收音ㄼ」。分組與順序的判準在 core/taxonomy.js
      const g = groupTags(tags);
      const btn = ([t, n]) => `<button class="tag" data-tag="${esc(t)}">${esc(t)} ${n}</button>`;
      $('b-tags').innerHTML = '<button class="tag on" data-tag="">全部</button>'
        + GROUPS.filter((x) => g[x.key].length).map((x) =>
            `<div class="tag-group"><div class="tag-group-h">${esc(x.label)}`
            + `<span>${esc(x.hint)}</span></div>`
            + `<div class="tag-row">${g[x.key].map(btn).join('')}</div></div>`).join('');
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

    if (!rows.length) {
      $('b-list').innerHTML = emptyState('🔍', '沒有符合的條目');
      $('b-more').innerHTML = '';
      return;
    }

    lastRows = rows;
    const admin_ = deps.isAdmin();
    const rowHtml = (r) => {
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
    };

    if (!pager) {
      pager = createPager({
        list: $('b-list'), footer: $('b-more'), pageSize: 60,
        render: (slice) => slice.map(rowHtml).join(''),
        afterRender: bindRows,
      });
    }
    pager.set(rows);

    renderBulkBar();
  } catch (e) {
    $('b-list').innerHTML = '';
    msg('載入失敗：' + (e.message || e));
  }
}

/** 每次重畫清單後重掛事件（分頁載入更多會整份重畫） */
function bindRows() {
  qsa('[data-ko]', $('b-list')).forEach((b) => { b.onclick = () => speech.speak(b.dataset.ko); });
  qsa('[data-edit]', $('b-list')).forEach((b) => {
    b.onclick = () => openEditor(lastRows.find((r) => r.id === b.dataset.edit));
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
