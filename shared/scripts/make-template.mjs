// =====================================================================
// 從現有的 korean/index.html 反推出樣板。
//
// 【為什麼用反推而不是重寫】
//   兩站的 index.html 是活的、上線中的檔案。手寫一份樣板再產生，
//   等於把 479 行重打一次 —— 任何一個空白、一個屬性順序不同，
//   都可能是看不出來的行為差異，而 HTML 的差異不會報錯。
//
//   反推則保證：樣板套回韓文站的值，必定得到現在這個檔案本身。
//   驗證方式是逐位元組比對，不是「看起來一樣」。
//
// 這支只跑一次（產生樣板後就不再需要），留著是為了說明樣板怎麼來的。
//     node shared/scripts/make-template.mjs
// =====================================================================
import fs from 'fs';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { LANG } = await import(`${ROOT}/korean/lang.config.js`);

let html = fs.readFileSync(`${ROOT}/korean/index.html`, 'utf8');

// 順序有意義：長的先換，否則「韓文」會先把「韓文例句」的一部分吃掉
const SLOTS = [
  ['漢字詞（如 學校；固有語留空）', '{{html.hanjaLabel}}'],
  [LANG.html.importSample, '{{html.importSample}}'],
  [LANG.html.posSample, '{{html.posSample}}'],
  ['搜尋韓文／中文／羅馬音…', '搜尋{{termLabel}}／中文／{{readingLabel}}…'],
  ['「韓文,中文,羅馬音…」', '「{{termLabel}},中文,{{readingLabel}}…」'],
  ['看韓文想中文', '看{{termLabel}}想中文'],
  ['韓文 ↔ 中文（繁體）雙向間隔重複學習', '{{termLabel}} ↔ 中文（繁體）雙向間隔重複學習'],
  ['韓文 ↔ 中文（繁體）雙向間隔重複', '{{termLabel}} ↔ 中文（繁體）雙向間隔重複'],
  ['<span>韓 → 中</span>', '<span>{{termShort}} → 中</span>'],
  ['<span>中 → 韓</span>', '<span>中 → {{termShort}}</span>'],
  ['<label>韓文 *</label>', '<label>{{termLabel}} *</label>'],
  ['<label>例句（韓）</label>', '<label>例句（{{termShort}}）</label>'],
  ['<label>羅馬音</label>', '<label>{{readingLabel}}</label>'],
  ['한국어 · 韓語單字卡', '{{html.native}} · {{html.siteName}}'],
  ['content="韓語單字卡"', 'content="{{html.siteName}}"'],
  ['<h1>韓語單字卡</h1>', '<h1>{{html.siteName}}</h1>'],
  ['<div class="brand">한국어 ', '<div class="brand">{{html.native}} '],
  ['한국어 單字卡 · 資料存於', '{{html.native}} 單字卡 · 資料存於'],
  ['<div class="hero-icon">한</div>', '<div class="hero-icon">{{html.heroIcon}}</div>'],
];

for (const [from, to] of SLOTS) {
  if (!html.includes(from)) {
    console.error(`❌ 找不到要替換的字串，樣板會不完整：${JSON.stringify(from)}`);
    process.exit(1);
  }
  html = html.replaceAll(from, to);
}

// 日文站多出來的五十音表：做成條件區塊
const GRID = `      <details id="grid-box" class="grid-box hidden">
        <summary><span>五十音表</span><span id="grid-sub" class="muted"></span></summary>
        <p class="hint">橫是「行」、縱是「段」。這不只是排版 ——
          動詞活用就是在同一行上移動（書く → 書きます → 書いた）。</p>
        <div id="gojuon"></div>
      </details>
`;
html = html.replace('      <h2>發音課程</h2>\n',
  `      <h2>發音課程</h2>\n{{#grid}}\n${GRID}{{/grid}}\n`);

// 韓文站沒有羅馬音／注音的範例值，日文站有 —— 用可為空的插槽
html = html.replace('<input id="e-roman" type="text">',
                    '<input id="e-roman" type="text"{{attr readingSample placeholder}}>');
html = html.replace('<input id="e-hanja" type="text">',
                    '<input id="e-hanja" type="text"{{attr hanjaSample placeholder}}>');

fs.writeFileSync(`${ROOT}/shared/index.template.html`, html);
console.log(`✅ 樣板已產生：${html.split('\n').length} 行，`
  + `${(html.match(/\{\{/g) || []).length} 個插槽`);
