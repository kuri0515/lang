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
import { difficultyScore } from './core/srs.js';
import * as auth from './data/auth.js';
import * as content from './data/content.js';
import * as progress from './data/progress.js';
import { createSession, orderForDiscrimination, ROUND_SIZE } from './study/session.js';
import { getMode, needsPool } from './study/modes/index.js';
import { show, onEnter, initTabs, viewFromHash } from './views/router.js';
import { initTheme } from './views/theme.js';
import { initVoiceUI } from './views/voice.js';
import { initAuth } from './views/auth.js';
import { initEditor, openEditor, loadDecksInto } from './views/editor.js';
import { initEdits } from './views/edits.js';
import * as home from './views/home.js';
import * as study from './views/study.js';
import { introFor, confusableOf } from './core/taxonomy.js';

let currentLesson = '';   // 本輪練的是哪一課，結束畫面要用
import * as browse from './views/browse.js';
import * as history from './views/history.js';
import * as importer from './views/importer.js';
import { lang } from './core/lang.js';

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
    // 三種寫法，差別在「要不要動排程」：
    //   回顧清單 → 只縮不放（答得好不動、答不好才拉近）
    //   自由練習 → 完全不動
    //   正規複習 → 照 SRS 算出來的寫
    if (p.activity === 'drill') return progress.logRecall(args);
    return p.free ? progress.logPractice(args) : progress.saveReview(args);
  },
  onChange: (state) => study.render(state),
  // 收尾話要知道剛練的是哪一課；自由練習不算推進課程，所以不帶
  onFinish: (stats, free) => {
    // 這一輪掌握了幾個，累加到今天的進度。
    // 自由練習不算 —— 它不動排程，也不該讓人靠它解鎖新課。
    if (!free) home.addMasteredToday(stats.mastered || 0);
    // 只有複習才有「還剩多少」—— 學新課、自由練習都是一次一批，沒有續攤的概念
    // 可練的內容＝剛做完那一輪 ＋ 今天還沒做的。
    // 刻意不從整個詞庫抓 —— 那會把還沒學過的詞端出來，
    // 等於繞過「先複習完才能學新的」那道閘門，而使用者會很自然地一直用它。
    const extra = [...lastBatchIds, ...reviewQueue.map((e) => e.item.id)];
    study.renderDone(stats, free, free ? '' : currentLesson,
                     reviewQueue.length, extra.length > 0);
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
  // 導言優先取自本輪的假名卡（雲端資料），沒有才回設定查（規則課）
  study.setLesson(lesson, introFor(lesson, entries));
  const modeId = home.studyMode();
  if (needsPool(modeId)) await ensurePool();

  session.start(entries, { freeMode, mode: modeId, kind });
  const mode = getMode(modeId);
  // 兩道過濾分開報，因為兩種空結果要給的建議完全不同：
  //   類型過空 → 「這批沒有句子」，該換的是類型或內容
  //   題型過空 → 「沒有適合這個題型的」，該換的是題型
  // 併成一句「沒有題目」的話，使用者只會反覆換錯的那一個。
  const type = home.studyType();
  if (type !== 'all') {
    const r = session.filter((e) => home.matchesType(e.item, type));
    if (!r.kept) {
      const what = type === 'sentence' ? '句子' : '單字';
      return msg(`這批內容裡沒有${what}。改選「全部」，或換一批內容。`);
    }
  }
  const { kept, dropped } = session.filter((e) => mode.canUse(e.item, studyCtx()));

  if (!kept) {
    return msg(`這批內容沒有適合「${mode.label}」的題目`
             + (modeId === 'scramble' ? `（需要${lang().termLabel}能拆成 2 個以上詞塊）` : '')
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
// 一輪的題數定義在 study/session.js（單一來源，首頁的提示文字也讀它）
let reviewQueue = [];        // 這一批還沒做的（分輪用）
let lastBatchIds = [];       // 剛做完那一輪的條目，供「再多練一些」使用

async function startReview() {
  try {
    const rows = await progress.fetchDue(user.id, [home.effectiveDir()], 200);
    if (!rows.length) return msg('沒有待複習的卡片', 'ok');
    // ★ 不打散整個佇列 —— fetchDue 已經照 due_at 排好，逾期最久的在最前面，
    //   那正是「今天沒做完的，明天排在最前面」的意思（順延）。
    //   上一版在這裡 shuffle(rows)，理由是「一輪全是同一課會失去交錯」，
    //   但那個需求只存在於一輪之內，不該把跨輪的優先權一起打散 ——
    //   打散之後，逾期三天的卡可能排在第四輪，而使用者往往只做一輪。
    //   正確的做法是：輪次照優先權切，輪內再打散（見 nextRound）。
    // 難度分高的排前面，同分再照逾期久的先。
    //
    // 只照 due_at 排的話，剛答錯的卡（due_at 被設成一分鐘後）會排到最後面 ——
    // 比所有逾期的卡都「新」。使用者往往只做前面幾輪，
    // 等於最該練的那些永遠輪不到，而畫面上完全看不出來。
    reviewQueue = rows
      .map((c) => ({ item: c.items, direction: c.direction, card: c }))
      .sort((a, b) => difficultyScore(b.card) - difficultyScore(a.card)
                   || Date.parse(a.card.due_at) - Date.parse(b.card.due_at));
    await nextRound();
  } catch (e) { msg(e.message || e); }
}

/**
 * 從 reviewQueue 取一輪出來開始。
 *
 * 【取的是「最前面」的 20 條，不是隨機 20 條】
 *   佇列照 due_at 排序，所以最前面就是逾期最久的 ——
 *   今天沒做完的那些，明天會自然出現在最前面（它們的 due_at 更舊）。
 *   這就是順延：間隔不變，只是實際複習的日子往後移。
 *
 * 【但輪內要重排】
 *   同一課的卡往往同時到期，照 due_at 取出來會連著一整輪同一課。
 *   重排只影響「這一輪的先後」，不影響「哪些被選中」。
 *
 *   用 orderForDiscrimination 而不是單純 shuffle —— 跟回顧清單同一套：
 *   形近組（ぬ／め）要相鄰出現才練得到辨別，被打散到一輪的頭和尾
 *   等於各自單獨練，而各自單獨練本來就都會。組間仍是隨機的。
 */
async function nextRound() {
  const batch = orderForDiscrimination(reviewQueue.splice(0, ROUND_SIZE), confusableOf);
  lastBatchIds = batch.map((e) => e.item.id);
  if (!batch.length) return msg('複習已清空 ✓', 'ok');
  await begin(batch, { kind: 'review' });
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
    await begin(keepOrder ? entries : orderForDiscrimination(entries, confusableOf),
                { freeMode: true, kind, lesson: tag,
                  note: kind === 'drill'
                    ? '弱項修復 · 只記錄成績，不影響複習排程'
                    : '自由練習 · 只記錄成績，不影響複習排程' });
  } catch (e) { msg(e.message || e); }
}

/**
 * 回顧清單練習。
 *
 * ★ 不是 freeMode。free 的語意是「完全不動排程」，
 *   而回顧要的是「答得好不動、答不好拉近」—— 那是第三種語意，
 *   由 activity='drill' 分派到 progress.logRecall。
 *   混用 free 的話，答不好的訊號會被整個丟掉。
 */
async function startRecall() {
  try {
    const dir = home.effectiveDir();
    const entries = await progress.fetchRecallEntries(user.id, dir);
    if (!entries.length) return msg('回顧清單是空的。在卡片上點 ☆ 就會加進來。');
    // ★ 不用 shuffle：形近組要相鄰出現才練得到辨別。
    //   ぬ 和 め 被打散到頭尾，中間隔十幾題，等於各自單獨練 ——
    //   而各自單獨練本來就都會。
    await begin(orderForDiscrimination(entries, confusableOf), {
      kind: 'drill',
      note: '回顧清單 · 答得好不會把複習日推遠，答不好才拉近',
    });
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
  onRecall: startRecall,
  onRemoveRecall: async (itemId) => {
    try {
      await progress.removeFromReviewList(itemId);
      recallIds.delete(itemId);
      refreshRecall();
    } catch (e) { msg(e.message || e); }
  },
});
// 回顧清單的 id 集合在記憶體裡維護 —— 每翻一張卡查一次 API 的話，
// 卡片會等在那裡，而這只是一個星號。
let recallIds = new Set();

async function refreshRecall() {
  if (!user) return;
  try {
    recallIds = await progress.fetchReviewListIds(user.id);
    home.renderRecall(await progress.fetchReviewList(user.id));
  } catch { /* 清單載不到不該擋住整個首頁 */ }
}

/**
 * 標了一個形近字，把整組一起加進來。
 *
 * ★ 這是這份形近組資料真正的用處。
 *   使用者標 ぬ 的時候想的是「這個字我不熟」，
 *   但他真正的問題是「ぬ 和 め 分不出來」—— 只練 ぬ 練不掉那個問題。
 *   老師在旁邊會說「你這兩個一直搞混，我們一起練」，這行就是那句話。
 *
 * 不問就直接加：問了等於把判斷丟回給不知道答案的人，
 * 而且多一次點擊。加錯的代價很小（清單上點 × 就移除），
 * 漏加的代價是繼續錯下去。
 */
async function addConfusableMates(item) {
  const group = confusableOf(item.ko);
  if (!group) return [];
  const mates = await content.pickItems({ ids: null, tag: '', limit: 400 })
    .then((all) => all.filter((x) => x.ko !== item.ko && group.keys.includes(x.ko)))
    .catch(() => []);
  const added = [];
  for (const m of mates) {
    if (recallIds.has(m.id)) continue;
    try {
      await progress.addToReviewList(m.id, `與「${item.ko}」形近`);
      recallIds.add(m.id);
      added.push(m.ko);
    } catch { /* 單一條加不進去不該中斷整組 */ }
  }
  return added;
}

async function toggleRecall(item) {
  if (!user) return;
  const on = recallIds.has(item.id);
  try {
    if (on) {
      await progress.removeFromReviewList(item.id);
      recallIds.delete(item.id);
      msg('已從回顧清單移除', 'ok');
    } else {
      await progress.addToReviewList(item.id);
      recallIds.add(item.id);
      const mates = await addConfusableMates(item);
      msg(mates.length
        ? `已加入，並一起加了形近的 ${mates.join('、')} —— 這組要放在一起練才分得出來`
        : '已加入回顧清單', 'ok');
    }
    study.render(session.state());
    refreshRecall();
  } catch (e) { msg(e.message || e); }
}

study.initStudy({
  session, getCtx: studyCtx, onQuit: () => show('view-done'),
  inRecallList: (id) => recallIds.has(id),
  onToggleRecall: toggleRecall,
});
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
  $('btn-back').onclick = () => {
    // 中途離開時把剩下的丟掉 —— 它們沒有消失，下次進首頁照樣算在待複習裡。
    // 留著的話，隔一天再按「再來一輪」會拿到昨天算出來的舊佇列。
    reviewQueue = [];
    show('view-home');
  };
  $('btn-again').onclick = () => nextRound().catch((e) => msg(e.message || e));
  $('btn-extra').onclick = () => {
    const ids = [...new Set([...lastBatchIds, ...reviewQueue.map((e) => e.item.id)])];
    if (!ids.length) return msg('沒有可以練的內容');
    startFree({ ids });
  };
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
  refreshRecall();          // 清單與首頁其他區塊並行載入，不互相擋
  await show(viewFromHash());
}

auth.onChange(onUser);
(async () => { await onUser(await auth.currentUser()); })();
