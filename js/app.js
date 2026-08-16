// =====================================================================
// UI 編排層 —— 只負責視圖切換與事件；演算法在 srs.js，資料在 db.js
// =====================================================================
import * as db from './db.js';
import { auth, myProfile, DIR_LABEL } from './db.js';
import { schedule, previewIntervals, RATING } from './srs.js';
import * as speech from './speech.js';

const $ = (id) => document.getElementById(id);
const views = ['view-auth', 'view-home', 'view-study', 'view-done', 'view-browse'];

const TYPE_LABEL = { word: '單字', phrase: '詞組', sentence: '句子' };

let user = null;
let queue = [];   // [{ item, direction, card|null }]
let idx = 0;
let shownAt = 0;
let sessionStats = { n: 0, correct: 0 };
let isSignUp = false;
let profile = null;
let pool = [];          // 選擇題干擾項來源
let answered = false;   // 選擇題本題是否已作答
const graded = new Set();   // 已作答過的佇列位置（← 回看時不可重複計分）

const studyMode = () =>
  document.querySelector('#mode-pick input:checked')?.value || 'flip';

// ---------------------------------------------------------------------
function show(view) { views.forEach((v) => $(v).classList.toggle('hidden', v !== view)); }
function msg(text, kind = 'err') {
  $('msg').innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
  if (text) setTimeout(() => { $('msg').innerHTML = ''; }, 6000);
}
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

// ★ 方向是單選：一輪只練一個方向。
//   「看韓文想中文」和「看中文想韓文」交替出現會讓人一直切換思考模式，
//   兩邊都練不專。要練另一個方向就換一輪。
function selectedDir() {
  return document.querySelector('#dir-pick input:checked')?.value || 'ko2zh';
}
function selectedDirs() { return [selectedDir()]; }

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
$('btn-toggle').onclick = () => {
  isSignUp = !isSignUp;
  $('auth-title').textContent = isSignUp ? '註冊' : '登入';
  $('btn-submit').textContent = isSignUp ? '註冊' : '登入';
  $('btn-toggle').textContent = isSignUp ? '已有帳號？登入' : '還沒有帳號？註冊';
  $('row-name').classList.toggle('hidden', !isSignUp);
};

$('btn-submit').onclick = async () => {
  const username = $('f-email').value.trim();
  const pass = $('f-pass').value;
  if (!username || !pass) return msg('請填寫帳號名與密碼');
  $('btn-submit').disabled = true;
  try {
    const { data, error } = isSignUp
      ? await auth.signUp(username, pass, $('f-name').value.trim())
      : await auth.signIn(username, pass);
    if (error) throw error;
    if (isSignUp && !data.session) msg('註冊成功，現在可以直接登入。', 'ok');
  } catch (e) { msg(e.message || String(e)); }
  finally { $('btn-submit').disabled = false; }
};

$('btn-signout').onclick = () => auth.signOut();

// ---------------------------------------------------------------------
// 首頁
// ---------------------------------------------------------------------
async function loadHome() {
  try {
    const dirs = selectedDirs();
    const [decks, due, today, overall, weak, daily] = await Promise.all([
      db.listDecks(),
      db.fetchDue(user.id, dirs, 500),
      db.todayStats(user.id),
      db.overallStats(user.id),
      db.weakItems(user.id, 8).catch(() => []),
      db.dailyStats(user.id, 30).catch(() => []),
    ]);

    $('s-due').textContent = due.length;
    $('s-done').textContent = today.reviewed;
    $('s-acc').textContent = pct(today.accuracy);
    $('s-all-acc').textContent = pct(overall.accuracy);

    $('btn-review').disabled = due.length === 0;
    $('btn-review').textContent = due.length ? `開始複習（${due.length}）` : '今日複習已清空 ✓';

    // 詞庫
    if (!decks.length) {
      $('deck-list').innerHTML =
        '<p class="muted">還沒有詞庫。把詞表放進 <code>raw/</code>，執行 <code>scripts/import_words.py</code> 匯入。</p>';
    } else {
      const counts = await Promise.all(decks.map((d) => db.countItems(d.id).catch(() => 0)));
      $('deck-list').innerHTML = decks.map((d, i) => `
        <div class="deck-row">
          <div>
            <h3>${esc(d.title)}${d.title_ko ? ` <span class="muted">${esc(d.title_ko)}</span>` : ''}</h3>
            <p>${counts[i]} 條${d.level ? ` · ${esc(d.level)}` : ''}</p>
          </div>
          <button class="primary" data-deck="${d.id}">學新的</button>
        </div>`).join('');
      $('deck-list').querySelectorAll('[data-deck]').forEach((b) => {
        b.onclick = () => startNew(b.dataset.deck);
      });
    }

    // 學習曲線
    renderChart(daily);

    // 弱項
    $('weak-list').innerHTML = weak.length
      ? weak.map((w) => {
          const a = w.accuracy == null ? null : Number(w.accuracy);
          const cls = a == null ? '' : a < 0.5 ? 'low' : a < 0.8 ? 'mid' : '';
          return `<div class="weak-row">
            <div>${esc(w.ko)} <span class="muted">${esc(w.zh)}</span>
              <span class="muted">· ${DIR_LABEL[w.direction]}</span></div>
            <div class="pct ${cls}">${pct(a)} <span class="muted">(${w.total_reviews})</span></div>
          </div>`;
        }).join('')
      : '<p class="muted">答滿 3 次後才會出現統計。</p>';
  } catch (e) {
    msg('載入失敗：' + (e.message || e));
  }
}

