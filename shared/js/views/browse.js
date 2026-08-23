// 詞庫瀏覽：搜尋、標籤、雙向學習狀態、批次下架（管理員）
import { $, esc, msg, qsa, debounce, skeleton, emptyState, createPager, opt } from '../core/dom.js';
import { wordHTML } from '../core/ruby.js';
import { lang } from '../core/lang.js';
import { on, emit, EVENTS } from '../core/bus.js';
import { STATE_LABEL, TYPE_LABEL, dirShort } from '../data/client.js';
import * as content from '../data/content.js';
import { groupTags, groups } from '../core/taxonomy.js';
import * as dialogue from './dialogue.js';
import * as script from './script.js';
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
  // 「學新的」＝從這個詞庫抓沒學過的。首頁原本那張詞庫卡就是這個功能，
  // 搬過來而不是刪掉 —— 韓文站有三個詞庫，刪了其中兩個就沒有入口。
  $('btn-study-deck').onclick = () => { if (deckId) deps.onNewDeck(deckId); };
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
let deckId = '';          // '' = 全部詞庫
let deckTitle = '';

/**
 * 子分頁：單字／情境對話／精讀。
 * 三者都是「內容從哪來」，而底部導覽回答的是「我要做什麼」——
 * 所以它們並列在這裡，不各佔一個底部入口。
 *
 * 精讀那一格只有宣告了 scriptReading 的站台才有，
 * 所以 pane 用 opt() 取 —— 沒有的站台整塊畫面不存在。
 */
function initTabs() {
  const PANES = { words: 'b-pane-words', dialogue: 'b-pane-dialogue', script: 'b-pane-script' };
  qsa('input[name="btab"]').forEach((r) => {
    r.onchange = () => {
      for (const [val, id] of Object.entries(PANES)) {
        opt(id)?.classList.toggle('hidden', val !== r.value);
      }
      if (r.value === 'dialogue') dialogue.open().catch((e) => msg(e.message || e));
      if (r.value === 'script') script.open().catch((e) => msg(e.message || e));
    };
  });
}

export async function open() {
  if (!tagsLoaded) {
    try {
      // 詞庫選單：只有兩個以上才顯示。一個的時候選它等於沒選，
      // 而多一列沒有作用的按鈕會讓人以為自己漏看了什麼。
      const decks = await content.listDecks().catch(() => []);
      const dbox = $('b-decks');
      if (decks.length > 1) {
        dbox.classList.remove('hidden');
        dbox.innerHTML = '<div class="tag-group-h">詞庫<span>先選範圍，再挑標籤</span></div>'
          + '<div class="tag-row">'
          + `<button class="tag on" data-deck="">全部</button>`
          + decks.map((d) => `<button class="tag" data-deck="${esc(d.id)}">${esc(d.title)}</button>`).join('')
          + '</div>';
        qsa('[data-deck]', dbox).forEach((b) => {
          b.onclick = () => {
            deckId = b.dataset.deck;
            deckTitle = deckId ? b.textContent : '';
            qsa('[data-deck]', dbox).forEach((x) => x.classList.toggle('on', x === b));
            render();
          };
        });
      } else {
        dbox.classList.add('hidden');
      }

      const tags = await content.listTags();
      // 分組呈現：主題是篩選器，發音是課程。平鋪在一起，
      // 想找「食物」得先滑過「收音ㄼ」。分組與順序的判準在 core/taxonomy.js
      const g = groupTags(tags);
      const btn = ([t, n]) => `<button class="tag" data-tag="${esc(t)}">${esc(t)} ${n}</button>`;
      $('b-tags').innerHTML = '<div class="tag-row"><button class="tag on" data-tag="">全部</button></div>'
        + groups().filter((x) => g[x.key].length).map((x) =>
            `<div class="tag-group"><div class="tag-group-h">${esc(x.label)}`
            + `<span>${esc(x.hint)}</span></div>`
            + `<div class="tag-row">${g[x.key].map(btn).join('')}</div></div>`).join('');
      qsa('.tag', $('b-tags')).forEach((b) => {
        b.onclick = () => {
          tag = b.dataset.tag;
          qsa('.tag', $('b-tags')).forEach((x) => x.classList.toggle('on', x === b));
          // 選完就收起 —— 篩選的目的是看結果，讓人自己再點一次收合是多一步
          $('b-filter').open = false;
          $('b-filter-now').textContent = tag || '全部';
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
    const raw = await content.pickItems({ tag, deckId: deckId || null, search: $('b-search').value });
    const byItem = await progress.cardsByItem(user?.id, raw.map((i) => i.id));
    const rows = raw.map((i) => ({ ...i, cards: byItem[i.id] || {} }));

    $('b-count').textContent = `${rows.length} 條`
      + (deckTitle ? ` · ${deckTitle}` : '') + (tag ? ` · ${tag}` : '');
    $('btn-study-deck').classList.toggle('hidden', !deckId);
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
        return `<span class="dot ${c ? c.state : ''}" title="${dirShort()[dir]}：${c ? STATE_LABEL[c.state] : '未學'}">${dirShort()[dir]}${acc}</span>`;
      };
      return `<div class="b-row" data-id="${r.id}">
        <div class="b-main">
          <div>
            ${admin_ ? `<input type="checkbox" class="b-check" data-pick="${r.id}">` : ''}
            <span class="b-ko">${wordHTML(r)}</span><span class="muted"> — </span><span class="b-zh">${esc(r.zh)}</span>
          </div>
          <div class="b-badges">${badge('ko2zh')}${badge('zh2ko')}
            <button class="b-speak" data-ko="${esc(r.ko)}" title="朗讀">🔊</button>
            ${admin_ ? `<button class="b-speak" data-edit="${r.id}" title="編輯">✏️</button>` : ''}
          </div>
        </div>
        <div class="b-sub">${[r.romanization, r.pos, TYPE_LABEL[r.item_type]].filter(Boolean).map(esc).join(' · ')}
          ${!lang().rubyFromHanja && r.hanja
              // hanja 欄兩站裝的東西不同：韓文站是漢字詞源（학교 → 學校），
              // 日文站是注音字串。不分站台就印，日文站會出現
              // 「· 漢 駅[えき]は…」這種沒有意義的東西，
              // 而讀音已經標在詞的上方，再印一次也是重複。
              ? `<span class="b-hanja"> · 漢 ${esc(r.hanja)}</span>` : ''}</div>
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
