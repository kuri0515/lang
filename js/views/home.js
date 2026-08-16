// 學習首頁：今日統計、連續天數、練習方式、詞庫、弱項
import { $, esc, pct, msg, emptyState, qs, qsa } from '../core/dom.js';
import { on, EVENTS } from '../core/bus.js';
import { DIR_SHORT } from '../data/client.js';
import * as content from '../data/content.js';
import * as progress from '../data/progress.js';
import { MODES, getMode, forcedDirection } from '../study/modes/index.js';

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
  $('mode-pick').addEventListener('change', () => { syncModeUI(); load(); });
  $('dir-pick').addEventListener('change', () => load());
  on(EVENTS.ITEMS_CHANGED, () => load());
  on(EVENTS.PROGRESS_WRITTEN, () => load());
  syncModeUI();
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
    renderStreak(daily, today);

    $('btn-review').disabled = due.length === 0;
    $('btn-review').textContent = due.length ? `開始複習（${due.length}）` : '今日複習已清空 ✓';

    renderDecks(decks);
    renderWeak(weak);
  } catch (e) {
    msg('載入失敗：' + (e.message || e));
  }
}

/**
 * 連續天數：從最近一天往回數，遇到沒學的那天為止。
 * 今天還沒開始不算斷 —— 一早看到「連續 0 天」會讓人洩氣，
 * 但實際上只是還沒開始。
 */
function renderStreak(daily, today) {
  if (!daily?.length) { $('streak').textContent = ''; return; }
  let n = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].n > 0) n++;
    else if (i === daily.length - 1 && today.reviewed === 0) continue;
    else break;
  }
  $('streak').innerHTML = n
    ? `🔥 連續 <b>${n}</b> 天${today.reviewed ? '' : ' · 今天還沒開始'}`
    : '今天是新的開始 👋';
}

async function renderDecks(decks) {
  if (!decks.length) {
    $('deck-list').innerHTML = emptyState('📦', '還沒有詞庫<br>到「我的 → 批次匯入」貼上你的詞表');
    return;
  }
  const counts = await Promise.all(decks.map((d) => content.countItems(d.id).catch(() => 0)));
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
