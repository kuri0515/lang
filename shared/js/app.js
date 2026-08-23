// =====================================================================
// 啟動與裝配
//
// 本檔只做三件事：建立 session、把各模組接起來、處理登入狀態。
// 任何業務邏輯都不該寫在這裡 ——
//   資料存取 → data/*      題型 → study/modes/*
//   會話邏輯 → study/session.js   畫面 → views/*
// =====================================================================
import { BUILD } from './build.js';
import { $, opt, esc, msg, shuffle } from './core/dom.js';
import { on, emit, EVENTS } from './core/bus.js';
import { difficultyScore } from './core/srs.js';
import * as auth from './data/auth.js';
import * as content from './data/content.js';
import * as progress from './data/progress.js';
import { createSession, orderForDiscrimination, ROUND_SIZE } from './study/session.js';
// 別名：app.js 已經有一個 nextRound()，那是「複習的下一批」，與輪次池無關
import { isUsable as roundUsable, nextRound as buildRound,
         deal as dealRound, consume as consumeRound } from './study/round.js';
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
import * as script from './views/script.js';
import * as history from './views/history.js';
import * as importer from './views/importer.js';
import { lang, lsKey } from './core/lang.js';

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
  onChange: (state) => { study.render(state); saveResume(); },
  // 收尾話要知道剛練的是哪一課；自由練習不算推進課程，所以不帶
  onFinish: async (stats, free) => {
    clearResume();          // 這一輪結束了，沒有東西要續跑
    await commitRound();    // 答完了，輪次池的指標才往前推（發牌時不推，見 commitRound）
    // 這一輪掌握了幾個，累加到今天的進度。
    // 「哪一種輪次算數」的規則在 home.addMasteredToday 裡（那裡驗得到）。
    home.addMasteredToday(stats.mastered || 0, currentKind);
    // 只有複習才有「還剩多少」—— 學新課、自由練習都是一次一批，沒有續攤的概念
    // 可練的內容＝剛做完那一輪 ＋ 今天還沒做的。
    // 刻意不從整個詞庫抓 —— 那會把還沒學過的詞端出來，
    // 等於繞過「先複習完才能學新的」那道閘門，而使用者會很自然地一直用它。
    study.renderDone(stats, free, free ? '' : currentLesson, reviewQueue.length);
    home.refreshRoundLabel();      // 這一組做完了，按鈕上的剩餘數要跟著動
    show('view-done');
  },
  onError: (e) => msg('儲存失敗：' + (e.message || e)),
});

async function ensurePool() {
  if (!pool.length) pool = await content.distractorPool().catch(() => []);
}

