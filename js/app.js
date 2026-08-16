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
import * as home from './views/home.js';
import * as study from './views/study.js';
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
  onFinish: (stats, free) => { study.renderDone(stats, free); show('view-done'); },
  onError: (e) => msg('儲存失敗：' + (e.message || e)),
});

async function ensurePool() {
  if (!pool.length) pool = await content.distractorPool().catch(() => []);
}

/** 開始一輪：依題型過濾佇列，過濾後沒東西就別進去 */
async function begin(entries, { freeMode = false, note = '' } = {}) {
  const modeId = home.studyMode();
  if (needsPool(modeId)) await ensurePool();

  session.start(entries, { freeMode });
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
    await begin(shuffle(rows.map((c) => ({ item: c.items, direction: c.direction, card: c }))));
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
    if (!rows.length) return msg(tag ? `「${tag}」這組已經學完了 👍` : '這個詞庫的新內容已經學完了 👍', 'ok');
    await begin(rows);
  } catch (e) { msg(e.message || e); }
}

/** 自由練習：不看到期時間、不受上限，只記成績不動排程 */
async function startFree({ ids = null, tag = '' } = {}) {
  try {
    const items = await content.pickItems({ ids, tag, limit: 60 });
    if (!items.length) return msg('沒有符合的內容');
    const dir = home.effectiveDir();
    await begin(shuffle(items.map((item) => ({ item, direction: dir, card: null }))),
                { freeMode: true, note: '自由練習 · 只記錄成績，不影響複習排程' });
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
initVoiceUI();
initImporterAndAdmin();

home.initHome({
  ...deps,
  onReview: startReview,
  onFree: () => startFree({}),
  onNewDeck: (deckId) => startNew(deckId),
  onDrillWeak: (ids) => startFree({ ids }),
});
study.initStudy({ session, getCtx: studyCtx, onQuit: () => show('view-done') });
browse.initBrowse({ ...deps, onPractice: (ids) => startFree({ ids }), onStudyTag: (t) => startNew(null, t) });
history.initHistory(deps);
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
