// =====================================================================
// 學習畫面 —— 只負責把 session 的狀態畫出來、把使用者操作轉給 session
// 佇列與計分邏輯全在 study/session.js，題型渲染全在 study/modes/*
// =====================================================================
import { $, esc, pct, msg } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { DIR_LABEL, TYPE_LABEL } from '../data/client.js';
import { previewIntervals } from '../core/srs.js';
import { getMode } from '../study/modes/index.js';
import * as content from '../data/content.js';
import * as speech from '../core/speech.js';
import { openEditor } from './editor.js';
import { lessonOutro } from '../core/taxonomy.js';

const els = {};
let session = null;
let ctx = null;          // { pool, isAdmin, modeId }
let active = null;       // 目前題型的 mount 回傳值
let onQuit = null;

/**
 * 課程導言。整堂課常駐 —— 練到一半想回頭確認規則是常態，
 * 用 toast 就等於看一眼之後再也找不到。
 * 這裡只負責顯示，內容與判準都在 core/taxonomy.js。
 *
 * 【專注模式：不另外做一個設定開關】
 *   有人要說明，有人只想直接背單字，不該逼任何一方遷就另一方。
 *   但「收起」這個動作本身就是偏好 —— 記住它就夠了，
 *   再開一個設定項只是把同一件事說兩遍。
 *   收起後仍留課名與「看說明」，隨時點得開，不會變成找不到的功能。
 */
const LS_INTRO = 'lesson-intro-open';

export function setLesson(tag, intro) {
  const box = $('lesson-intro');
  if (!box) return;
  box.classList.toggle('hidden', !intro);
  if (!intro) return;
  $('lesson-title').textContent = tag;
  $('lesson-body').textContent = intro;
  // 預設展開：第一次進來的人要看得到。收起過就一直維持收起。
  box.open = localStorage.getItem(LS_INTRO) !== '0';
  box.ontoggle = () => localStorage.setItem(LS_INTRO, box.open ? '1' : '0');
}

export function initStudy({ session: s, getCtx, onQuit: quitCb }) {
  session = s; onQuit = quitCb;
  Object.assign(els, {
    front: $('c-front'), back: $('c-back'), backText: $('c-back-text'),
    roman: $('c-roman'), pos: $('c-pos'), type: $('c-type'), dir: $('c-dir'),
    example: $('c-example'), exKo: $('c-ex-ko'), exZh: $('c-ex-zh'),
    note: $('c-note'), acc: $('c-acc'), hanja: $('c-hanja'), hanjaRel: $('c-hanja-rel'),
    same: $('c-same'),
    listen: $('c-listen'), listenSlow: $('c-listen-slow'), listenBox: $('listen-box'),
    choices: $('choices'), grade: $('grade'),
    scramble: $('scramble'), sAnswer: $('s-answer'), sPool: $('s-pool'), sResult: $('s-result'),
    show: $('btn-show'), prog: $('prog'), pos_: $('pos-label'),
  });

  $('btn-show').onclick = reveal;
  $('btn-speak').onclick = () => {
    const e = session.state().entry;
    if (e) speech.speak(e.item.ko, e.item.audio_url);
  };
  $('btn-edit-card').onclick = () => {
    const e = session.state().entry;
    if (e) openEditor(e.item);
  };
  $('grade').querySelectorAll('button').forEach((b) => {
    b.onclick = () => session.grade(Number(b.dataset.r));
  });
  $('btn-prev').onclick = () => session.go(-1);
  $('btn-next').onclick = () => session.go(1);
  $('btn-undo').onclick = () => session.undo();
  $('btn-quit').onclick = () => { session.quit(); onQuit?.(); };

  document.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', () => session.flushNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') session.flushNow();
  });

  // 條目被編輯 → 同步進佇列並重畫。本畫面不認識編輯器，只訂閱事件。
  on(EVENTS.ITEM_UPDATED, (saved) => session.syncItem(saved));

  ctx = getCtx;
}

