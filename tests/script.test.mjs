// =====================================================================
// 精讀畫面：對真實的 index.html 跑完「作品 → 集 → 幕 → 行」
//
// 資料層換成固定的假資料（tests/_script-data-stub.mjs），
// 所以驗的是畫面邏輯本身：層層篩選、注音、遮蔽、進度、朗讀、範圍。
//
//     SITE=japanese node --import ./tests/_script-stub.mjs tests/script.test.mjs
// =====================================================================
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { SITE, SHARED, SITE_DIR, siteReady } from './_site.mjs';

const html = fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://x.test/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.getComputedStyle = dom.window.getComputedStyle;
global.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} };
global.SpeechSynthesisUtterance = function () {};

const LANG = await siteReady();
let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};
const $ = (id) => document.getElementById(id);
const vis = (id) => !!$(id) && !$(id).classList.contains('hidden');
const tick = () => new Promise((r) => setTimeout(r, 0));
const qs = (s) => document.querySelector(s);
const qsa = (s) => [...document.querySelectorAll(s)];

console.log(`【精讀】（站台：${SITE}）`);

// ── 沒宣告的站台，這個畫面根本不該存在 ──────────────────────
if (!LANG.scriptReading) {
  chk('★ 沒宣告 scriptReading 的站台不該有這塊畫面', !$('b-pane-script'),
      '藏起來的話 $() 還是找得到，某支程式會對著永遠空白的畫面做事，而且不報錯');
  chk('詞庫的子分頁也不該多出這一格',
      !qsa('input[name="btab"]').some((r) => r.value === 'script'));
  console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
  process.exit(fails ? 1 : 0);
}

const view = await import(`${SHARED}/js/views/script.js`);
const data = await import(`${SHARED}/js/data/script.js`);
chk('★ 用的是假資料層，沒有連線上資料庫', data.IS_STUB === true,
    '攔截失效的話這支測試會打到線上專案');

// ★ 精讀掛在「詞庫」底下，不是底部導覽的一個入口。（使用者的決定）
//   反過來寫：有人把它加回底部就會紅。
chk('★ 精讀不是底部導覽的入口', !qs('#tabbar [data-tab="view-script"]'));
chk('底部導覽維持四個',
    new Set(qsa('#tabbar button').map((b) => b.dataset.tab)).size === 4);
chk('★ 它是「詞庫」底下的第三格子分頁',
    qsa('input[name="btab"]').map((r) => r.value).join(',') === 'words,dialogue,script');

view.initScript({ userId: () => 'u1' });
await view.open();

// ── 三層篩選永遠看得到 ────────────────────────────────────
// 清單式的「一層層點進去」做不到一件事：隨時跳回上一層換一個 ——
// 那要先退出再重選，而挑內容時本來就是來回比較的。
chk('★ 作品那一層一直都在', vis('sc-works') && qsa('#sc-works [data-work]').length > 0);
chk('★ 集那一層一直都在', qsa('#sc-eps [data-ep]').length > 0);
chk('開場還沒選幕，所以不顯示內文', !vis('sc-scene-pane'));
chk('總進度算的是全部的集', /1\s*\/\s*3/.test($('sc-total').textContent),
    `讀了 1 幕、兩集共 3 幕（${$('sc-total').textContent}）`);

// ── 第一層：作品 · 季 ────────────────────────────────────
{
  const works = qsa('#sc-works [data-work]');
  chk('列出兩季', works.length === 2, works.map((b) => b.dataset.work).join(' / '));
  chk('預設選第一季', works[0].classList.contains('on'));
  chk('★ 只列出這一季的集', qsa('#sc-eps [data-ep]').length === 1,
      '沒有按季收斂的話，三季 75 集會全部攤在同一列');

  works[1].click();
  await tick();
  chk('★ 換一季，集跟著換',
      qs('#sc-works [data-work].on').dataset.work.includes('第 2 季'));
  chk('換季後幕那一層收起來', !vis('sc-scene-row'),
      '不收的話會留著上一季某一集的幕，而標題已經換了');
  qsa('#sc-works [data-work]')[0].click();
  await tick();
}

// ── 第二層：集 ───────────────────────────────────────────
{
  chk('選集之前不顯示幕', !vis('sc-scene-row'));
  const b = qs('#sc-eps [data-ep]');
  chk('★ 集的按鈕上帶進度', /1\/2/.test(b.textContent),
      `挑集數時要回答的正是「哪一集還沒讀完」（${b.textContent.trim()}）`);
  b.click();
  await tick();
  chk('★ 選了集，幕那一層才出現', vis('sc-scene-row'));
  chk('幕的格數＝這一集的幕數', qsa('#sc-scenes [data-scene]').length === 2);
  chk('★ 讀過的幕標出來了',
      qs('#sc-scenes [data-scene="1"]').classList.contains('on')
      && !qs('#sc-scenes [data-scene="2"]').classList.contains('on'));
  chk('★「從第幾幕開始」指向第一個沒讀的', /第 2 幕/.test($('sc-continue').textContent),
      $('sc-continue').textContent);
}