// 近 30 天答題量柱狀圖：柱高＝答題量，填色高度＝正確比例
function renderChart(daily) {
  if (!daily?.length) { $('chart').innerHTML = ''; return; }
  const max = Math.max(1, ...daily.map((d) => d.n));
  const today = daily[daily.length - 1];
  $('chart').innerHTML = daily.map((d, i) => {
    const h = d.n ? Math.max(6, (d.n / max) * 100) : 3;
    const fill = d.n ? (d.correct / d.n) * 100 : 0;
    const isToday = i === daily.length - 1;
    return `<div class="bar${d.n ? '' : ' empty'}${isToday ? ' today' : ''}"
      style="height:${h}%" title="${d.date}｜${d.n} 題${d.n ? `｜正確率 ${Math.round((d.correct / d.n) * 100)}%` : ''}">
      <i class="fill" style="height:${fill}%"></i></div>`;
  }).join('');

  const total = daily.reduce((s, d) => s + d.n, 0);
  const active = daily.filter((d) => d.n > 0).length;
  const streak = (() => {
    let n = 0;
    for (let i = daily.length - 1; i >= 0; i--) { if (daily[i].n > 0) n++; else break; }
    return n;
  })();
  $('chart-legend').textContent =
    `30 天共 ${total} 題 · 學習 ${active} 天 · 連續 ${streak} 天${today.n ? '' : '（今天還沒開始）'}`;
}

$('dir-pick').addEventListener('change', () => { if (user) loadHome(); });

// ---------------------------------------------------------------------
// 學習流程
// ---------------------------------------------------------------------
$('btn-review').onclick = async () => {
  try {
    const rows = await db.fetchDue(user.id, selectedDirs(), 200);
    if (!rows.length) return msg('沒有待複習的卡片', 'ok');
    queue = shuffle(rows.map((c) => ({ item: c.items, direction: c.direction, card: c })));
    await ensurePool();
    beginSession();
  } catch (e) { msg(e.message || e); }
};

async function startNew(deckId, tag = '') {
  try {
    // 套用每日新卡上限：一次灌太多新詞，隔天的複習量會爆掉
    const limit = profile?.daily_new_limit ?? 20;
    const done = await db.newCardsToday(user.id).catch(() => 0);
    const room = Math.max(0, limit - done);
    if (room === 0) {
      return msg(`今日新卡已達上限（${limit} 張）。先把複習做完，明天再來 👍`, 'ok');
    }

    const rows = await db.fetchNewItems(user.id, deckId, selectedDirs(), room, tag);
    if (!rows.length) return msg(tag ? `「${tag}」這組已經學完了 👍` : '這個詞庫的新內容已經學完了 👍', 'ok');
    if (rows.length < room) msg(`本輪 ${rows.length} 張新卡`, 'ok');
    queue = rows;
    await ensurePool();
    beginSession();
  } catch (e) { msg(e.message || e); }
}

async function ensurePool() {
  if (pool.length) return;
  try { pool = await db.distractorPool(); } catch { pool = []; }
}

function beginSession() {
  flushPending();
  $('btn-undo').disabled = true;
  graded.clear();
  idx = 0;
  sessionStats = { n: 0, correct: 0 };
  show('view-study');
  render();
}

