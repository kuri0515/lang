// 學習首頁：今日統計、連續天數、練習方式、詞庫、弱項
import { $, opt, esc, pct, msg, emptyState, qs, qsa } from '../core/dom.js';
import { wordHTML } from '../core/ruby.js';
import { on, EVENTS } from '../core/bus.js';
import { dirShort } from '../data/client.js';
import * as content from '../data/content.js';
import { pronOrder, nextLesson, LESSON_DONE,
         lifeScenes, pickScene } from '../core/taxonomy.js';
import * as progress from '../data/progress.js';
import { MODES, getMode, forcedDirection } from '../study/modes/index.js';
import { ROUND_SIZE } from '../study/session.js';
import { ROUND_CRITERION } from '../core/srs.js';
import { matchesType as matchesTypePure } from '../study/session.js';
import { computeStreak } from '../core/stats.js';
import { lang, lsKey } from '../core/lang.js';

let nextLessonTag = null;   // 給首頁建議區用：課程的下一步
let nextLessonNo = 0;
let deps = null;      // { user, profile, onReview, onFree, onNewDeck, onDrillWeak }
let weakIds = [];
let primaryAction = null;
let firstDeckId = null;

export const studyMode = () => qs('#mode-pick input:checked')?.value || 'flip';

/**
 * 這輪只練哪一種內容：all / word / sentence。
 *
 * 【為什麼要這個】
 *   單字和句子練起來是兩件事：單字是認字，句子是理解語序與語尾。
 *   混在一起排程沒有錯，但「今天只想把句子唸順」是很正常的需求，
 *   而原本只能整批練或不練。
 *
 * 【為什麼包含詞組（phrase）算在「單字」】
 *   詞組在使用上更接近單字（かき氷、お菓子），不是要練語序的對象。
 *   分成三類會讓選擇器變長，而第三類幾乎沒人會單獨挑。
 */
export const studyType = () => qs('#type-pick input:checked')?.value || 'all';

/** 條目符不符合目前選的類型（判斷本身在 study/session.js，這裡只補上預設值）*/
export const matchesType = (item, t = studyType()) => matchesTypePure(item, t);
// ★ 使用者自己選的方向，與「這個題型實際用的方向」是兩件事。
//
//   聽音選義必須是「外語→中」（聽聲音選意思），拼出來必須是「中→外語」
//   （看中文寫出來）—— 那是題型本身的性質，不能改。
//
//   但先前的做法是在強制時直接把選鈕改掉，於是：
//   使用者設了「中→外語」，點一次聽音選義，那個設定就被覆蓋成「外語→中」，
//   換回翻卡也回不來。而偏好會把被覆蓋的值存起來，等於永久弄丟。
//
//   所以記住使用者自己的選擇，強制只影響「這一輪用哪個方向」與畫面顯示。
let userDir = 'ko2zh';
export const selectedDir = () => userDir;
export const effectiveDir = () => forcedDirection(studyMode()) || selectedDir();

/** 題型綁定方向時鎖住方向選擇器，避免出現「看中文卻要選中文」的矛盾組合 */
export function syncModeUI() {
  const m = getMode(studyMode());
  $('mode-hint').textContent = m.hint || '';
  const TYPE_TXT = { all: '', word: ' · 只練單字', sentence: ' · 只練句子' };
  $('opt-summary').textContent =
    `${m.label} · ${dirShort()[effectiveDir()]}${TYPE_TXT[studyType()] || ''}`;
  qsa('#dir-pick input').forEach((i) => {
    i.disabled = !!m.direction;
    // 強制時顯示題型要求的方向；沒強制時顯示使用者自己的選擇。
    // 兩種情況都只動畫面，不動 userDir —— 那是使用者的東西。
    i.checked = i.value === (m.direction || userDir);
  });
  $('dir-pick').style.opacity = m.direction ? '.5' : '1';
}

/**
 * 練習方式的偏好：題型／方向／內容類型。
 *
 * 【為什麼三個一起存】
 *   它們是同一個面板上的同一件事。只存方向的話，
 *   另外兩個仍然每次跳回預設 —— 使用者的體感是「有時記得有時不記得」，
 *   那比完全不記得更難理解。
 *
 * 【本機的鍵帶使用者 id】
 *   localStorage 是整個網域共用的，不分使用者。
 *   不帶 id 的話換帳號登入會看到上一個人的設定 ——
 *   而「切換使用者要初始化」正是這裡的要求。
 */
