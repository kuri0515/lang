// =====================================================================
// 精讀畫面：照影片台詞一幕一幕讀
//
// 【三層，不是一層】
//   集 → 幕 → 行。一集四百多行攤成一份清單沒有人讀得完，
//   也沒有「今天讀到哪」的單位。幕就是那個單位：
//   一次五到十行，讀得完，而且它本身是一段完整的對話。
//
// 【為什麼預設是對照，不是只看目標語言】
//   這是精讀不是測驗。台詞的難度遠高於單字卡 ——
//   一開始就蓋住中文，多數人會卡在第三行然後關掉。
//   先看得懂，再收掉中文重讀一次，那是兩個不同階段，
//   而切換的時機該由學習者自己決定（所以是選項不是流程）。
//
// 【讀完是自評，而且可以取消】
//   沒有辦法自動判斷一個人「讀懂了」。既然是自評，就必須能反悔 ——
//   標錯了卻收不回來，下次就沒有人敢按。
// =====================================================================
import { $, esc, msg, qsa } from '../core/dom.js';
import { rubyHTML, stripRuby, hasRuby } from '../core/ruby.js';
import * as speech from '../core/speech.js';
import * as script from '../data/script.js';
import * as content from '../data/content.js';

let deps = null;
let eps = [];
let counts = {};          // episode_id → 讀過幾幕
let ep = null;            // 目前這一集
let lines = [];           // 這一集的全部行
let done = new Set();     // 這一集讀過的幕
let scene = 0;            // 目前這一幕（1 起；0＝還沒選）
let mode = 'both';        // both | ja | zh
let showRuby = true;
let wordCache = new Map();

export function initScript(d) {
  deps = d;
  $('sc-back-list').onclick = () => showList();
  $('sc-back-ep').onclick = () => showEp();
  $('sc-prev').onclick = () => openScene(scene - 1);
  $('sc-next').onclick = () => openScene(scene + 1);
  $('sc-play').onclick = () => playScene();
  $('sc-ruby').onclick = () => { showRuby = !showRuby; syncRubyBtn(); renderLines(); };
  $('sc-done').onclick = () => toggleDone();
  $('sc-continue').onclick = () => openScene(nextUnread());
  qsa('input[name="scmode"]').forEach((r) => {
    r.onchange = () => { mode = r.value; renderLines(); };
  });
  syncRubyBtn();
}

const syncRubyBtn = () => { $('sc-ruby').textContent = `注音：${showRuby ? '開' : '關'}`; };

/** 這一集第一個還沒讀的幕；全部讀完就回第一幕 */
function nextUnread() {
  const total = ep?.scene_count || 0;
  for (let n = 1; n <= total; n++) if (!done.has(n)) return n;
  return 1;
}

// ---------------------------------------------------------------------
// 集清單
// ---------------------------------------------------------------------
export async function open() {
  if (!eps.length) eps = await script.listEpisodes();
  counts = await script.progressCounts(deps.userId());
  showList();
}

