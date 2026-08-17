// 學習首頁：今日統計、連續天數、練習方式、詞庫、弱項
import { $, esc, pct, msg, emptyState, qs, qsa } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { dirShort } from '../data/client.js';
import * as content from '../data/content.js';
import { pronOrder, nextLesson, LESSON_DONE,
         lifeScenes, pickScene } from '../core/taxonomy.js';
import * as progress from '../data/progress.js';
import { MODES, getMode, forcedDirection } from '../study/modes/index.js';
import { computeStreak } from '../core/stats.js';

let deps = null;      // { user, profile, onReview, onFree, onNewDeck, onDrillWeak }
let weakIds = [];
let primaryAction = null;
let firstDeckId = null;

export const studyMode = () => qs('#mode-pick input:checked')?.value || 'flip';
export const selectedDir = () => qs('#dir-pick input:checked')?.value || 'ko2zh';
export const effectiveDir = () => forcedDirection(studyMode()) || selectedDir();

/** 題型綁定方向時鎖住方向選擇器，避免出現「看中文卻要選中文」的矛盾組合 */
export function syncModeUI() {
  const m = getMode(studyMode());
  $('mode-hint').textContent = m.hint || '';
  $('opt-summary').textContent = `${m.label} · ${dirShort()[effectiveDir()]}`;
  qsa('#dir-pick input').forEach((i) => {
    i.disabled = !!m.direction;
    if (m.direction) i.checked = i.value === m.direction;
  });
  $('dir-pick').style.opacity = m.direction ? '.5' : '1';
}

export function initHome(d) {
  deps = d;
  $('btn-review').onclick = () => deps.onReview();
  $('btn-primary').onclick = () => primaryAction?.();
  $('btn-free').onclick = () => deps.onFree();
  $('btn-drill-weak').onclick = () => {
    if (!weakIds.length) return msg('還沒有足夠的資料判斷弱項');
    deps.onDrillWeak(weakIds);
  };
  // 改題型／方向只影響「待複習」數 —— 統計、詞庫、弱項與方向無關，
  // 全量重載會打 6+N 個查詢，切個選項就卡一下。
  $('mode-pick').addEventListener('change', () => { syncModeUI(); refreshDue(); });
  $('dir-pick').addEventListener('change', () => { syncModeUI(); refreshDue(); });
  on(EVENTS.ITEMS_CHANGED, () => { deckCounts = null; load(); });
  on(EVENTS.PROGRESS_WRITTEN, () => load());
  syncModeUI();
}

/** 只更新「待複習」——方向改變時走這裡 */
export async function refreshDue() {
  const user = deps?.user();
  if (!user) return;
  try {
    const due = await progress.fetchDue(user.id, [effectiveDir()], 500);
    $('s-due').textContent = due.length;
    $('btn-review').disabled = due.length === 0;
    $('btn-review').textContent = due.length ? `開始複習（${due.length}）` : '今日複習已清空 ✓';
  } catch (e) { msg('載入失敗：' + (e.message || e)); }
}

export async function load() {
  const user = deps?.user();
  if (!user) return;
  try {
    const dirs = [effectiveDir()];
    // 詞庫先取 —— 生活場景的進度必須限定在 life-01 之內。
    // 生活、學習這些標籤 vocab-01 也在用，不限定的話進度會被灌水，
    // 場景永遠做不完。
    const decks = await content.listDecks();
    const lifeDeck = decks.find((d) => d.slug === 'life-01')?.id ?? null;

    const [due, today, overall, weak, daily, pron, life] = await Promise.all([
      progress.fetchDue(user.id, dirs, 500),
      progress.todayStats(user.id),
      progress.overallStats(user.id),
      progress.weakItems(user.id, 8).catch(() => []),
      progress.dailyStats(user.id, 30).catch(() => []),
      // 發音課程進度失敗不該拖垮整個首頁 —— 它是加值資訊，不是主線
      content.pronProgress(user.id, pronOrder()).catch(() => []),
      lifeDeck ? content.tagProgress(user.id, lifeScenes(), lifeDeck).catch(() => [])
               : Promise.resolve([]),
    ]);

    $('s-due').textContent = due.length;
    $('s-done').textContent = today.reviewed;
    $('s-acc').textContent = pct(today.accuracy);
    $('s-all-acc').textContent = overall.mastered;
    renderStreak(daily);

    $('btn-review').disabled = due.length === 0;
    $('btn-review').textContent = due.length ? `複習 ${due.length}` : '複習已清空';

    renderSuggestion(due.length, today, decks);

    renderDecks(decks);
    renderPron(pron);
    renderLife(life);
    renderWeak(weak);
  } catch (e) {
    msg('載入失敗：' + (e.message || e));
  }
}

