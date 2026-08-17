// =====================================================================
// 啟動與裝配
//
// 本檔只做三件事：建立 session、把各模組接起來、處理登入狀態。
// 任何業務邏輯都不該寫在這裡 ——
//   資料存取 → data/*      題型 → study/modes/*
//   會話邏輯 → study/session.js   畫面 → views/*
// =====================================================================
import { $, esc, msg, shuffle } from './core/dom.js';
import { on, emit, EVENTS } from './core/bus.js';
import * as auth from './data/auth.js';
import * as content from './data/content.js';
import * as progress from './data/progress.js';
import { createSession } from './study/session.js';
import { getMode, needsPool } from './study/modes/index.js';
import { show, onEnter, initTabs, viewFromHash } from './views/router.js';
import { initTheme } from './views/theme.js';
import { initVoiceUI } from './views/voice.js';
import { initAuth } from './views/auth.js';
import { initEditor, openEditor, loadDecksInto } from './views/editor.js';
import { initEdits } from './views/edits.js';
import * as home from './views/home.js';
import * as study from './views/study.js';
import { LESSON_INTRO } from './core/taxonomy.js';

let currentLesson = '';   // 本輪練的是哪一課，結束畫面要用
import * as browse from './views/browse.js';
import * as history from './views/history.js';
import * as importer from './views/importer.js';

// ---------------------------------------------------------------------
// 應用狀態：只有這三個是跨模組共享的，其餘各自封裝
// ---------------------------------------------------------------------
let user = null;
let profile = null;
let pool = [];              // 選擇題干擾項池

const isAdmin = () => profile?.role === 'admin';
const studyCtx = () => ({ pool, isAdmin: isAdmin(), modeId: home.studyMode() });

// ---------------------------------------------------------------------
// 學習會話
// ---------------------------------------------------------------------
const session = createSession({
  save: (p) => {
    const args = { userId: user.id, ...p };
    // 自由練習只記錄不動排程；正規複習兩者都寫。
    return p.free ? progress.logPractice(args) : progress.saveReview(args);
  },
  onChange: (state) => study.render(state),
  // 收尾話要知道剛練的是哪一課；自由練習不算推進課程，所以不帶
  onFinish: (stats, free) => {
    study.renderDone(stats, free, free ? '' : currentLesson);
    show('view-done');
  },
  onError: (e) => msg('儲存失敗：' + (e.message || e)),
});

async function ensurePool() {
  if (!pool.length) pool = await content.distractorPool().catch(() => []);
}

/** 開始一輪：依題型過濾佇列，過濾後沒東西就別進去 */
async function begin(entries, { freeMode = false, kind = 'review', note = '', lesson = '' } = {}) {
  // 導言與收尾話每輪都要重設 —— 不清掉的話，下一輪會掛著上一課的內容
  currentLesson = lesson;
  study.setLesson(lesson, lesson ? LESSON_INTRO[lesson] : '');
  const modeId = home.studyMode();
  if (needsPool(modeId)) await ensurePool();

  session.start(entries, { freeMode, mode: modeId, kind });
  const mode = getMode(modeId);
  const { kept, dropped } = session.filter((e) => mode.canUse(e.item, studyCtx()));

  if (!kept) {
    return msg(`這批內容沒有適合「${mode.label}」的題目`
             + (modeId === 'scramble' ? '（需要韓文能拆成 2 個以上詞塊）' : '')
             + '。換個題型，或換一批內容。');
  }
  if (dropped) msg(`本輪 ${kept} 題（已略過 ${dropped} 條不適用的）`, 'ok');
  else if (note) msg(note, 'ok');

  show('view-study');
  study.render(session.state());
}

// ---------------------------------------------------------------------
// 三種進入學習的路徑
// ---------------------------------------------------------------------
async function startReview() {
  try {
    const rows = await progress.fetchDue(user.id, [home.effectiveDir()], 200);
    if (!rows.length) return msg('沒有待複習的卡片', 'ok');
    await begin(shuffle(rows.map((c) => ({ item: c.items, direction: c.direction, card: c }))),
                { kind: 'review' });
  } catch (e) { msg(e.message || e); }
}

async function startNew(deckId, tag = '') {
  try {
    // 每日新卡上限：一次灌太多新詞，隔天的複習量會爆掉
    const limit = profile?.daily_new_limit ?? 20;
    const done = await progress.newCardsToday(user.id).catch(() => 0);
    const room = Math.max(0, limit - done);
    if (!room) return msg(`今日新卡已達上限（${limit} 張）。先把複習做完，明天再來 👍`, 'ok');

    const rows = await progress.fetchNewItems(user.id, deckId, [home.effectiveDir()], room, tag);
    if (!rows.length) {
      // 一組的詞全都學過、但還沒掌握牢時，這裡原本只丟一句「已經學完了」就沒下文。
      // 發音課程的「下一課」定義是「還沒掌握牢」而非「沒碰過」，
      // 所以這種情況是常態不是例外 —— 按了沒反應，學習者只會覺得壞掉了。
      // 改成轉去練同一組的既有內容。
      if (tag) {
        msg(`「${tag}」的新詞都學過了，改成練習這一組 👍`, 'ok');
        return startFree({ tag, kind: 'drill' });
      }
      return msg('這個詞庫的新內容已經學完了 👍', 'ok');
    }
    await begin(rows, { kind: 'new', lesson: tag });
  } catch (e) { msg(e.message || e); }
}

/** 自由練習：不看到期時間、不受上限，只記成績不動排程 */
/**
 * 開始一個生活場景。與發音課程共用同一條路，差別只在取材範圍：
 * 場景是多標籤的聯集，且限定在 life-01 之內
 * —— 生活、學習這些標籤 vocab-01 也在用，不限定就會混進通用詞彙。
 */
