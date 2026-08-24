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
import { $, esc, msg, qsa, busy } from '../core/dom.js';
import { rubyHTML, stripRuby, hasRuby } from '../core/ruby.js';
import * as speech from '../core/speech.js';
import * as script from '../data/script.js';
import * as content from '../data/content.js';
import { lang } from '../core/lang.js';

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
let sceneWordIds = [];    // 這一幕的詞對應到哪些卡片（給「練這一幕」用）
let workFilter = '';      // 只看某一季（''＝全部）
let unreadOnly = false;   // 幕清單只看還沒讀的

export function initScript(d) {
  deps = d;
  $('sc-prev').onclick = () => openScene(scene - 1);
  $('sc-next').onclick = () => openScene(scene + 1);
  $('sc-play').onclick = () => playScene();
  $('sc-ruby').onclick = () => { showRuby = !showRuby; syncRubyBtn(); renderLines(); };
  $('sc-done').onclick = () => toggleDone();
  $('sc-continue').onclick = () => openScene(nextUnread());
  // 一集 70 幕，讀了一半之後「還沒讀的是哪些」比「全部」更常被問。
  // 做成切換而不是預設只看未讀 —— 回頭重讀是常態，不是例外。
  $('sc-filter').onclick = () => { unreadOnly = !unreadOnly; renderScenes(); };
  // ★ 讀完一幕，最想做的事就是把剛遇到的詞練熟 ——
  //   而在這之前，那 768 張卡唯一的入口是
  //   「詞庫 → 篩選那一副 → 學這組」，沒有人會自己走到那裡。
  //   內容從哪來（精讀）與拿它做什麼（練習）本來就該接在一起。
  $('sc-practice').onclick = (e) => busy(e.currentTarget, () => {
    if (!sceneWordIds.length) return msg('這一幕的詞還沒有建卡');
    return deps.onPractice?.(sceneWordIds.slice());
  });
  // 把這一幕鎖成「新課」的範圍。之後回首頁按新課，學的就是這一幕的詞。
  // 用切換而不是單向設定 —— 設得下去就要收得回來。
  $('sc-scope').onclick = () => {
    const cur = deps.getScope?.();
    const mine = cur && cur.epId === ep?.id && cur.scene === scene;
    deps.onSetScope?.(mine ? null : {
      epId: ep.id, scene,
      label: `${ep.work_title} 第 ${ep.episode} 集 · 第 ${scene} 幕`,
    });
    syncScopeBtn();
  };
  qsa('input[name="scmode"]').forEach((r) => {
    r.onchange = () => { mode = r.value; renderLines(); };
  });
  syncRubyBtn();
}

const syncRubyBtn = () => { $('sc-ruby').textContent = `注音：${showRuby ? '開' : '關'}`; };

function syncScopeBtn() {
  const cur = deps?.getScope?.();
  const mine = cur && cur.epId === ep?.id && cur.scene === scene;
  $('sc-scope').textContent = mine
    ? '✓ 首頁「新課」正在學這一幕（點一下取消）'
    : '把這一幕設為首頁「新課」的範圍';
}

/** 這一集第一個還沒讀的幕；全部讀完就回第一幕 */
function nextUnread() {
  const total = ep?.scene_count || 0;
  for (let n = 1; n <= total; n++) if (!done.has(n)) return n;
  return 1;
}

// ---------------------------------------------------------------------
// 層層篩選：作品 → 集 → 幕
//
// 三層永遠看得到。清單式的「一層層點進去」做不到一件事：
// 隨時跳回上一層換一個 —— 那要先退出再重選，
// 而使用者在挑內容時本來就是來回比較的。
// ---------------------------------------------------------------------
export async function open() {
  if (!eps.length) eps = await script.listEpisodes();
  counts = await script.progressCounts(deps.userId());
  if (!workFilter && eps.length) workFilter = workKeyOf(eps[0]);
  await renderPick();
}

const workKeyOf = (e) => `${e.work_title}｜第 ${e.season} 季`;

async function renderPick() {
  $('sc-scene-pane').classList.add('hidden');
  const has = eps.length > 0;
  $('sc-empty').classList.toggle('hidden', has);
  $('sc-pick').classList.toggle('bare', !has);
  if (!has) {
    $('sc-total').textContent = '';
    for (const id of ['sc-works', 'sc-eps']) $(id).innerHTML = '';
    $('sc-scene-row').classList.add('hidden');
    return;
  }

  const readAll = eps.reduce((n, e) => n + (counts[e.id] || 0), 0);
  const sceneAll = eps.reduce((n, e) => n + e.scene_count, 0);
  $('sc-total').textContent = `${readAll} / ${sceneAll} 幕`;

  // ── 第一層：作品 · 季 ──
  const works = [...new Set(eps.map(workKeyOf))];
  if (!works.includes(workFilter)) workFilter = works[0];
  $('sc-works').innerHTML = works.map((w) =>
    `<button class="tag${w === workFilter ? ' on' : ''}" data-work="${esc(w)}">${esc(w)}</button>`).join('');
  qsa('#sc-works [data-work]').forEach((b2) => {
    b2.onclick = () => { workFilter = b2.dataset.work; ep = null; renderPick(); };
  });

  // ── 第二層：集 ──
  const list = eps.filter((e) => workKeyOf(e) === workFilter);
  if (!ep || !list.some((e) => e.id === ep.id)) ep = null;
  $('sc-eps').innerHTML = list.map((e) => {
    const d = counts[e.id] || 0;
    // 進度直接寫在每一集上 —— 挑集數時要回答的正是「哪一集還沒讀完」
    return `<button class="tag${ep && e.id === ep.id ? ' on' : ''}" data-ep="${e.id}">`
      + `第 ${e.episode} 集<small>${d}/${e.scene_count}</small></button>`;
  }).join('');
  qsa('#sc-eps [data-ep]').forEach((b2) => {
    b2.onclick = () => openEp(b2.dataset.ep);
  });

  // ── 第三層：幕 ──
  $('sc-scene-row').classList.toggle('hidden', !ep);
  if (ep) renderScenes();
}

