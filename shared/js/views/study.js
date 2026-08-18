// =====================================================================
// 學習畫面 —— 只負責把 session 的狀態畫出來、把使用者操作轉給 session
// 佇列與計分邏輯全在 study/session.js，題型渲染全在 study/modes/*
// =====================================================================
import { $, esc, pct, msg } from '../core/dom.js';
import { wordHTML } from '../core/ruby.js';
import { on, EVENTS } from '../core/bus.js';
import { dirLabel, TYPE_LABEL } from '../data/client.js';
import { previewIntervals } from '../core/srs.js';
import { getMode } from '../study/modes/index.js';
import * as content from '../data/content.js';
import * as speech from '../core/speech.js';
import { openEditor } from './editor.js';
import { lessonOutro } from '../core/taxonomy.js';
import { parseLine } from '../core/dialogue.js';
import { hasRuby, rubyHTML, stripRuby } from '../core/ruby.js';
import { lang, lsKey } from '../core/lang.js';

const rubyFromHanja = () => !!lang().rubyFromHanja;

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
const LS_INTRO = () => lsKey('lesson-intro-open');

// 外部注入：回顧清單的狀態查詢與切換。
// 用注入而不是直接 import data 層 —— views 不該自己決定資料怎麼來，
// 而且這樣測試裡可以塞一個假的進來。
let deps = {};

export function setLesson(tag, intro) {
  const box = $('lesson-intro');
  if (!box) return;
  box.classList.toggle('hidden', !intro);
  if (!intro) return;
  $('lesson-title').textContent = tag;
  $('lesson-body').textContent = intro;
  // 預設展開：第一次進來的人要看得到。收起過就一直維持收起。
  box.open = localStorage.getItem(LS_INTRO()) !== '0';
  box.ontoggle = () => localStorage.setItem(LS_INTRO(), box.open ? '1' : '0');
}

