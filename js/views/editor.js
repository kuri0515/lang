// =====================================================================
// 條目編輯／新增（管理員）
//
// 【解耦重點】
//   本模組不認識學習頁、瀏覽頁或任何其他畫面。存檔後只廣播
//   ITEM_UPDATED，誰關心誰自己訂閱。以前它得直接改 queue、改 pool、
//   再手動呼叫 render() 和 renderBrowse()。
// =====================================================================
import { $, esc, msg } from '../core/dom.js';
import { emit, EVENTS } from '../core/bus.js';
import * as admin from '../data/admin.js';
import * as content from '../data/content.js';

let editing = null;
let decksCache = [];

export async function loadDecksInto(sel) {
  if (!decksCache.length) decksCache = await content.listDecks().catch(() => []);
  sel.innerHTML = decksCache.map((d) =>
    `<option value="${d.id}|${esc(d.slug)}">${esc(d.title)}</option>`).join('')
    + '<option value="__new__">＋ 新增詞庫…</option>';
}

export function invalidateDecks() { decksCache = []; }

/** 取得選中的詞庫；選「新增」時當場建一個 */
export async function resolveDeck(sel) {
  if (sel.value !== '__new__') return sel.value.split('|');
  const title = prompt('新詞庫名稱', '我的詞庫');
  if (!title) return [null, null];
  const slug = prompt('詞庫代號（英數與連字號）', 'my-deck-' + Date.now().toString(36));
  if (!slug) return [null, null];
  try {
    const d = await admin.ensureDeck(slug.trim(), title.trim());
    decksCache = [];
    await loadDecksInto(sel);
    sel.value = `${d.id}|${d.slug}`;
    return [d.id, d.slug];
  } catch (e) { msg('建立詞庫失敗：' + (e.message || e)); return [null, null]; }
}

export function openEditor(item) {
  editing = item;
  const set = (id, v) => { $(id).value = v ?? ''; };
  set('e-ko', item.ko); set('e-zh', item.zh);
  set('e-roman', item.romanization); set('e-pos', item.pos);
  set('e-hanja', item.hanja);
  $('e-type').value = item.item_type || 'word';
  set('e-ex-ko', item.example_ko); set('e-ex-zh', item.example_zh);
  set('e-note', item.note);
  set('e-tags', (item.tags || []).join(', '));

  $('e-msg').textContent = '';
  $('e-msg').className = 'editor-msg';
  $('e-deck-row').classList.toggle('hidden', !!item.id);
  $('editor').querySelector('h2').textContent = item.id ? '編輯條目' : '新增條目';
  $('editor').classList.remove('hidden');
  $('e-ko').focus();
}

export function closeEditor() { $('editor').classList.add('hidden'); editing = null; }

async function save() {
  if (!editing) return;
  const ko = $('e-ko').value.trim();
  const zh = $('e-zh').value.trim();
  const say = (t, cls = '') => { $('e-msg').textContent = t; $('e-msg').className = 'editor-msg ' + cls; };
  if (!ko || !zh) return say('韓文與中文為必填', 'err');

  const patch = {
    ko, zh,
    romanization: $('e-roman').value.trim() || null,
    hanja: $('e-hanja').value.trim() || null,
    pos: $('e-pos').value.trim() || null,
    item_type: $('e-type').value,
    example_ko: $('e-ex-ko').value.trim() || null,
    example_zh: $('e-ex-zh').value.trim() || null,
    note: $('e-note').value.trim() || null,
    tags: $('e-tags').value.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean),
  };

  $('e-save').disabled = true;
  say('同步中…');
  try {
    let saved;
    if (editing.id) {
      // 用資料庫回讀的那一行更新畫面，而非我們送出的 patch ——
      // 才能確定畫面反映的是雲端真正存了什麼。
      saved = await admin.updateItem(editing.id, patch);
    } else {
      const [deckId, deckSlug] = await resolveDeck($('e-deck'));
      if (!deckId) { $('e-save').disabled = false; say(''); return; }
      [saved] = await admin.insertItems(deckId, deckSlug, [patch]);
      emit(EVENTS.ITEMS_CHANGED);
    }
    emit(EVENTS.ITEM_UPDATED, saved);
    say(editing.id ? '✓ 已同步到雲端' : '✓ 已新增', 'ok');
    setTimeout(closeEditor, 700);
  } catch (e) {
    say('儲存失敗：' + (e.message || e), 'err');
  } finally {
    $('e-save').disabled = false;
  }
}

export function initEditor() {
  $('e-close').onclick = closeEditor;
  $('e-cancel').onclick = closeEditor;
  $('editor').onclick = (e) => { if (e.target === $('editor')) closeEditor(); };
  $('e-save').onclick = save;
}