/** 開始一輪：依題型過濾佇列，過濾後沒東西就別進去 */
// roundOf：這一輪是從輪次池發出來的幾個。由 begin 統一持有，
// 其他入口不傳就自動歸零 —— 免得某一條路徑忘了清，
// 讓複習做完時去推進輪次池的指標。
async function begin(entries, { freeMode = false, kind = 'review', note = '', lesson = '',
                                roundOf = 0 } = {}) {
  roundPending = roundOf;
  // 導言與收尾話每輪都要重設 —— 不清掉的話，下一輪會掛著上一課的內容
  currentLesson = lesson;
  currentKind = kind;
  // 導言優先取自本輪的假名卡（雲端資料），沒有才回設定查（規則課）
  study.setLesson(lesson, introFor(lesson, entries));
  const modeId = home.studyMode();
  if (needsPool(modeId)) await ensurePool();

  // 達標次數由題型決定：產出型的「拼出來」只要兩次 ——
  // 拼對一次的證據力遠高於選對一次，而它的成本也高得多
  // （實測一輪 123–358 次點擊，對照四選一的 30–87 次）。
  session.start(entries, { freeMode, mode: modeId, kind,
                           criterion: getMode(modeId).criterion });
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

// 學新課時一批拿幾條。這不是「每日上限」——
// 每日上限已取消，這只是「一次點下去不要把整個詞庫灌進來」。
const NEW_BATCH = 20;
let reviewQueue = [];        // 這一批還沒做的（分輪用）
let currentKind = 'review';  // 這一輪是什麼性質（決定掌握數算不算進今日任務）

// ---------------------------------------------------------------------
// 中斷續跑
//
// 【要解決的事】
//   網址的 hash 只記得「在哪一頁」，不記得「做到第幾題」。
//   重新整理、切到別的 App 再回來、手機把分頁回收 ——
//   這三件事在手機上每天都會發生，而目前的結果都是整輪重來。
//   一輪要答三十到八十題，重來一次的代價足以讓人今天不想再開。
//
// 【本機 ＋ 雲端都存】
//   本機（localStorage）：每答一題就寫，零延遲、離線也有效。
//   雲端（study_resume）：換一台裝置也接得上 —— 手機做到一半、
//   打開電腦想接著做，那是這個功能真正的用途。
//
//   兩邊都存的重點不是「寫兩份」，是**回來時該信哪一份**：
//   取 savedAt 比較新的那一份。用用戶端的時間點而不是伺服器寫入時間 ——
//   後者會讓網路慢的那一台後到，於是先操作的蓋掉後操作的。
//
// 【雲端為什麼不是每答一題就寫】
//   一輪要答三十到八十題，每題一次網路寫入是三十到八十次請求，
//   而其中七十九次的結果隔幾秒就被下一次覆蓋掉。
//   本機負責「每一題都不丟」，雲端負責「換裝置接得上」——
//   後者只需要在離開時是對的。
//
// 【為什麼要有時效】
//   三天前中斷的那一輪，卡片的到期日早就變了，接回去會用過期的資料
//   去覆蓋雲端。過期就丟掉，回到正常流程重新算。
// ---------------------------------------------------------------------
// 鍵一定要帶站台前綴 —— 兩站同網域，localStorage 是共用的（見 core/lang.js 的 lsKey）
// ★ 每個使用者 × 每個題型一份。
//   不帶使用者：換帳號會接到別人的進度（localStorage 整個網域共用）。
//   不帶題型：用翻卡做到一半、換成拼出來，回去會接到翻卡那一輪 ——
//   而每個題型是一種不同的練習（認得／選得出來／寫得出來），
//   換題型是「換一件事做」，不是「同一件事換個樣子」。
const RESUME_KEY = (mode) => lsKey(`resume.${user?.id || 'anon'}.${mode}`);
const RESUME_MAX_AGE = 12 * 3600 * 1000;   // 超過 12 小時就當作是「另一天的事」

let cloudPushAt = 0;
const CLOUD_MIN_GAP = 20000;      // 雲端最多 20 秒寫一次

function currentResumeState() {
  const snap = session.snapshot();
  if (!snap.queue.length || snap.idx >= snap.queue.length) return null;
  return { ...snap, reviewQueue, lesson: currentLesson, savedAt: Date.now() };
}

/**
 * @param toCloud 強制同步到雲端（離開頁面、切到背景時用）。
 *   平時靠節流，因為每答一題寫一次雲端 = 一輪三十到八十次請求，
 *   而其中絕大多數隔幾秒就被下一次覆蓋掉。
 */
function saveResume({ toCloud = false } = {}) {
  const state = currentResumeState();
  if (!state) return clearResume();
  try { localStorage.setItem(RESUME_KEY(state.modeId), JSON.stringify(state)); }
  catch { /* 容量滿或隱私模式：續跑是加分功能，不該擋住學習 */ }

  if (!user?.id) return;
  if (toCloud || Date.now() - cloudPushAt > CLOUD_MIN_GAP) {
    cloudPushAt = Date.now();
    progress.saveResume(user.id, state.modeId, state);   // 失敗一律吞掉，見 data 層
  }
}
function clearResume(mode = session.state().mode) {
  try { localStorage.removeItem(RESUME_KEY(mode)); } catch { /* 同上 */ }
  if (user?.id) progress.clearResume(user.id, mode);
}
/**
 * 有沒有可續跑的一輪？有就接回去並回傳 true。
 *
 * 本機與雲端各有一份，取 savedAt 比較新的：
 *   同一台裝置 → 幾乎永遠是本機（它每答一題就寫）
 *   換一台裝置 → 本機是空的或很舊，雲端勝出
 * 平手時取本機 —— 內容一樣，少一次不必要的狀態切換。
 */
/**
 * 讀某個題型的續跑狀態：本機與雲端取比較新的那一份。
 *
 * 同一台裝置 → 幾乎永遠是本機（每答一題就寫）
 * 換一台裝置 → 本機是空的或很舊，雲端勝出
 * 平手取本機 —— 內容一樣，少一次不必要的狀態切換。
 */
async function readResume(mode) {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(RESUME_KEY(mode)) || 'null'); }
  catch { /* 壞掉就當沒有 */ }
  const cloud = await progress.loadResume(user?.id, mode);
  const both = [local, cloud]
    .filter((x) => x && Date.now() - (x.savedAt || 0) <= RESUME_MAX_AGE);
  if (both.length < 2) return both[0] || null;

  // ★ 同一輪就比進度，不比時間。
  //
  //   savedAt 是用戶端的時鐘。兩台裝置的時鐘差得比兩次作答的間隔還多時，
  //   按時間挑會挑到較舊的那一份 —— 使用者的體感是「進度退回去了」。
  //   實測：手機時鐘快兩小時，手機做到第 3 題、電腦做到第 8 題，
  //   按時間會挑第 3 題，五題白做。
  //
  //   而「做到第幾題」不需要時鐘就比得出來，同一輪內它就是我們要的答案。
  //   不同輪才回頭比時間 —— 那時比的是「哪一輪比較新」，
  //   而不同輪之間本來就沒有共同的進度可比。
  const [a, b] = both;
  if (a.sessionId && a.sessionId === b.sessionId) {
    return (a.idx ?? 0) >= (b.idx ?? 0) ? a : b;
  }
  return both.sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0))[0];
}