// ── 幕清單「只看沒讀的」──────────────────────────────────
{
  chk('預設看全部', /全部 2 幕/.test($('sc-filter').textContent), $('sc-filter').textContent);
  $('sc-filter').click();
  chk('★ 切成只看沒讀的，讀過的就不列了',
      qsa('#sc-scenes [data-scene]').length === 1,
      `第 1 幕已讀，應只剩第 2 幕（實際 ${qsa('#sc-scenes [data-scene]').length} 個）`);
  chk('按鈕上寫著還剩幾幕', /只看沒讀的（1）/.test($('sc-filter').textContent));
  $('sc-filter').click();
  chk('★ 切得回全部', qsa('#sc-scenes [data-scene]').length === 2,
      '回頭重讀是常態，不是例外 —— 切不回去就變成單向的');
}

// ── 第三層：一幕的內容 ───────────────────────────────────
qs('#sc-scenes [data-scene="1"]').click();
await tick();
chk('★ 選了幕才顯示內文', vis('sc-scene-pane'));
chk('標題說得出完整位置', /第 1 集 · 第 1 幕/.test($('sc-scene-title').textContent),
    $('sc-scene-title').textContent);
chk('★ 幕格標出正在讀的那一格',
    qs('#sc-scenes [data-scene="1"]').classList.contains('now'),
    '從內文抬頭看不出自己在哪的話，這三層就白做了');
chk('只顯示這一幕的行', qsa('#sc-lines .sc-line').length === 3,
    `第 1 幕有 3 句，出現 ${qsa('#sc-lines .sc-line').length} 句`);
chk('第一幕的「上一幕」不能按', $('sc-prev').disabled === true);

// ── 注音 ─────────────────────────────────────────────────
chk('★ 漢字上方有注音', $('sc-lines').querySelectorAll('ruby rt').length > 0,
    '這是這個站對初學者最要緊的一件事');
