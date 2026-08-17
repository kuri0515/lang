// =====================================================================
// 架構約束檢查 —— 讓分層是「被強制的」而不是「靠自覺的」
//
//     node tests/arch.test.mjs
//
// 這支存在的理由：上一輪我口頭宣稱「views 不直接用 supabase」，
// 但當時的檢查只 grep 了 'supabase' 字串，而 views 是從
// data/client.js 匯入 sb —— 字串不含 supabase，於是誤報通過。
// 約束要用機器檢查，且檢查本身要對著真正的違規案例驗證過。
// =====================================================================
import fs from 'fs';
import path from 'path';
import { SITE, SHARED, SITE_DIR, siteReady } from './_site.mjs';

const LANG = await siteReady();

// 程式碼只有一份（shared/js），但 DOM 契約每站一份 ——
// 所以掃描的原始碼固定，index.html 隨 SITE 走。
const ROOT = `${SHARED}/js`;
const LAYER = { core: 0, data: 1, study: 2, views: 3 };
const layerOf = (rel) => {
  const parts = rel.split(path.sep);
  return parts.length > 1 ? (LAYER[parts[0]] ?? 4) : 4;   // 根目錄 = app 層
};

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p) : e.name.endsWith('.js') && files.push(p);
  }
})(ROOT);

let fails = 0;
const chk = (n, bad, why = '') => {
  console.log(`  ${bad.length ? '❌' : '✅'} ${n}${why && !bad.length ? ' — ' + why : ''}`);
  bad.forEach((b) => console.log(`       ${b}`));
  fails += bad.length ? 1 : 0;
};
const rel = (f) => path.relative(ROOT, f);
const read = (f) => fs.readFileSync(f, 'utf8');
const imports = (f) => [...read(f).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

console.log(`（站台：${SITE}）`);
console.log('【依賴方向】core ← data ← study ← views ← app');
const wrongWay = [];
const dangling = [];
for (const f of files) {
  for (const spec of imports(f)) {
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) { dangling.push(`${rel(f)} → ${spec}`); continue; }
    if (!target.startsWith(ROOT)) continue;               // config.js 等專案根檔案
    if (layerOf(rel(target)) > layerOf(rel(f))) {
      wrongWay.push(`${rel(f)} (層${layerOf(rel(f))}) → ${rel(target)} (層${layerOf(rel(target))})`);
    }
  }
}
chk('沒有反向依賴', wrongWay, '依賴只往下走');
chk('沒有壞掉的相對路徑', dangling, 'ES module 缺一個檔就整站白屏');

console.log('\n【層職責】');
chk('core 不向上依賴',
  files.filter((f) => rel(f).startsWith('core' + path.sep))
       .filter((f) => imports(f).some((s) => s.startsWith('../')))
       .map(rel));

// ★ 關鍵：查的是「有沒有拿到 sb 這個 client」，不是 grep 'supabase' 字串
const usesClient = (f) =>
  /from\s+'[^']*data\/client\.js'/.test(read(f)) &&
  /\bsb\s*\./.test(read(f));
chk('只有 data 層直接使用 supabase client',
  files.filter((f) => !rel(f).startsWith('data' + path.sep)).filter(usesClient).map(rel),
  '查 sb.* 的實際用法，而非 grep 字串');

const touchesDom = (f) => /\bdocument\.|getElementById|querySelector/.test(read(f));
chk('data 層不碰 DOM',
  files.filter((f) => rel(f).startsWith('data' + path.sep)).filter(touchesDom).map(rel));
chk('session 引擎不碰 DOM',
  files.filter((f) => rel(f) === path.join('study', 'session.js')).filter(touchesDom).map(rel),
  '故可純 node 測試');