async function openEp(id) {
  const next = eps.find((e) => e.id === id);
  if (!next) return;
  ep = next;
  lines = await script.loadLines(id);
  done = await script.loadProgress(deps.userId(), id);
  await renderPick();
}

function renderScenes() {
  const total = ep.scene_count;
  $('sc-ep-prog').textContent = `${done.size} / ${total} 幕`;
  $('sc-ep-bar').style.width = `${total ? Math.round((done.size / total) * 100) : 0}%`;
  const left = total - done.size;
  $('sc-filter').textContent = unreadOnly ? `只看沒讀的（${left}）` : `全部 ${total} 幕`;
  const nums = Array.from({ length: total }, (_, i) => i + 1)
    .filter((n) => !unreadOnly || !done.has(n));
  $('sc-scenes').innerHTML = nums.map((num) => {
    const rows = lines.filter((l) => l.scene === num).length;
    return `<button class="scene-cell${done.has(num) ? ' on' : ''}${num === scene ? ' now' : ''}"
      data-scene="${num}" title="${rows} 句">${num}</button>`;
  }).join('') || '<p class="muted nomargin">這一集都讀完了。</p>';
  qsa('#sc-scenes [data-scene]').forEach((b2) => {
    b2.onclick = () => openScene(Number(b2.dataset.scene));
  });
  const n = nextUnread();
  $('sc-continue').textContent =
    done.size >= total ? '整集讀完了 · 從第 1 幕重讀' : `從第 ${n} 幕開始`;
}

// ---------------------------------------------------------------------
// 一幕
// ---------------------------------------------------------------------
async function openScene(n) {
  if (!ep) return;
  if (n < 1 || n > ep.scene_count) return;
  speech.cancel();
  scene = n;
  $('sc-scene-pane').classList.remove('hidden');
  renderScenes();                       // 讓幕格標出現在讀的是哪一格
  const rows = sceneLines();
  $('sc-scene-title').textContent =
    `${ep.work_title} 第 ${ep.episode} 集 · 第 ${n} 幕 / ${ep.scene_count}`;
  $('sc-scene-time').textContent = rows.length
    ? `${clock(rows[0].start_s)} – ${clock(rows[rows.length - 1].end_s)} · ${rows.length} 句`
    : '';
  $('sc-prev').disabled = n <= 1;
  $('sc-next').disabled = n >= ep.scene_count;
  syncDoneBtn();
  syncScopeBtn();
  renderLines();
  renderGrammar(rows);
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
 * 這一幕用到的句型。
 *
 * 代號由抽取階段判定（看詞形與詞性的序列），解說在站台設定裡。
 * 沒命中就整張卡收起來 —— 留一張寫著「沒有」的卡片，
 * 只會讓人以為是壞了。實測一集有 14/70 幕確實沒有可標的句型。
 */
function renderGrammar(rows) {
  const dict = lang().grammar || {};
  const ids = [...new Set(rows.flatMap((l) => l.grammar || []))].filter((k) => dict[k]);
  const card = $('sc-gram-card');
  card.classList.toggle('hidden', !ids.length);
  $('sc-gram-n').textContent = ids.length ? `${ids.length} 個` : '';
  if (!ids.length) return;
  $('sc-gram').innerHTML = ids.map((k) => {
    const g = dict[k];
    return `<div class="sc-gram">
      <b>${esc(g.form)}</b>
      <span>${esc(g.sense)}</span>
      ${g.watch ? `<em>⚠ ${esc(g.watch)}</em>` : ''}
    </div>`;
  }).join('');
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
  // ★ 先清空上一幕的狀態再算這一幕。
  //   本來是「沒有詞就提早 return」，於是 sceneWordIds 與按鈕
  //   都留著上一幕的 —— 按下去練到的是上一幕的詞，而畫面上
  //   寫著這一幕。不報錯，只是練錯東西。
  sceneWordIds = [];
  $('sc-practice').classList.add('hidden');
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
  sceneWordIds = items.map((it) => it.id);
  $('sc-practice').classList.toggle('hidden', !items.length);
  $('sc-practice').textContent = `練這一幕（${items.length}）`;
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
    renderScenes();
    if (want && scene < ep.scene_count) openScene(scene + 1);
  } catch (e) {
    if (want) done.delete(scene); else done.add(scene);
    syncDoneBtn();
    msg('進度沒存起來：' + (e.message || e));
  }
}

/**
 * 整幕連續朗讀。
 *
 * ★ 每唸一句都要重新確認「還在同一幕」。
 *   本來寫的是 `if (scene === 0) return`，只擋得住「回到清單」——
 *   換到別的幕時 scene 變成別的數字而不是 0，於是守衛不觸發，
 *   畫面已經是新的一幕，聲音還在把舊那一幕唸完。
 *   而它不會報錯，只會讓人以為朗讀壞了。
 *
 *   playId 則擋住「重複按播放」：第二次按下去時，
 *   第一輪的迴圈還卡在 await 裡，兩輪會交錯著唸。
 */
let playId = 0;
async function playScene() {
  const rows = sceneLines();
  const at = scene;
  const mine = ++playId;
  for (const l of rows) {
    if (scene !== at || playId !== mine) return;
    await speech.speakAwait(stripRuby(l.ruby || l.ja)).catch(() => {});
  }
}