function onKey(e) {
  if ($('view-study').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === 'Escape') { session.quit(); onQuit?.(); return; }
  if (e.code === 'ArrowLeft')  { e.preventDefault(); session.go(-1); return; }
  if (e.code === 'ArrowRight') { e.preventDefault(); session.go(1); return; }
  if (e.code === 'Space') { e.preventDefault(); reveal(); return; }

  const k = e.key.toLowerCase();
  if (k === 'u') { session.undo(); return; }
  // 題型先攔（選擇題的 1-4 是選項），沒攔就當評分
  if (active?.onKey?.(e.key)) return;
  if (k === 's') { const en = session.state().entry; if (en) speech.speak(en.item.ko, en.item.audio_url); return; }
  if (['1', '2', '3', '4'].includes(e.key) && !els.grade.classList.contains('hidden')) {
    session.grade(Number(e.key));
  }
}

const setFront = (text, long) => {
  els.front.textContent = text;
  els.front.classList.toggle('long', !!long);
};

/** session 狀態變了就重畫 */
export function render(state) {
  const { entry, idx, total, isGraded, canUndo, canPrev, canNext } = state;
  if (!entry) return;
  const { item, direction, card } = entry;
  const c = ctx();

  active?.teardown?.();
  active = null;
  hanjaToken++;      // 讓上一張卡還在飛的漢字查詢作廢
  sameToken++;       // 同義詞查詢同理，否則舊結果會畫到新卡上

  // ---- 靜態內容 ----
  els.prog.style.width = `${(idx / total) * 100}%`;
  els.pos_.textContent = `${idx + 1} / ${total}`;
  els.dir.textContent = DIR_LABEL[direction];
  els.type.textContent = TYPE_LABEL[item.item_type] || '單字';

  const ko2zh = direction === 'ko2zh';
  const front = ko2zh ? item.ko : item.zh;
  const back = ko2zh ? item.zh : item.ko;
  setFront(front, front.length > 12);
  els.backText.textContent = back;
  els.backText.classList.toggle('long', back.length > 12);

  els.roman.classList.add('hidden');
  els.pos.textContent = item.pos || '';
  els.pos.classList.toggle('hidden', !item.pos);
  els.example.classList.toggle('hidden', !item.example_ko);
  els.exKo.textContent = item.example_ko || '';
  els.exZh.textContent = item.example_zh || '';
  els.note.textContent = item.note || '';
  els.note.classList.toggle('hidden', !item.note);
  els.hanja.classList.add('hidden');
  els.hanjaRel.classList.add('hidden');
  els.same.classList.add('hidden');

  const tot = card?.total_reviews ?? 0;
  els.acc.textContent = tot ? `過往正確率 ${pct(card.correct_reviews / tot)}（${tot} 次）` : '';
  els.acc.classList.toggle('hidden', !tot);

  const p = previewIntervals(card || {});
  [1, 2, 3, 4].forEach((r) => { $('p' + r).textContent = p[r]; });

  // ---- 作答介面：交給題型 ----
  els.back.classList.add('hidden');
  els.grade.classList.add('hidden');
  els.choices.classList.add('hidden');
  els.scramble.classList.add('hidden');
  els.listenBox.classList.add('hidden');
  els.show.classList.add('hidden');

  const mode = getMode(c.modeId);
  if (isGraded) {
    reveal();                       // 回看：攤開答案，不給作答介面
  } else if (mode.mount && mode.canUse(item, c)) {
    active = mode.mount({
      item, direction, els, pool: c.pool,
      reveal, grade: (r) => session.grade(r), setFront,
    });
  } else {
    els.show.classList.remove('hidden');
  }

  showPeekNote(isGraded);
  $('btn-undo').disabled = !canUndo;
  $('btn-prev').disabled = !canPrev;
  $('btn-next').disabled = !canNext;
  $('btn-edit-card').classList.toggle('hidden', !c.isAdmin);

  session.markShown();
}

function showPeekNote(on_) {
  let note = $('peek-note');
  if (on_ && !note) {
    note = document.createElement('div');
    note.id = 'peek-note';
    note.className = 'peek-note';
    note.textContent = '這一題已作答，回看不再計分';
    els.grade.after(note);
  }
  note?.classList.toggle('hidden', !on_);
}

export function reveal() {
  if (!els.back.classList.contains('hidden')) return;
  const entry = session.state().entry;
  if (!entry) return;
  const { item, direction } = entry;

  els.back.classList.remove('hidden');
  els.show.classList.add('hidden');
  els.grade.classList.remove('hidden');

  // 羅馬音揭曉後才顯示，且貼在韓文那一面 —— 提前顯示會劇透「中→韓」
  if (item.romanization) {
    els.roman.textContent = item.romanization;
    els.roman.classList.remove('hidden');
    (direction === 'ko2zh' ? els.front : els.backText).after(els.roman);
  }
  showHanja(item);
  showSameMeaning(item);
}

