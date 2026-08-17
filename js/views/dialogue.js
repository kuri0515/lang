// =====================================================================
// 情境對話畫面
//
// 兩種練法，因為它們練的是不同能力：
//   朗讀（保留順序）—— 練理解與語流。看得到誰在說、聽得到怎麼唸。
//   打亂（排回原序）—— 練「這句接哪句」。單句看得懂，不代表接得上話。
//
// 中文預設隱藏。看著翻譯讀韓文等於沒讀 —— 要先自己想，想不出來再開。
// =====================================================================
import { $, qsa, esc } from '../core/dom.js';
import { groupDialogues, shuffleLines, checkOrder } from '../core/dialogue.js';
import * as speech from '../core/speech.js';
import * as content from '../data/content.js';

let all = [];          // [{ scene, lines }]
let cur = null;        // 目前開啟的對話
let showZh = false;
let mode = 'read';     // read | shuffle
let picked = [];       // 打亂練習中已排入的行
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
  $('dlg-zh').onclick = () => { showZh = !showZh; render(); };
  $('dlg-play').onclick = () => playAll();
  $('dlg-mode').onclick = () => {
    mode = mode === 'read' ? 'shuffle' : 'read';
    picked = [];
    render();
  };
}

export async function open() {
  if (!loaded) {
    // 依 sort_order 取回 —— 對話的行序全靠它，用 id 排等於亂序
    const items = await content.pickItems({});
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

function openOne(d) {
  cur = d;
  mode = 'read';
  picked = [];
  $('dlg-list-card').classList.add('hidden');
  $('dlg-detail').classList.remove('hidden');
  render();
}

function render() {
  if (!cur) return;
  $('dlg-title').textContent = cur.scene;
  $('dlg-zh').textContent = showZh ? '隱藏中文' : '顯示中文';
  $('dlg-mode').textContent = mode === 'read' ? '打亂順序' : '回到朗讀';
  $('dlg-play').classList.toggle('hidden', mode !== 'read');
  $('dlg-hint').textContent = mode === 'read'
    ? '點氣泡裡的 🔊 聽單句，或用上面的整段朗讀。'
    : '照對話順序點下面的句子。單句看得懂，不代表接得上話。';

  if (mode === 'read') renderRead(); else renderShuffle();
}

function renderRead() {
  $('dlg-pool').classList.add('hidden');
  $('dlg-result').textContent = '';
  $('dlg-body').innerHTML = cur.lines.map((l, i) => `
    <div class="dlg-row ${l.speaker === 'B' ? 'b' : 'a'}">
      <div class="dlg-bubble">
        <div class="dlg-who">${esc(l.speaker)}</div>
        <div class="dlg-ko">${esc(l.item.ko)}
          <button data-say="${i}" title="朗讀">🔊</button></div>
        ${l.item.romanization ? `<div class="dlg-roman">${esc(l.item.romanization)}</div>` : ''}
        ${showZh ? `<div class="dlg-zh">${esc(l.item.zh)}</div>` : ''}
        ${l.grammar ? `<div class="dlg-gram">${esc(l.grammar)}</div>` : ''}
      </div>
    </div>`).join('');
  qsa('[data-say]', $('dlg-body')).forEach((b) => {
    b.onclick = () => {
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
      <div class="s ${cls}" data-slot="${i}">${p ? esc(p.item.ko) : '　'}</div>
    </div>`;
  }).join('');

  $('dlg-pool').classList.remove('hidden');
  $('dlg-pool').innerHTML = pool.map((l, i) => {
    const used = picked.includes(l);
    return `<button class="dlg-pick${used ? ' used' : ''}" data-pick="${i}"
              ${used ? 'disabled' : ''}>${esc(l.item.ko)}</button>`;
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
  if (playing) { speech.cancel?.(); playing = false; $('dlg-play').textContent = '▶ 整段朗讀'; return; }
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
