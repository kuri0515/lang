// =====================================================================
// 學習卡片的實際渲染
//
//     node --import ./tests/_cdn-stub.mjs tests/card.test.mjs <pool.json>
//
// 【為什麼這支存在】
//   views/study.js 經資料層 import 到 CDN 上的 supabase-js，node 載不進來，
//   所以先前的測試全部避開了它 —— 而它正是學生 90% 時間在看的那張卡。
//   最重要的東西沒有測試，只因為它比較難載。
//
//   實際代價：188 張句子卡的備註都印著「對話 A｜刷牙｜」這種內部格式，
//   資料完全正確、API 驗證全綠，直到把卡片真的渲染出來看才發現。
//
//   _cdn-stub.mjs 用模組 hook 把 CDN 那一行換成本地替身，這個洞才補得起來。
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { SITE, SHARED, SITE_DIR, siteReady } from './_site.mjs';

const dom = new JSDOM(fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8'),
  { pretendToBeVisual: true, url: 'https://x.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
const LANG = await siteReady();

const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const study = await import(`${SHARED}/js/views/study.js`);
const { createSession } = await import(`${SHARED}/js/study/session.js`);

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const $ = (id) => document.getElementById(id);
const hidden = (id) => $(id).classList.contains('hidden');

const S = createSession({ save: async () => {}, onChange: (st) => study.render(st), onFinish: () => {} });
study.initStudy({
  session: S, getCtx: () => ({ pool: items }), onQuit: () => {},
  inRecallList: () => false, onToggleRecall: () => {},
});
const render = (item, direction = 'ko2zh') => {
  S.start([{ item, direction, card: null }], { mode: 'flip', kind: 'new' });
  study.reveal();
};

console.log(`【卡片渲染】（站台：${SITE}）`);
const word = items.find((x) => x.item_type === 'word' && !x.note);
render(word);
chk('單字卡：正面是目標語言、背面是中文',
  $('c-front').textContent === word.ko && $('c-back-text').textContent === word.zh);
chk('沒有備註時不顯示空白區塊', hidden('c-note'));

const dlg = items.find((x) => (x.note || '').startsWith('對話'));
if (dlg) {
  render(dlg);
  // ★ 這一條是這支測試存在的理由
  chk('★ 備註不含內部格式（對話 A｜情境｜）',
      !$('c-note').textContent.includes('｜'),
      '前兩段是給程式歸組用的中繼資料，不是給學生看的');
  chk('情境改成類型標籤的一部分',
      $('c-type').textContent.includes('·'),
      $('c-type').textContent);
}

const ruby = items.find((x) => /\[/.test(x.hanja || ''));
if (ruby) {
  render(ruby);
  chk('帶注音的句子渲染成 <ruby>', $('c-front').querySelectorAll('ruby').length > 0);
  chk('注音沒有洩漏方括號到畫面', !$('c-front').textContent.includes('['),
      '看到 [えき] 就是 ruby 沒生效，而那比沒有注音更難看');
  chk('注音不會再另開一行「漢字 …」', hidden('c-hanja'),
      '正面已經標好了，重複一次是噪音');
}

const kana = items.find((x) => (x.tags || []).includes('平假名') && x.note);
if (kana) {
  render(kana);
  chk('假名卡顯示口訣', !hidden('c-note') && $('c-note').textContent.length > 5);
  chk('口訣是多行（口訣＋字源）', $('c-note').textContent.includes('\n'));
}

// 反面：把注音清掉，ruby 就不該出現 —— 證明上面那條真的在測東西
if (ruby) {
  render({ ...ruby, hanja: '' });
  chk('反面樣本：沒有注音時不會憑空出現 ruby',
      $('c-front').querySelectorAll('ruby').length === 0);
}

// ---------------------------------------------------------------------
// 首頁的五十音表 —— 驗「畫出來的東西」，不是驗資料
//
// ★ 先前有一條測試叫「課程裡的假名都在表上（含片假名）」，它是綠的，
//   但它比對的是 taxonomy 的資料。而渲染那段程式碼其實根本沒進到檔案裡，
//   畫面上只有平假名。測了旁邊的東西，看起來一樣安全。
//   這一段直接讀 DOM。
// ---------------------------------------------------------------------
console.log('\n【五十音表的渲染】');
{
  const home = await import(`${SHARED}/js/views/home.js`);
  const { pronOrder } = await import(`${SHARED}/js/core/taxonomy.js`);
  const grid = LANG.taxonomy.grid;
  if (!grid) {
    console.log('  ⏭  本站沒有字母表視圖');
  } else {
    const rows = pronOrder()
      .map((tag) => ({ tag, total: items.filter((i) => i.tags.includes(tag)).length,
                       started: 0, mastered: 0 }))
      .filter((r) => r.total > 0);
    home.initHome({ user: () => ({ id: 'u' }), isAdmin: () => false,
                    onStudyTag: () => {}, onRecall: () => {} });
    home.renderGojuon(grid, rows, new Set(rows.map((r) => r.tag)));

    const pairs = $('gojuon').querySelectorAll('.g-cell-pair');
    const cells = $('gojuon').querySelectorAll('button.g-cell');
    chk(`每個音一格、格內兩種寫法（${pairs.length} 格）`, pairs.length === 46, `${pairs.length} 格`);
    chk('★ 片假名真的畫出來了', cells.length > 46,
        `只有 ${cells.length} 個可點 —— 少於 47 表示片假名沒渲染`);

    const first = pairs[0];
    chk('同一格是同一個音的兩種寫法',
        first && [...first.children].map((c) => c.textContent).join('') === 'あア',
        first ? [...first.children].map((c) => c.textContent).join('/') : '');

    chk('摘要數字含兩種寫法',
        /\/ 9[0-9] 個假名/.test($('grid-sub').textContent),
        $('grid-sub').textContent);

    // 濁音區：清音一列（不可點）、變化形一列（可點）
    const dk = $('dakuon').querySelectorAll('.d-block');
    chk(`濁音對照 ${dk.length} 組`, dk.length === 5, `${dk.length} 組`);
    chk('濁音格可點、對照的清音不可點',
        $('dakuon').querySelectorAll('button.g-cell').length === 25 &&
        $('dakuon').querySelectorAll('span.g-todo').length === 25);
  }
}

// ---------------------------------------------------------------------
// 情境對話：整句才是學生真正在讀的地方，標音不能只有卡片上有
// ---------------------------------------------------------------------
console.log('\n【情境對話的渲染】');
{
  const dlgView = await import(`${SHARED}/js/views/dialogue.js`);
  dlgView.initDialogue({ user: () => ({ id: 'u' }), onPractice: () => {} });
  await dlgView.open();

  const list = $('dlg-list');
  // 樣本裡沒有對話 ≠ 功能壞了 —— 韓文站的 fixture 是 169 條的子集，本來就不含對話。
  // 把「沒有資料」報成失敗，會讓人去修一個沒有壞的東西。
  const annotated = items.filter((x) => /\[/.test(x.hanja || '')
                                     && (x.note || '').startsWith('對話'));
  if (!list.children.length) {
    console.log(`  ⏭  這份樣本裡沒有對話（${items.length} 條），跳過`);
  } else if (!annotated.length) {
    chk(`對話清單有內容（${list.children.length} 組）`, true);
    console.log('  ⏭  本站的對話沒有振り仮名');
  } else {
    chk(`對話清單有內容（${list.children.length} 組）`, true);
    const scene = annotated[0].note.split('｜')[1];
    const row = [...list.children].find((c) => c.textContent.includes(scene));
    row.click();
    const ko = $('dlg-body').querySelector('.dlg-ko');
    chk(`★ 對話裡的漢字也有標音（${scene}）`,
        ko.querySelectorAll('ruby').length > 0,
        '卡片上標了、對話裡沒標，等於在最需要的地方把標音拿掉');
    chk('沒有把 HTML 當成文字印出來', !ko.textContent.includes('<ruby>'),
        'shownHTML 回傳的是 HTML，外面再包一層 esc() 就會變成這樣');
    chk('注音的方括號沒有洩漏', !ko.textContent.includes('['));
  }
}

// =====================================================================
// 【詞庫與學習歷史的渲染】
//
// 這兩個畫面從來沒有被渲染測試過 —— 而上一輪替漢字補標讀音時，
// 改的正是它們。當時只單獨驗了 wordHTML() 這支函式回傳什麼，
// 沒有真的把畫面渲染出來看。
//
// 「函式對」與「畫面對」是兩件事：函式回傳 <ruby>，
// 呼叫端只要多包一層 esc() 就會把標籤原樣印在畫面上 ——
// 那個錯誤在情境對話已經犯過一次，靠肉眼看畫面才發現。
// =====================================================================
console.log('\n【詞庫與學習歷史的渲染】');
{
  const browse = await import(SHARED + '/js/views/browse.js');
  // deps 要給齊 —— 少一個（例如 user()）會在 render 的 try 裡被吞掉，
  // 畫面停在骨架，看起來像「沒有資料」而不是「測試沒接好」。
  browse.initBrowse({
    user: () => ({ id: 'u1' }), isAdmin: () => false,
    onStudy: () => {}, onEdit: () => {}, onStudyTag: () => {},
    onPractice: () => {}, onStudyScene: () => {},
  });
  await browse.open();

  const list = $('b-list');
  chk(`詞庫有渲染出條目（${list.children.length} 列）`, list.children.length > 0);

  // 沒有把 HTML 當成文字印出來 —— 雙重 esc() 的典型症狀
  chk('沒有把 <ruby> 標籤印成文字', !/&lt;ruby/.test(list.innerHTML));

  const kanji = items.filter((x) => /\[/.test(x.hanja || '') && x.item_type === 'word');
  if (!kanji.length) {
    console.log('  ⏭  這份樣本沒有帶讀音的單字');
  } else {
    chk(`詞庫裡的漢字有標讀音（樣本 ${kanji.length} 條）`,
      list.querySelectorAll('ruby').length > 0,
      `渲染出 ${list.querySelectorAll('ruby').length} 個 ruby`);
  }

  // hanja 欄兩站裝的東西不同，所以這一條要分兩個方向驗，
  // 而且兩邊都必須是「真的可能失敗」的檢查 ——
  // 原本韓文站那一支寫成恆真（三元運算子的 else 直接給 true），
  // 綠燈只代表它跑過，不代表它驗過任何東西。
  const hanjaShown = list.innerHTML.includes('· 漢 ');
  if (LANG.rubyFromHanja) {
    // 日文站：hanja 是注音原料，印出來會變成「· 漢 駅[えき]は…」
    chk('日文站不把注音原料當漢字詞源印出來', !hanjaShown);
  } else {
    // 韓文站：hanja 是漢字詞源（학교 → 學校），對中文母語者是最大的紅利，該印
    const withHanja = items.filter((x) => x.hanja && x.item_type === 'word');
    if (!withHanja.length) console.log('  ⏭  這份樣本沒有標漢字詞源的單字');
    else chk(`韓文站有印出漢字詞源（樣本 ${withHanja.length} 條）`, hanjaShown);
  }
}


// =====================================================================
// 【複習分輪】
//
// 模擬每天學 8 條的學習者：第 82 天要複習 75 條（正確率 85%），
// 70% 的話 87 條。排程本身沒壞（沒有尖峰，是穩定成長），
// 但一輪 87 題會讓人今天不想打開 App。
//
// 分輪的關鍵不是把數字變小，是「總數照實顯示、只把一次要坐多久切小」。
// 蓋住總數只做 20 的話，剩下的不會消失，只會無聲地越積越多。
// 所以這裡要驗的是：剩餘量有沒有誠實地寫在按鈕上。
// =====================================================================
console.log('\n【複習分輪】');
{
  // 場景一律以「輪」為單位，不用隨手挑的數字 ——
  // 寫死 55 的話，一輪的題數改了測試還是綠的，但它驗的已經不是真的情境。
  const { ROUND_SIZE: R } = await import(SHARED + '/js/study/session.js');
  const done = { n: R, correct: R - 3 };          // 做完一輪，錯三題

  study.renderDone(done, false, '', R * 5 + 5);   // 還剩五輪半
  const again = $('btn-again');
  chk('還有剩時出現「再來一輪」', !again.classList.contains('hidden'));
  chk('按鈕上寫著真實剩餘量', again.textContent.includes(String(R * 5 + 5)), again.textContent);
  chk('還有剩時「返回」退居次要', !$('btn-back').classList.contains('primary'));

  study.renderDone(done, false, '', 0);           // 清空
  chk('清空後不再出現「再來一輪」', again.classList.contains('hidden'));
  chk('清空後「返回」回到主要按鈕', $('btn-back').classList.contains('primary'));

  // ★「再多練一些」：今天做完了還想練的人，唯一的正確出口。
  //   它走自由練習（不動排程）—— 間隔還沒走完就提前答對，
  //   那次回憶的價值本來就比較低，讓它把下次複習推遠會灌水。
  //   沒有這顆按鈕的話，那個人會去學新課，或是關掉。
  study.renderDone(done, false, '', 0, true);
  chk('有內容可練時出現「再多練一些」', !$('btn-extra').classList.contains('hidden'));
  chk('按鈕上寫明不影響排程', /不影響複習排程/.test($('btn-extra').textContent),
      '不寫的話沒人敢按 —— 學習者最怕的就是「多練反而害到自己」');
  study.renderDone(done, false, '', 0, false);
  chk('沒有內容可練時不顯示', $('btn-extra').classList.contains('hidden'));
}


// =====================================================================
// 【順延的可見性】
//
// 順延本身是自動的：沒做的卡 due_at 留在過去，隔天照樣算待複習，
// 而清單照 due_at 排序，逾期最久的自然排最前面。
// 問題是這件事對學習者完全隱形 —— 他只看到「待複習 63」，
// 不知道其中 40 條是上週的，也就不知道該調整的是新課的速度。
//
// 機制對、但看不到，等於不存在。這裡驗的是「看得到」。
// =====================================================================
console.log('\n【順延的可見性】');
{
  const home = await import(SHARED + '/js/views/home.js');
  const { ROUND_SIZE } = await import(SHARED + '/js/study/session.js');
  const box = $('suggest');
  const day = 86400000;
  const now = Date.now();
  const due = (n, ageDays) => Array.from({ length: n }, () => ({
    due_at: new Date(now - ageDays * day).toISOString(),
  }));

  // 「逾期超過一天才算順延」這條規則現在只存在於 data/progress.js 的
  // dueCounts()（用兩個 count 查詢算，不再把 500 張卡撈到前端）。
  // 這裡不重複驗規則本身 —— 驗它有沒有正確顯示在畫面上就夠了，
  // 而規則放兩處必然漂移。

  // ② 少量時不囉嗦
  home.renderSuggestion(ROUND_SIZE, { reviewed: 0 }, [], 0);
  chk('一輪以內不提分輪', !/做不完沒關係/.test(box.textContent), box.textContent.slice(0, 30));

  // ③ 超過兩輪：要講清楚做不完會怎樣，否則很多人直接關掉
  // 六輪的量、其中一輪是順延來的
  const many = ROUND_SIZE * 6;
  home.renderSuggestion(many, { reviewed: 0 }, [], ROUND_SIZE);
  chk(`大量（${many}＝六輪）時說明分輪與順延`, /做不完沒關係/.test(box.textContent));
  chk('★ 明說間隔不會因順延而變長', /間隔不會因此變長/.test(box.textContent),
      '這是使用者最可能誤解的地方：以為拖到明天會被懲罰');
  chk('顯示順延的條數', box.textContent.includes(String(ROUND_SIZE)));

  // ④ 順延過半 = 學新課的速度超過負荷，要直接講
  home.renderSuggestion(many, { reviewed: 0 }, [], ROUND_SIZE * 4);   // 順延四輪＝過半
  chk('★ 順延過半時建議暫停新課', /暫停學新課/.test(box.textContent),
      '積壓的成因是新課太快，不講的話學習者只會更用力複習');
  home.renderSuggestion(many, { reviewed: 0 }, [], ROUND_SIZE);       // 順延一輪＝沒過半
  chk('沒過半就不給那句建議', !/暫停學新課/.test(box.textContent));

  // ★ 畫面上寫的題數必須等於實際切輪用的題數。
  //   這兩個數字原本散在三個檔案，改一處漏兩處不會報錯 ——
  //   只會讓畫面寫「一輪 20 題」而實際做 10 題。
  chk(`畫面寫的題數＝實際的一輪（${ROUND_SIZE}）`,
    box.textContent.includes(`一輪 ${ROUND_SIZE} 個詞`)
    && $('btn-primary').textContent.includes(`一輪 ${ROUND_SIZE} 個詞`));
}


// =====================================================================
// 【每日複習任務：掌握 20 個才解鎖新課】
// =====================================================================
console.log('\n【每日複習任務】');
{
  const home = await import(SHARED + '/js/views/home.js');
  // ★ 要用正式路徑取鍵。寫死 'mastered-...' 的話，
  //   程式改成帶站台前綴（kr./ja.）之後，測試會去讀一個沒人寫的格子，
  //   而斷言仍然「通過」—— 驗的其實是空氣。
  const { lsKey } = await import(SHARED + '/js/core/lang.js');
  const key = lsKey('mastered-' + new Date().toISOString().slice(0, 10));
  const set = (n) => localStorage.setItem(key, String(n));

  set(0);
  chk('目標預設 20', home.dailyTarget(60) === 20);
  // ★ 到期數不足 20 時要以到期數為準，否則剛開始學的人永遠解鎖不了 ——
  //   而他正是每天只有幾個詞到期的那種人，這個死結會擋在最前面。
  chk('★ 到期只有 8 個時，目標就是 8', home.dailyTarget(8) === 8);

  set(5);
  chk('已掌握的算進目標基數', home.dailyTarget(3) === 8,
      '掌握過的已經不在待複習裡了，不加回去的話目標會越做越小');
  // ★ 目前不擋 —— 使用者的決定（2026-08-18）。
  //   進度照算、照顯示，只是不再限制什麼時候可以學新的。
  //   斷言留著並且反過來寫：日後若有人「順手」把閘門加回去，
  //   這裡會紅，而不是靜靜地改變產品行為。
  chk('沒達標也放行', home.newLessonBlocked(3) === null);
  set(20);
  chk('達標後當然也放行', home.newLessonBlocked(40) === null);

  // ★ 只有正規複習算進今日任務。
  //   回顧清單是自己標記想多練的詞，不是今天到期的 ——
  //   算進去的話，靠練自選的詞就能湊滿 20/20，
  //   而真正該複習的一條都沒做，那個數字就失去意義。
  set(0);
  home.addMasteredToday(5, 'review');
  chk('複習算數', home.masteredToday() === 5);
  home.addMasteredToday(5, 'drill');
  chk('★ 回顧清單不算', home.masteredToday() === 5, `實得 ${home.masteredToday()}`);
  home.addMasteredToday(5, 'free');
  chk('自由練習不算', home.masteredToday() === 5);
  home.addMasteredToday(5, 'new');
  chk('學新課不算（它不是複習）', home.masteredToday() === 5);

  set(0);
  home.renderSuggestion(60, { reviewed: 0 }, [], 0);
  chk('首頁顯示掌握進度', /0\/20/.test($('suggest').textContent), $('suggest').textContent.slice(0, 40));
  localStorage.removeItem(key);
}


// =====================================================================
// 【詞庫卡片：只有一個詞庫時不顯示】
//
// 首頁原本有三個「開始學」的入口：主按鈕、發音課程、詞庫。
// 三個都指向同一批內容時，使用者要先看懂三者的差別才敢按 ——
// 而它們其實沒有差別。多一個入口不是多一個選擇，是多一次猶豫。
//
// 用數量判斷而不是站台開關：一個詞庫時主按鈕本來就會落到 onNewDeck，
// 內容不會進不去；兩個以上才真的需要清單來選。
// 日文站現在只有 kana-01，韓文站有三個 —— 同一段程式，兩種正確結果。
// =====================================================================
// ★ 詞庫選單搬到詞庫分頁：首頁原本有一張「詞庫」卡，
//   那是第三個「開始學」的入口，而它們指向同一批內容。
//   合併而不是刪除 —— 韓文站有三個詞庫，刪了其中兩個就沒有入口。
console.log('\n【詞庫分頁的詞庫選單】');
{
  const browse2 = await import(SHARED + '/js/views/browse.js');
  const box = $('b-decks');
  chk('選單元素存在', !!box);
  chk('預設隱藏（等 open() 決定）', box.classList.contains('hidden'));
  chk('有「學新的」按鈕（承接首頁那張卡的功能）', !!$('btn-study-deck'));
  chk('預設隱藏，選了詞庫才出現', $('btn-study-deck').classList.contains('hidden'));
}


// =====================================================================
// 【拼出來：唯一一個測「產出」的題型】
//
// 其他三種都只測認得：翻卡自評（自己說了算）、四選一（猜得到）、
// 聽音選義（也是選）。學習者可能覺得自己會了 92 個假名，
// 實際提筆一個都寫不出來 —— 因為從來沒被要求產出過。
// =====================================================================
console.log('\n【拼出來】');
{
  const spell = (await import(SHARED + '/js/study/modes/spell.js')).default;
  const kana = items.filter((x) => spell.canUse(x) && x.item_type === 'word');
  if (!kana.length) { console.log('  ⏭  這份樣本沒有可拼寫的條目'); }
  else {
    chk(`有可拼寫的條目（${kana.length} 條）`, kana.length > 0);
    // 含漢字的拼不出來 —— 鍵盤上放不下漢字，硬要拼只會卡住
    const withKanji = items.find((x) => /[一-鿿]/.test(x.ko || ''));
    if (withKanji) chk('含漢字的條目排除在外', !spell.canUse(withKanji), withKanji.ko);

    const target = kana.find((x) => x.ko.length >= 2) || kana[0];
    let graded = null;
    // 題型只透過 els 這個對照表碰 DOM，所以測試自己組一份就好 ——
    // 不必把整個 study.js 的內部狀態拉進來。
    const spEls = {
      spell: $('spell'), spTyped: $('sp-typed'),
      spKeys: $('sp-keys'), spResult: $('sp-result'), grade: $('grade'),
    };
    const ctx = {
      item: target, els: spEls, pool: items,
      reveal: () => {}, grade: (r) => { graded = r; },
      setFront: () => {},
    };
    spell.mount(ctx);

    const keys = [...$('sp-keys').querySelectorAll('[data-c]')].map((b) => b.dataset.c);
    chk('鍵盤含正解需要的每一個字', [...target.ko].every((c) => keys.includes(c)),
        `${target.ko} → 鍵盤 ${keys.join('')}`);
    chk('★ 沒有洩漏答案長度', !$('sp-keys').textContent.includes(String(target.ko.length))
        || keys.length !== target.ko.length,
        '固定格子會把長度送出去，而促音那一課的對比全靠長度');
    chk('有完成鍵（不靠字數自動判定）', !!$('sp-keys').querySelector('[data-done]'));
    chk('有退格鍵', !!$('sp-keys').querySelector('[data-back]'));

    // 拼對 → 記「記得」
    for (const c of target.ko) {
      $('sp-keys').querySelector(`[data-c="${c}"]`).click();
    }
    $('sp-keys').querySelector('[data-done]').click();
    chk('拼對 → 自動記為答對', graded === 3, `grade=${graded}`);
    chk('★ 不出現自評按鈕', $('grade').classList.contains('hidden'),
        '客觀題的價值就在沒有自評的空間');

    // 拼錯 → 逐字標出錯在哪
    graded = null;
    spell.mount({ ...ctx, grade: (r) => { graded = r; } });
    // 重掛之後鍵盤會重新洗牌，要重讀 —— 用舊的那一份會點到不存在的鍵
    const keys2 = [...$('sp-keys').querySelectorAll('[data-c]')].map((b) => b.dataset.c);
    const wrong = keys2.find((c) => c !== target.ko[0]);
    $('sp-keys').querySelector(`[data-c="${wrong}"]`).click();
    $('sp-keys').querySelector('[data-done]').click();
    chk('拼錯 → 記為忘了', graded === 1);
    chk('★ 逐字標出錯的位置', !!$('sp-typed').querySelector('.no'),
        '只說「錯了」的話，學習者不知道自己錯在哪一個字');
    chk('顯示正解', /正確答案/.test($('sp-result').textContent));

    // ★ 每次呈現都要重新排列。
    //   一個詞要連對兩次才算掌握，所以它至少出現兩次 ——
    //   鍵盤排列固定的話，第二次練到的是「っ 在右邊數來第三顆」，
    //   不是那個字。手指記得住位置，腦子不會因此記住字。
    const layouts = new Set();
    for (let i = 0; i < 8; i++) {
      spell.mount({ ...ctx, grade: () => {} });
      layouts.add([...$('sp-keys').querySelectorAll('[data-c]')]
        .map((b) => b.dataset.c).join(''));
    }
    chk(`★ 鍵盤每次重排（8 次出現 ${layouts.size} 種排列）`, layouts.size >= 2,
        '固定排列會讓人靠位置記答案 —— 手指記得住，腦子不會');
  }
}


// =====================================================================
// 【首頁載入：三個分頁共用，不能重複打】
//
// 課程選擇（發音課程、生活場景）搬到詞庫分頁、學習記錄搬到記錄分頁之後，
// 那兩頁的內容仍由 home.load() 產生 —— 所以三個分頁的 onEnter 都會呼叫它。
// 快速切分頁＝同時觸發三輪、每輪七個查詢。
// 這不會出錯，只是白花三倍的網路 —— 在手機的行動網路上，那是看得出來的延遲。
// =====================================================================
console.log('\n【首頁載入】');
{
  const home = await import(SHARED + '/js/views/home.js');
  const a = home.load(); const b = home.load(); const c = home.load();
  chk('★ 同時呼叫三次共用同一個 promise', a === b && b === c,
      '否則切一次分頁就打三輪查詢');
  await Promise.all([a, b, c]);
  const d = home.load();
  chk('前一輪結束後可以再載入', d !== a);
  await d;
}


// =====================================================================
// 【忘記密碼】
//
// 重設密碼的程式碼一直都在（data/auth.js 的 resetPassword），
// 只是畫面上沒有入口 —— 忘記密碼的人就只能卡在登入頁。
// 是「找孤兒」的稽核翻出來的：一個沒有任何地方呼叫的匯出，
// 多數時候是垃圾，但這一個是漏接的功能。刪掉等於把 bug 藏起來。
// =====================================================================
console.log('\n【忘記密碼】');
{
  chk('登入頁有「忘記密碼」的入口', !!$('btn-forgot'));
  const authView = await import(SHARED + '/js/views/auth.js');
  chk('auth 模組有匯出初始化函式', typeof authView.initAuth === 'function');
  // ★ 不驗「查無此帳號」的訊息 —— 那正是不該有的東西：
  //   回「查無此帳號」等於讓任何人用這個表單問出誰註冊過，
  //   而這一站的帳號就是暱稱，猜中的成本很低。
  const html = fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8');
  chk('★ 不洩漏帳號是否存在', !/查無此帳號|帳號不存在/.test(html),
      '一律回「若這個帳號存在，信已寄出」—— 對真的使用者沒差別，對試探的人沒資訊');
}


// =====================================================================
// 【今日進度環】
//
// 先前首頁是四個等權並排的數字（待複習／今日已答／今日正確／已掌握），
// 沒有主次 —— 學習者不知道該看哪一個，於是一個都不看。
// 真正要回答的問題只有一個：「今天還剩多少」。
// =====================================================================
console.log('\n【今日進度環】');
{
  const home = await import(SHARED + '/js/views/home.js');
  const ring = $('ring-fg');
  const C = 2 * Math.PI * 44;

  home.renderRing(0, 20);
  chk('沒開始時環是空的', Math.abs(parseFloat(ring.style.strokeDashoffset) - C) < 0.5,
      ring.style.strokeDashoffset);
  chk('中間寫進度而不是單一數字', $('s-done').textContent === '0/20', $('s-done').textContent);

  home.renderRing(10, 20);
  chk('一半時環走一半', Math.abs(parseFloat(ring.style.strokeDashoffset) - C / 2) < 0.5);

  home.renderRing(20, 20);
  chk('達標時環滿格', Math.abs(parseFloat(ring.style.strokeDashoffset)) < 0.5);
  chk('達標時換色（不是只有數字變）', ring.classList.contains('done'));
  chk('達標時說出來', /達標/.test($('ring-sub').textContent), $('ring-sub').textContent);

  // ★ 超過目標不能溢出。做了三輪就顯示 30/20 的話，
  //   環會畫過頭，而「超額」本身不是要傳達的訊息。
  home.renderRing(35, 20);
  chk('★ 超過目標不溢出', Math.abs(parseFloat(ring.style.strokeDashoffset)) < 0.5
      && $('s-done').textContent === '20/20', $('s-done').textContent);

  // ★ 兩條載入路徑都要更新環。
  //   refreshDue() 是切換方向時走的快速路徑，只更新「待複習」——
  //   而環的目標是 min(20, 待複習 + 已掌握)，待複習一變它也要動。
  //   少了它，切完方向環會停在舊目標，兩個數字互相矛盾。
  const homeSrc = fs.readFileSync(`${SHARED}/js/views/home.js`, 'utf8');
  const paths = (homeSrc.match(/renderRing\(/g) || []).length;
  chk('★ 快速路徑也更新環', paths >= 3,
      `renderRing 出現 ${paths} 次（定義 1 ＋ 兩條載入路徑各 1）`);

  // 最近七天：「昨天有、今天空著」一眼看得到，
  // 而那比任何一句文案都更能讓人現在就打開。
  const day = (i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  home.renderWeek([{ day: day(1), n: 5 }, { day: day(3), n: 2 }]);
  const cells = [...$('week').children];
  chk('七天條有七格', cells.length === 7, `${cells.length} 格`);
  chk('有學的那兩天填實', cells.filter((c) => c.classList.contains('on')).length === 2);
  chk('★ 最後一格是今天（沒學就空著）',
      cells[6].classList.contains('today-mark') && !cells[6].classList.contains('on'),
      '今天空著正是要讓人看到的東西');
  home.renderWeek([{ day: day(0), n: 3 }]);
  chk('今天學了就填實', [...$('week').children][6].classList.contains('on'));
}


// =====================================================================
// 【題型選單】
//
// 先前寫死在 HTML 裡，後果實際發生過兩次，而且都不報錯：
//   · 新增「拼出來」之後選單上沒有它 —— 功能做完了卻沒有人點得到
//   · 日文站關閉了「詞序重組」，選單卻照樣顯示，
//     選了會靜靜退回翻卡自評（getMode 對關閉的題型回退 flip）
// 現在由註冊表產生。
// =====================================================================
console.log('\n【題型選單】');
{
  const { MODES } = await import(SHARED + '/js/study/modes/index.js');
  const home = await import(SHARED + '/js/views/home.js');
  // ★ 選單在 initHome 裡產生。先前這裡沒有呼叫它，
  //   而它剛好只在五十音表那一段的 else 分支被呼叫過 ——
  //   於是日文站是綠的、韓文站是空的，看起來像產品有問題，
  //   實際上是測試的前置沒做。真實 App 一定會呼叫 initHome。
  home.initHome({ user: () => ({ id: 'u' }), isAdmin: () => false,
                  onStudyTag: () => {}, onRecall: () => {},
                  onReview: () => {}, onFree: () => {}, onNewDeck: () => {} });
  const opts = [...$('mode-pick').querySelectorAll('input[name="mode"]')];
  chk(`選單的題型數＝註冊表（${MODES.length} 種）`, opts.length === MODES.length,
      opts.map((o) => o.value).join('/'));
  chk('★ 拼出來在選單上', opts.some((o) => o.value === 'spell'),
      '做完一個題型卻沒讓它可選，等於沒做');

  const off = LANG.disabledModes || [];
  if (off.length) {
    chk(`★ 本站關閉的題型不出現（${off.join('/')}）`,
        off.every((id) => !opts.some((o) => o.value === id)),
        '顯示一個選了會退回別的題型的選項，比不顯示更糟');
  } else {
    console.log('  ⏭  本站沒有關閉任何題型');
  }
  chk('預設選第一個', opts[0]?.checked === true);
}


// =====================================================================
// 【離開再回來要接得上】
//
// 學習中的分頁列打開之後，人隨時可能離開（查個詞、看看記錄）。
// 離開不會弄丟進度 —— 每答一題就存本機＋雲端。
// 但沒有回去的入口，等於把人鎖在外面：那一輪還在記憶體裡，
// 卻沒有任何按鈕指向它。
// =====================================================================
console.log('\n【離開再回來要接得上】');
{
  const home = await import(SHARED + '/js/views/home.js');
  const box = $('suggest');
  const btn = $('btn-primary');
  let resumed = 0;

  home.initHome({
    user: () => ({ id: 'u' }), isAdmin: () => false,
    onStudyTag: () => {}, onRecall: () => {}, onReview: () => {},
    onFree: () => {}, onNewDeck: () => {},
    roundLeft: () => 7,
    onResumeRound: () => { resumed += 1; },
  });

  home.renderSuggestion(30, { reviewed: 0 }, [], 0);
  chk('★ 有做到一半的一輪 → 主按鈕變成「繼續」', /繼續這一輪/.test(btn.textContent),
      btn.textContent);
  chk('寫出還剩幾題', /7/.test(btn.textContent),
      '不寫數字等於要人自己回想做到哪 —— 而他離開正是因為分心了');
  btn.click();
  chk('點下去回到那一輪', resumed === 1);

  // 沒有進行中的一輪時，照常給原本的建議
  home.initHome({
    user: () => ({ id: 'u' }), isAdmin: () => false,
    onStudyTag: () => {}, onRecall: () => {}, onReview: () => {},
    onFree: () => {}, onNewDeck: () => {},
    roundLeft: () => 0, onResumeRound: () => {},
  });
  home.renderSuggestion(30, { reviewed: 0 }, [], 0);
  chk('沒有進行中的一輪就不顯示', !/繼續這一輪/.test(btn.textContent), btn.textContent);
  void box;
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