chk('core/srs 是純函式（不碰 DOM、不發網路）',
  files.filter((f) => rel(f) === path.join('core', 'srs.js'))
       .filter((f) => touchesDom(f) || /fetch\(|localStorage/.test(read(f))).map(rel));

console.log('\n【一致性】');
// 同一段邏輯不該有兩份實作，否則會各自漂移
const streakImpls = files.filter((f) => /連續|streak/i.test(read(f)) && /for\s*\(let i = daily/.test(read(f)));
chk('連續天數只有一份實作', streakImpls.length > 1 ? streakImpls.map(rel) : [],
    '兩份會各自漂移，導致首頁與記錄頁數字不一致');

// 條目欄位清單集中一處
const fieldLists = files.filter((f) => /'id, ko, zh, romanization/.test(read(f)));
chk('條目欄位清單集中一處',
  fieldLists.length > 1 ? fieldLists.map(rel) : [], 'ITEM_FIELDS');

// 用到卻沒有匯入的識別字。
// 實際踩過：把一個純函式搬到別的模組後，呼叫端改好了、import 卻沒補上，
// 依賴方向與相對路徑檢查都是綠的（因為根本沒有那一行 import），
// 直到執行到那個函式才 ReferenceError。
console.log('\n【匯入完備】');
{
  const missing = [];
  for (const f of files) {
    const src = read(f);
    const imported = new Set();
    for (const m of src.matchAll(/import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))\s+from/g)) {
      if (m[1]) imported.add(m[1]);
      if (m[3]) imported.add(m[3]);
      if (m[2]) {
        for (const part of m[2].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop().trim();
          if (name) imported.add(name);
        }
      }
    }
    // 只查「看起來像從別處來的」：駝峰或底線命名，且本檔沒有宣告過
    const declared = new Set([...src.matchAll(
      /(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    for (const m of src.matchAll(/\b([a-z][A-Za-z0-9]*(?:Pure|Impl|Raw))\b/g)) {
      const id = m[1];
      if (!imported.has(id) && !declared.has(id)) missing.push(`${rel(f)}: ${id}`);
    }
  }
  chk('沒有用到未匯入的識別字', [...new Set(missing)],
      '依賴檢查看不到「根本沒寫的那一行 import」');
}

console.log('\n【DOM 契約】');
// JS 取用了 HTML 裡不存在的元素 —— 這類 bug 不會在語法檢查時暴露，
// 只會在使用者點到那個功能時才炸。已經咬過兩次（listen-box、h-filter）。
const html = fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const DYNAMIC = new Set(['bulk-bar', 'peek-note', 'bulk-clear', 'bulk-del']);
const missingIds = [];
const badSelectors = [];
for (const f of files) {
  const src = read(f);
  for (const m of src.matchAll(/\$\('([^']+)'\)/g)) {
    const id = m[1];
    if (htmlIds.has(id) || DYNAMIC.has(id) || /^p\d$/.test(id)) continue;
    missingIds.push(`${rel(f)}: $('${id}')`);
  }
  // 站台可選的元素（用 opt() 取的那些）不列入必要 id ——
  // 它們本來就只存在於某些站台，見 core/dom.js 的 opt()。
  const optional = new Set([...src.matchAll(/\bopt\('([^']+)'\)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/qsa?\('(#[^']+)'/g)) {
    const root = m[1].split(/[\s\[>]/)[0].slice(1);
    if (!htmlIds.has(root) && !optional.has(root)) badSelectors.push(`${rel(f)}: ${m[1]}`);
  }
}
chk('JS 取用的 DOM id 都存在於 index.html', missingIds);

// 課程導言的不變量：begin() 每輪都必須重設，否則下一輪會掛著上一課的說明。
// 這條在 jsdom 測不到（study.js 會連帶載入 CDN 上的 supabase-js），改用原始碼層檢查。
{
  const app = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  const body = app.slice(app.indexOf('async function begin('));
  const head = body.slice(0, body.indexOf('\n}'));
  const setIdx = head.indexOf('study.setLesson');
  const returnIdx = head.search(/\n\s+(if|return|await)\b/);
  const ok = setIdx > -1 && (returnIdx === -1 || setIdx < returnIdx);
  chk('begin() 一開頭就重設課程導言',
      ok ? [] : ['放在提前 return 之後或根本沒呼叫 —— 換課時會殘留上一課的說明']);
}
chk('querySelector 的 id 錨點都存在', badSelectors);

const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
chk('HTML 的 id 不重複', allIds.filter((x, i) => allIds.indexOf(x) !== i).map((x) => `重複: ${x}`));

// ---------------------------------------------------------------------
// 共用碼不該寫死任何一個語言的說法
//
// 實際踩過：dialogue.js 的按鈕文字寫死「看韓文想中文」，
// 日文站的 index.html 明明改成「看日文想中文」，JS 一渲染就變回去。
// HTML 改對了、畫面還是錯的 —— 這種洩漏最容易漏看，
// 因為它不在你剛改的那個檔案裡。
//
// 只查「會顯示給使用者的字串」：字串字面值，且不在註解裡。
// 註解提到韓語是正常的（很多設計理由本來就源自韓語），擋註解只會製造雜訊。
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 站台的 HTML 不該出現「別的語言的文字」
//
// 實際踩過：日文站的詞性欄 placeholder 是「명사 / 동사 …」，
// 匯入區的範例是「사랑,愛,sarang…」—— 兩處都是從韓文站複製過來時漏改的。
//
// ★ 判準用「字元範圍」，不是列舉字詞。
//   第一版我只查了「韓／한／諺文／收音」這幾個字，
//   명사 是諺文卻不含那幾個字，所以完全沒被抓到 ——
//   列舉式的判準永遠會漏掉你沒想到的那一個。
// ---------------------------------------------------------------------
console.log('\n【站台用字】');
{
  const SCRIPTS = {
    hangul: /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/,
    kana: /[\u3040-\u309F\u30A0-\u30FF]/,
  };
  // 每站「應該有」哪一種文字；出現別種就是複製時漏改
  const EXPECT = { korean: 'hangul', japanese: 'kana' };
  const mine = EXPECT[SITE];
  const strays = [];
  if (mine) {
    for (const [name, re] of Object.entries(SCRIPTS)) {
      if (name === mine) continue;
      html.split('\n').forEach((line, i) => {
        if (re.test(line)) strays.push(`${SITE}/index.html:${i + 1}  ${line.trim().slice(0, 70)}`);
      });
    }
  }
  chk(`${SITE}/index.html 沒有夾帶其他語言的文字`, strays,
      '多半是從另一站複製過來時漏改的 placeholder 或範例');
}

// ---------------------------------------------------------------------
// 欄位標籤要與 lang.config 宣告的一致
//
// 實際踩過：日文站的編輯畫面把 romanization 欄標成「假名」，
// 但那一欄存的是羅馬音（ha wo mi ga ki），lang.config 也寫著「羅馬音」。
// 三個地方各說各話，而使用者看到的是最錯的那一個 ——
// 他會以為要填假名，填進去之後朗讀與拍數判斷全部失準。
//
// 標籤講錯話比用錯語言更容易誤導：用錯語言一眼看得出來，
// 標籤錯了看起來完全正常，只是填的人被引導填了錯的東西。
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// modulepreload 的路徑必須真的存在
//
// 預載一個 404 比不預載更糟：瀏覽器照樣開一條連線去抓，
// 拿回 404 之後靜靜丟掉 —— 浪費一次往返，而且不會有任何錯誤訊息。
// 清單是產生的，所以正常不會壞；這條守的是「產生器改壞了」。
// ---------------------------------------------------------------------
console.log('\n【模組預載】');
{
  // ★ 這支測試的 chk 收的是「問題清單」不是布林值 ——
  //   傳布林進去會在 .forEach 那行炸掉，而且訊息完全看不出原因。
  const hrefs = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  chk(`有預載清單（${hrefs.length} 條）`,
      hrefs.length ? [] : ['沒有任何預載 —— ES module 逐層發現，深度會乘以延遲']);
  chk('每一條預載都指到存在的檔案',
      hrefs.filter((h) => !fs.existsSync(path.resolve(SITE_DIR, h))),
      '404 的預載浪費往返又不報錯');

  const entry = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  chk('入口模組也在預載清單裡',
      hrefs.includes(entry) ? [] : [`入口 ${entry} 不在清單裡`]);
}

console.log('\n【欄位標籤一致】');
{
  const labelOf = (id) => {
    const re = new RegExp(`<label>([^<]*)</label>\\s*<input id="${id}"`);
    const m = html.replace(/\n/g, ' ').match(re);
    return m ? m[1].trim() : null;
  };
  const cases = [
    ['e-roman', LANG.readingLabel, 'romanization 欄'],
    ['e-hanja', LANG.hanjaLabel, 'hanja 欄'],
  ];
  const bad = [];
  for (const [id, want, what] of cases) {
    const got = labelOf(id);
    if (got === null) { bad.push(`${what}：找不到 <label>（id=${id}）`); continue; }
    // 標籤可以帶補充說明（「注音（漢字[かな]…）」），但必須以宣告的名稱開頭
    if (!got.startsWith(want)) bad.push(`${what}：畫面「${got}」 ≠ 設定「${want}」`);
  }
  chk('編輯畫面的欄位標籤與 lang.config 一致', bad,
      '設定改了畫面沒改，使用者會照著錯的標籤填錯的東西');
}

console.log('\n【語言中立】');
{
  // 各語言專屬、不該出現在共用碼的字眼
  const LOCKED = /韓文|韓語|諺文|收音|固有語|한글|한국|日文|日語|假名|平假名|片假名|振り仮名/;
  const bad = [];
  for (const f of files) {
    const src = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, '')      // 區塊註解
      .replace(/^\s*\/\/.*$/gm, '');           // 整行註解
    for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const lit = m[2];
      if (!LOCKED.test(lit)) continue;
      // 模板字串裡用 ${lang().termLabel} 組出來的不算 —— 那正是正確的做法
      if (m[1] === '`' && /\$\{/.test(lit)) continue;
      bad.push(`${rel(f)}: ${JSON.stringify(lit).slice(0, 60)}`);
    }
  }
  chk('共用碼沒有寫死某個語言的說法', bad,
      '語言相關的字一律走 lang()，否則另一站的畫面會悄悄講錯語言');
}

console.log('\n【安全】');
// 只盯「使用者可編輯的欄位」。粗篩所有非 esc() 插值會連數字都算違規，
// 雜訊淹沒真訊號 —— 上一版就是這樣，人只好每次手動複核一遍。
const USER_FIELDS = String.raw`ko|zh|note|tags|romanization|hanja|pos|example_ko|example_zh|username|email|title|display_name|slug`;
const RISKY = new RegExp(
  String.raw`\$\{(?![^}]*\besc\b)[^}]*\b(?:${USER_FIELDS})\b[^}]*\}`, 'g');
const xss = [];
for (const f of files) {
  for (const m of read(f).matchAll(RISKY)) {
    // textContent / value / confirm 不會執行 HTML，只看真正進 innerHTML 的
    const before = read(f).slice(Math.max(0, m.index - 260), m.index);
    if (!/innerHTML|insertAdjacentHTML/.test(before)) continue;
    xss.push(`${rel(f)}: ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`);
  }
}
chk('使用者資料進 innerHTML 前都經過 esc()', xss, '只檢查真正有風險的欄位，避免雜訊淹沒訊號');
// 查的是「真的長得像 JWT 的字串」，不是 service_role 這個詞 ——
// 註解裡提到它是正常的，寫死一把 key 才是問題。
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\./;
const svcKeys = files.filter((f) => {
  const src = read(f);
  const m = src.match(JWT_RE);
  if (!m) return false;
  // anon key 在前端是設計上公開的；service_role 才不能出現
  try { return JSON.parse(atob(m[0].split('.')[1])).role === 'service_role'; }
  catch { return false; }
});
chk('前端沒有 service_role key', svcKeys.map(rel), 'anon key 公開是設計如此，安全靠 RLS');

console.log(fails ? `\n❌ ${fails} 項約束被違反` : '\n✅ 所有架構約束通過');
process.exit(fails ? 1 : 0);
