// 學習記錄：逐筆時間線 + 近 30 天曲線
import { $, esc, msg, skeleton, emptyState, qs } from '../core/dom.js';
import { DIR_SHORT, RATE_LABEL } from '../data/client.js';
import * as progress from '../data/progress.js';
import { summarize } from '../core/stats.js';

let deps = null;
let cursor = null;
let dirFilter = '';

export function initHistory(d) {
  deps = d;
  $('h-more').onclick = () => load(false);
  $('h-filter').addEventListener('change', () => {
    dirFilter = qs('#h-filter input:checked').value;
    load(true);
  });
}

export async function open() {
  const user = deps.user();
  if (!user) return;
  const [daily, mastered] = await Promise.all([
    progress.dailyStats(user.id, 30).catch(() => []),
    progress.masteredItems(user.id, 200).catch(() => []),
  ]);
  renderChart(daily);
  renderMastered(mastered);
  await load(true);
}

/**
 * 已掌握的詞 —— 附上「什麼時候記住的」與「什麼時候開始學的」。
 * 這是使用者最想看到的那條線：從第一次見到，到真的記住，隔了多久。
 */
function renderMastered(rows) {
  $('m-count').textContent = rows.length ? `${rows.length} 條` : '';
  if (!rows.length) {
    $('m-list').innerHTML = emptyState('🏆',
      '還沒有掌握的詞<br>複習間隔拉到 21 天以上就算記住了');
    return;
  }
  const fmt = (s) => new Date(s).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
  const days = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
  $('m-list').innerHTML = rows.slice(0, 50).map((r) => `
    <div class="m-row">
      <div class="m-word">
        <b>${esc(r.ko)}</b> <span class="muted">${esc(r.zh)}</span>
        ${r.hanja ? `<span class="b-hanja"> · 漢 ${esc(r.hanja)}</span>` : ''}
        <span class="muted"> · ${DIR_SHORT[r.direction]}</span>
      </div>
      <div class="m-when">
        <span title="開始學 → 記住">${fmt(r.first_learned_at)} → ${fmt(r.mastered_at)}</span>
        <small>${days(r.first_learned_at, r.mastered_at)} 天 · ${r.total_reviews} 次</small>
      </div>
    </div>`).join('')
    + (rows.length > 50 ? `<p class="muted center">…另有 ${rows.length - 50} 條</p>` : '');
}

export async function load(reset = true) {
  const user = deps.user();
  if (!user) return;
  if (reset) { cursor = null; $('h-list').innerHTML = `<div class="card">${skeleton(6)}</div>`; }
  try {
    const rows = await progress.listHistory(user.id, { limit: 100, before: cursor, dir: dirFilter || null });
    if (reset) $('h-list').innerHTML = '';
    if (!rows.length) {
      if (reset) $('h-list').innerHTML = `<div class="card">${emptyState('📖', '還沒有學習記錄<br>去「學習」練幾題吧')}</div>`;
      $('h-more').classList.add('hidden');
      return;
    }
    cursor = rows[rows.length - 1].reviewed_at;
    $('h-more').classList.toggle('hidden', rows.length < 100);
    $('h-list').insertAdjacentHTML('beforeend', groupByDay(rows));
  } catch (e) {
    msg('載入記錄失敗：' + (e.message || e));
  }
}

function groupByDay(rows) {
  const groups = [];
  for (const r of rows) {
    const key = new Date(r.reviewed_at)
      .toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  return groups.map((g) => {
    const ok = g.rows.filter((r) => r.is_correct).length;
    const recon = g.rows.filter((r) => r.source && r.source !== 'live').length;
    return `<div class="card h-day">
      <h3><span>${esc(g.key)}${recon ? ` <span class="h-src">${recon} 筆為補回</span>` : ''}</span>
          <span>${g.rows.length} 題 · 正確率 ${Math.round(ok / g.rows.length * 100)}%</span></h3>
      ${g.rows.map((r) => {
        const t = new Date(r.reviewed_at);
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        return `<div class="h-item">
          <span class="h-time">${hh}:${mm}</span>
          <span class="h-mark">${r.is_correct ? '✅' : '❌'}</span>
          <span class="h-word">${esc(r.items.ko)} <small>${esc(r.items.zh)}</small>
            <small> · ${DIR_SHORT[r.direction]}</small></span>
          <span class="h-rate">${RATE_LABEL[r.rating] || ''}${
            r.source && r.source !== 'live'
              ? '<span class="h-src" title="這筆不是作答當下寫入的，而是事後從複習排程反推補回">補</span>' : ''
          }</span>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

/** 柱高＝答題量，填色高度＝正確比例 */
export function renderChart(daily) {
  if (!daily?.length) { $('chart').innerHTML = ''; return; }
  const max = Math.max(1, ...daily.map((d) => d.n));
  $('chart').innerHTML = daily.map((d, i) => {
    const h = d.n ? Math.max(6, (d.n / max) * 100) : 3;
    const fill = d.n ? (d.correct / d.n) * 100 : 0;
    const acc = d.n ? `｜正確率 ${Math.round(d.correct / d.n * 100)}%` : '';
    return `<div class="bar${d.n ? '' : ' empty'}${i === daily.length - 1 ? ' today' : ''}"
      style="height:${h}%" title="${d.date}｜${d.n} 題${acc}"><i class="fill" style="height:${fill}%"></i></div>`;
  }).join('');

  // 與首頁共用同一份實作 —— 兩處數字必須一致
  const { total, activeDays, days, startedToday } = summarize(daily);
  $('chart-legend').textContent =
    `30 天共 ${total} 題 · 學習 ${activeDays} 天 · 連續 ${days} 天`
    + (startedToday ? '' : '（今天還沒開始）');
}