export function initStudy({ session: s, getCtx, onQuit: quitCb,
                            inRecallList, onToggleRecall }) {
  deps = { inRecallList, onToggleRecall };
  session = s; onQuit = quitCb;
  Object.assign(els, {
    front: $('c-front'), back: $('c-back'), backText: $('c-back-text'),
    roman: $('c-roman'), pos: $('c-pos'), type: $('c-type'), dir: $('c-dir'),
    example: $('c-example'), exKo: $('c-ex-ko'), exZh: $('c-ex-zh'),
    note: $('c-note'), acc: $('c-acc'), hanja: $('c-hanja'), hanjaRel: $('c-hanja-rel'),
    flag: $('c-flag'),
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

/**
 * 正面文字。有振り仮名標注時走 ruby，否則維持 textContent。
 *
 * ★ 只有「確定帶標注」才走 innerHTML。
 *   rubyHTML() 內部一律 esc()，但把預設留在 textContent 這一側，
 *   意味著沒有標注的詞條完全碰不到 innerHTML —— 少一條路就少一個風險。
 */
const setFront = (text, long) => {
  if (hasRuby(text)) els.front.innerHTML = rubyHTML(text);
  else els.front.textContent = text;
  els.front.classList.toggle('long', stripRuby(text).length > 12 || !!long);
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
  els.dir.textContent = dirLabel()[direction];

  const ko2zh = direction === 'ko2zh';
  // hanja 欄在日文站存的是「ko 的注音版本」（駅[えき]は…）。
  // 有標注就用它當顯示文字 —— 漢字上方標假名，比另起一行寫讀音
  // 更不打斷句子的節奏，而節奏正是日語的重點。
  const koShown = (rubyFromHanja() && hasRuby(item.hanja)) ? item.hanja : item.ko;
  const front = ko2zh ? koShown : item.zh;
  const back = ko2zh ? item.zh : koShown;
  setFront(front, false);
  if (hasRuby(back)) els.backText.innerHTML = rubyHTML(back);
  else els.backText.textContent = back;
  els.backText.classList.toggle('long', stripRuby(back).length > 12);

  els.roman.classList.add('hidden');
  els.pos.textContent = item.pos || '';
  els.pos.classList.toggle('hidden', !item.pos);
  els.example.classList.toggle('hidden', !item.example_ko);
  els.exKo.textContent = item.example_ko || '';
  els.exZh.textContent = item.example_zh || '';
  // 回顧標記：★＝已在清單。狀態由呼叫端提供的集合決定，
  // 不在這裡打 API —— 每翻一張卡就查一次，卡片會等在那裡。
  if (els.flag) {
    const on = deps.inRecallList?.(item.id) ?? false;
    els.flag.textContent = on ? '★' : '☆';
    els.flag.classList.toggle('on', on);
    els.flag.title = on ? '已在回顧清單（點一下移除）' : '加入回顧清單';
    els.flag.onclick = () => deps.onToggleRecall?.(item);
  }
  // ★ 對話行的 note 是「對話 A｜情境｜語法說明」—— 前兩段是給程式歸組用的
  //   中繼資料，不是給學生看的。原本整串直接顯示，於是 188 張句子卡
  //   每一張都印著「對話 A｜刷牙｜」。資料完全正確，畫面在漏內部細節。
  //   情境改成小標籤（那對學生有意義：知道這句用在哪），
  //   說話者代號丟掉（在單卡情境下它沒有意義）。
  const parsed = parseLine(item.note);
  els.note.textContent = parsed ? parsed.grammar : (item.note || '');
  els.note.classList.toggle('hidden', !els.note.textContent);
  els.type.textContent = parsed
    ? `${TYPE_LABEL[item.item_type] || '句子'} · ${parsed.scene}`
    : (TYPE_LABEL[item.item_type] || '單字');
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
      + `<span class="sm-ko">${wordHTML(r)}</span>`
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
  // ★ 這個站把 hanja 欄當注音用，就整個關掉「漢字詞源」這條路。
  //   原本的條件是 rubyFromHanja() && hasRuby(...)，但只要有人在編輯器裡
  //   把純漢字填進注音欄（沒有中括號），hasRuby 就不成立，
  //   於是會拿一段日文去跑韓語的同漢字詞查詢 —— 查得到才奇怪，
  //   而查不到不會報錯，只是那一區永遠空白，沒人知道為什麼。
  //   欄位語意由站台決定，判斷就該在站台層級，不是逐條猜。
  if (rubyFromHanja()) return;

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
      `<span class="rel"><b>${wordHTML(r)}</b> ${esc(r.zh)}</span>`).join('') + '</div>').join('');
  els.hanjaRel.classList.remove('hidden');
}

/**
 * @param remaining 這一批還沒做完的數量。0 表示今天的複習清空了。
 * @param canPractice 有沒有東西可以再多練（決定「再多練一些」顯不顯示）
 *
 * 【為什麼要分輪，而不是一次全部做完】
 *   模擬一個每天學 8 條的學習者：第 82 天要複習 75 條（正確率 85%），
 *   正確率 70% 的話是 87 條。首頁直接顯示「複習 87」，按下去是一輪 87 題 ——
 *   那個數字本身就會讓人今天不想打開。
 *
 * 【為什麼不直接設每日上限】
 *   蓋住 87 只做 20，剩下的不會消失，只會無聲地越積越多，
 *   兩週後變成 200。上限讓數字好看，代價是問題延後爆炸。
 *   所以總數照實顯示，只把「一次要坐下來做多久」切小：
 *   一輪做得完，做完告訴你還剩幾條、要不要接著來。
 *   決定權在學習者，而他看到的是真實的數字。
 */
export function renderDone(stats, free, lesson = '', remaining = 0, canPractice = false) {
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

  // 還有沒做完的就給一顆按鈕，並把真實剩餘量寫在上面。
  // 不寫數字的話（只寫「繼續」）等於把進度藏起來 ——
  // 學習者需要知道還有多遠，才決定得了現在要不要繼續。
  const again = $('btn-again');
  again.textContent = remaining ? `再來一輪（還有 ${remaining} 條）` : '';
  again.classList.toggle('hidden', !remaining);
  // 「再多練一些」：想多學但今天的複習已經做完的人，唯一的正確出口。
  //
  // 它走自由練習 —— 只記錄成績、完全不動排程。
  // 這一點很重要：間隔還沒走完就提前答對，那次回憶的價值本來就比較低，
  // 讓它把下次複習推遠會灌水（跟「連對三次抹掉剛才忘了」是同一類錯）。
  //
  // 藏在詞庫的標籤裡沒有人找得到 —— 而「今天做完了還想再練」正是
  // 最該給出口的時刻，錯過了他就去學新課，或是關掉。
  $('btn-extra').classList.toggle('hidden', !canPractice);

  // 還有剩時「返回」退居次要；清空了就讓「返回」回到主要按鈕
  $('btn-back').classList.toggle('primary', !remaining);
}
