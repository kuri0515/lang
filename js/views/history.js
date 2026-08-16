// 學習記錄：逐筆時間線 + 近 30 天曲線
import { $, esc, msg, skeleton, emptyState, qs, qsa } from '../core/dom.js';
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

const MODE_LABEL = { flip: '翻卡自評', choice: '四選一', scramble: '詞序重組', listen: '聽音選義' };
const MODE_ICON  = { flip: '🃏', choice: '📝', scramble: '🧩', listen: '🎧' };

const fmtTime = (t) => new Date(t).toTimeString().slice(0, 5);
const fmtDay = (d) => new Date(d).toLocaleDateString('zh-TW',
  { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const fmtDur = (sec) => sec < 60 ? `${sec} 秒` : `${Math.round(sec / 60)} 分`;

/**
 * 記錄頁主體：以「場次」為單位，一輪學習一列，可展開看逐題。
 * 明細不預先載入 —— 展開哪一場才查哪一場，避免一進頁面就撈幾百筆。
 */
export async function load(reset = true) {
  const user = deps.user();
  if (!user) return;
  if (reset) { cursor = null; $('h-list').innerHTML = `<div class="card">${skeleton(5)}</div>`; }

  try {
    const [sessions, legacy] = await Promise.all([
      progress.listSessions(user.id, { limit: 30, before: cursor }),
      cursor ? [] : progress.legacyDays(user.id).catch(() => []),
    ]);

    if (reset) $('h-list').innerHTML = '';
    if (!sessions.length && !legacy.length) {
      if (reset) $('h-list').innerHTML =
        `<div class="card">${emptyState('📖', '還沒有學習記錄<br>去「學習」練幾題吧')}</div>`;
      $('h-more').classList.add('hidden');
      return;
    }
    cursor = sessions.length ? sessions[sessions.length - 1].started_at : cursor;
    $('h-more').classList.toggle('hidden', sessions.length < 30);

    // 場次按天分組
    const days = [];
    for (const se of sessions) {
      const key = se.started_at.slice(0, 10);
      if (!days.length || days[days.length - 1].key !== key) days.push({ key, sessions: [] });
      days[days.length - 1].sessions.push(se);
    }

    let html = days.map(renderDay).join('');
    if (!cursor || reset) html += legacy.map(renderLegacyDay).join('');
    $('h-list').insertAdjacentHTML('beforeend', html);
    bindToggles();
  } catch (e) {
    msg('載入記錄失敗：' + (e.message || e));
  }
}

function renderDay(d) {
  const n = d.sessions.reduce((s, x) => s + x.answered, 0);
  const ok = d.sessions.reduce((s, x) => s + x.correct, 0);
  return `<div class="card h-day">
    <h3><span>${esc(fmtDay(d.key))}</span>
        <span>${d.sessions.length} 場 · ${n} 題 · 正確率 ${Math.round(ok / n * 100)}%</span></h3>
    ${d.sessions.map(renderSession).join('')}
  </div>`;
}

function renderSession(se) {
  const acc = Math.round(Number(se.accuracy) * 100);
  const cls = acc >= 80 ? 'good' : acc >= 50 ? 'mid' : 'low';
  return `<div class="sess" data-sid="${esc(se.session_id)}">
    <button class="sess-head">
      <span class="sess-icon">${MODE_ICON[se.mode] || '📘'}</span>
      <span class="sess-main">
        <b>${esc(MODE_LABEL[se.mode] || '學習')}</b>
        <span class="muted"> · ${DIR_SHORT[se.direction] || ''}</span>
        ${se.is_free ? '<span class="tag-free">自由練習</span>' : ''}
        <small>${fmtTime(se.started_at)}–${fmtTime(se.ended_at)} · ${fmtDur(se.duration_sec)}</small>
      </span>
      <span class="sess-stat">
        <b class="acc-${cls}">${acc}%</b>
        <small>${se.correct}/${se.answered}</small>
      </span>
      <span class="sess-arrow">⌄</span>
    </button>
    <div class="sess-body hidden"></div>
  </div>`;
}

function renderLegacyDay(d) {
  const acc = Math.round(d.correct / d.answered * 100);
  return `<div class="card h-day">
    <h3><span>${esc(fmtDay(d.day))} <span class="h-src">早期記錄</span></span>
        <span>${d.answered} 題 · 正確率 ${acc}%</span></h3>
    <div class="sess" data-day="${d.day}">
      <button class="sess-head">
        <span class="sess-icon">📘</span>
        <span class="sess-main"><b>未分場次</b>
          <small>當時尚未記錄題型與場次</small></span>
        <span class="sess-stat"><b>${acc}%</b><small>${d.correct}/${d.answered}</small></span>
        <span class="sess-arrow">⌄</span>
      </button>
      <div class="sess-body hidden"></div>
    </div>
  </div>`;
}

function bindToggles() {
  qsa('.sess-head', $('h-list')).forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.onclick = async () => {
      const box = btn.closest('.sess');
      const body = box.querySelector('.sess-body');
      const open = !body.classList.contains('hidden');
      box.classList.toggle('open', !open);
      body.classList.toggle('hidden', open);
      if (open || body.dataset.loaded) return;

      body.innerHTML = skeleton(4);
      const user = deps.user();
      try {
        const rows = box.dataset.sid
          ? await progress.sessionDetail(user.id, box.dataset.sid)
          : await progress.legacyDayDetail(user.id, box.dataset.day);
        body.innerHTML = rows.map((r) => `
          <div class="h-item">
            <span class="h-time">${fmtTime(r.reviewed_at)}</span>
            <span class="h-mark">${r.is_correct ? '✅' : '❌'}</span>
            <span class="h-word">${esc(r.items.ko)} <small>${esc(r.items.zh)}</small>
              ${r.items.hanja ? `<small class="b-hanja"> · 漢 ${esc(r.items.hanja)}</small>` : ''}</span>
            <span class="h-rate">${RATE_LABEL[r.rating] || ''}${
              r.elapsed_ms ? `<small> ${(r.elapsed_ms / 1000).toFixed(1)}s</small>` : ''
            }${r.source && r.source !== 'live' ? '<span class="h-src" title="事後從複習排程反推補回">補</span>' : ''}</span>
          </div>`).join('') || '<p class="muted center">沒有明細</p>';
        body.dataset.loaded = '1';
      } catch (e) {
        body.innerHTML = `<p class="muted center">載入失敗：${esc(e.message || e)}</p>`;
      }
    };
  });
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
