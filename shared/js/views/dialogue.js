// =====================================================================
// 情境對話畫面
//
// 三種模式，各練一種能力：
//   學習 —— 全部攤開（韓文·羅馬音·中文·語法），配 🔊 聽發音。先看懂再說。
//   練習 —— 只顯示一面，自己回想，點開對答案，再自評記不記得。
//   打亂 —— 排回原順序。單句看得懂，不代表接得上話。
//
// 學習模式刻意全顯示：這個階段的任務是理解，蓋住反而妨礙。
// 練習模式刻意只顯示一面：看著翻譯讀韓文等於沒讀。
// 同一份內容兩種呈現，差別只在「現在要理解，還是要檢驗」。
// =====================================================================
import { $, qsa, esc } from '../core/dom.js';
import { groupDialogues, shuffleLines, checkOrder, DIALOGUE_MARK } from '../core/dialogue.js';
import * as speech from '../core/speech.js';
import * as content from '../data/content.js';
import { lang } from '../core/lang.js';
import { stripRuby, wordHTML } from '../core/ruby.js';

let all = [];          // [{ scene, lines }]
let cur = null;        // 目前開啟的對話
let koFirst = true;    // 練習模式看哪一面：目標語言→中文 或 中文→目標語言
let mode = 'learn';    // learn | practice | shuffle
let picked = [];       // 打亂練習中已排入的行
let revealed = new Set();   // 練習模式中已翻開的行
let rated = new Map();      // 行 → 自評結果（true＝想起來了）
let loaded = false;

let deps = null;

export function initDialogue(d) {
  deps = d;
  $('dlg-back').onclick = () => showList();
  // 翻譯練習：方向（韓→中／中→韓）沿用首頁的全域設定，這裡不再開一個選項 ——
  // 同一件事有兩處設定，使用者只會搞不清楚以哪個為準
  // cur 在清單頁是 null —— 沒有這個防護，從清單頁按到就會炸
  $('dlg-tr-order').onclick = () => cur && practice(cur.lines, true);
  $('dlg-tr-mix').onclick = () => cur && practice(cur.lines, false);
  $('dlg-tr-all').onclick = () => practice(all.flatMap((d2) => d2.lines), false);
  $('dlg-play').onclick = () => playAll();
  $('dlg-side').onclick = () => { koFirst = !koFirst; resetPractice(); render(); };
  $('dlg-reset').onclick = () => { resetPractice(); render(); };
  qsa('input[name="dmode"]').forEach((r) => {
    r.onchange = () => { mode = r.value; picked = []; resetPractice(); render(); };
  });
}

export async function open() {
  if (!loaded) {
    // 依 sort_order 取回 —— 對話的行序全靠它，用 id 排等於亂序
    // 只要對話句：靠 note 開頭篩，讓資料庫做掉。
    // 全撈的話，日文站要為了 188 句對話搬 7049 條詞（gzip 628 KB、8 趟往返）。
    const items = await content.pickItems({ noteHas: DIALOGUE_MARK });
    all = groupDialogues(items);
    loaded = true;
  }
  showList();
}

/**
 * 送進翻譯練習。
 * keepOrder＝照對話順序：練的是語流，前一句是後一句的線索。
 * 打亂＝逐句抽考：確認每一句單獨拿出來也答得出，不是靠前後文猜的。
 */
function practice(lines, keepOrder) {
  const ids = lines.map((l) => l.item.id);
  if (!ids.length) return;
  deps?.onPracticeDialogue?.(ids, keepOrder);
}

/** 內容被編輯過就重抓，否則畫面會停在舊句子 */
export function invalidate() { loaded = false; }

function showList() {
  cur = null;
  $('dlg-detail').classList.add('hidden');
  $('dlg-list-card').classList.remove('hidden');
  $('dlg-count').textContent = `${all.length} 組情境對話`;
  $('dlg-list').innerHTML = all.map((d, i) => `
    <div class="dlg-item" data-i="${i}">
      <b>${esc(d.scene)}</b>
      <span>${d.lines.length} 句 ›</span>
    </div>`).join('');
  qsa('[data-i]', $('dlg-list')).forEach((el) => {
    el.onclick = () => openOne(all[Number(el.dataset.i)]);
  });
}

function resetPractice() { revealed = new Set(); rated = new Map(); }

function openOne(d) {
  cur = d;
  mode = 'learn';
  qsa('input[name="dmode"]').forEach((r) => { r.checked = r.value === 'learn'; });
  picked = [];
  resetPractice();
  $('dlg-list-card').classList.add('hidden');
  $('dlg-detail').classList.remove('hidden');
  render();
}