function render() {
  if (idx >= queue.length) return finish();
  const { item, direction, card } = queue[idx];
  const ko2zh = direction === 'ko2zh';

  $('prog').style.width = `${(idx / queue.length) * 100}%`;
  $('c-dir').textContent = DIR_LABEL[direction];
  $('c-type').textContent = TYPE_LABEL[item.item_type] || '單字';

  // 正面 / 背面依方向對調
  const front = ko2zh ? item.ko : item.zh;
  const back = ko2zh ? item.zh : item.ko;
  setText('c-front', front, front.length > 12);
  setText('c-back-text', back, back.length > 12);

  // 羅馬音只在「看中文想韓文」揭曉後、或韓文正面時作為輔助 —— 一律放背面避免劇透
  $('c-roman').classList.add('hidden');

  $('c-pos').textContent = item.pos || '';
  $('c-pos').classList.toggle('hidden', !item.pos);
  $('c-example').classList.toggle('hidden', !item.example_ko);
  $('c-ex-ko').textContent = item.example_ko || '';
  $('c-ex-zh').textContent = item.example_zh || '';
  $('c-note').textContent = item.note || '';
  $('c-note').classList.toggle('hidden', !item.note);

  const tot = card?.total_reviews ?? 0;
  $('c-acc').textContent = tot ? `過往正確率 ${pct(card.correct_reviews / tot)}（${tot} 次）` : '';
  $('c-acc').classList.toggle('hidden', !tot);

  $('c-back').classList.add('hidden');
  $('grade').classList.add('hidden');

  if (studyMode() === 'choice' && pool.length >= 4) {
    $('btn-show').classList.add('hidden');
    $('choices').classList.remove('hidden');
    renderChoices(item, direction);
  } else {
    $('choices').classList.add('hidden');
    $('btn-show').classList.remove('hidden');
  }

  const p = previewIntervals(card || {});
  [1, 2, 3, 4].forEach((r) => { $('p' + r).textContent = p[r]; });

  // 導覽狀態
  $('pos-label').textContent = `${idx + 1} / ${queue.length}`;
  $('btn-prev').disabled = idx === 0;
  $('btn-next').disabled = idx >= queue.length - 1;
  $('btn-edit-card').classList.toggle('hidden', profile?.role !== 'admin');

  // 已作答過 → 鎖住作答，只供回看
  const done = graded.has(idx);
  $('choices').classList.toggle('hidden', done || studyMode() !== 'choice' || pool.length < 4);
  $('btn-show').classList.toggle('hidden', done || (studyMode() === 'choice' && pool.length >= 4));
  let note = $('peek-note');
  if (done) {
    if (!note) {
      note = document.createElement('div');
      note.id = 'peek-note'; note.className = 'peek-note';
      note.textContent = '這一題已作答，回看不再計分';
      $('grade').after(note);
    }
    note.classList.remove('hidden');
  } else if (note) note.classList.add('hidden');

  shownAt = Date.now();
}

// ---------------------------------------------------------------------
// 選擇題：從條目池挑 3 個干擾項
//
// 挑選策略（由嚴到寬）：同標籤 → 同詞性 → 同類型 → 任意。
// 干擾項要「像但不對」才有訓練價值；隨機亂挑會讓人靠排除法猜對，
// 練不到真正的辨義。
// ---------------------------------------------------------------------
function buildChoices(item, direction) {
  const key = direction === 'ko2zh' ? 'zh' : 'ko';
  const answer = item[key];
  const tags = new Set(item.tags || []);

  const score = (o) => {
    let s = 0;
    if ((o.tags || []).some((t) => tags.has(t))) s += 4;
    if (o.pos && o.pos === item.pos) s += 2;
    if (o.item_type === item.item_type) s += 1;
    return s;
  };

  const cands = pool
    .filter((o) => o.id !== item.id && o[key] && o[key] !== answer)
    .map((o) => ({ o, s: score(o) + Math.random() }))   // 加隨機打破同分僵局
    .sort((a, b) => b.s - a.s)
    .map((x) => x.o);

  // 去掉答案文字重複的干擾項（例如兩個「再見」）
  const seen = new Set([answer]);
  const picked = [];
  for (const c of cands) {
    if (seen.has(c[key])) continue;
    seen.add(c[key]);
    picked.push(c[key]);
    if (picked.length === 3) break;
  }
  return shuffle([answer, ...picked]);
}