/**
 * 回到「目前這個題型」進行中的那一輪。回傳是否真的有一輪可以回。
 *
 * ★ 記憶體裡那一輪不一定是目前的題型。
 *   使用者可能用翻卡做到一半、去設定換成拼出來、再回到學習畫面 ——
 *   這時該接的是拼出來那一份，不是記憶體裡的翻卡。
 *   每個題型是一種不同的練習（認得／選得出來／寫得出來），
 *   各自的進度本來就該分開。
 *
 * ★ 舊題型那一輪不會因此消失：每答一題就存，而鍵帶著題型 ——
 *   換回去時它還在。
 *
 * 開機與從分頁列回去走的是同一條路：兩條路各寫一份判斷必然漂移。
 */
async function resumeRound() {
  const want = home.studyMode();
  const st = session.state();
  if (st.total > 0 && st.idx < st.total && st.mode === want) {
    show('view-study'); study.render(st); return true;      // 記憶體裡就是這個題型
  }
  const snap = await readResume(want);
  if (!snap || !session.resume(snap)) return false;
  reviewQueue = Array.isArray(snap.reviewQueue) ? snap.reviewQueue : [];
  currentLesson = snap.lesson || '';
  study.setLesson(currentLesson, '');
  show('view-study'); study.render(session.state());
  return true;
}


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
  if (!batch.length) return msg('複習已清空 ✓', 'ok');
  await begin(batch, { kind: 'review' });
}