function renderStreak(daily) {
  const { days, startedToday } = computeStreak(daily);
  $('streak').innerHTML = days
    ? `🔥 連續 <b>${days}</b> 天${startedToday ? '' : ' · 今天還沒開始'}`
    : '今天是新的開始 👋';
}

let deckCounts = null;

/**
 * 下一步建議 —— 首頁最該回答的是「現在做什麼」。
 *
 * 原本只有一顆「開始複習」，待複習歸零時就變灰，然後沒有下文 ——
 * 使用者得自己想到去詞庫按「學新的」。這裡把當下最該做的那件事
 * 直接放進主按鈕。
 */
function renderSuggestion(dueCount, today, decks) {
  const box = $('suggest');
  const btn = $('btn-primary');
  box.classList.remove('done');
  firstDeckId = decks[0]?.id ?? null;

  if (dueCount > 0) {
    box.innerHTML = `今天有 <b>${dueCount}</b> 個詞到期，先把複習做完最划算 ——
      間隔重複的效果全靠準時複習。`;
    btn.textContent = `開始複習（${dueCount}）`;
    btn.disabled = false;
    primaryAction = () => deps.onReview();
    return;
  }

  if (firstDeckId) {
    box.classList.add('done');
    box.innerHTML = today.reviewed
      ? `✓ 今日複習已清空，答了 <b>${today.reviewed}</b> 題。想再前進就學幾個新詞。`
      : '✓ 今天沒有到期的複習。要不要學幾個新詞？';
    btn.textContent = '學新的詞';
    btn.disabled = false;
    primaryAction = () => deps.onNewDeck(firstDeckId);
    return;
  }

  box.innerHTML = '還沒有詞庫。到「我的 → 批次匯入」貼上你的詞表。';
  btn.textContent = '沒有可學的內容';
  btn.disabled = true;
  primaryAction = null;
}

async function renderDecks(decks) {
  if (!decks.length) {
    $('deck-list').innerHTML = emptyState('📦', '還沒有詞庫<br>到「我的 → 批次匯入」貼上你的詞表');
    return;
  }
  // 條目數只在內容變動時才會變，沒必要每次進首頁都打 N 個查詢
  if (!deckCounts) {
    deckCounts = Object.fromEntries(await Promise.all(
      decks.map(async (d) => [d.id, await content.countItems(d.id).catch(() => 0)])));
  }
  const counts = decks.map((d) => deckCounts[d.id] ?? 0);
  $('deck-list').innerHTML = decks.map((d, i) => `
    <div class="deck-row">
      <div>
        <h3>${esc(d.title)}${d.title_ko ? ` <span class="muted">${esc(d.title_ko)}</span>` : ''}</h3>
        <p>${counts[i]} 條${d.level ? ` · ${esc(d.level)}` : ''}</p>
      </div>
      <button class="primary small" data-deck="${d.id}">學新的</button>
    </div>`).join('');
  qsa('[data-deck]', $('deck-list')).forEach((b) => {
    b.onclick = () => deps.onNewDeck(b.dataset.deck);
  });
}

/**
 * 發音課程。
 *
 * 【只指一件事：下一課】
 *   25 課全攤在眼前，自學者的反應是不知從何下手，然後跳過。
 *   所以主視覺只給一課，完整清單收在 details 裡按需展開。
 *
 * 【「下一課」怎麼定義】
 *   不是「第一個沒碰過的」，而是「第一個沒掌握牢的」——
 *   碰過兩條就跳下一課，等於一路夾生。掌握門檻取 80%：
 *   要求 100% 會讓人卡在某一課出不去（有幾條特別難是常態），
 *   低於 80% 又太鬆。全部達標就恭喜，不硬塞下一件事。
 */
