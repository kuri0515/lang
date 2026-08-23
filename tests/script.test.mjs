// =====================================================================
// 精讀畫面：對真實的 index.html 跑完「集 → 幕 → 行」
//
// 資料層換成固定的假資料（tests/_script-data-stub.mjs），
// 所以驗的是畫面邏輯本身：分頁切換、注音、遮蔽、進度、朗讀清單。
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

console.log(`【精讀】（站台：${SITE}）`);

// ── 沒宣告的站台，這個畫面根本不該存在 ──────────────────────
if (!LANG.scriptReading) {
  chk('★ 沒宣告 scriptReading 的站台不該有這塊畫面', !$('b-pane-script'),
      '藏起來的話 $() 還是找得到，某支程式會對著永遠空白的畫面做事，而且不報錯');
  chk('詞庫的子分頁也不該多出這一格',
      ![...document.querySelectorAll('input[name="btab"]')].some((r) => r.value === 'script'));
  console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
  process.exit(fails ? 1 : 0);
}

const view = await import(`${SHARED}/js/views/script.js`);
const data = await import(`${SHARED}/js/data/script.js`);
chk('★ 用的是假資料層，沒有連線上資料庫', data.IS_STUB === true,
    '攔截失效的話這支測試會打到線上專案');

// ★ 精讀掛在「詞庫」底下，不是底部導覽的一個入口。
//   底部導覽回答「我要做什麼」，而精讀跟單字、對話一樣是
//   「內容從哪來」—— 多一個底部入口就多一次猶豫。
//   （使用者的決定，2026-08-24）反過來寫：有人加回去這裡會紅。
chk('★ 精讀不是底部導覽的入口',
    !document.querySelector('#tabbar [data-tab="view-script"]'),
    '底部導覽維持四個');
chk('底部導覽維持四個',
    new Set([...document.querySelectorAll('#tabbar button')].map((b) => b.dataset.tab)).size === 4);
chk('★ 它是「詞庫」底下的第三格子分頁',
    [...document.querySelectorAll('input[name="btab"]')].map((r) => r.value)
      .join(',') === 'words,dialogue,script');

view.initScript({ userId: () => 'u1' });
await view.open();

// ── 集清單 ───────────────────────────────────────────────
chk('開場在集清單', vis('sc-list-pane') && !vis('sc-scene-pane'));
chk('列出了集', !!document.querySelector('#sc-eps [data-ep]'));
chk('★ 集上顯示進度', /1\s*\/\s*2/.test($('sc-eps').textContent),
    `讀了 1 幕共 2 幕 —— 看不到進度就不知道該從哪繼續（${$('sc-total').textContent}）`);

// ── 進到一集 ─────────────────────────────────────────────
document.querySelector('#sc-eps [data-ep]').click();
await new Promise((r) => setTimeout(r, 0));
chk('進到幕清單', vis('sc-ep-pane'));
chk('幕的方格數＝這一集的幕數',
    document.querySelectorAll('#sc-scenes [data-scene]').length === 2);
chk('★ 讀過的幕標出來了',
    document.querySelector('#sc-scenes [data-scene="1"]').classList.contains('on')
    && !document.querySelector('#sc-scenes [data-scene="2"]').classList.contains('on'));
chk('★「從第幾幕開始」指向第一個沒讀的', /第 2 幕/.test($('sc-continue').textContent),
    $('sc-continue').textContent);

// ── 進到一幕 ─────────────────────────────────────────────
document.querySelector('#sc-scenes [data-scene="1"]').click();
await new Promise((r) => setTimeout(r, 0));
chk('進到一幕', vis('sc-scene-pane'));
chk('只顯示這一幕的行', document.querySelectorAll('#sc-lines .sc-line').length === 3,
    `第 1 幕有 3 句，出現 ${document.querySelectorAll('#sc-lines .sc-line').length} 句`);
chk('第一幕的「上一幕」不能按', $('sc-prev').disabled === true);

// ── 注音 ─────────────────────────────────────────────────
chk('★ 漢字上方有注音', $('sc-lines').querySelectorAll('ruby rt').length > 0,
    '這是這個站對初學者最要緊的一件事');
chk('★ 注音沒有洩漏成方括號', !/\[/.test($('sc-lines').textContent),
    '直接印 ruby 欄位會露出 駅[えき] 這種標記');
$('sc-ruby').click();
chk('關掉注音後 ruby 消失', $('sc-lines').querySelectorAll('ruby rt').length === 0);
chk('★ 關掉注音後仍是乾淨的原句', !/\[/.test($('sc-lines').textContent),
    '關掉時若直接印 ruby 欄位，就會看到 駅[えき]は近[ちか]いです');
$('sc-ruby').click();

// ── 遮蔽 ─────────────────────────────────────────────────
const setMode = (v) => {
  const r = [...document.querySelectorAll('input[name="scmode"]')].find((x) => x.value === v);
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

// ── 讀完 / 取消 ──────────────────────────────────────────
const before = $('sc-done').textContent;
$('sc-done').click();
await new Promise((r) => setTimeout(r, 0));
chk('★ 標記可以取消', /取消/.test(before),
    '讀完是自評，而自評會後悔 —— 收不回來就沒有人敢按');
chk('取消後寫到資料層', data.marked.some((m) => m.scene === 1 && m.done === false),
    JSON.stringify(data.marked));


// ── 整幕朗讀：換幕要停 ─────────────────────────────────────
// 朗讀是逐句 await 的，而使用者隨時會換幕。
// 沒有停下來的話，畫面是新的一幕、聲音還在唸上一幕 ——
// 那不會報錯，只會讓人以為朗讀壞了。
//
// 全程用真實的 DOM 點擊驅動 —— 正式程式裡不開測試後門，
// 要控制的是語音，就換掉語音模組（見 tests/_speech-stub.mjs）。
{
  const sp = await import(`${SHARED}/js/core/speech.js`);
  chk('用的是語音替身', sp.IS_STUB === true);

  document.querySelector('#sc-scenes [data-scene="1"]').click();
  await new Promise((r) => setTimeout(r, 0));
  sp.reset();

  $('sc-play').click();
  await new Promise((r) => setTimeout(r, 0));
  chk('朗讀從第一句開始', sp.spoken.length === 1, `唸了 ${sp.spoken.length} 句`);

  // 唸到一半換幕
  document.querySelector('#sc-scenes [data-scene="2"]');
  $('sc-next').click();
  await new Promise((r) => setTimeout(r, 0));
  const atSwitch = sp.spoken.length;
  sp.finishOne();                       // 剛才那一句唸完了
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  chk('★ 換幕後不再唸上一幕的下一句', sp.spoken.length === atSwitch,
      `換幕後又唸了 ${sp.spoken.length - atSwitch} 句 —— 畫面是新的一幕，聲音還在唸舊的`);

  $('sc-prev').click();
  await new Promise((r) => setTimeout(r, 0));
}

// ── 幕之間移動 ───────────────────────────────────────────
$('sc-next').click();
await new Promise((r) => setTimeout(r, 0));
chk('下一幕換了內容', document.querySelectorAll('#sc-lines .sc-line').length === 2);
chk('最後一幕的「下一幕」不能按', $('sc-next').disabled === true);
$('sc-back-ep').click();
chk('回得到幕清單', vis('sc-ep-pane'));
$('sc-back-list').click();
chk('回得到集清單', vis('sc-list-pane'));

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