function renderChoices(item, direction) {
  const key = direction === 'ko2zh' ? 'zh' : 'ko';
  const answer = item[key];
  const opts = buildChoices(item, direction);
  answered = false;

  $('choices').innerHTML = opts.map((t, i) =>
    `<button data-val="${esc(t)}"><span class="idx">${i + 1}</span>${esc(t)}</button>`).join('');
  $('choices').querySelectorAll('button').forEach((b) => {
    b.onclick = () => pickChoice(b, answer);
  });
}

function pickChoice(btn, answer) {
  if (answered) return;
  answered = true;
  const correct = btn.dataset.val === answer;

  $('choices').querySelectorAll('button').forEach((b) => {
    if (b.dataset.val === answer) b.classList.add('right');
    else if (b === btn) b.classList.add('wrong');
    else b.classList.add('dim');
    b.disabled = true;
  });

  reveal();                       // 揭曉例句、羅馬音、備註
  $('grade').classList.add('hidden');   // 選擇題不手動評分

  // 答對→「記得」(3)，答錯→「忘了」(1)。停一下讓人看清答案再翻頁。
  setTimeout(() => grade(correct ? RATING.GOOD : RATING.AGAIN), correct ? 750 : 1900);
}

function setText(id, text, isLong) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('long', !!isLong);
}

function reveal() {
  if (!$('c-back').classList.contains('hidden')) return;
  const { item, direction } = queue[idx];
  $('c-back').classList.remove('hidden');
  // 揭曉後才顯示羅馬音（避免「看中文想韓文」被劇透）
  if (item.romanization) {
    $('c-roman').textContent = item.romanization;
    $('c-roman').classList.remove('hidden');
    // 韓文在哪一面，羅馬音就貼哪一面
    const target = direction === 'ko2zh' ? $('c-front') : $('c-back-text');
    target.after($('c-roman'));
  }
  $('grade').classList.remove('hidden');
  $('btn-show').classList.add('hidden');
}

$('btn-show').onclick = reveal;
$('grade').querySelectorAll('button').forEach((b) => {
  b.onclick = () => grade(Number(b.dataset.r));
});

// ---------------------------------------------------------------------
// 評分 —— 寫入延遲 UNDO_MS，這段時間內可完整撤銷（連記錄都不會產生）
//
// 為什麼要延遲而不是「寫了再刪」：reviews 是只追加的日誌，
// RLS 沒開放 delete。誤點若已寫入就洗不掉，會污染正確率。
// 延遲寫入讓「撤銷」語意上等於「這一題根本沒答過」。
// ---------------------------------------------------------------------
const UNDO_MS = 2500;
let pending = null;   // { timer, payload, snapshot }

function flushPending(immediate = true) {
  if (!pending) return;
  const { timer, payload } = pending;
  clearTimeout(timer);
  pending = null;
  $('btn-undo').disabled = true;
  if (immediate) {
    db.saveReview(payload).catch((e) => msg('儲存失敗：' + (e.message || e)));
  }
}

async function grade(rating) {
  flushPending();                      // 上一題定案，只有最近一題可撤銷

  const entry = queue[idx];
  const next = schedule(entry.card || {}, rating);
  const elapsed = Date.now() - shownAt;

  if (graded.has(idx)) return;    // 回看模式下不重複計分
  graded.add(idx);
  const snapshot = { idx, queueLen: queue.length, stats: { ...sessionStats } };

  sessionStats.n += 1;
  if (rating >= 3) sessionStats.correct += 1;

  idx += 1;
  if (rating === RATING.AGAIN) {
    queue.push({ ...entry, card: { ...(entry.card || {}), ...next } });
  }

  const payload = {
    userId: user.id, item: entry.item, direction: entry.direction,
    prevCard: entry.card, rating, next, elapsedMs: elapsed,
  };
  pending = { payload, snapshot, timer: setTimeout(() => flushPending(true), UNDO_MS) };

  render();
  $('btn-undo').disabled = false;
}

function undo() {
  if (!pending) return;
  const { snapshot } = pending;
  clearTimeout(pending.timer);
  pending = null;

  idx = snapshot.idx;
  graded.delete(idx);
  queue.length = snapshot.queueLen;      // 丟掉 AGAIN 補進佇列的那張
  sessionStats = snapshot.stats;

  $('btn-undo').disabled = true;
  render();
  reveal();                              // 撤銷後直接停在答案面，方便重新評分
  msg('已撤銷，這一題沒有被記錄。', 'ok');
}