async function startScene(scene) {
  if (!scene) return;
  const deck = (await content.listDecks()).find((d) => d.slug === 'life-01');
  if (!deck) return msg('找不到「生活 · 興趣」詞庫');
  const limit = profile?.daily_new_limit ?? 20;
  const done = await progress.newCardsToday(user.id).catch(() => 0);
  const room = Math.max(0, limit - done);
  if (!room) return msg(`今日新卡已達上限（${limit} 張）。先把複習做完，明天再來 👍`, 'ok');

  const rows = await progress.fetchNewItems(user.id, deck.id, [home.effectiveDir()],
                                            room, scene.tags);
  if (!rows.length) {
    msg(`「${scene.label}」的新詞都學過了，改成練習這一組 👍`, 'ok');
    return startFree({ tag: scene.tags, deckId: deck.id, kind: 'drill' });
  }
  await begin(rows, { kind: 'new' });
}

/**
 * @param keepOrder 保留原順序（對話用）。預設打亂 ——
 *   一般練習照原順序會讓人靠位置記答案，但對話照順序是刻意的：
 *   那練的是「這句接哪句」，順序本身就是內容。
 */
async function startFree({ ids = null, tag = '', deckId = null,
                           kind = 'free', keepOrder = false } = {}) {
  try {
    const items = await content.pickItems({ ids, tag, deckId, limit: 60 });
    if (!items.length) return msg('沒有符合的內容');
    const dir = home.effectiveDir();
    const entries = items.map((item) => ({ item, direction: dir, card: null }));
    await begin(keepOrder ? entries : shuffle(entries),
                { freeMode: true, kind, lesson: tag,
                  note: kind === 'drill'
                    ? '弱項修復 · 只記錄成績，不影響複習排程'
                    : '自由練習 · 只記錄成績，不影響複習排程' });
  } catch (e) { msg(e.message || e); }
}

// ---------------------------------------------------------------------
// 裝配
// ---------------------------------------------------------------------
const deps = { user: () => user, isAdmin };

initTheme();
initTabs();
initAuth();
initEditor();
initEdits();
initVoiceUI();
initImporterAndAdmin();

home.initHome({
  ...deps,
  onReview: startReview,
  onFree: () => startFree({}),
  onNewDeck: (deckId) => startNew(deckId),
  onDrillWeak: (ids) => startFree({ ids, kind: 'drill' }),
  // 發音課程的「開始」走與詞庫瀏覽的「學這組」同一條路 ——
  // 同一件事只能有一個入口實作，兩份必然漂移
  onStudyTag: (t) => startNew(null, t),
  // 場景由多個標籤組成，且只在 life-01 之內取材
  onStudyScene: (s) => startScene(s),
});
study.initStudy({ session, getCtx: studyCtx, onQuit: () => show('view-done') });
browse.initBrowse({ ...deps,
  onPractice: (ids) => startFree({ ids }),
  onStudyTag: (t) => startNew(null, t),
  // 對話的翻譯練習：走同一條自由練習的路，只差要不要打亂
  onPracticeDialogue: (ids, keepOrder) => startFree({ ids, keepOrder, kind: 'drill' }),
  // 對話練習模式的自評：記成績但不動複習排程 ——
  // 檢驗自己的臨時動作，不該打亂長期的複習節奏（與自由練習同一個原則）
  onSelfRate: (item, direction, ok) =>
    progress.logPractice({ item, direction, rating: ok ? 3 : 1,
                           mode: 'flip', activity: 'free' })
            .catch(() => {}),
});
history.initHistory(deps);
history.initWords((ids) => startFree({ ids, kind: 'drill' }));
importer.initImporter();

onEnter('view-home', () => home.load());
onEnter('view-browse', () => browse.open());
onEnter('view-history', () => history.open());
onEnter('view-import', () => importer.open());

function initImporterAndAdmin() {
  $('btn-add').onclick = async () => {
    await loadDecksInto($('e-deck'));
    openEditor({ id: null, ko: '', zh: '', tags: [], item_type: 'word' });
  };
  $('btn-import').onclick = () => show('view-import');
  $('btn-import-back').onclick = () => show('view-me');
  $('btn-back').onclick = () => show('view-home');
}

// 內容變動 → 干擾項池失效，下輪重抓
on(EVENTS.ITEMS_CHANGED, () => { pool = []; });
on(EVENTS.ITEM_UPDATED, (saved) => {
  const i = pool.findIndex((x) => x.id === saved.id);
  if (i >= 0) Object.assign(pool[i], saved);
});

// ---------------------------------------------------------------------
// 登入狀態
// ---------------------------------------------------------------------
async function onUser(u) {
  user = u;
  $('whoami').textContent = u ? auth.displayName(u) : '';
  if (!u) {
    profile = null;
    $('admin-tag').classList.add('hidden');
    $('admin-card').classList.add('hidden');
    return show('view-auth');
  }
  // isAdmin 僅供 UX（顯示徽章與管理入口）；真正的寫入邊界是 RLS
  profile = await auth.myProfile(u.id).catch(() => null);
  $('admin-tag').classList.toggle('hidden', !isAdmin());
  $('admin-card').classList.toggle('hidden', !isAdmin());
  // username 與 email 是使用者自己填的，必須轉義 ——
  // 註冊時取的是登入欄位原樣，塞得進 <img onerror=...>
  $('me-account').innerHTML =
    `帳號 <b>${esc(profile?.username)}</b>　角色 ${isAdmin() ? '管理員' : '一般使用者'}<br>`
    + `<span class="hint">${esc(u.email)}</span>`;
  // 重新整理後回到原本那一頁
  await show(viewFromHash());
}

auth.onChange(onUser);
(async () => { await onUser(await auth.currentUser()); })();