/**
 * 句子的顯示形式：有振り仮名就用它。
 *
 * ★ 對話正是學生讀「整句」的地方 —— 學習卡片上標了音，
 *   對話裡卻是光禿禿的漢字，等於在最需要的地方把標音拿掉。
 *   （學生會用中文讀音把漢字帶過去，看起來讀懂了，開口時一個字都出不來。）
 *
 * 朗讀與答案比對一律用 item.ko（純文字）—— TTS 唸到 [えき] 會變成雜音。
 */
// 排序練習的句塊也走這裡：這一關考的是「語序」，不是「漢字怎麼唸」，
// 所以標音不算洩題 —— 反而讓學習者是在讀句子，而不是在拼圖形。
const shownHTML = (item) => wordHTML(item);

function render() {
  if (!cur) return;
  $('dlg-title').textContent = cur.scene;
  $('dlg-play').classList.toggle('hidden', mode === 'shuffle');
  $('dlg-side').classList.toggle('hidden', mode !== 'practice');
  $('dlg-reset').classList.toggle('hidden', mode !== 'practice');
  // ★ 這裡曾寫死韓文站的說法，把 index.html 裡正確的日文版蓋掉 ——
  //   HTML 改對了、JS 一渲染就變回去，是最容易漏看的一種語言洩漏。
  const t = lang().termLabel;
  $('dlg-side').textContent = koFirst ? `看${t}想中文` : `看中文想${t}`;
  $('dlg-hint').textContent = {
    learn: '全部攤開。點 🔊 聽單句，或用整段朗讀。',
    practice: '先自己想，再點氣泡對答案，然後自評。',
    shuffle: '照對話順序點下面的句子。單句看得懂，不代表接得上話。',
  }[mode];

  if (mode === 'learn') renderLearn();
  else if (mode === 'practice') renderPractice();
  else renderShuffle();
}

/** 學習模式：全部攤開。這個階段要理解，蓋住反而妨礙 */
function renderLearn() {
  $('dlg-pool').classList.add('hidden');
  $('dlg-result').textContent = '';
  $('dlg-body').innerHTML = cur.lines.map((l, i) => bubble(l, i, `
    <div class="dlg-ko">${shownHTML(l.item)}<button data-say="${i}" title="朗讀">🔊</button></div>
    ${l.item.romanization ? `<div class="dlg-roman">${esc(l.item.romanization)}</div>` : ''}
    <div class="dlg-zh">${esc(l.item.zh)}</div>
    ${l.grammar ? `<div class="dlg-gram">${esc(l.grammar)}</div>` : ''}`)).join('');
  bindSay();
}

/**
 * 練習模式：只顯示一面，點開對答案，再自評。
 *
 * 自評走 logPractice —— 記成績但不動複習排程，
 * 與自由練習同一個原則：檢驗自己的臨時動作，不該打亂長期的複習節奏。
 */
function renderPractice() {
  $('dlg-pool').classList.add('hidden');
  // 練習模式：日文那面要標音，中文那面沒有標音的問題
  const shown = (l) => (koFirst ? shownHTML(l.item) : esc(l.item.zh));
  const hidden = (l) => (koFirst ? esc(l.item.zh) : shownHTML(l.item));

  $('dlg-body').innerHTML = cur.lines.map((l, i) => {
    const open_ = revealed.has(l);
    const mark = rated.get(l);
    const front = koFirst
      ? `<div class="dlg-ko">${shown(l)}<button data-say="${i}" title="朗讀">🔊</button></div>`
      + (l.item.romanization ? `<div class="dlg-roman">${esc(l.item.romanization)}</div>` : '')
      : `<div class="dlg-ko">${shown(l)}</div>`;
    const back = !open_
      ? `<div class="dlg-hide" data-open="${i}">點一下看答案</div>`
      : `<div class="dlg-zh">${hidden(l)}</div>`
        + (l.grammar ? `<div class="dlg-gram">${esc(l.grammar)}</div>` : '')
        + (mark === undefined
            ? `<div class="dlg-rate">
                 <button data-rate="${i}" data-ok="0">沒想起來</button>
                 <button data-rate="${i}" data-ok="1" class="primary">想起來了</button>
               </div>`
            : `<div class="dlg-mark ${mark ? 'ok' : 'no'}">${mark ? '✓ 記得' : '· 再看一次'}</div>`);
    return bubble(l, i, front + back, mark !== undefined ? 'done' : '');
  }).join('');

  const n = rated.size;
  const ok = [...rated.values()].filter(Boolean).length;
  $('dlg-result').textContent = n
    ? (n < cur.lines.length ? `已自評 ${n}/${cur.lines.length}`
       : `這段 ${cur.lines.length} 句，記得 ${ok} 句。`)
    : '';

  bindSay();
  qsa('[data-open]', $('dlg-body')).forEach((el) => {
    el.onclick = () => { revealed.add(cur.lines[Number(el.dataset.open)]); render(); };
  });
  qsa('[data-rate]', $('dlg-body')).forEach((b) => {
    b.onclick = () => {
      const l = cur.lines[Number(b.dataset.rate)];
      const ok_ = b.dataset.ok === '1';
      rated.set(l, ok_);
      // 記成績但不動排程 —— 與自由練習同一個原則
      deps?.onSelfRate?.(l.item, koFirst ? 'ko2zh' : 'zh2ko', ok_);
      render();
    };
  });
}