const prefsKey = (userId) => lsKey(`prefs.${userId || 'anon'}`);

export function readPrefs() {
  return { mode: studyMode(), dir: selectedDir(), type: studyType() };
}

/** 套用偏好到畫面。容忍缺欄位與壞值 —— jsonb 不幫忙驗證 */
export function applyPrefs(p) {
  if (!p || typeof p !== 'object') return;
  const set = (sel, val) => {
    if (!val) return;
    // 用比對值而不是屬性選擇器 —— 不必處理跳脫，也不必碰 CSS.escape
    // （jsdom 沒有 CSS，而裸識別碼即使加可選鏈也會拋 ReferenceError）。
    const el = [...qsa(`${sel} input`)].find((i) => i.value === val);
    if (el) el.checked = true;                 // 找不到就不動：題型可能已被本站關掉
  };
  set('#mode-pick', p.mode);
  if (p.dir === 'ko2zh' || p.dir === 'zh2ko') userDir = p.dir;
  set('#type-pick', p.type);
  syncModeUI();                                // 依題型決定畫面上要顯示哪一個
}

/** 存偏好：本機立刻、雲端交給呼叫端（app.js 知道 user id） */
export function savePrefsLocal(userId) {
  try { localStorage.setItem(prefsKey(userId), JSON.stringify(readPrefs())); }
  catch { /* 隱私模式：雲端那一份仍然有效 */ }
}
export function loadPrefsLocal(userId) {
  try { return JSON.parse(localStorage.getItem(prefsKey(userId)) || 'null'); }
  catch { return null; }
}

export function initHome(d) {
  deps = d;

  // ★ 題型選單由註冊表產生，不寫死在 HTML。
  //
  //   寫死的後果實際發生過兩次，而且都不會報錯：
  //     · 新增「拼出來」之後選單上沒有它 —— 功能做完了卻沒有人點得到
  //     · 日文站關閉了「詞序重組」（日文不用空格分詞，實測 301 條裡
  //       只有 1 條有素材），選單卻照樣顯示，選了會靜靜退回翻卡自評
  //
  //   欄數跟著題型數走：兩欄排版在手機上一律成立，
  //   寬螢幕時才攤成一排（見 CSS 的 seg-4）。
  $('mode-pick').className = `seg${MODES.length === 4 ? ' seg-4' : ''}`;
  $('mode-pick').innerHTML = MODES.map((m, i) =>
    `<label><input type="radio" name="mode" value="${esc(m.id)}"${i === 0 ? ' checked' : ''}>`
    + `<span>${esc(m.label)}</span></label>`).join('');
  $('btn-primary').onclick = () => primaryAction?.();
  $('btn-free').onclick = () => deps.onFree();
  // 首頁的按鈕一律在這裡綁。先前「學習新的」綁在 app.js ——
  // 同一個畫面的按鈕分兩處綁，日後改一處漏一處，
  // 而漏掉的那顆不會報錯，只是點下去沒反應。
  $('btn-new').onclick = () => startNext();
  $('btn-drill-weak').onclick = () => {
    if (!weakIds.length) return msg('還沒有足夠的資料判斷弱項');
    deps.onDrillWeak(weakIds);
  };
  // 改題型／方向只影響「待複習」數 —— 統計、詞庫、弱項與方向無關，
  // 全量重載會打 6+N 個查詢，切個選項就卡一下。
  $('mode-pick').addEventListener('change', () => { syncModeUI(); refreshDue(); deps.onPrefsChange?.(); });
  $('dir-pick').addEventListener('change', () => {
    // 只有使用者自己動選鈕時才更新 userDir。
    // syncModeUI 因為題型強制而改 checked 不會走到這裡（那是程式改的，不是人改的）。
    userDir = qs('#dir-pick input:checked')?.value || userDir;
    syncModeUI(); refreshDue(); deps.onPrefsChange?.();
  });
  // 類型只影響「這輪抽什麼」，不影響到期張數的計算，所以不必 refreshDue()。
  // 但摘要要跟著變 —— 選項收合起來時，摘要是唯一看得到目前設定的地方。
  $('type-pick').addEventListener('change', () => { syncModeUI(); deps.onPrefsChange?.(); });
  $('btn-recall').onclick = () => deps.onRecall?.();
  on(EVENTS.ITEMS_CHANGED, () => { deckCounts = null; load(); });
  on(EVENTS.PROGRESS_WRITTEN, () => load());
  syncModeUI();
}