function showList() {
  scene = 0;
  pane('sc-list-pane');
  const box = $('sc-eps');
  if (!eps.length) {
    box.innerHTML = '<div class="card"><p class="muted nomargin">還沒有精讀內容。</p></div>';
    $('sc-total').textContent = '';
    return;
  }
  const readAll = eps.reduce((s, e) => s + (counts[e.id] || 0), 0);
  const sceneAll = eps.reduce((s, e) => s + e.scene_count, 0);
  $('sc-total').textContent = `${readAll} / ${sceneAll} 幕`;

  // 依作品分組 —— 之後會有第二季、第三季，甚至第二部作品
  const by = new Map();
  for (const e of eps) {
    const k = `${e.work_title}｜第 ${e.season} 季`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  box.innerHTML = [...by.entries()].map(([title, list]) => `
    <div class="card">
      <h2>${esc(title)}</h2>
      ${list.map((e) => {
        const d = counts[e.id] || 0;
        const pc = e.scene_count ? Math.round((d / e.scene_count) * 100) : 0;
        return `<button class="ep-row" data-ep="${e.id}">
          <b>第 ${e.episode} 集</b>
          <small>${e.line_count} 句 · ${e.scene_count} 幕</small>
          <span class="ep-prog"><i style="width:${pc}%"></i></span>
          <em>${d}/${e.scene_count}</em>
        </button>`;
      }).join('')}
    </div>`).join('');
  qsa('#sc-eps [data-ep]').forEach((b) => {
    b.onclick = () => openEp(b.dataset.ep);
  });
}

// ---------------------------------------------------------------------
// 一集的幕清單
// ---------------------------------------------------------------------
async function openEp(id) {
  ep = eps.find((e) => e.id === id);
  if (!ep) return;
  lines = await script.loadLines(id);
  done = await script.loadProgress(deps.userId(), id);
  showEp();
}

function showEp() {
  scene = 0;
  speech.cancel();
  pane('sc-ep-pane');
  $('sc-ep-title').textContent = `${ep.work_title} 第 ${ep.season} 季 第 ${ep.episode} 集`;
  $('sc-ep-prog').textContent = `${done.size} / ${ep.scene_count} 幕`;
  $('sc-ep-bar').style.width =
    `${ep.scene_count ? Math.round((done.size / ep.scene_count) * 100) : 0}%`;
  const n = nextUnread();
  $('sc-continue').textContent =
    done.size >= ep.scene_count ? '整集讀完了 · 從第 1 幕重讀' : `從第 ${n} 幕開始`;

  const total = ep.scene_count;
  $('sc-scenes').innerHTML = Array.from({ length: total }, (_, i) => {
    const num = i + 1;
    const rows = lines.filter((l) => l.scene === num).length;
    return `<button class="scene-cell${done.has(num) ? ' on' : ''}" data-scene="${num}"
      title="${rows} 句">${num}</button>`;
  }).join('');
  qsa('#sc-scenes [data-scene]').forEach((b) => {
    b.onclick = () => openScene(Number(b.dataset.scene));
  });
}

// ---------------------------------------------------------------------
// 一幕
// ---------------------------------------------------------------------
async function openScene(n) {
  if (!ep) return;
  if (n < 1 || n > ep.scene_count) return;
  speech.cancel();
  scene = n;
  pane('sc-scene-pane');
  const rows = sceneLines();
  $('sc-scene-title').textContent = `第 ${n} 幕 / ${ep.scene_count}`;
  $('sc-scene-time').textContent = rows.length
    ? `${clock(rows[0].start_s)} – ${clock(rows[rows.length - 1].end_s)} · ${rows.length} 句`
    : '';
  $('sc-prev').disabled = n <= 1;
  $('sc-next').disabled = n >= ep.scene_count;
  syncDoneBtn();
  renderLines();
  await renderWords(rows);
}

const sceneLines = () => lines.filter((l) => l.scene === scene);

const clock = (s) => {
  const t = Math.max(0, Math.floor(s || 0));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function renderLines() {
  const rows = sceneLines();
  $('sc-lines').innerHTML = rows.map((l) => {
    // 注音關掉時要顯示乾淨的原句 —— 直接印 ruby 欄位會露出 [かんじ] 這種標記
    const ja = showRuby && hasRuby(l.ruby) ? rubyHTML(l.ruby) : esc(stripRuby(l.ruby || l.ja));
    return `<div class="sc-line" data-idx="${l.idx}">
      <button class="sc-say icon-btn" data-say="${l.idx}" title="朗讀">🔊</button>
      <div class="sc-body">
        ${mode === 'zh' ? '' : `<div class="sc-ja">${ja}</div>`}
        ${mode === 'ja' ? '' : `<div class="sc-zh">${esc(l.zh)}</div>`}
      </div>
    </div>`;
  }).join('');
  qsa('#sc-lines [data-say]').forEach((b) => {
    b.onclick = () => {
      const l = rows.find((x) => x.idx === Number(b.dataset.say));
      if (l) speech.speak(stripRuby(l.ruby || l.ja));
    };
  });
}

/**
 * 這一幕出現的詞。
 *
 * 詞從 tokens 欄位來 —— 那是抽取時斷出來的原形，精確。
 * 用字串比對去猜的話，「気」會在「元気」「気持ち」裡命中，
 * 而日文沒有詞界空白，這種誤中排除不掉（見 migration 0023）。
 */
async function renderWords(rows) {
  const want = [...new Set(rows.flatMap((l) => l.tokens || []))];
  const box = $('sc-words');
  $('sc-words-n').textContent = want.length ? `${want.length} 個` : '';
  if (!want.length) { box.innerHTML = '<p class="muted nomargin">這一幕沒有需要另外背的詞。</p>'; return; }

  const miss = want.filter((w) => !wordCache.has(w));
  if (miss.length) {
    // 一次查完這一幕缺的，不要逐詞查 —— 一幕十幾個詞就是十幾趟往返
    const got = await content.itemsByKo(miss).catch(() => []);
    for (const it of got) wordCache.set(it.ko, it);
    for (const w of miss) if (!wordCache.has(w)) wordCache.set(w, null);
  }
  const items = want.map((w) => wordCache.get(w)).filter(Boolean);
  box.innerHTML = items.map((it) => `
    <div class="sc-word">
      <b>${hasRuby(it.hanja) ? rubyHTML(it.hanja) : esc(it.ko)}</b>
      <span class="muted">${esc(it.pos || '')}</span>
      <span>${esc(it.zh)}</span>
    </div>`).join('')
    || '<p class="muted nomargin">這一幕的詞還沒有建卡。</p>';
}

function syncDoneBtn() {
  const on = done.has(scene);
  $('sc-done').textContent = on ? '✓ 已讀完（再按一次取消）' : '這一幕讀完了';
  $('sc-done').classList.toggle('ghost', on);
}

async function toggleDone() {
  const want = !done.has(scene);
  // 先動畫面再寫雲端：一次網路往返的等待會讓按鈕像沒反應。
  // 寫失敗時回捲，並說出原因 —— 靜靜地回到原狀比不動更難理解。
  if (want) done.add(scene); else done.delete(scene);
  syncDoneBtn();
  try {
    await script.markScene(deps.userId(), ep.id, scene, want);
    counts[ep.id] = done.size;
    if (want && scene < ep.scene_count) openScene(scene + 1);
  } catch (e) {
    if (want) done.delete(scene); else done.add(scene);
    syncDoneBtn();
    msg('進度沒存起來：' + (e.message || e));
  }
}

/** 整幕連續朗讀。中途切走由 router 的 speech.cancel() 收掉 */
async function playScene() {
  const rows = sceneLines();
  for (const l of rows) {
    if (scene === 0) return;                 // 已經離開這一幕
    await speech.speakAwait(stripRuby(l.ruby || l.ja)).catch(() => {});
  }
}

function pane(id) {
  for (const p of ['sc-list-pane', 'sc-ep-pane', 'sc-scene-pane']) {
    $(p)?.classList.toggle('hidden', p !== id);
  }
}
