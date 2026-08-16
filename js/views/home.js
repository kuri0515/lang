// 學習首頁：今日統計、連續天數、練習方式、詞庫、弱項
import { $, esc, pct, msg, emptyState, qs, qsa } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { DIR_SHORT } from '../data/client.js';
import * as content from '../data/content.js';
import * as progress from '../data/progress.js';
import { MODES, getMode, forcedDirection } from '../study/modes/index.js';
import { computeStreak } from '../core/stats.js';

let deps = null;      // { user, profile, onReview, onFree, onNewDeck, onDrillWeak }
let weakIds = [];

export const studyMode = () => qs('#mode-pick input:checked')?.value || 'flip';
export const selectedDir = () => qs('#dir-pick input:checked')?.value || 'ko2zh';
export const effectiveDir = () => forcedDirection(studyMode()) || selectedDir();

/** 題型綁定方向時鎖住方向選擇器，避免出現「看中文卻要選中文」的矛盾組合 */
export function syncModeUI() {
  const m = getMode(studyMode());
  $('mode-hint').textContent = m.hint || '';
  $('opt-summary').textContent = `${m.label} · ${DIR_SHORT[effectiveDir()]}`;
  qsa('#dir-pick input').forEach((i) => {
    i.disabled = !!m.direction;
    if (m.direction) i.checked = i.value === m.direction;
  });
  $('dir-pick').style.opacity = m.direction ? '.5' : '1';
}

export function initHome(d) {
  deps = d;
  $('btn-review').onclick = () => deps.onReview();
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
    const [decks, due, today, overall, weak, daily] = await Promise.all([
      content.listDecks(),
      progress.fetchDue(user.id, dirs, 500),
      progress.todayStats(user.id),
      progress.overallStats(user.id),
      progress.weakItems(user.id, 8).catch(() => []),
      progress.dailyStats(user.id, 30).catch(() => []),
    ]);

    $('s-due').textContent = due.length;
    $('s-done').textContent = today.reviewed;
    $('s-acc').textContent = pct(today.accuracy);
    $('s-all-acc').textContent = pct(overall.accuracy);
    renderStreak(daily);

    $('btn-review').disabled = due.length === 0;
    $('btn-review').textContent = due.length ? `開始複習（${due.length}）` : '今日複習已清空 ✓';

    renderDecks(decks);
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

function renderWeak(weak) {
  weakIds = [...new Set(weak.map((w) => w.item_id))];
  $('btn-drill-weak').classList.toggle('hidden', !weakIds.length);
  $('weak-list').innerHTML = weak.length
    ? weak.map((w) => {
        const a = w.accuracy == null ? null : Number(w.accuracy);
        const cls = a == null ? '' : a < 0.5 ? 'low' : a < 0.8 ? 'mid' : '';
        return `<div class="weak-row">
          <div>${esc(w.ko)} <span class="muted">${esc(w.zh)}</span>
            <span class="muted">· ${DIR_SHORT[w.direction]}</span></div>
          <div class="pct ${cls}">${pct(a)} <span class="muted">(${w.total_reviews})</span></div>
        </div>`;
      }).join('')
    : emptyState('🎯', '同一條答滿 3 次後<br>這裡會列出最需要加強的');
}