/** 只更新「待複習」——方向改變時走這裡 */
export async function refreshDue() {
  const user = deps?.user();
  if (!user) return;
  try {
    const due = await progress.dueCounts(user.id, [effectiveDir()]);
    $('s-due').textContent = due.total;
    // 環的目標值是 min(20, 待複習 + 已掌握)，所以待複習一變它也要跟著動。
    // 少了這一行，切換方向之後環會停在舊目標 —— 兩個數字互相矛盾，
    // 而使用者不會知道該信哪一個。
    renderRing(masteredToday(), dailyTarget(due.total));
    dueNow = due.total;
  } catch (e) { msg('載入失敗：' + (e.message || e)); }
}

// 進行中的載入。詞庫、記錄兩個分頁進入時也會呼叫 load()
// （課程選擇與學習記錄已經搬到那兩頁，但內容仍由這裡產生），
// 所以快速切分頁會同時觸發三輪、每輪七個查詢。
// 共用同一個 promise：多按幾下只算一次。
let loading = null;

// ★ 刻意不是 async。async function 會把回傳值再包一層新的 promise，
//   於是三次呼叫拿到三個不同的物件 —— 雖然 doLoad 只跑一次，
//   但呼叫端拿到的不是同一個，任何「是不是同一輪」的判斷都會失準。
//   （測試就是這樣抓到的：斷言 a === b 紅了，功能卻是對的。）
export function load() {
  if (loading) return loading;
  loading = doLoad().finally(() => { loading = null; });
  return loading;
}

async function doLoad() {
  const user = deps?.user();
  if (!user) return;
  try {
    const dirs = [effectiveDir()];
    // 詞庫先取 —— 生活場景的進度必須限定在 life-01 之內。
    // 生活、學習這些標籤 vocab-01 也在用，不限定的話進度會被灌水，
    // 場景永遠做不完。
    // ★ decks 不再單獨 await —— 先前它擋在 Promise.all 前面，
    //   每次載入都多一趟完整的往返（實測 200–300 ms，而首頁在三個分頁都會載入）。
    //   只有生活場景真的需要等它（進度必須限定在 life-01 之內），
    //   所以把「等 decks → 查場景」串成一條，與其他查詢並行。
    const decksP = content.listDecks();
    const lifeP = decksP.then((ds) => {
      const id = ds.find((d) => d.slug === 'life-01')?.id ?? null;
      return id ? content.tagProgress(user.id, lifeScenes(), id).catch(() => []) : [];
    }).catch(() => []);

    const [decks, due, today, overall, weak, daily, pron, life] = await Promise.all([
      decksP,
      progress.dueCounts(user.id, dirs),
      progress.todayStats(user.id),
      progress.overallStats(user.id),
      progress.weakItems(user.id, 8).catch(() => []),
      progress.dailyStats(user.id, 30).catch(() => []),
      // 發音課程進度失敗不該拖垮整個首頁 —— 它是加值資訊，不是主線
      content.pronProgress(user.id, pronOrder()).catch(() => []),
      lifeP,
    ]);

    $('s-due').textContent = due.total;
    $('s-reviewed').textContent = today.reviewed;
    $('s-acc').textContent = pct(today.accuracy);
    $('s-all-acc').textContent = overall.mastered;
    renderStreak(daily);


    // ★ 順序有意義：renderPron 會算出「下一課」，
    //   而建議區的大按鈕要指向它。反過來的話，第一次載入時
    //   建議區拿到的是上一輪的值（首次進站是 null），
    //   於是新手看到的仍是舊的那顆按鈕 —— 而且不會報錯。
    renderPron(pron);
    // 五十音表：站台有宣告才畫。available 決定哪些格子可以點 ——
    // ら行 的內容還沒進來時，格子要看得出「還沒加入」而不是「還沒學」。
    renderGojuon(lang().taxonomy.grid ?? null, pron,
                 new Set(pron.filter((r) => r.total > 0).map((r) => r.tag)));
    dueNow = due.total;
    renderRing(masteredToday(), dailyTarget(due.total));
    renderSuggestion(due.total, today, decks, due.carried);

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
  renderWeek(daily);
}

/**
 * 最近七天，有學的填實。
 *
 * 【為什麼要有，明明已經有「連續 N 天」】
 *   「連續 3 天」是一個結論，看不出昨天有沒有斷。
 *   七格一字排開，「昨天有、今天空著」一眼就看得到 ——
 *   而那比任何一句文案都更能讓人現在就打開。
 *
 * 【為什麼不畫更長（30 天）】
 *   30 格在手機上每格不到 3 px，看起來像雜訊。
 *   而且要回答的問題是「今天做了沒」，不是「這個月表現如何」——
 *   後者在記錄分頁有完整的圖。
 */
export function renderWeek(daily) {
  const box = $('week');
  if (!box) return;
  const has = new Set((daily || []).filter((d) => d.n > 0).map((d) => d.day));
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push(`<i class="${has.has(d) ? 'on' : ''}${i === 0 ? ' today-mark' : ''}"></i>`);
  }
  box.innerHTML = out.join('');
}

