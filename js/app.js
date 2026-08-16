// =====================================================================
// UI 編排層 —— 只負責視圖切換與事件；演算法在 srs.js，資料在 db.js
// =====================================================================
import * as db from './db.js';
import { auth, myProfile, DIR_LABEL } from './db.js';
import { schedule, previewIntervals, RATING } from './srs.js';

const $ = (id) => document.getElementById(id);
const views = ['view-auth', 'view-home', 'view-study', 'view-done'];

const TYPE_LABEL = { word: '單字', phrase: '詞組', sentence: '句子' };

let user = null;
let queue = [];   // [{ item, direction, card|null }]
let idx = 0;
let shownAt = 0;
let sessionStats = { n: 0, correct: 0 };
let isSignUp = false;
let profile = null;

// ---------------------------------------------------------------------
function show(view) { views.forEach((v) => $(v).classList.toggle('hidden', v !== view)); }
function msg(text, kind = 'err') {
  $('msg').innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : '';
  if (text) setTimeout(() => { $('msg').innerHTML = ''; }, 6000);
}
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);

function selectedDirs() {
  const dirs = [...$('dir-pick').querySelectorAll('input:checked')].map((i) => i.value);
  return dirs.length ? dirs : ['ko2zh'];
}

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
    const [decks, due, today, overall, weak] = await Promise.all([
      db.listDecks(),
      db.fetchDue(user.id, dirs, 500),
      db.todayStats(user.id),
      db.overallStats(user.id),
      db.weakItems(user.id, 8).catch(() => []),
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

$('dir-pick').addEventListener('change', () => { if (user) loadHome(); });

// ---------------------------------------------------------------------
// 學習流程
// ---------------------------------------------------------------------
$('btn-review').onclick = async () => {
  try {
    const rows = await db.fetchDue(user.id, selectedDirs(), 200);
    if (!rows.length) return msg('沒有待複習的卡片', 'ok');
    queue = shuffle(rows.map((c) => ({ item: c.items, direction: c.direction, card: c })));
    beginSession();
  } catch (e) { msg(e.message || e); }
};

async function startNew(deckId) {
  try {
    const rows = await db.fetchNewItems(user.id, deckId, selectedDirs(), 20);
    if (!rows.length) return msg('這個詞庫的新內容已經學完了 👍', 'ok');
    queue = rows;
    beginSession();
  } catch (e) { msg(e.message || e); }
}

function beginSession() {
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
  $('btn-show').classList.remove('hidden');

  const p = previewIntervals(card || {});
  [1, 2, 3, 4].forEach((r) => { $('p' + r).textContent = p[r]; });

  shownAt = Date.now();
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

async function grade(rating) {
  const entry = queue[idx];
  const next = schedule(entry.card || {}, rating);
  const elapsed = Date.now() - shownAt;

  sessionStats.n += 1;
  if (rating >= 3) sessionStats.correct += 1;

  // 樂觀推進：先翻下一張，寫庫在背景；失敗再提示
  idx += 1;
  if (rating === RATING.AGAIN) {
    queue.push({ ...entry, card: { ...(entry.card || {}), ...next } });
  }
  render();

  try {
    await db.saveReview({
      userId: user.id, item: entry.item, direction: entry.direction,
      prevCard: entry.card, rating, next, elapsedMs: elapsed,
    });
  } catch (e) { msg('儲存失敗：' + (e.message || e)); }
}

$('btn-quit').onclick = finish;
$('btn-back').onclick = async () => { show('view-home'); await loadHome(); };

function finish() {
  const { n, correct } = sessionStats;
  $('done-text').textContent = n
    ? `本輪答了 ${n} 題，正確率 ${pct(correct / n)}。`
    : '本輪沒有作答。';
  show('view-done');
}

// ---------------------------------------------------------------------
// 朗讀：優先用條目自帶音檔，否則瀏覽器 TTS（ko-KR）
// ---------------------------------------------------------------------
$('btn-speak').onclick = () => speak();
function speak() {
  const item = queue[idx]?.item;
  if (!item) return;
  if (item.audio_url) { new Audio(item.audio_url).play().catch(() => {}); return; }
  if (!('speechSynthesis' in window)) return msg('目前瀏覽器不支援朗讀');
  const u = new SpeechSynthesisUtterance(item.ko);
  u.lang = 'ko-KR';
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------------
// 鍵盤：空白鍵揭曉 / 1-4 評分 / S 朗讀
// ---------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if ($('view-study').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); reveal(); return; }
  if (e.key.toLowerCase() === 's') { speak(); return; }
  if (['1', '2', '3', '4'].includes(e.key) && !$('grade').classList.contains('hidden')) {
    grade(Number(e.key));
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

auth.onChange(onUser);
(async () => { await onUser(await auth.user()); })();