/** 氣泡外框。三種模式共用，避免同一段結構寫三遍後各自漂移 */
function bubble(l, i, inner, extra = '') {
  return `<div class="dlg-row ${l.speaker === 'B' ? 'b' : 'a'}">
    <div class="dlg-bubble ${extra}">
      <div class="dlg-who">${esc(l.speaker)}</div>
      ${inner}
    </div>
  </div>`;
}

function bindSay() {
  qsa('[data-say]', $('dlg-body')).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const l = cur.lines[Number(b.dataset.say)];
      speech.speak(l.item.ko, l.item.audio_url);
    };
  });
}

function renderShuffle() {
  if (!cur._shuffled) cur._shuffled = shuffleLines(cur.lines);
  const pool = cur._shuffled;

  // 上半：排好的格子。答對前不標色 —— 邊排邊標等於直接給答案
  const done = picked.length === cur.lines.length;
  const { flags, correct } = done ? checkOrder(picked, cur.lines)
                                  : { flags: [], correct: false };
  $('dlg-body').innerHTML = cur.lines.map((_, i) => {
    const p = picked[i];
    const cls = !p ? '' : done ? (flags[i] ? 'ok' : 'no') : 'filled';
    return `<div class="dlg-slot">
      <span class="n">${i + 1}</span>
      <div class="s ${cls}" data-slot="${i}">${p ? shownHTML(p.item) : '　'}</div>
    </div>`;
  }).join('');

  $('dlg-pool').classList.remove('hidden');
  $('dlg-pool').innerHTML = pool.map((l, i) => {
    const used = picked.includes(l);
    return `<button class="dlg-pick${used ? ' used' : ''}" data-pick="${i}"
              ${used ? 'disabled' : ''}>${shownHTML(l.item)}</button>`;
  }).join('');

  $('dlg-result').textContent = !done ? ''
    : correct ? '✅ 順序正確，這段你接得上了。'
              : '再看一次 —— 標紅的位置不對，其他都對。';

  qsa('[data-pick]', $('dlg-pool')).forEach((b) => {
    b.onclick = () => {
      if (picked.length >= cur.lines.length) return;
      picked.push(pool[Number(b.dataset.pick)]);
      render();
    };
  });
  // 點已排入的格子可以退回，不必整段重來
  qsa('[data-slot]', $('dlg-body')).forEach((el) => {
    el.onclick = () => {
      const i = Number(el.dataset.slot);
      if (i < picked.length) { picked.splice(i, 1); render(); }
    };
  });
}

/**
 * 整段朗讀。逐句唸完再唸下一句 —— 同時觸發會疊在一起變成噪音。
 * 中途離開這一頁就停，否則聲音會跟著人跑到別的畫面。
 */
let playing = false;
async function playAll() {
  if (playing) { speech.cancel(); playing = false; $('dlg-play').textContent = '▶ 整段朗讀'; return; }
  playing = true;
  $('dlg-play').textContent = '⏹ 停止';
  const lines = cur.lines;
  for (const l of lines) {
    if (!playing || $('view-browse').classList.contains('hidden')) break;
    await speech.speakAwait(l.item.ko, l.item.audio_url).catch(() => {});
    await new Promise((r) => setTimeout(r, 260));   // 兩句之間留一點空隙才像對話
  }
  playing = false;
  $('dlg-play').textContent = '▶ 整段朗讀';
}
