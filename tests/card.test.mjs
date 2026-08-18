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
  study.renderDone({ n: 20, correct: 17 }, false, '', 55);
  const again = $('btn-again');
  chk('還有剩時出現「再來一輪」', !again.classList.contains('hidden'));
  chk('按鈕上寫著真實剩餘量', /55/.test(again.textContent), again.textContent);
  chk('還有剩時「返回」退居次要', !$('btn-back').classList.contains('primary'));

  study.renderDone({ n: 20, correct: 19 }, false, '', 0);
  chk('清空後不再出現「再來一輪」', again.classList.contains('hidden'));
  chk('清空後「返回」回到主要按鈕', $('btn-back').classList.contains('primary'));
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