$('btn-undo').onclick = undo;

// 離開頁面前把還沒定案的那題寫掉，避免資料遺失
window.addEventListener('pagehide', () => flushPending(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPending(true);
});

// ---------------------------------------------------------------------
// 前後切換：←／→ 純瀏覽，不計分。
// 回看已作答過的卡時直接攤開答案並鎖住評分，
// 避免同一題被記錄兩次污染正確率。
// ---------------------------------------------------------------------
function goto(delta) {
  const target = idx + delta;
  if (target < 0 || target >= queue.length) return;
  flushPending();                  // 換卡前先把待寫的定案
  idx = target;
  render();
  if (graded.has(idx)) reveal();
}

$('btn-prev').onclick = () => goto(-1);
$('btn-next').onclick = () => goto(1);

$('btn-quit').onclick = () => { flushPending(); finish(); };
$('btn-back').onclick = async () => { flushPending(); show('view-home'); await loadHome(); };

function finish() {
  const { n, correct } = sessionStats;
  $('done-text').textContent = n
    ? `本輪答了 ${n} 題，正確率 ${pct(correct / n)}。`
    : '本輪沒有作答。';
  show('view-done');
}

// =====================================================================
// 編輯條目（管理員）—— 就地修改，直接寫雲端，回讀後即時更新畫面
// =====================================================================
let editing = null;   // 正在編輯的條目

function openEditor(item) {
  editing = item;
  $('e-ko').value    = item.ko || '';
  $('e-zh').value    = item.zh || '';
  $('e-roman').value = item.romanization || '';
  $('e-pos').value   = item.pos || '';
  $('e-type').value  = item.item_type || 'word';
  $('e-ex-ko').value = item.example_ko || '';
  $('e-ex-zh').value = item.example_zh || '';
  $('e-note').value  = item.note || '';
  $('e-tags').value  = (item.tags || []).join(', ');
  $('e-msg').textContent = '';
  $('e-msg').className = 'editor-msg';
  $('editor').classList.remove('hidden');
  $('e-ko').focus();
}

function closeEditor() { $('editor').classList.add('hidden'); editing = null; }
$('e-close').onclick = closeEditor;
$('e-cancel').onclick = closeEditor;
$('editor').onclick = (e) => { if (e.target === $('editor')) closeEditor(); };

$('e-save').onclick = async () => {
  if (!editing) return;
  const ko = $('e-ko').value.trim();
  const zh = $('e-zh').value.trim();
  if (!ko || !zh) {
    $('e-msg').textContent = '韓文與中文為必填';
    $('e-msg').className = 'editor-msg err';
    return;
  }

  const patch = {
    ko, zh,
    romanization: $('e-roman').value.trim() || null,
    pos:          $('e-pos').value.trim() || null,
    item_type:    $('e-type').value,
    example_ko:   $('e-ex-ko').value.trim() || null,
    example_zh:   $('e-ex-zh').value.trim() || null,
    note:         $('e-note').value.trim() || null,
    tags: $('e-tags').value.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean),
  };

  $('e-save').disabled = true;
  $('e-msg').textContent = '同步中…';
  $('e-msg').className = 'editor-msg';
  try {
    // updateItem 回傳的是資料庫回讀的那一行 —— 用它更新畫面，
    // 而不是用我們送出去的 patch，才能確定雲端真的存成這樣。
    const saved = await db.updateItem(editing.id, patch);
    syncLocal(saved);
    $('e-msg').textContent = '✓ 已同步到雲端';
    $('e-msg').className = 'editor-msg ok';
    setTimeout(closeEditor, 700);
  } catch (e) {
    $('e-msg').textContent = '儲存失敗：' + (e.message || e);
    $('e-msg').className = 'editor-msg err';
  } finally {
    $('e-save').disabled = false;
  }
};

/** 把雲端回讀的新資料同步進所有記憶體副本，畫面即時反映 */
function syncLocal(saved) {
  for (const e of queue) if (e.item.id === saved.id) Object.assign(e.item, saved);
  const pi = pool.findIndex((x) => x.id === saved.id);
  if (pi >= 0) Object.assign(pool[pi], saved);
  if (!$('view-study').classList.contains('hidden')) render();
  if (!$('view-browse').classList.contains('hidden')) renderBrowse();
}

$('btn-edit-card').onclick = () => {
  const item = queue[idx]?.item;
  if (item) openEditor(item);
};