async function startNew(deckId, tag = '') {
  try {
    // ★ 每日新卡上限已取消（使用者的決定，2026-08-18）——
    //   原本的理由是「一次灌太多新詞，隔天的複習量會爆掉」，
    //   那個現象是真的（模擬過：每天 8 條新的，90 天後每日複習 45–75 條），
    //   但要不要踩煞車是學習者自己的判斷，不該由系統代替他決定。
    //
    //   room 仍保留 —— 它現在的作用是「這一批最多拿幾條」，
    //   不是「今天還剩幾條額度」。把它拿掉的話，一次點下去會把整個詞庫
    //   的新詞全部灌進一輪。
    const room = NEW_BATCH;

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
  // ★ 每日新卡上限已取消（使用者的決定，2026-08-18）——
  //   原本的理由是「一次灌太多新詞，隔天的複習量會爆掉」，
  //   那個現象是真的（模擬過：每天 8 條新的，90 天後每日複習 45–75 條），
  //   但要不要踩煞車是學習者自己的判斷，不該由系統代替他決定。
  //
  //   room 仍保留 —— 它現在的作用是「這一批最多拿幾條」，
  //   不是「今天還剩幾條額度」。把它拿掉的話，一次點下去會把整個詞庫
  //   的新詞全部灌進一輪。
  const room = NEW_BATCH;

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
// ---------------------------------------------------------------------
// 輪次池：把全部內容掃過一遍，一輪接一輪
//
// 【與複習池的分工】
//   複習池看到期日 —— 端出「哪些快忘了」。
//   輪次池看一個固定的打散順序 —— 回答「我掃到哪了」。
//   兩者互不干涉。使用者已經學完第一輪，要的是「不斷地把全部內容輪過」，
//   而那件事光靠到期日做不到：到期日永遠不保證每個詞都輪得到。
//
// 【為什麼一輪的順序在開始時就固定】
//   中途插入新詞會讓「還剩多少」跳動，而那個數字是這個模式唯一的進度感。
//   新詞加入下一輪。
//
// 【答題仍然寫排程】
//   「獨立」指的是出題順序，不是不記錄。
//   輪次池練到的詞照樣進複習循環 —— 否則它們永遠不會被複習帶回來。
// ---------------------------------------------------------------------
let round = null;          // { roundNo, queue, pos }
let roundPending = 0;      // 這一組發出去幾個、還沒答完

/** 讀（或開）輪次狀態。走完一輪才開下一輪，全部重新打散 */
async function ensureRound() {
  if (!round) round = await progress.loadRound(user.id);

  // ★ 「走完」只有一種定義：queue 有內容，而且 pos 走到底。
  //
  //   舊寫法是 `if (round.pos < round.queue.length) return round`，
  //   把 queue 為空也算成走完。於是只要有一次建輪撈不到內容
  //   （登入還沒接上就按下去就會這樣），就存下一個 queue=[] 的輪次，
  //   而之後每按一次輪練都會：重建一輪 → roundNo +1 → 發出一組空的牌 →
  //   停在「沒有符合的內容」。畫面像是沒反應，輪數卻一路往上跳。
  //   實際發生過：韓文站有使用者跑到第 17 輪，而 pos 只有 70／801。
  if (roundUsable(round) && round.pos < round.queue.length) return round;

  const deck = (await content.listDecks()).find((d) => d.slug === lang().roundDeck);
  // ★ 不給 limit —— pickItems 沒有 limit 時會分頁撈完。
  //   給 limit 會走單次查詢，而 PostgREST 單次最多回 1000 列：
  //   詞庫超過一千條之後，一輪會靜靜地少掉一截，
  //   而「還剩多少」看起來完全正常（它算的是那份殘缺清單）。
  //   實測韓文站的詞庫目前 801 條 —— 還沒撞到，但正在往那裡長。
  const items = await content.pickItems({ deckId: deck?.id ?? null });
  // 撈不到內容就讓呼叫端看見錯誤，絕不存下一個空的輪次 ——
  // 存下去的話它會被下一次讀成「該開新的一輪」（見上面那段）。
  if (!items.length) {
    throw new Error(`讀不到「${lang().roundDeck}」的內容，請確認連線後再試一次`);
  }
  round = buildRound(round, items.map((i) => i.id), shuffle);
  roundPending = 0;
  await progress.saveRound(user.id, round);
  return round;
}

/**
 * 這一組答完了，才把指標往前推。
 *
 * 【為什麼不在發牌時就推】
 *   原本是發出去就 pos += 10，理由是「中途離開也算走過」。
 *   但那讓「按一下輪練」變成有代價的動作：使用者以為沒反應而多按幾次，
 *   詞庫就被吃掉幾十個，而那些詞這一輪再也不會出現。
 *   輪次池的約定是「每個詞這一輪都輪得到」，發牌即消費會直接違背它。
 *   改成答完才推：中途離開下次拿到同一組，重按也不會有任何損失。
 */
async function commitRound() {
  if (!roundPending || !round) return;
  round = consumeRound(round, roundPending);
  roundPending = 0;
  await progress.saveRound(user.id, round);
}

/** 這一輪的進度，給首頁顯示用。發出去還沒答完的也算進去，數字才不會停著不動 */
export function roundProgress() {
  if (!round) return null;
  return {
    roundNo: round.roundNo,
    done: Math.min(round.pos + roundPending, round.queue.length),
    total: round.queue.length,
  };
}

async function startFree({ ids = null, tag = '', deckId = null,
                           kind = 'free', keepOrder = false } = {}) {
  try {
    const pooled = !ids && !tag && !deckId;
    let items;
    let dealt = 0;
    if (pooled) {
      const r = await ensureRound();
      if (!r || !r.queue.length) return msg('這個詞庫還沒有內容');
      const take = dealRound(r, ROUND_SIZE);
      items = await content.pickItems({ ids: take, limit: ROUND_SIZE });
      dealt = take.length;          // 答完才算消費掉，見 commitRound
    } else {
      items = await content.pickItems({ ids, tag, deckId, limit: 60 });
    }
    if (!items.length) return msg('沒有符合的內容');

    // 已經有卡的要帶著卡進來 —— 沒帶的話排程會從頭算起，
    // 一個學了三週的詞會被當成新詞，間隔掉回一天。
    const byItem = pooled
      ? await progress.cardsByItem(user.id, items.map((i) => i.id)).catch(() => ({}))
      : {};
    const dir = home.effectiveDir();
    const entries = items.map((item) => ({
      item, direction: dir, card: byItem[item.id]?.[dir] ?? null,
    }));

    const r = roundProgress();
    await begin(keepOrder ? entries : orderForDiscrimination(entries, confusableOf),
                { freeMode: !pooled, kind, lesson: tag, roundOf: dealt,
                  criterion: getMode(home.studyMode()).criterion,
                  note: kind === 'drill'
                    ? '弱項修復 · 只記錄成績，不影響複習排程'
                    : (pooled
                      ? `第 ${r.roundNo} 輪 · 還剩 ${r.total - r.done} / ${r.total}`
                      : '練習這一組 · 只記錄成績，不影響複習排程') });
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

// 分頁列的「首頁」：有進行中的一輪就回到那一輪

/**
 * 練習方式改變時存起來。
 *
 * 本機立刻（零延遲、離線也有效），雲端節流兩秒 ——
 * 使用者連點三個選項不該打三次網路，而其中兩次的結果馬上就被覆蓋。
 */
let prefsTimer = null;
function onPrefsChange() {
  home.savePrefsLocal(user?.id);
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => auth.savePrefs(user?.id, home.readPrefs()), 2000);
}

home.initHome({
  ...deps,
  onPrefsChange,
  // 這一輪還剩幾題（0 = 沒有進行中的一輪）。
  // 分頁列在學習中也顯示，所以要有一條回得去的路。
  roundLeft: () => {
    const st = session.state();
    return st.total > 0 && st.idx < st.total ? st.total - st.idx : 0;
  },
  onResumeRound: () => resumeRound(),
  onReview: startReview,
  onFree: () => startFree({}),
  roundProgress,
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
  // ★ 直接查那幾個字，不要「撈一批再過濾」。
  //   形近組的夥伴在詞庫裡的位置是隨機的 —— 撈前 400 條再過濾的話，
  //   排在 400 之後的夥伴永遠找不到，而功能看起來完全正常：
  //   它只是沒有把該加的加進去，不會報錯。
  const mates = await content.itemsByKo(group.keys.filter((k) => k !== item.ko))
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
  // 離開但保留這一輪。用 push:false 讓網址留在 #home，
  // 否則下次重新整理會回到學習頁而不是首頁。
  onPark: () => show('view-home'),
  inRecallList: (id) => recallIds.has(id),
  onToggleRecall: toggleRecall,
});
browse.initBrowse({ ...deps,
  onPractice: (ids) => startFree({ ids }),
  // 詞庫分頁的「學新的」—— 與首頁原本那張詞庫卡同一條路
  onNewDeck: (id) => startNew(id),
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
// ★ 課程選擇（發音課程、生活場景）已經搬到詞庫分頁，
//   但它們的內容仍由 home.load() 產生 —— 直接開啟 #browse 而沒去過首頁時，
//   那兩區會是空的。這種缺陷不會報錯，只會讓人看到兩張空卡片。
//   所以進入詞庫分頁時也跑一次首頁的載入。
//   （home.load 內部本來就會擋重複載入，多跑一次的代價只有一次查詢。）
onEnter('view-browse', () => Promise.all([browse.open(), home.load()]));
// 學習記錄（回顧清單、弱項）同理：它們也是 home.load() 產生的
onEnter('view-history', () => Promise.all([history.open(), home.load()]));
// 練習方式已經搬到「我的」，而它的摘要列（題型 · 方向 · 內容類型）
// 由 home 的 syncModeUI() 產生 —— 沒有這一行，進「我的」時摘要是空的。
// 搬移畫面時最容易漏的就是這種「內容還留在原本的模組裡」的接線。
// 精讀分頁只有宣告了 scriptReading 的站台才有這塊畫面。
// 用 $() 先確認元素在，不在就整個不接線 ——
// 對著不存在的元素綁事件會在啟動時丟錯，而那會讓整站白畫面。
// 精讀掛在「詞庫」底下的子分頁（見 views/browse.js），
// 所以這裡只做初始化 —— 什麼時候開由那邊決定。
if (opt('b-pane-script')) script.initScript({ userId: () => user?.id || null });
onEnter('view-me', () => home.syncModeUI());
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
/**
 * 啟動流程。★ 只在「使用者換人」時整套重跑。
 *
 * 【為什麼要擋】
 *   onAuthStateChange 不只在登入登出時觸發 —— token 大約每小時自動換一次，
 *   分頁重新取得焦點也會觸發。原本每次都整套重跑，
 *   而首頁的「繼續這一輪」會走 resumeRound()：它會切到學習畫面、重建佇列。
 *   於是練到一半時 token 一換，畫面就自己重來 ——
 *   使用者看到的是「輪練會自動刷新」。
 *
 *   token 換了不代表使用者換了，帳號沒變就什麼都不必做。
 */
let bootedFor = null;      // 已經完成啟動流程的使用者 id

async function onUser(u, event) {
  // 同一個人、已經啟動過 → 這只是換了張 token 或分頁回到前景，不動畫面。
  // 登出（u 為 null）一定要放行，否則登出後畫面還停在學習頁。
  if (u && bootedFor === u.id) return;
  bootedFor = u?.id ?? null;
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
  // ★ 練習方式：雲端優先，沒有才用本機。
  //   雲端優先是為了「換裝置登入要拿得到」；
  //   而本機那一份的意義是離線與零延遲，不是真理來源。
  //   兩者都沒有就維持畫面預設。
  // ★ 空物件不算「雲端有設定」。
  //   0017 加了 study_prefs 卻沒補 UPDATE 權限（見 0020），
  //   雲端那份一直是 '{}' —— 而 ?? 只在 null/undefined 才回退，
  //   {} 兩者都不是，於是本機存的偏好永遠用不到，
  //   方向只好退回硬編碼預設值。使用者看到的是「設了又跳回去」。
  const cloudPrefs = profile?.study_prefs;
  const hasCloud = cloudPrefs && typeof cloudPrefs === 'object'
                   && Object.keys(cloudPrefs).length > 0;
  home.applyPrefs(hasCloud ? cloudPrefs : home.loadPrefsLocal(u.id));

  refreshRecall();          // 清單與首頁其他區塊並行載入，不互相擋

  // ★ 開場一律落在網址指定的那一頁，不自動彈進學習畫面。
  //
  //   本來是「有做到一半的一輪就直接接回去」，理由是少按一下。
  //   但學習畫面不寫進網址（見 router.js 檔頭），所以重新整理時
  //   無論人原本在哪一頁，都會被彈進學習畫面 ——
  //   使用者要的是回首頁，拿到的是又一輪題目。
  //
  //   續跑本身沒有變弱：進度照存，首頁第一顆大按鈕就是
  //   「繼續這一輪（還有 N 題）」（見 views/home.js）。
  //   差別只在由誰決定要不要接回去。
  await show(viewFromHash());
}

// 切到別的 App、鎖螢幕、關分頁 —— 手機上這些比「按下一題」更常發生。
// onChange 已經每答一題存一次，這兩個事件是保險：
// 停在「已翻面但還沒評分」的狀態時，只有它們會存到。
window.addEventListener('visibilitychange', () => {
  // 切到背景就是「可能換到別台裝置」的時刻 —— 這一次一定要送上雲端
  if (document.visibilityState === 'hidden') saveResume({ toCloud: true });
});
// 關分頁、切 App、鎖螢幕 —— 這時來不及等請求完成，
// 改用 keepalive：瀏覽器保證即使頁面沒了也會把它送出去。
window.addEventListener('pagehide', () => {
  session.flushNow();                       // 待寫入的答題先發出去
  const st = currentResumeState();
  if (st && user?.id) progress.saveResumeBeacon(user.id, st.modeId, st);
  saveResume();                             // 本機那份照存
});

// ---------------------------------------------------------------------
// 清掉沒有站台前綴的舊鍵（一次性）
//
// 這些鍵是 2026-08-18 之前寫下的，兩站共用同一格 ——
// 於是日文站會讀到韓文站的學習佇列（使用者回報「日文站串了韓文站的內容」）。
// 程式已經改用帶前綴的鍵，但**使用者瀏覽器裡的舊資料還在**，
// 而舊版的 app.js 還會在快取裡待上十分鐘（max-age=600）。
// 那段時間內舊碼仍會讀到舊鍵，症狀不會馬上消失。
//
// 所以主動刪掉。刪掉的代價只是「那一輪要重做」，
// 而留著的代價是「日文站上出現韓文單字」—— 後者嚴重得多。
//
// ★ 不刪 'kr.theme'：韓文站現在的正式鍵就是這個字串（前綴剛好是 kr）。
//   刪掉會把韓文站使用者的佈景設定清空。
(() => {
  try {
    const legacy = ['session-resume-v1', 'lesson-intro-open'];
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (legacy.includes(k) || /^mastered-\d{4}-\d{2}-\d{2}$/.test(k)) {
        localStorage.removeItem(k);
      }
    }
  } catch { /* 隱私模式：沒有舊資料要清，也不該因此擋住啟動 */ }
})();

// ---------------------------------------------------------------------
// 版本偵測：手上這份是不是最新的？
//
// GitHub Pages 對 JS 設 cache-control: max-age=600 —— 十分鐘內瀏覽器
// 根本不會去問伺服器。於是部署完打開網站，看到的還是舊版，
// 而使用者無從分辨「改壞了」與「還沒生效」，每次都要猜。
//
// 這裡不去對抗快取（改不了 Pages 的標頭），只做一件事：**誠實說出來**。
// version.json 用 no-store 讀取，與頁面裡嵌的編號比對，不同就顯示提示。
//
// 【為什麼點下去是換網址而不是 location.reload()】
//   reload 仍可能從快取拿 JS。換成帶 ?v= 的網址，
//   至少 HTML 一定是新的；而 HTML 更新後，模組的預載清單也會跟著更新。
//   要讓每個模組都立刻更新得替它們全部加上版本號 ——
//   那需要一個建置步驟，會破壞現在「推上去就是部署」的簡單性。
//   十分鐘後快取到期本來就會自己好，這裡解決的是「不知道發生什麼事」。
// ---------------------------------------------------------------------
async function checkVersion() {
  const mine = document.querySelector('meta[name="build"]')?.content;
  if (!mine) return;

  // ★ 先比「我這份 JS」與「這個 HTML」——
  //   瀏覽器對 HTML 與 JS 的快取各自到期，可能出現新 HTML 配舊 JS。
  //   那時 meta 與 version.json 都是新的，檢查一片綠，而 App 已經壞了
  //   （2026-08-19 日文站就是這樣：堆疊指向的行號在線上檔案裡根本對不上）。
  //   這一比不必連網，最快也最準。
  if (BUILD !== mine) return showUpdateBar(mine, '程式版本不一致');

  try {
    const r = await fetch('../version.json', { cache: 'no-store' });
    const { build } = await r.json();
    if (!build || build === mine) return;
    showUpdateBar(build);
  } catch { /* 離線或檔案還沒部署：不打擾，維持現狀 */ }
}

/**
 * 更新提示條。點下去之前先把還沒落地的寫入寫完 ——
 * 評分後有 2.5 秒的延遲寫入，而 location.replace() 會把還在飛的請求砍掉。
 */
function showUpdateBar(build, why = '') {
  if (document.querySelector('.update-bar')) return;      // 只放一條
  const bar = document.createElement('button');
  bar.className = 'update-bar';
  bar.textContent = why ? `${why} · 點此更新` : '有新版本 · 點此更新';
  bar.onclick = async () => {
    bar.disabled = true;
    bar.textContent = '正在儲存進度…';
    try {
      await session.settle();                            // 答題記錄：等它真的寫進去
      const st = currentResumeState();                    // 續跑進度：也等
      if (st && user?.id) await progress.saveResume(user.id, st.modeId, st);
    } catch { /* 存不上也得讓人更新 —— 卡在這裡更糟 */ }
    const u = new URL(window.location.href);
    u.searchParams.set('v', build);
    window.location.replace(u.toString());
  };
  document.body.appendChild(bar);
}
checkVersion();
// 從背景切回來時再看一次 —— 手機把分頁留在背景好幾天是常態
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkVersion();
});

auth.onChange(onUser);
(async () => { await onUser(await auth.currentUser()); })();