/**
 * 今日進度環：今天掌握了幾個 / 今天的目標。
 *
 * 【為什麼環裡放「已掌握」而不是「已答題數」】
 *   答題數會隨著答錯而膨脹 —— 一直答錯的人數字反而更漂亮，
 *   那是完全相反的訊號。掌握數只有真的連續答對才會動。
 */
export function renderRing(mastered, target) {
  const el = $('ring-fg');
  if (!el) return;
  const pct = target > 0 ? Math.min(1, mastered / target) : 0;
  const C = 2 * Math.PI * 44;
  el.style.strokeDashoffset = String(C * (1 - pct));
  el.classList.toggle('done', pct >= 1);
  $('s-done').textContent = target ? `${Math.min(mastered, target)}/${target}` : String(mastered);
  $('ring-sub').textContent = pct >= 1 ? '今日達標 ✓' : '今日已掌握';
}

let deckCounts = null;

/**
 * 下一步建議 —— 首頁最該回答的是「現在做什麼」。
 *
 * 原本只有一顆「開始複習」，待複習歸零時就變灰，然後沒有下文 ——
 * 使用者得自己想到去詞庫按「學新的」。這裡把當下最該做的那件事
 * 直接放進主按鈕。
 */
/**
 * 這批待複習裡，有幾條是「之前排定、當天沒做完而順延過來」的。
 *
 * 判準是到期超過一天 —— 今天才到期的不算順延。
 * 順延本身是自動的（沒做的卡 due_at 留在過去，隔天照樣算待複習，
 * 而清單照 due_at 排序，逾期最久的自然排最前面）。
 * 但這件事對學習者是隱形的：他只看到「待複習 63」，
 * 不知道其中 40 條是上週的，也就不知道該調整的是新課的速度。
 */

// ---------------------------------------------------------------------
// 每天先複習：掌握 20 個詞，今天的複習任務就算完成
//
// 【判準是「掌握」，不是「答過」】
//   一個詞要在同一輪之內連續答對三次才算掌握。
//   答過一次就算的話，胡亂點四個按鈕也會前進 ——
//   那個數字會變成「今天點了幾下」，而不是「今天學會了幾個」。
//
// 【為什麼要擋著不讓學新的】
//   學新的比複習有成就感 —— 新東西一直進來，舊的一直沒回頭看，
//   兩週後就是「學過 300 個詞、一個都想不起來」。
//   準時複習沒有任何即時回饋，靠自制力永遠打不過新鮮感，所以由系統擋。
//
// 【達標之後不強迫繼續】
//   剩下的複習照順延邏輯排到明天最前面，間隔不變。
//   要繼續複習可以，要去學新的也可以 —— 今天的責任已經盡了。
//   把人留在「還沒做完」的狀態，只會讓他明天不想打開。
//
// 【目標要以實際到期數封頂】
//   今天只有 8 個詞到期時，硬要湊 20 個永遠湊不到 ——
//   那會變成「一個新課都學不了」的死結，而且看不出原因。
//   剛開始學的人正是每天只有幾個詞到期的人，這個死結會擋在最前面。
// ---------------------------------------------------------------------
let dueNow = 0;        // 這次載入時的待複習量，按鈕據此判斷擋不擋
const DAILY_MASTERY_TARGET = 20;

