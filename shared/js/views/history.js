// 學習記錄：逐筆時間線 + 近 30 天曲線
import { $, esc, msg, skeleton, emptyState, qs, qsa, debounce, createPager } from '../core/dom.js';
import { wordHTML } from '../core/ruby.js';
import { lang } from '../core/lang.js';
import { dirShort, dirLabel, RATE_LABEL } from '../data/client.js';
import * as progress from '../data/progress.js';
import { summarize, funnel, byDirection } from '../core/stats.js';

let deps = null;
let cursor = null;

export function initHistory(d) {
  deps = d;
  $('h-more').onclick = () => load(false);
}

export async function open() {
  const user = deps.user();
  if (!user) return;
  // 總覽與單詞進度共用同一份資料，一次載入不重複查
  const [daily, w, po, ns] = await Promise.all([
    progress.dailyStats(user.id, 30).catch(() => []),
    progress.wordProgress(user.id).catch(() => []),
    progress.practicedOnly(user.id).catch(() => []),
    progress.notStartedItems(user.id).catch(() => []),
  ]);
  words = w; practiced = po; notStarted = ns;
  renderChart(daily);
  renderOverview(daily);
  if (tab === 'words') renderWords(); else await load(true);
}

const MODE_LABEL = { flip: '翻卡自評', choice: '四選一', scramble: '詞序重組', listen: '聽音選義' };
const MODE_ICON  = { flip: '🃏', choice: '📝', scramble: '🧩', listen: '🎧' };
// 活動類型：同樣是答 8 題，「修復弱項」與「隨手練練」意義完全不同
const ACT = {
  new:    { label: '學新詞', cls: 'act-new' },
  review: { label: '複習',   cls: 'act-review' },
  drill:  { label: '弱項修復', cls: 'act-drill' },
  free:   { label: '自由練習', cls: 'act-free' },
};

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
        ${se.activity ? `<span class="act ${ACT[se.activity]?.cls || ''}">${ACT[se.activity]?.label || se.activity}</span>` : ''}
        <b>${esc(MODE_LABEL[se.mode] || '學習')}</b>
        <span class="muted"> · ${dirShort()[se.direction] || ''}</span>
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
            <span class="h-word">${wordHTML(r.items)} <small>${esc(r.items.zh)}</small>
              ${!lang().rubyFromHanja && r.items.hanja
              ? `<small class="b-hanja"> · 漢 ${esc(r.items.hanja)}</small>` : ''}</span>
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
    `${total} 題 · ${activeDays} 天 · 連續 ${days} 天${startedToday ? '' : ' · 今天未開始'}`;
}


// =====================================================================
// 單詞進度：按掌握程度篩選，展開看該詞的完整軌跡
// =====================================================================
let tab = 'sessions';
let filter = 'all';
let wordPager = null;
let words = [];        // 已建卡的詞
let notStarted = [];   // 完全沒碰過的詞
let practiced = [];    // 練過但未進輪轉的詞

const STAGE = {
  mastered: { cls: 'mastered', label: '已掌握' },
  review:   { cls: 'review',   label: '複習中' },
  learning: { cls: 'learning', label: '學習中' },
  practiced:{ cls: 'practiced', label: '練習過' },
  new:      { cls: 'new',      label: '未開始' },
};
const MODE_SHORT = { flip: '翻卡', choice: '四選一', scramble: '重組', listen: '聽音' };

export function initWords(onDrill) {
  $('h-tabs').addEventListener('change', (e) => {
    tab = e.target.value;
    $('h-pane-sessions').classList.toggle('hidden', tab !== 'sessions');
    $('h-pane-words').classList.toggle('hidden', tab !== 'words');
    if (tab === 'words' && !words.length) loadWords();
  });
  qsa('#w-filter .tag').forEach((b) => {
    b.onclick = () => {
      filter = b.dataset.f;
      qsa('#w-filter .tag').forEach((x) => x.classList.toggle('on', x === b));
      renderWords();
    };
  });
  $('w-search').addEventListener('input', debounce(renderWords, 250));
  $('w-drill').onclick = () => {
    const ids = visible().map((w) => w.item_id).filter(Boolean);   // 整份篩選結果，非目前這頁
    if (ids.length) onDrill(ids);
  };
}