chk('★ 注音沒有洩漏成方括號', !/\[/.test($('sc-lines').textContent),
    '直接印 ruby 欄位會露出 駅[えき] 這種標記');
$('sc-ruby').click();
chk('關掉注音後 ruby 消失', $('sc-lines').querySelectorAll('ruby rt').length === 0);
chk('★ 關掉注音後仍是乾淨的原句', !/\[/.test($('sc-lines').textContent),
    '關掉時若直接印 ruby 欄位，就會看到方括號的標記');
$('sc-ruby').click();

// ── 遮蔽 ─────────────────────────────────────────────────
const setMode = (v) => {
  const r = qsa('input[name="scmode"]').find((x) => x.value === v);
  r.checked = true; r.onchange();
};
setMode('ja');
chk('★ 只看日文時中文不在畫面上', $('sc-lines').querySelectorAll('.sc-zh').length === 0,
    '看著翻譯讀等於沒讀');
setMode('zh');
chk('只看中文時日文不在畫面上', $('sc-lines').querySelectorAll('.sc-ja').length === 0);
setMode('both');
chk('回到對照兩者都在',
    $('sc-lines').querySelectorAll('.sc-ja').length === 3
    && $('sc-lines').querySelectorAll('.sc-zh').length === 3);

// ── 這一幕的詞 ───────────────────────────────────────────
chk('★ 詞來自斷詞結果，不是字串比對', /4 個/.test($('sc-words-n').textContent),
    `第 1 幕的 tokens 去重後是 4 個（${$('sc-words-n').textContent}）`);

// ── 這一幕的語法 ─────────────────────────────────────────
{
  chk('★ 列出這一幕用到的句型', /2 個/.test($('sc-gram-n').textContent),
      `第 1 幕命中 masu 與 te-iru（${$('sc-gram-n').textContent}）`);
  chk('句型有形式也有意思',
      /〜ます/.test($('sc-gram').textContent) && /〜ている/.test($('sc-gram').textContent));
  chk('★ 易錯點另起一行顯示', $('sc-gram').querySelectorAll('em').length >= 1,
      '「知っている」不是「正在知道」這種提醒，正是這張卡的價值');

  // ★ 句型要標回它出現的那一行。
  //   只列在卡片上的話，學習者知道「這一幕有〜ている」，卻不知道是哪一句 ——
  //   而精讀的核心正是在句子裡看見文法。
  const lineTags = qsa('#sc-lines .sc-tag');
  chk('★ 句型標回它出現的那一行', lineTags.length === 3,
      `第 1 幕：第 1 句 1 個、第 2 句 2 個、第 3 句 0 個（實際 ${lineTags.length}）`);
  chk('沒有句型的那一行不掛標籤',
      qsa('#sc-lines .sc-line')[2].querySelectorAll('.sc-tag').length === 0);
  chk('行上只印形式，不重複印解說',
      !/正在做/.test(qsa('#sc-lines .sc-tags').map((e) => e.textContent).join('')),
      '解說在下面那張卡，重複一次會把行擠爆');

  // 沒命中就整張卡收起來 —— 一張寫著「沒有」的卡片只會讓人以為壞了。
  // 實測一集有 14/70 幕確實沒有可標的句型。
  qs('#sc-scenes [data-scene="2"]').click();
  await tick();
  chk('★ 沒有句型時整張卡收起來', $('sc-gram-card').classList.contains('hidden'),
      '第 2 幕只有一個不存在的代號，等於沒有');
  chk('★ 不認識的代號直接略過，不顯示空白條目',
      $('sc-gram').querySelectorAll('.sc-gram').length === 0
      || !/undefined/.test($('sc-gram').textContent),
      '解說庫還沒補的代號會是 undefined —— 那會印出一整排空白');
  qs('#sc-scenes [data-scene="1"]').click();
  await tick();
}

// ── 查卡片要限定在這一集自己的詞庫 ───────────────────────
// 不限定的話，同一個詞形在別副詞庫裡的卡片也會被撈進來 ——
// 這一幕的清單因此混進別的課本，而畫面看起來完全正常
// （那些詞確實出現在這一幕，只是連錯了卡）。實測影響 29/70 幕。
{
  const cs = await import(`${SHARED}/js/data/content.js`);
  chk('★ 查這一幕的詞時有帶上詞庫',
      cs.askedWith.length > 0 && cs.askedWith.every((d) => d === 'demo-01'),
      `帶下去的是 ${JSON.stringify(cs.askedWith)}`);
}

// ── 練這一幕的詞 ─────────────────────────────────────────
// 那些詞卡在這之前唯一的入口是「詞庫 → 篩選那一副 → 學這組」，
// 沒有人會自己走到那裡。內容從哪來與拿它做什麼，該接在一起。
{
  const sent = [];
  view.initScript({ userId: () => 'u1', onPractice: (ids) => { sent.push(ids); } });
  qs('#sc-scenes [data-scene="1"]').click();
  await tick();
  chk('★ 有「練這一幕」的入口', !$('sc-practice').classList.contains('hidden'));
  chk('按鈕上寫著幾個詞', /練這一幕（4）/.test($('sc-practice').textContent),
      $('sc-practice').textContent);
  $('sc-practice').click();
  await tick();
  chk('★ 送出的是這一幕的詞', sent.length === 1 && sent[0].length === 4,
      JSON.stringify(sent[0] || []));

  // ★ 換到別的幕，按鈕與清單都必須跟著換。
  //   本來是「沒有詞就提早 return」，於是上一幕的清單留著 ——
  //   按下去練到的是上一幕的詞，而畫面上寫著這一幕。
  qs('#sc-scenes [data-scene="2"]').click();
  await tick();
  chk('換幕後按鈕跟著換', /練這一幕（3）/.test($('sc-practice').textContent),
      $('sc-practice').textContent);
  $('sc-practice').click();
  await tick();
  chk('★ 送出的是新那一幕的詞，不是上一幕的',
      sent.length === 2 && sent[1].length === 3 && sent[1].join() !== sent[0].join(),
      JSON.stringify(sent[1] || []));
}

// ── 把一幕設為「新課」的範圍 ───────────────────────────────
{
  let cur = null;
  view.initScript({
    userId: () => 'u1',
    getScope: () => cur,
    onSetScope: (sc) => { cur = sc; },
  });
  qs('#sc-scenes [data-scene="1"]').click();
  await tick();
  chk('預設沒有鎖定範圍', /設為/.test($('sc-scope').textContent), $('sc-scope').textContent);

  $('sc-scope').click();
  chk('★ 設得下去', cur && cur.scene === 1 && !!cur.epId, JSON.stringify(cur));
  chk('★ 範圍要說得出是哪一幕', /第 1 集 · 第 1 幕/.test(cur.label || ''), cur.label);

  // ★ 設得下去就要收得回來 —— 單向設定會做出一個出不來的狀態
  $('sc-scope').click();
  chk('★ 收得回來', cur === null);

  $('sc-scope').click();
  qs('#sc-scenes [data-scene="2"]').click();
  await tick();
  chk('★ 別的幕不會顯示成已鎖定', /設為/.test($('sc-scope').textContent),
      `鎖的是第 1 幕，現在看的是第 2 幕（${$('sc-scope').textContent}）`);
  qs('#sc-scenes [data-scene="1"]').click();
  await tick();
  chk('回到被鎖的那一幕又顯示成已鎖定', /取消/.test($('sc-scope').textContent));
  $('sc-scope').click();
  view.initScript({ userId: () => 'u1' });
  qs('#sc-scenes [data-scene="1"]').click();
  await tick();
}

// ── 整幕朗讀：換幕要停 ─────────────────────────────────────
// 朗讀是逐句 await 的，而使用者隨時會換幕。
// 沒有停下來的話，畫面是新的一幕、聲音還在唸上一幕 —— 那不會報錯。
// 全程用真實的 DOM 點擊驅動：正式程式裡不開測試後門，
// 要控制的是語音，就換掉語音模組（見 tests/_speech-stub.mjs）。
{
  const sp = await import(`${SHARED}/js/core/speech.js`);
  chk('用的是語音替身', sp.IS_STUB === true);
  sp.reset();

  $('sc-play').click();
  await tick();
  chk('朗讀從第一句開始', sp.spoken.length === 1, `唸了 ${sp.spoken.length} 句`);

  qs('#sc-scenes [data-scene="2"]').click();
  await tick();
  const atSwitch = sp.spoken.length;
  sp.finishOne();
  await tick(); await tick();
  chk('★ 換幕後不再唸上一幕的下一句', sp.spoken.length === atSwitch,
      `換幕後又唸了 ${sp.spoken.length - atSwitch} 句 —— 畫面是新的一幕，聲音還在唸舊的`);
}

// ── 讀完 / 取消 ──────────────────────────────────────────
{
  qs('#sc-scenes [data-scene="1"]').click();
  await tick();
  chk('★ 標記可以取消', /取消/.test($('sc-done').textContent),
      '讀完是自評，而自評會後悔 —— 收不回來就沒有人敢按');
  $('sc-done').click();
  await tick();
  chk('取消後寫到資料層', data.marked.some((m) => m.scene === 1 && m.done === false),
      JSON.stringify(data.marked));
}

// ── 回到上次讀到的地方 ────────────────────────────────────
// 昨天讀到第 30 幕，今天打開又要重選季、選集、找那一幕 ——
// 那是每天都要付一次的成本。
{
  let saved = null;
  const mk = () => view.initScript({
    userId: () => 'u1',
    getReadPos: () => saved,
    onReadPos: (p) => { saved = p; },
  });
  mk();
  await view.open();
  qs('#sc-eps [data-ep]').click();
  await tick();
  qs('#sc-scenes [data-scene="2"]').click();
  await tick();
  chk('★ 讀了哪一幕就記下來', saved && saved.scene === 2, JSON.stringify(saved));

  // 重新進這個分頁：選擇要還原，但**不自動打開內文**
  mk();
  await view.open();
  chk('★ 回到上次那一集', qs('#sc-eps [data-ep].on'), '集沒選好的話等於沒還原');
  chk('★ 幕那一層直接展開', vis('sc-scene-row'));
  chk('★ 標出上次讀到的那一幕',
      qs('#sc-scenes [data-scene="2"]').classList.contains('last'));
  chk('★ 不自動打開內文', !vis('sc-scene-pane'),
      '按分頁是想看看有什麼，不是要立刻繼續讀（docs/LESSONS.md L-003）');
  chk('★ 繼續鈕接的是上次那一幕', /接著第 2 幕/.test($('sc-continue').textContent),
      `中途跳著讀是常態，回來想接的是自己離開的地方（${$('sc-continue').textContent}）`);

  $('sc-continue').click();
  await tick();
  chk('按了才進去', vis('sc-scene-pane'));

  view.initScript({ userId: () => 'u1' });
  await view.open();
  qs('#sc-eps [data-ep]').click();
  await tick();
}

// ── 幕之間移動 ───────────────────────────────────────────
{
  qs('#sc-scenes [data-scene="1"]').click();
  await tick();
  $('sc-next').click();
  await tick();
  chk('下一幕換了內容', qsa('#sc-lines .sc-line').length === 2);
  chk('最後一幕的「下一幕」不能按', $('sc-next').disabled === true);
}

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