const todayKey = () => lsKey('mastered-' + new Date().toISOString().slice(0, 10));

export function masteredToday() {
  return Number(localStorage.getItem(todayKey()) || 0);
}
/**
 * 一輪結束後累加。key 帶日期，跨日自動歸零，不必清理。
 *
 * @param kind 這一輪的性質。只有正規複習（review）算進今日任務。
 *
 * 【為什麼回顧清單不算】
 *   回顧清單是自己標記想多練的詞，不是今天到期的。
 *   算進去的話，靠練自選的詞就能湊滿 20/20，
 *   而真正該複習的一條都沒做 —— 那讓「今日複習任務」這個數字失去意義。
 *
 *   先前的條件寫在 app.js 且只判斷 !free，於是 drill 被算進去了。
 *   規則搬到這裡是為了驗得到：app.js 是接線檔，沒有執行期測試。
 */
export function addMasteredToday(n, kind = 'review') {
  if (kind !== 'review') return;
  if (n > 0) localStorage.setItem(todayKey(), String(masteredToday() + n));
}
/** 今天要掌握幾個才算完成 —— 到期數不足 20 時以到期數為準 */
export function dailyTarget(dueCount) {
  return Math.min(DAILY_MASTERY_TARGET, dueCount + masteredToday());
}
/**
 * 學新課的統一入口。擋下來時只給訊息，不做任何事。
 *
 * 所有「學新的」按鈕都走這裡 —— 分散在各處自己判斷的話，
 * 漏掉一個入口不會報錯，只會讓那個按鈕變成繞過限制的後門，
 * 而使用者會很自然地一直用那一個。
 */
function startLesson(run) {
  const why = newLessonBlocked(dueNow);
  if (why) return msg(why);
  run();
}

/**
 * 現在可以學新的嗎？回傳 null 表示可以，否則回傳擋下來的理由。
 *
 * ★ 目前一律放行 —— 使用者的決定（2026-08-18）。
 *
 * 【原本擋著的理由，留在這裡供日後參考】
 *   學新的比複習有成就感，新東西一直進來、舊的一直沒回頭，
 *   兩週後就是「學過三百個詞、一個都想不起來」。
 *   準時複習沒有即時回饋，靠自制力打不過新鮮感。
 *
 * 【為什麼保留這個函式而不是整段刪掉】
 *   進度本身還在算（首頁照樣顯示 x/20 已掌握），只是不再擋人。
 *   把判斷留在一個地方、只改回傳值，日後要恢復或改成「軟提醒」
 *   都只動這裡；散掉的話下次要重找一遍所有入口。
 */
export function newLessonBlocked(dueCount) {   // eslint-disable-line no-unused-vars
  return null;
}

/**
 * 「學習新的」按鈕。
 *
 * 走的是主按鈕在「今天沒有到期」時會走的那條路：
 * 有發音課程就上下一課，否則從第一個詞庫抓新詞。
 * 不另外實作 —— 兩份「開始學新的」邏輯必然漂移，
 * 而漂移的症狀是「兩顆按鈕點下去結果不一樣」，使用者只會覺得壞了。
 */
export function startNext() {
  if (nextLessonTag) return deps.onStudyTag(nextLessonTag);
  if (firstDeckId) return deps.onNewDeck(firstDeckId);
  msg('還沒有詞庫。到「我的 → 批次匯入」貼上你的詞表。');
}