// ---------------------------------------------------------------------
// 瀏覽詞庫：搜尋 / 標籤篩選 / 朗讀 / 顯示雙向學習狀態
// ---------------------------------------------------------------------
let browseTag = '';
let browseTimer = null;

$('btn-browse').onclick = async () => {
  show('view-browse');
  if (!$('b-tags').children.length) {
    try {
      const tags = await db.listTags();
      $('b-tags').innerHTML =
        `<button class="tag on" data-tag="">全部</button>` +
        tags.map(([t, n]) => `<button class="tag" data-tag="${esc(t)}">${esc(t)} ${n}</button>`).join('');
      $('b-tags').querySelectorAll('.tag').forEach((b) => {
        b.onclick = () => {
          browseTag = b.dataset.tag;
          $('b-tags').querySelectorAll('.tag').forEach((x) => x.classList.toggle('on', x === b));
          renderBrowse();
        };
      });
    } catch (e) { msg(e.message || e); }
  }
  renderBrowse();
};

$('btn-browse-back').onclick = async () => { show('view-home'); await loadHome(); };

$('btn-study-tag').onclick = () => { if (browseTag) startNew(null, browseTag); };

$('b-search').addEventListener('input', () => {
  clearTimeout(browseTimer);
  browseTimer = setTimeout(renderBrowse, 250);   // 防抖，避免每個字都打一次 API
});

const STATE_LABEL = { new: '新', learning: '學習中', review: '複習中', suspended: '暫停' };
const picked = new Set();   // 多選刪除的勾選集合

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
  $('bulk-clear').onclick = () => { picked.clear(); renderBrowse(); };
  $('bulk-del').onclick = bulkDelete;
}

async function bulkDelete() {
  const ids = [...picked];
  // 軟刪除仍是破壞性操作，先確認
  if (!confirm(`確定要下架這 ${ids.length} 條嗎？\n\n它們不會再出現在學習與瀏覽中，`
             + `但資料與你的學習記錄都會保留，之後可以還原。`)) return;
  try {
    const done = await db.setItemsActive(ids, false);
    picked.clear();
    // 回讀筆數核對，不靠斷言
    msg(`已下架 ${done.length} 條${done.length !== ids.length ? `（送出 ${ids.length} 條）` : ''}`, 'ok');
    pool = [];                      // 干擾項池失效，下輪重抓
    await renderBrowse();
  } catch (e) {
    msg('下架失敗：' + (e.message || e));
  }
}

async function renderBrowse() {
  $('b-list').innerHTML = '<p class="muted">載入中…</p>';
  try {
    const rows = await db.browseItems(user.id, { q: $('b-search').value, tag: browseTag });
    $('b-count').textContent = `${rows.length} 條${browseTag ? ` · ${browseTag}` : ''}`;
    $('btn-study-tag').classList.toggle('hidden', !browseTag);
    $('btn-study-tag').textContent = `學「${browseTag}」`;
    if (!rows.length) { $('b-list').innerHTML = '<p class="muted">沒有符合的條目。</p>'; return; }

    $('b-list').innerHTML = rows.map((r) => {
      const badge = (dir, label) => {
        const c = r.cards[dir];
        const cls = c ? c.state : '';
        const acc = c && c.total_reviews
          ? ` ${Math.round((c.correct_reviews / c.total_reviews) * 100)}%` : '';
        return `<span class="dot ${cls}" title="${label}：${c ? STATE_LABEL[c.state] : '未學'}">${label}${acc}</span>`;
      };
      const admin = profile?.role === 'admin';
      return `<div class="b-row" data-id="${r.id}">
        <div class="b-main">
          <div>
            ${admin ? `<input type="checkbox" class="b-check" data-pick="${r.id}">` : ''}
            <span class="b-ko">${esc(r.ko)}</span>
            <span class="muted"> — </span><span class="b-zh">${esc(r.zh)}</span>
          </div>
          <div class="b-badges">
            ${badge('ko2zh', '韓→中')}${badge('zh2ko', '中→韓')}
            <button class="b-speak" data-ko="${esc(r.ko)}" title="朗讀">🔊</button>
            ${admin ? `<button class="b-speak" data-edit="${r.id}" title="編輯">✏️</button>` : ''}
          </div>
        </div>
        <div class="b-sub">${[r.romanization, r.pos, TYPE_LABEL[r.item_type]].filter(Boolean).map(esc).join(' · ')}</div>
        ${r.example_ko ? `<div class="b-ex">${esc(r.example_ko)}<br>${esc(r.example_zh || '')}</div>` : ''}
        ${r.note ? `<div class="b-sub">💡 ${esc(r.note)}</div>` : ''}
      </div>`;
    }).join('');

    $('b-list').querySelectorAll('[data-ko]').forEach((b) => {
      b.onclick = () => speakText(b.dataset.ko);
    });
    $('b-list').querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => openEditor(rows.find((r) => r.id === b.dataset.edit));
    });
    $('b-list').querySelectorAll('[data-pick]').forEach((c) => {
      c.checked = picked.has(c.dataset.pick);
      c.closest('.b-row').classList.toggle('sel', c.checked);
      c.onchange = () => {
        c.checked ? picked.add(c.dataset.pick) : picked.delete(c.dataset.pick);
        c.closest('.b-row').classList.toggle('sel', c.checked);
        renderBulkBar();
      };
    });
    renderBulkBar();
  } catch (e) {
    $('b-list').innerHTML = '';
    msg('載入失敗：' + (e.message || e));
  }
}