function renderPron(rows) {
  const { next, done: doneCount, total, ordered } = nextLesson(rows);
  $('pron-count').textContent = total;
  if (!total) {
    $('pron-card').classList.add('hidden');
    return;
  }
  const rate = (r) => r.mastered / r.total;

  $('pron-next').innerHTML = next
    ? `<div class="pron-next">
         <div class="n-body">
           <div class="n-label">下一課 ${doneCount + 1} / ${total}</div>
           <div class="n-title">${esc(next.tag)}</div>
           <div class="n-sub">${next.total} 條 · 已掌握 ${next.mastered}</div>
         </div>
         <button class="primary small" data-pron="${esc(next.tag)}">開始</button>
       </div>`
    : `<div class="pron-next"><div class="n-body">
         <div class="n-title">🎉 發音課程全部達標</div>
         <div class="n-sub">${total} 課都掌握了八成以上</div>
       </div></div>`;

  $('pron-list').innerHTML = ordered.map((r) => {
    const p = Math.round(rate(r) * 100);
    return `<div class="pron-row${rate(r) >= LESSON_DONE ? ' done' : ''}">
      <span class="p-name">${esc(r.tag)}</span>
      <span class="p-bar"><i style="width:${p}%"></i></span>
      <span class="p-num">${r.mastered}/${r.total}</span>
      <button data-pron="${esc(r.tag)}">學</button>
    </div>`;
  }).join('');

  qsa('[data-pron]').forEach((b) => {
    b.onclick = () => deps.onStudyTag(b.dataset.pron);
  });
}

/**
 * 生活 · 興趣模組的場景。
 *
 * ★ 措辭刻意與發音課程區分：那邊是「下一課」，這邊是「挑一個」。
 *   發音有前後依賴，跳著學會夾生；生活場景沒有依賴，
 *   今天想學咖啡廳就該能直接學。硬套課程那套順序，
 *   等於把興趣驅動的東西變成作業。所以不鎖、不排名次，全部可點。
 */
function renderLife(scenes) {
  const card = $('life-card');
  if (!scenes.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const { scene, reason } = pickScene(scenes);
  const TEXT = {
    continue: '接著把這個收完',
    start: '要不要從這裡開始？',
    done: '',
  };
  $('life-pick').innerHTML = scene
    ? `<div class="pron-next">
         <div class="n-body">
           <div class="n-label">${esc(TEXT[reason])}</div>
           <div class="n-title">${esc(scene.label)}</div>
           <div class="n-sub">${esc(scene.hint)} · ${scene.mastered}/${scene.total}</div>
         </div>
         <button class="primary small" data-scene="${esc(scene.key)}">開始</button>
       </div>`
    : `<div class="pron-next"><div class="n-body">
         <div class="n-title">🌱 這個模組都掌握了</div>
         <div class="n-sub">想複習的話，下面任何一個場景都可以再點</div>
       </div></div>`;

  $('life-list').innerHTML = scenes.map((s) => {
    const p = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
    return `<div class="pron-row${p >= LESSON_DONE * 100 ? ' done' : ''}">
      <span class="p-name">${esc(s.label)}</span>
      <span class="p-bar"><i style="width:${p}%"></i></span>
      <span class="p-num">${s.mastered}/${s.total}</span>
      <button data-scene="${esc(s.key)}">學</button>
    </div>`;
  }).join('');

  qsa('[data-scene]').forEach((b) => {
    const s = scenes.find((x) => x.key === b.dataset.scene);
    b.onclick = () => deps.onStudyScene(s);
  });
}

function renderWeak(weak) {
  weakIds = [...new Set(weak.map((w) => w.item_id))];
  $('btn-drill-weak').classList.toggle('hidden', !weakIds.length);
  $('weak-list').innerHTML = weak.length
    ? weak.map((w) => {
        const a = w.accuracy == null ? null : Number(w.accuracy);
        const cls = a == null ? '' : a < 0.5 ? 'low' : a < 0.8 ? 'mid' : '';
        return `<div class="weak-row">
          <div>${esc(w.ko)} <span class="muted">${esc(w.zh)}</span>
            <span class="muted">· ${dirShort()[w.direction]}</span></div>
          <div class="pct ${cls}">${pct(a)} <span class="muted">(${w.total_reviews})</span></div>
        </div>`;
      }).join('')
    : emptyState('🎯', '同一條答滿 3 次後<br>這裡會列出最需要加強的');
}