export function renderSuggestion(dueCount, today, decks, carried = 0) {
  const box = $('suggest');
  const btn = $('btn-primary');
  box.classList.remove('done');
  firstDeckId = decks[0]?.id ?? null;

  // ★ 有做到一半的一輪就先給回去的路。
  //   分頁列在學習中也顯示了（見 router.js），所以人隨時可能離開 ——
  //   離開不會弄丟進度（每答一題就存），但沒有入口就等於把自己鎖在外面。
  //   這一條排在最前面：它是此刻最該做的事，其餘建議都排在它後面。
  const left = deps?.roundLeft?.() ?? 0;
  if (left > 0) {
    box.innerHTML = `這一輪還有 <b>${left}</b> 題沒做完。`;
    btn.textContent = `繼續這一輪（還有 ${left} 題）`;
    btn.disabled = false;
    primaryAction = () => deps.onResumeRound();
    return;
  }

  if (dueCount > 0) {
    // 超過兩輪就把「做不完沒關係」講清楚 ——
    // 看到 63 而不知道可以分次做，很多人會直接關掉。
    const rounds = Math.ceil(dueCount / ROUND_SIZE);
    const target = dailyTarget(dueCount);
    const got = masteredToday();
    box.innerHTML = `今天的複習任務 <b>${Math.min(got, target)}/${target}</b> 個已掌握`
      + `（連續答對 ${ROUND_CRITERION} 次才算）<br>還有 <b>${dueCount}</b> 個詞到期`
      + (carried ? `（其中 <b>${carried}</b> 條是之前順延過來的）` : '')
      + '，先把複習做完最划算 —— 間隔重複的效果全靠準時複習。'
      + (rounds > 2
        ? `<br><span class="muted">一輪 ${ROUND_SIZE} 個詞，做不完沒關係：`
          + '沒做到的會排到明天最前面，複習間隔不會因此變長。'
          + (carried > dueCount / 2
            ? '<br>★ 順延的已經超過一半，先暫停學新課幾天，讓它降下來。'
            : '')
          + '</span>'
        : '');
    btn.textContent = `開始複習（一輪 ${ROUND_SIZE} 個詞，共 ${dueCount}）`;
    btn.disabled = false;
    primaryAction = () => deps.onReview();
    return;
  }

  // ★ 有課程就走課程，不要走「整個詞庫抓 20 張」。
  //   兩條路的差別對初學者很大：
  //     走課程 → 範圍是一課、開頭會顯示這一課的口訣（書上最有價值的東西）
  //     走詞庫 → 一次 20 張橫跨兩三課，而且沒有任何導言
  //   原本的大按鈕指向後者，等於把新手帶到比較差的那條路，
  //   而他不會知道另一條存在。
  if (nextLessonTag) {
    box.classList.add('done');
    box.innerHTML = today.reviewed
      ? `✓ 今日複習已清空，答了 <b>${today.reviewed}</b> 題。接著上第 ${nextLessonNo} 課。`
      : `✓ 今天沒有到期的複習。接著上第 ${nextLessonNo} 課 —— 一課約 8 條，一次坐下來走得完。`;
    btn.textContent = `開始第 ${nextLessonNo} 課：${nextLessonTag}`;
    btn.disabled = false;
    primaryAction = () => startLesson(() => deps.onStudyTag(nextLessonTag));
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

// 首頁不再有「詞庫」卡 —— 它是第三個「開始學」的入口，
// 而三個入口指向同一批內容時，使用者要先看懂差別才敢按。
// 選詞庫、看內容、學新的，全部搬到「詞庫」分頁（views/browse.js）。
// firstDeckId 仍保留：沒有發音課程可上時，主按鈕會落到它。

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
  const { next, done: doneCount, mastered: masteredCount, total, ordered } = nextLesson(rows);
  nextLessonTag = next?.tag ?? null;
  nextLessonNo = doneCount + 1;
  $('pron-count').textContent = total;
  if (!total) {
    $('pron-card').classList.add('hidden');
    return;
  }
  const rate = (r) => r.mastered / r.total;

  // 「走完」與「掌握」是兩件事，分開講。
  // 只顯示掌握數的話，剛學完的人看到的是 0 —— 那等於告訴他剛才白做了。
  const sub = (r) =>
    r.started >= r.total ? `${r.total} 條 · 已全部學過`
    : r.started > 0 ? `${r.total} 條 · 學過 ${r.started}`
    : `${r.total} 條 · 還沒開始`;

  $('pron-next').innerHTML = next
    ? `<div class="pron-next">
         <div class="n-body">
           <div class="n-label">下一課 ${doneCount + 1} / ${total}</div>
           <div class="n-title">${esc(next.tag)}</div>
           <div class="n-sub">${sub(next)}</div>
         </div>
         <button class="primary small" data-pron="${esc(next.tag)}">開始</button>
       </div>`
    : `<div class="pron-next"><div class="n-body">
         <div class="n-title">🎉 ${total} 課全部走過一遍了</div>
         <div class="n-sub">已掌握 ${masteredCount} / ${total} 課 ——
           掌握是「隔三週還記得」，剩下的交給複習慢慢長上來。</div>
       </div></div>`;

  // 進度條分兩層：淺色＝走過的、深色＝已掌握的。
  // 只畫掌握的話，剛學完的一課看起來和從沒碰過的一模一樣。
  $('pron-list').innerHTML = ordered.map((r) => {
    const walked = Math.round((r.started / r.total) * 100);
    const mast = Math.round(rate(r) * 100);
    const cls = rate(r) >= LESSON_DONE ? ' done' : (r.started >= r.total ? ' walked' : '');
    return `<div class="pron-row${cls}">
      <span class="p-name">${esc(r.tag)}</span>
      <span class="p-bar"><b style="width:${walked}%"></b><i style="width:${mast}%"></i></span>
      <span class="p-num" title="學過 ${r.started} · 掌握 ${r.mastered}（共 ${r.total} 條）">${r.started}/${r.total}</span>
      <button data-pron="${esc(r.tag)}">學</button>
    </div>`;
  }).join('');

  qsa('[data-pron]').forEach((b) => {
    b.onclick = () => startLesson(() => deps.onStudyTag(b.dataset.pron));
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

  // 收合列上寫出數量 —— 「看全部場景」不寫幾個，等於要人先點開才知道值不值得點。
  const shown = scenes.filter((s) => s.total > 0);
  const cnt = $('life-count');
  if (cnt) cnt.textContent = String(shown.length);

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

  // total 0 的場景不印 —— 一列「0/0 [學]」點下去是空的學習階段，
  // 使用者只會以為壞了。標籤還沒有內容是內容的問題，不該變成畫面上的死按鈕。
  $('life-list').innerHTML = scenes.filter((s) => s.total > 0).map((s) => {
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
          <div>${wordHTML(w)} <span class="muted">${esc(w.zh)}</span>
            <span class="muted">· ${dirShort()[w.direction]}</span></div>
          <div class="pct ${cls}">${pct(a)} <span class="muted">(${w.total_reviews})</span></div>
        </div>`;
      }).join('')
    : emptyState('🎯', '同一條答滿 3 次後<br>這裡會列出最需要加強的');
}

/**
 * 回顧清單。
 *
 * 【為什麼要顯示標記的理由與所屬課】
 *   清單放久了會忘記「當初為什麼標它」。只列詞的話，
 *   過兩週看到一排字，人會不知道從何練起，然後乾脆不練。
 */
export function renderRecall(rows) {
  const card = $('recall-card');
  if (!rows.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('recall-n').textContent = `${rows.length} 條`;
  $('recall-list').innerHTML = rows.slice(0, 8).map((r) => {
    const it = r.item;
    // 課程標籤與詞本身相同時不重複顯示 —— 假名卡的課就是那個假名，
    // 印成「ぬ … ぬ」只是佔位置，還讓人以為是兩個不同的東西。
    const tag = (it.tags || []).find((t) => t.length === 1) || '';
    const lesson = tag === it.ko ? '' : tag;
    return `<div class="recall-row">
      <span class="r-ko">${wordHTML(it)}</span>
      <span class="r-zh muted">${esc(it.zh)}</span>
      ${lesson ? `<span class="r-tag">${esc(lesson)}</span>` : ''}
      ${r.note ? `<span class="r-note">${esc(r.note)}</span>` : ''}
      <button class="r-del" data-recall-del="${esc(it.id)}" title="移出清單">×</button>
    </div>`;
  }).join('') + (rows.length > 8 ? `<p class="hint nomargin">…另有 ${rows.length - 8} 條</p>` : '');

  qsa('[data-recall-del]').forEach((b) => {
    b.onclick = () => deps.onRemoveRecall?.(b.dataset.recallDel);
  });
}

/**
 * 五十音表。只有宣告了 GOJUON_GRID 的站台才畫（韓文站是 null）。
 *
 * 三種狀態要一眼分得出來，因為它們對學習者的意義完全不同：
 *   還沒學  → 「我接下來要學這些」
 *   學過了  → 「我走過了，但還在鞏固」
 *   已掌握  → 「這個真的會了」
 * 只用兩種顏色的話，剛學完的一課會和從沒碰過的長得一樣。
 */
export function renderGojuon(grid, rows, available) {
  const box = opt('grid-box');
  if (!box) return;   // 這一站沒有字母表視圖
  if (!grid) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');

  const by = Object.fromEntries(rows.map((r) => [r.tag, r]));
  // 片假名由平假名推得（碼位 +0x60）—— あ 與 ア 是同一個音的兩種寫法，
  // 不必再維護一份對照表。統計含兩種，所以片假名上線後數字自己會變。
  const kata = (k) => String.fromCodePoint(k.codePointAt(0) + 0x60);
  const all = grid.rows.flatMap((r) => r.kana).filter(Boolean)
    .flatMap((k) => [k, kata(k)])
    .filter((k) => available.has(k));
  const walked = all.filter((k) => by[k] && by[k].started >= by[k].total).length;
  opt('grid-sub').textContent = `${walked} / ${all.length} 個假名`;

  const head = `<div class="g-row g-head"><span class="g-lab"></span>${
    grid.cols.map((c) => `<span class="g-col">${esc(c[0])}</span>`).join('')}</div>`;

  opt('gojuon').innerHTML = head + grid.rows.map((r) => `
    <div class="g-row">
      <span class="g-lab">${esc(r.row)}</span>
      ${r.kana.map((k) => {
        if (!k) return '<span class="g-cell g-none"></span>';
        // ★ 一格放兩種寫法：あ 在上、ア 在下。
        //   分成兩張表會讓學習者以為要背 92 個獨立符號，
        //   實際上是 46 個音各有兩種寫法 —— 那個認知差別很大。
        return `<span class="g-cell-pair">${[k, kata(k)].map((x) => {
          if (!available.has(x)) {
            return `<span class="g-cell g-todo" title="${esc(x)}　這一課的內容還沒加進來">${esc(x)}</span>`;
          }
          const p = by[x];
          const done = p && p.mastered / p.total >= LESSON_DONE;
          const seen = p && p.started >= p.total;
          const cls = done ? 'g-done' : seen ? 'g-seen' : 'g-new';
          const tip = !p ? '' : done ? '已掌握' : seen ? `學過 ${p.started}/${p.total}` : '還沒開始';
          return `<button class="g-cell ${cls}" data-pron="${esc(x)}" title="${esc(x)}　${tip}">${esc(x)}</button>`;
        }).join('')}</span>`;
      }).join('')}
    </div>`).join('');

  renderDakuon(lang().taxonomy.dakuon, by);

  qsa('#gojuon [data-pron], #dakuon [data-pron]').forEach((b) => {
    b.onclick = () => startLesson(() => deps.onStudyTag(b.dataset.pron));
  });
}

/**
 * 濁音・半濁音對照：清音在上、變化形在下。
 *
 * 這一區存在的理由只有一句話：讓學習者看到「が 是 か 加兩點」，
 * 而不是把它當第 47 個要背的新符號。
 * 所以顯示方式是「並排對照」而不是「另一張表」——
 * 另開一張表等於承認它們是新字，正好與要教的相反。
 */
function renderDakuon(rows, by) {
  const box = opt('dakuon');
  if (!box) return;
  if (!rows) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');

  // 這些字沒有各自的課，全部指向「濁音」／「半濁音」那一課
  const cell = (k, tag) => {
    const p = by[tag];
    const done = p && p.mastered / p.total >= LESSON_DONE;
    const seen = p && p.started >= p.total;
    return `<button class="g-cell ${done ? 'g-done' : seen ? 'g-seen' : 'g-new'}"
      data-pron="${esc(tag)}" title="${esc(k)}　點一下練「${esc(tag)}」這一課">${esc(k)}</button>`;
  };

  box.innerHTML = rows.map((r) => {
    const tag = r.half ? '半濁音' : '濁音';
    const mark = r.half ? '゜' : '゛';
    return `<div class="d-block">
      <div class="d-lab">${esc(r.from)} <span class="muted">＋${mark}</span></div>
      <div class="g-row">${r.clear.map((k) =>
        `<span class="g-cell g-todo" title="清音（已在上表）">${esc(k)}</span>`).join('')}</div>
      <div class="g-row">${r.voiced.map((k) => cell(k, tag)).join('')}</div>
    </div>`;
  }).join('');
}