// ---------------------------------------------------------------------
// 朗讀：優先用條目自帶音檔，否則瀏覽器 TTS（ko-KR）
// ---------------------------------------------------------------------
$('btn-speak').onclick = () => speak();
function speak() {
  const item = queue[idx]?.item;
  if (item) speech.speak(item.ko, item.audio_url);
}
function speakText(text) { speech.speak(text); }

// ---------------------------------------------------------------------
// 鍵盤：空白鍵揭曉 / 1-4 評分 / S 朗讀
// ---------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if ($('view-study').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'ArrowLeft')  { e.preventDefault(); goto(-1); return; }
  if (e.code === 'ArrowRight') { e.preventDefault(); goto(1); return; }
  if (e.code === 'Space') { e.preventDefault(); reveal(); return; }
  if (e.key.toLowerCase() === 's') { speak(); return; }
  if (e.key.toLowerCase() === 'u') { undo(); return; }
  if (['1', '2', '3', '4'].includes(e.key)) {
    if (!$('choices').classList.contains('hidden')) {
      $('choices').querySelectorAll('button')[Number(e.key) - 1]?.click();
    } else if (!$('grade').classList.contains('hidden')) {
      grade(Number(e.key));
    }
  }
});

// ---------------------------------------------------------------------
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------------
// 朗讀語音設定
// ---------------------------------------------------------------------
function initVoiceUI() {
  speech.onVoicesReady((list) => {
    const sel = $('voice-pick');
    if (!list.length) {
      sel.innerHTML = '<option>（系統沒有韓語語音）</option>';
      sel.disabled = true; $('voice-test').disabled = true;
      return;
    }
    const cur = speech.currentVoice();
    sel.innerHTML = list.map((v, i) =>
      `<option value="${esc(v.name)}"${v.name === cur?.name ? ' selected' : ''}>${esc(v.name)}${i === 0 ? '（推薦）' : ''}</option>`
    ).join('');
    sel.onchange = () => { speech.setVoice(sel.value); speech.speak('안녕하세요'); };
  });

  const r = $('voice-rate');
  r.value = speech.rate();
  $('rate-label').textContent = speech.rate().toFixed(2) + '×';
  r.oninput = () => {
    speech.setRate(Number(r.value));
    $('rate-label').textContent = Number(r.value).toFixed(2) + '×';
  };
  r.onchange = () => speech.speak('한국어를 배우고 있어요');
  $('voice-test').onclick = () => speech.speak('안녕하세요. 만나서 반갑습니다.');
}

// ---------------------------------------------------------------------
// 啟動
// ---------------------------------------------------------------------
async function onUser(u) {
  user = u;
  $('whoami').textContent = u ? auth.displayName(u) : '';
  $('btn-signout').classList.toggle('hidden', !u);
  if (!u) { profile = null; $('admin-tag').classList.add('hidden'); return show('view-auth'); }

  // isAdmin 僅供 UX（顯示徽章 / 未來的後台入口）；真正的寫入邊界是 RLS
  profile = await myProfile(u.id).catch(() => null);
  $('admin-tag').classList.toggle('hidden', profile?.role !== 'admin');

  show('view-home');
  await loadHome();
}

initVoiceUI();
auth.onChange(onUser);
(async () => { await onUser(await auth.user()); })();