/**
 * 中文意思相同的其他韓文詞。揭曉後才顯示，理由同漢字：提前顯示等於送分。
 *
 * 解決的是一個會讓人白白扣分的情況 ——「中→韓」看到「謝謝」想出 고맙습니다，
 * 卡片答案是 감사합니다，學生會把答對記成答錯。
 *
 * 措辭刻意用「中文相同的還有」而不是「這樣答也對」：
 * 일 和 하나 中文都是「一」，但漢字數詞與固有數詞不能互換，
 * 說「也對」是教錯的。所以只陳述事實，並把每個詞自己的 note 一起帶出來 ——
 * 那裡正好寫著該學的辨析（謙稱 vs 半語、漢字數詞 vs 固有數詞）。
 */
let sameToken = 0;

async function showSameMeaning(item) {
  const token = ++sameToken;
  const rel = await content.sameMeaning(item.zh, item.id).catch(() => []);
  if (token !== sameToken || !rel.length) return;   // 已翻頁就丟棄

  els.same.innerHTML = '<div class="sm-title">中文相同的還有</div>'
    + rel.map((r) => '<div class="sm-row">'
      + `<span class="sm-ko">${esc(r.ko)}</span>`
      + (r.romanization ? `<span class="sm-roman">${esc(r.romanization)}</span>` : '')
      + (r.note ? `<span class="sm-note">${esc(r.note)}</span>` : '')
      + '</div>').join('');
  els.same.classList.remove('hidden');
}

/**
 * 漢字詞與同源詞群：揭曉後才顯示。
 * 提前顯示等於送分 —— 看到「學校」誰都猜得出是 학교。
 *
 * 兩個要點：
 *   1. 多個漢字並行查詢。原本 for-await 是串列的，
 *      4 個漢字就是 4 趟往返，慢到來不及在使用者翻頁前顯示。
 *   2. 用 token 擋競態。查詢還沒回來時使用者可能已經翻到下一張，
 *      舊回應若照樣寫入，會把上一個詞的同源詞畫到新卡上。
 */
let hanjaToken = 0;

async function showHanja(item) {
  const token = ++hanjaToken;
  if (!item.hanja) return;

  els.hanja.innerHTML = `漢字 <b>${esc(item.hanja)}</b>`;
  els.hanja.classList.remove('hidden');

  const chars = [...item.hanja].filter((ch) => ch >= '一' && ch <= '鿿');
  if (!chars.length) return;

  const results = await Promise.all(
    chars.map((ch) => content.sharesHanja(ch, item.id, 5).catch(() => [])));
  if (token !== hanjaToken) return;      // 已經翻頁了，丟棄這批結果

  const seen = new Set();
  const groups = [];
  chars.forEach((ch, i) => {
    const fresh = results[i].filter((r) => !seen.has(r.id));
    fresh.forEach((r) => seen.add(r.id));
    if (fresh.length) groups.push({ ch, rel: fresh });
  });
  if (!groups.length) return;

  els.hanjaRel.innerHTML = groups.map((g) =>
    `<div><b>${esc(g.ch)}</b> — ` + g.rel.map((r) =>
      `<span class="rel"><b>${esc(r.ko)}</b> ${esc(r.zh)}</span>`).join('') + '</div>').join('');
  els.hanjaRel.classList.remove('hidden');
}

export function renderDone(stats, free, lesson = '') {
  $('done-text').textContent = stats.n
    ? `本輪答了 ${stats.n} 題，正確率 ${pct(stats.correct / stats.n)}。`
      + (free ? '（自由練習：已記錄成績，複習排程未變動）' : '')
    : '本輪沒有作答。';

  // 課程收尾話。刻意不是每課都有 —— 每課都給等於每句都不算數。
  // 沒作答就不說，那句話會變成對著空氣講。
  const outro = stats.n ? lessonOutro(lesson, stats.correct / stats.n) : '';
  const el = $('done-outro');
  el.textContent = outro;
  el.classList.toggle('hidden', !outro);
}