export async function loadWords() {
  const user = deps.user();
  if (!user) return;
  $('w-list').innerHTML = skeleton(6);
  try {
    [words, practiced, notStarted] = await Promise.all([
      progress.wordProgress(user.id),
      progress.practicedOnly(user.id).catch(() => []),
      progress.notStartedItems(user.id).catch(() => []),
    ]);
    renderWords();
  } catch (e) {
    $('w-list').innerHTML = '';
    msg('載入失敗：' + (e.message || e));
  }
}

/** 目前篩選 + 搜尋下可見的詞 */
function visible() {
  const q = $('w-search').value.trim().toLowerCase();
  const match = (w) => !q || [w.ko, w.zh, w.hanja].some((x) => (x || '').toLowerCase().includes(q));

  let list;
  if (filter === 'new') {
    list = notStarted.map((i) => ({ ...i, item_id: i.id, state: 'new', dirs: {}, total: 0 }));
  } else if (filter === 'practiced') {
    list = practiced;
  } else if (filter === 'all') {
    list = [...words, ...practiced];
  } else {
    list = words.filter((w) => {
      if (filter === 'mastered') return w.mastered;
      // 已掌握的不該再出現在「複習中」——否則兩個篩選互相重疊，數字對不上
      if (filter === 'review') return w.state === 'review' && !w.mastered;
      if (filter === 'learning') return w.state === 'learning' || w.state === 'new';
      if (filter === 'weak') return w.total >= 3 && w.accuracy != null && w.accuracy < 0.7;
      return true;
    });
  }
  return list.filter(match);
}

let currentList = [];

function renderWords() {
  const list = visible();
  currentList = list;
  const counts = {
    all: words.length + practiced.length,
    practiced: practiced.length,
    mastered: words.filter((w) => w.mastered).length,
    review: words.filter((w) => w.state === 'review' && !w.mastered).length,
    learning: words.filter((w) => ['learning', 'new'].includes(w.state)).length,
    weak: words.filter((w) => w.total >= 3 && w.accuracy != null && w.accuracy < 0.7).length,
    new: notStarted.length,
  };
  qsa('#w-filter .tag').forEach((b) => {
    const n = counts[b.dataset.f];
    b.textContent = b.textContent.replace(/\s*\d+$/, '') + (n != null ? ` ${n}` : '');
  });

  $('w-count').textContent = `${list.length} 條`;
  $('w-drill').classList.toggle('hidden', !list.length || filter === 'all');
  $('w-drill').textContent = `練這 ${list.length} 條`;

  if (!list.length) {
    $('w-list').innerHTML = emptyState('🔍', '這個範圍裡沒有詞');
    $('w-more').innerHTML = '';
    return;
  }

  const rowHtml = (w) => {
    const st = w.mastered ? STAGE.mastered : (STAGE[w.state] || STAGE.new);
    const acc = w.accuracy != null ? `${Math.round(w.accuracy * 100)}%` : '–';
    const sub = w.practicedOnly
      ? `自由練習 ${w.total} 次 · 正確率 ${acc} · 尚未排入複習`
      : w.total
        ? `答過 ${w.total} 次 · 正確率 ${acc}`
          + (w.nextDueAt ? ` · 下次 ${fmtDate(w.nextDueAt)}` : '')
        : '尚未開始學';
    return `<div class="w-row" data-id="${esc(w.item_id)}">
      <button class="w-head">
        <span class="w-main">
          <span class="w-ko">${wordHTML(w)}</span>
          <span class="w-zh"> ${esc(w.zh)}</span>
          ${!lang().rubyFromHanja && w.hanja
              // hanja 欄兩站裝的東西不同：韓文站是漢字詞源（학교 → 學校），
              // 日文站是注音字串（駅[えき]は…）。不分站台就印，
              // 日文站的詞彙清單會出現「· 漢 駅[えき]は…」這種沒有意義的東西 ——
              // 而讀音已經標在詞的上方了，這裡再印一次也是重複。
              ? `<span class="b-hanja"> · 漢 ${esc(w.hanja)}</span>` : ''}
          <span class="w-sub">${esc(sub)}</span>
        </span>
        <span class="w-badges"><span class="stage ${st.cls}">${st.label}</span></span>
        <span class="w-arrow">⌄</span>
      </button>
      <div class="w-body hidden"></div>
    </div>`;
  };

  if (!wordPager) {
    wordPager = createPager({
      list: $('w-list'), footer: $('w-more'), pageSize: 60,
      render: (slice) => slice.map(rowHtml).join(''),
      afterRender: () => bindWordToggles(),
    });
  }
  wordPager.set(list);
}

const fmtDate = (s) => new Date(s).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
const fmtStamp = (s) => new Date(s).toLocaleString('zh-TW',
  { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function bindWordToggles() {
  qsa('.w-head', $('w-list')).forEach((btn) => {
    btn.onclick = async () => {
      const row = btn.closest('.w-row');
      const body = row.querySelector('.w-body');
      const open = !body.classList.contains('hidden');
      row.classList.toggle('open', !open);
      body.classList.toggle('hidden', open);
      if (open || body.dataset.loaded) return;

      const w = currentList.find((x) => String(x.item_id) === row.dataset.id);
      body.innerHTML = skeleton(3);
      try {
        const atts = w.total ? await progress.itemAttempts(deps.user().id, w.item_id, 20) : [];
        body.innerHTML = renderWordDetail(w, atts);
        body.dataset.loaded = '1';
      } catch (e) {
        body.innerHTML = `<p class="muted center">載入失敗：${esc(e.message || e)}</p>`;
      }
    };
  });
}

/** 一個詞的完整軌跡：兩個方向各自的狀態 + 最近的作答歷程 */
function renderWordDetail(w, atts) {
  if (!w.total) {
    return `<p class="muted center" style="padding:10px 0">這個詞還沒開始學。到「學習」頁選個題型就會排進來。</p>`;
  }
  if (w.practicedOnly) {
    const ds = Object.entries(w.dirs).map(([dir, d]) =>
      `<div class="dir-block"><h4><span>${dirShort()[dir]}</span>
        <span class="stage practiced">練習過</span></h4>
        <div class="dir-facts">
          <span>作答 <b>${d.attempts} 次</b></span>
          <span>正確率 <b>${Math.round(Number(d.accuracy) * 100)}%</b>（${d.correct}/${d.attempts}）</span>
          <span>第一次 <b>${fmtStamp(d.first_at)}</b></span>
          <span>最近 <b>${fmtStamp(d.last_at)}</b></span>
        </div></div>`).join('');
    return ds + `<p class="hint">自由練習只記成績、不排複習。要讓它進入複習輪轉，
      到「學習」頁按詞庫的「學新的」。</p>`;
  }
  const dirBlock = (dir) => {
    const d = w.dirs[dir];
    if (!d) return `<div class="dir-block"><h4>${dirShort()[dir]}</h4>
      <div class="dir-facts"><span>還沒練過這個方向</span></div></div>`;
    const st = d.mastered ? STAGE.mastered : (STAGE[d.state] || STAGE.new);
    return `<div class="dir-block">
      <h4><span>${dirShort()[dir]}</span><span class="stage ${st.cls}">${st.label}</span></h4>
      <div class="dir-facts">
        <span>首次學習 <b>${fmtStamp(d.first_learned_at)}</b></span>
        <span>最近複習 <b>${d.last_reviewed_at ? fmtStamp(d.last_reviewed_at) : '–'}</b></span>
        <span>正確率 <b>${d.accuracy != null ? Math.round(d.accuracy * 100) + '%' : '–'}</b>（${d.correct_reviews}/${d.total_reviews}）</span>
        <span>目前間隔 <b>${Number(d.interval_days).toFixed(0)} 天</b></span>
        <span>下次複習 <b>${d.due_at ? fmtStamp(d.due_at) : '–'}</b></span>
        <span>記住於 <b>${d.mastered_at ? fmtStamp(d.mastered_at) : '尚未'}</b></span>
      </div>
    </div>`;
  };

  const rows = atts.map((a) => `
    <div class="att">
      <span class="t">${fmtStamp(a.reviewed_at)}</span>
      <span>${a.is_correct ? '✅' : '❌'}</span>
      <span class="m">${a.mode ? (MODE_SHORT[a.mode] || a.mode) : '—'}</span>
      <span>${dirShort()[a.direction]}</span>
      <span>${RATE_LABEL[a.rating] || ''}</span>
      ${a.elapsed_ms ? `<span>${(a.elapsed_ms / 1000).toFixed(1)}s</span>` : ''}
      ${a.activity ? `<span class="act ${ACT[a.activity]?.cls || ''}">${ACT[a.activity]?.label || ''}</span>` : ''}
      ${a.source && a.source !== 'live' ? '<span class="h-src">補</span>' : ''}
    </div>`).join('');

  return dirBlock('ko2zh') + dirBlock('zh2ko')
    + (rows ? `<div class="attempts"><div class="hint" style="margin:0 0 4px">最近 ${atts.length} 次作答</div>${rows}</div>` : '');
}


// =====================================================================
// 進度總覽 —— 從學習者視角，先回答「我到哪了」
// =====================================================================
function renderOverview(daily) {
  const f = funnel(words, notStarted.length, practiced.length);
  $('ov-started').textContent = f.touched;
  $('ov-total').textContent = f.total;
  $('ov-pct').textContent = `${Math.round(f.touchedPct * 100)}%`;

  const seg = (cls, n) => n ? `<i class="${cls}" style="width:${(n / f.total) * 100}%"></i>` : '';
  $('funnel').innerHTML =
    seg('f-mastered', f.mastered) + seg('f-review', f.review)
    + seg('f-learning', f.learning) + seg('f-practiced', f.practiced);

  const dot = (cls, label, n) =>
    `<span><i class="${cls}"></i>${label} <b>${n}</b></span>`;
  $('funnel-legend').innerHTML =
    dot('f-mastered', '已掌握', f.mastered)
    + dot('f-review', '複習中', f.review)
    + dot('f-learning', '學習中', f.learning)
    + dot('f-practiced', '練習過', f.practiced)
    + `<span><i style="background:var(--border)"></i>未開始 <b>${f.notStarted}</b></span>`;

  // 兩個方向分開看 —— 混在一起會把真正的弱項藏起來。
  // 資料源是 user_cards 的計數，0008 之後它已包含自由練習，
  // 與「我的弱項」同源，兩處數字不會打架。
  const rows = words.flatMap((w) => Object.values(w.dirs));
  const bd = byDirection(rows);
  $('dir-compare').innerHTML = ['ko2zh', 'zh2ko'].map((dir) => {
    const d = bd[dir];
    const acc = d.accuracy;
    return `<div class="dc-row" title="${dirLabel()[dir]}">
      <span class="dc-name">${dirShort()[dir]}</span>
      <span class="dc-bar"><i style="width:${acc != null ? acc * 100 : 0}%"></i></span>
      <span class="dc-val">${acc != null ? `<b>${Math.round(acc * 100)}%</b> ${d.correct}/${d.total}` : '尚未練過'}</span>
    </div>`;
  }).join('');

  // 30 天摘要現在掛在曲線的收合標題上，收起時也看得到重點
}
