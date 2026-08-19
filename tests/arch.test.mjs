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

// 計數不得在客戶端累加 —— 2026-08-19 造成 108 筆對不上的那個 bug。
// prevCard 是一輪開始時讀到的那張，而同一輪內重排的卡不會更新它，
// 於是每次都寫成 prev+1，計數停在原地而 reviews 一筆筆累積。
// 累加一律交給資料庫（log_review / log_practice 的 +1）。
{
  const prog = fs.readFileSync(new URL('../shared/js/data/progress.js', import.meta.url).pathname, 'utf8');
  const bad = [];
  if (/total_reviews:\s*\(/.test(prog)) bad.push('progress.js 又在客戶端算 total_reviews');
  if (/correct_reviews:\s*\(/.test(prog)) bad.push('progress.js 又在客戶端算 correct_reviews');
  chk('★ 答題計數不在客戶端累加', bad);
  // 正規複習與自由練習都必須走 RPC —— 兩個寫入分開做就不是同進同退
  // 離開頁面前必須等寫入落地 —— flush 只是「發出」，導航會把還在飛的砍掉
  const app = fs.readFileSync(new URL('../shared/js/app.js', import.meta.url).pathname, 'utf8');
  // 切到 window.location.replace（真正的導航），不是註解裡提到的那次 ——
  // 第一版切到註解就截斷了，於是明明寫對了卻報違反。
  const upd = app.slice(app.indexOf("bar.onclick"),
                        app.indexOf("window.location.replace", app.indexOf("bar.onclick")));
  chk('★ 版本更新前先等答題寫入落地',
      /await\s+session\.settle\(\)/.test(upd) ? []
        : ['更新按鈕沒有等 session.settle() —— 剛答的那題會被導航砍掉']);
  chk('★ 版本更新前也等續跑進度上雲',
      /await\s+progress\.saveResume\(/.test(upd) ? []
        : ['更新按鈕沒有等進度上雲']);
  const hide = app.slice(app.indexOf("addEventListener('pagehide'"));
  chk('★ 關分頁時用 keepalive 送出',
      /saveResumeBeacon/.test(hide.slice(0, 400)) ? []
        : ['pagehide 沒走 keepalive —— 一般請求會隨頁面一起被砍掉']);

  // ★ 靜態站的部署不是原子的：新版推上去後，舊版仍會在使用者的瀏覽器裡
  //   活十分鐘以上（GitHub Pages max-age=600，分頁不關就更久）。
  //   所以「刪欄位」與「程式碼停止使用該欄位」不能在同一次做 ——
  //   2026-08-19 這樣做的結果是兩站都打不開。
  //   這條檢查擋的是：migration 裡有 drop column，而它刪的欄位
  //   在 shared/js 裡還找得到引用。
  {
    const mig = fs.readdirSync(new URL('../shared/supabase/migrations', import.meta.url).pathname)
      .filter((f) => f.endsWith('.sql'));
    const js = ['app.js', 'data/auth.js', 'data/progress.js', 'data/content.js']
      .map((f) => { try { return fs.readFileSync(new URL(`../shared/js/${f}`, import.meta.url).pathname, 'utf8'); } catch { return ''; } })
      .join('\n');
    const dropped = new Set();
    for (const f of mig) {
      const sql = fs.readFileSync(new URL(`../shared/supabase/migrations/${f}`, import.meta.url).pathname, 'utf8');
      for (const m of sql.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?([a-z_]+)/gi)) dropped.add(m[1]);
      // 之後又加回來的就不算刪過
      for (const m of sql.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_]+)/gi)) dropped.delete(m[1]);
    }
    const stillUsed = [...dropped].filter((c) => new RegExp(`\\b${c}\\b`).test(js));
    chk('★ 已刪除的欄位不得還被程式碼引用',
        stillUsed.map((c) => `${c} 已被 drop，但 shared/js 還在用 —— 舊版快取會打不開`));
  }

  chk('saveReview 走 RPC（卡片與記錄同一個交易）',
      /rpc\('log_review'/.test(prog) ? [] : ['saveReview 沒有走 log_review RPC']);
}

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
  // 跨網域的那條（CDN）不在本機檔案系統上，另外驗
  chk('每一條本地預載都指到存在的檔案',
      hrefs.filter((h) => !h.startsWith('http'))
           .filter((h) => !fs.existsSync(path.resolve(SITE_DIR, h))),
      '404 的預載浪費往返又不報錯');

  // ★ CDN 那條必須與 client.js 裡真正 import 的網址一字不差 ——
  //   版本號升級時若沒跟著動，會白抓一份沒人用的舊版，而且不報錯。
  const clientSrc = fs.readFileSync(`${SHARED}/js/data/client.js`, 'utf8');
  const cdn = clientSrc.match(/from\s+'(https:\/\/[^']+)'/)?.[1];
  chk('CDN 預載的網址與程式碼裡的一致',
      !cdn || hrefs.includes(cdn) ? [] : [`程式碼用 ${cdn}，預載清單裡沒有`]);

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

// ---------------------------------------------------------------------
// 【清單畫面不可以直接印 ko】
//
// 資料裡 826 條的漢字全標了讀音，但一度只有學習卡片和情境對話會渲染 ——
// 詞庫、學習歷史、回顧清單、同義詞、漢字詞群共七處印的是裸漢字。
// 於是「駅」在卡片上看得到 えき，翻到詞庫又變回一個不會唸的字。
//
// 初學者這個階段還沒有「看到漢字自動浮出讀音」的能力，
// 少標一次就是少一次曝光，而列表正是滑最快、看最多的地方。
//
// 這種缺陷不會報錯、資料查起來也是 100% 覆蓋率 —— 只有把畫面渲染出來才看得到。
// 所以改成用一支 wordHTML()，並在這裡擋住走回頭路。
//
// 【兩種例外，都不是漏改】
//   ① 屬性值（data-ko="…"）—— 那是拿去給 TTS 唸的，必須是純文字。
//      塞 <ruby> 進屬性只會唸出一串標籤。
//   ② importer.js —— 那是「你剛貼進來的東西長這樣」的預覽。
//      預覽要忠實呈現原文，加工過的預覽就失去預覽的意義。
//   把例外寫進閘門並說明理由，比讓人每次看到紅字再自己判斷一遍可靠。
const RAW_KO = /\$\{esc\((?:\w+\.)*\w+\.ko\)\}/g;
const rawKo = [];
for (const f of files.filter((f) => /\/views\//.test(f) && !/importer\.js$/.test(f))) {
  const src = read(f);
  for (const m of src.matchAll(RAW_KO)) {
    // 屬性值：往前找到最近的 < 或 > ，若中間有 =" 就是在標籤屬性裡
    const head = src.slice(Math.max(0, m.index - 120), m.index);
    if (/<[^<>]*=\"$/.test(head)) continue;
    rawKo.push(`${rel(f)}: ${m[0]}`);
  }
}
chk('清單畫面用 wordHTML() 而不是直接印 ko', rawKo,
  '日文站的漢字要標讀音；韓文站 wordHTML 會原樣回傳，兩站共用同一支');

// 【hanja 欄不可以不分站台就印出來】
//
// 這一欄兩站裝的東西根本不同：
//   韓文站 = 漢字詞源（학교 → 學校），對中文母語者是最大的紅利，該顯眼地印。
//   日文站 = 注音字串（駅[えき]は…），是渲染 ruby 用的原料，不是給人讀的。
// 不分站台就印，日文站的詞庫與學習歷史會出現「· 漢 駅[えき]は…」，
// 而讀音已經標在詞的正上方，再印一次還是重複。
//
// 這種錯不會拋例外、不會影響資料，只會在畫面上安靜地顯示一串亂碼似的東西 ——
// 正是「大架構一致、細則不同」最容易破的地方。
const HANJA_RAW = /\$\{(?!\s*!lang\(\)\.rubyFromHanja)[^}]*\bhanja\b[^}]*\}/g;
const hanjaRaw = [];
for (const f of files.filter((f) => /\/views\//.test(f))) {
  const src = read(f);
  for (const m of src.matchAll(HANJA_RAW)) {
    if (!/漢 |b-hanja/.test(m[0])) continue;
    hanjaRaw.push(`${rel(f)}: ${m[0].replace(/\s+/g, ' ').slice(0, 70)}`);
  }
}
chk('印出 hanja 前先問站台', hanjaRaw, '韓文站是漢字詞源要印；日文站是注音原料不該印');

// 【共用碼的字串常量不可以寫死某一站的語言】
//
// dom 測試會掃渲染後的畫面，但那只涵蓋「會進 DOM」的字串。
// 語音試聽那個 bug 就漏掉了：speech.speak('안녕하세요') 丟給 TTS，
// 從來不出現在畫面上，於是日文站選了日語語音、按下去唸出一句韓文，
// 而任何看畫面的檢查都是綠的。
//
// 【為什麼只看字串常量】
//   共用碼的註解裡本來就有大量兩種語言的字（解釋兩站差異時必然會舉例），
//   整份檔案粗篩會被註解淹沒。所以先把註解剝掉，只看引號裡的東西。
//
// 【為什麼用字集而不是列舉字詞】
//   列舉「안녕하세요、명사…」只擋得住想得到的那幾個 ——
//   詞性 placeholder 當初就是這樣漏的，我列的清單裡沒有它。
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const SCRIPT = /[가-힣ᄀ-ᇿぁ-ゖァ-ヺ]/;
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const hardcoded = [];
for (const f of files) {
  for (const m of stripComments(read(f)).matchAll(LITERAL)) {
    if (SCRIPT.test(m[2])) hardcoded.push(`${rel(f)}: ${m[0].slice(0, 40)}`);
  }
}
chk('共用碼沒有寫死任何一站的語言文字', hardcoded,
  '要顯示或朗讀的字一律由站台宣告（lang.config.js），共用碼不認得任何一種語言');

// 【`ns.fn()` 呼叫的函式，對方模組真的有匯出嗎】
//
// 這個專案大量用命名空間匯入（import * as home from './views/home.js'），
// 而 JS 對「呼叫一個不存在的匯出」沒有任何靜態檢查 ——
// home.addMasteredToday(...) 在對方忘了 export 時就是 undefined is not a function。
//
// 實測過這個洞：把 addMasteredToday 的 export 拿掉，
// 499 條測試全部照樣通過。而真實後果是「今天的掌握數永遠不累加、
// 學習者永遠解鎖不了新課」，沒有任何錯誤訊息。
//
// 【為什麼靜態檢查就夠】
//   要真的抓到得把每個分支都執行一遍，而 app.js 的分支多半要登入才走得到。
//   比對「呼叫的名字」與「對方的匯出清單」不必執行，涵蓋率反而更完整。
//
// 【只查本專案的模組】
//   外部套件（supabase 之類）沒有原始碼可比對，跳過。
const exportsOf = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+(\w+)/gm)) names.add(m[1]);
  // export { a, b as c }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      if (bits.length) names.add((bits[1] || bits[0]).trim());
    }
  }
  return names;
};
const badCalls = [];
for (const f of files) {
  const src = read(f);
  const ns = new Map();          // 別名 → 目標檔的絕對路徑
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'(\.[^']+)'/g)) {
    const target = path.resolve(path.dirname(f), m[2]);
    if (fs.existsSync(target)) ns.set(m[1], target);
  }
  for (const [alias, target] of ns) {
    const names = exportsOf(target);
    const re = new RegExp(`\\b${alias}\\.(\\w+)\\s*\\(`, 'g');
    for (const m of src.matchAll(re)) {
      if (!names.has(m[1])) badCalls.push(`${rel(f)}: ${alias}.${m[1]}() → ${path.basename(target)} 沒有匯出它`);
    }
  }
}
chk('ns.fn() 呼叫的函式對方都有匯出', badCalls,
  'JS 對此沒有任何靜態檢查，忘了 export 只會在使用者點到時變成 undefined is not a function');

// 【localStorage 的鍵一律要帶站台前綴】
//
// 兩站同在 kuri0515.github.io 這一個網域下，而 localStorage 是
// **整個網域共用**的 —— 路徑不同不會隔開。
// 於是 'session-resume-v1' 這種裸鍵，兩站寫的是同一格。
//
// 實際發生過（2026-08-18）：在韓文站學到一半，打開日文站，
// 續跑把韓文站那一輪接了回來 —— 日文站上出現整輪韓文單字，
// 而程式沒有任何錯誤。使用者的回報是「日文站串了韓文站的內容」。
// theme 當時甚至寫死成 'kr.theme'，日文站也在寫同一格。
//
// 這種錯誤在單站測試裡永遠測不到：一次只跑一個站，不會撞。
// 只有靜態檢查擋得住。
const BARE_LS = /localStorage\.(?:get|set|remove)Item\(\s*(['"`])/g;
const bareKeys = [];
for (const f of files) {
  for (const m of read(f).matchAll(BARE_LS)) {
    const line = read(f).slice(m.index, m.index + 70).split('\n')[0];
    bareKeys.push(`${rel(f)}: ${line}`);
  }
}
chk('localStorage 的鍵都經過 lsKey()（帶站台前綴）', bareKeys,
  '兩站同網域、localStorage 共用 —— 裸鍵會讓一站讀到另一站的資料，而且不報錯');

// 【模組寫到哪個分頁，那個分頁進入時就要呼叫它】
//
// 這一天之內我漏了三次同樣的事：把畫面搬到別的分頁，
// 但它的內容仍由原本的模組產生，而新分頁的 onEnter 沒有呼叫那個模組 ——
// 結果是一張空卡片。不會報錯，看起來只是「還沒載入」。
//
//   · 發音課程、生活場景搬到詞庫分頁 → 直接開 #browse 會是空的
//   · 回顧清單、我的弱項搬到記錄分頁 → 同上
//   · 練習方式搬到「我的」→ 摘要列是空的（使用者問「設定在哪」才發現）
//
// home.js 現在寫到四個分頁的元素，這個結構本身就容易漏。
// 與其每次靠記得，不如讓它在漏的時候紅起來。
//
// 【只看「一進來就該看得到」的元素】
//   第一版把所有元素都算進去，於是報了三個誤報：
//     dialogue 寫 view-browse → 但它在隱藏的對話面板裡，點分頁才載入
//     voice / edits 寫 view-me → 一個在啟動時初始化、一個由按鈕開啟
//   全都是正確的行為。而誤報的閘門比沒有閘門更糟 ——
//   紅字變成雜訊之後，真的漏接那天也一樣被略過。
//
//   所以只看「進入分頁時直接可見」的元素：
//   排除 class 含 hidden 的容器之內，以及 <details> 之內（預設收合）。
//   我漏掉的那三次，全都是一進去就該看到卻空著的區塊。
//
//   editor 是頂層覆蓋層（在所有 section 之外），本來就不屬於任何分頁。
{
  const htmlSrc = fs.readFileSync(`${SITE_DIR}/index.html`, 'utf8');
  // 用深度配對找每個 view 的範圍：靠猜 </section> 會在巢狀時切錯
  const owner = {};
  for (const m of htmlSrc.matchAll(/<section id="(view-[a-z]+)"/g)) {
    let depth = 0, end = m.index;
    for (const t of htmlSrc.slice(m.index).matchAll(/<\/?section\b/g)) {
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { end = m.index + t.index; break; }
    }
    const body = htmlSrc.slice(m.index, end);
    for (const idm of body.matchAll(/id="([a-z0-9-]+)"/g)) {
      // 這個 id 前面有沒有「還沒關掉的」hidden 容器或 details？
      const before = body.slice(0, idm.index);
      const depth = (tag) => {
        let d = 0;
        for (const t of before.matchAll(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'g'))) {
          if (t[0].startsWith('</')) d = Math.max(0, d - 1);
          else if (tag !== 'div' || /class="[^"]*\bhidden\b/.test(t[0])) d++;
          else if (d > 0) d++;                 // 已在隱藏容器內，巢狀 div 也算
        }
        return d;
      };
      // ★ <summary> 裡的東西看得見 —— details 收合時仍然顯示摘要列。
      //   把整個 details 當成不可見的話，會漏掉「摘要列是空的」這種缺陷，
      //   而那正是我實際漏掉的那一次（練習方式搬到「我的」，摘要沒接上）。
      const inSummary = /<summary\b[^>]*>(?:(?!<\/summary>)[\s\S])*$/.test(before);
      if (!inSummary && (depth('details') > 0 || depth('div') > 0)) continue;
      owner[idm[1]] = m[1];
    }
  }

  const appSrc = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  const hooks = {};
  for (const m of appSrc.matchAll(/onEnter\('(view-[a-z]+)',\s*([^\n]*)/g)) {
    hooks[m[1]] = (hooks[m[1]] || '') + m[2];
  }

  // 例外：不是靠「進入分頁」渲染的模組。
  //   voice 在啟動時 initVoiceUI() 就掛好，實際填內容是等瀏覽器
  //   非同步回報可用語音（onVoicesReady）—— 那個時機與分頁無關，
  //   綁到 onEnter 反而會在語音還沒載入時把清單清空。
  //   寫成清單而不是放寬規則：放寬會讓 home.initHome 之類的
  //   啟動期呼叫也算數，那道閘門就守不住任何東西了。
  // 三條例外，都是真的正確行為 —— 寫明理由而不是放寬規則。
  //
  // ★ 我試過「猜哪些元素一進來就看得見」（排除 hidden 容器與 details 之內）。
  //   那條路在誤報與漏報之間來回兩次都沒收斂：
  //   summary 裡的看得見、details 裡的看不見、hidden 容器又可能被 JS 打開，
  //   每補一個規則就換一種錯法。不可靠的閘門比沒有閘門更糟。
  const EXEMPT = new Set([
    // 啟動時 initVoiceUI() 就掛好，實際填內容是等瀏覽器非同步回報可用語音。
    // 那個時機與分頁無關，綁到 onEnter 反而會在語音還沒載入時把清單清空。
    'voice',
    // 對話面板預設隱藏，點「情境對話」子分頁才載入（browse.js 的 initTabs）。
    // 一進詞庫就載入對話是白花一次查詢。
    'dialogue',
    // 編輯記錄由「我的」裡的按鈕開啟，不是一進去就顯示。
    'edits',
  ]);

  const gaps = [];
  for (const f of files.filter((f) => /\/views\/\w+\.js$/.test(f))) {
    const mod = path.basename(f, '.js');
    if (EXEMPT.has(mod)) continue;
    const views = new Set();
    for (const m of read(f).matchAll(/\$\('([a-z0-9-]+)'\)\s*\.(?:innerHTML|textContent)\s*=/g)) {
      if (owner[m[1]]) views.add(owner[m[1]]);
    }
    for (const v of views) {
      // view-study / view-done 由學習流程主動 show()，沒有 onEnter，跳過
      if (!hooks[v]) continue;
      if (!hooks[v].includes(mod + '.')) gaps.push(`${v} 進入時沒有呼叫 ${mod}（它寫這一頁的元素）`);
    }
  }
  chk('搬過去的畫面都有接上載入', gaps,
    '內容留在原本的模組、新分頁沒呼叫它 —— 結果是一張空卡片，而且不報錯');
}

// 【各畫面用到的 deps 回呼，app.js 必須真的提供】
//
// 畫面都用 deps.onXxx?.() 這種可選鏈呼叫 —— 漏接線時不會報錯，
// 那顆按鈕就是靜靜地沒反應。而「按了沒反應」是使用者最難描述、
// 我最難查的一種問題（今天在朗讀上花了一整輪，就是這個形狀）。
//
// 【為什麼比對要認簡寫屬性】
//   deps 是 { user: () => user, isAdmin } —— isAdmin 是簡寫。
//   只認 `name:` 的話會把它報成缺失，而那是誤報。
//   我第一版就是這樣，一個誤報就足以讓人不再細看這份報告。
{
  const appSrc = fs.readFileSync(`${ROOT}/app.js`, 'utf8');
  const provided = new Set([
    ...[...appSrc.matchAll(/(\w+)\s*:/g)].map((m) => m[1]),        // name: value
    ...[...appSrc.matchAll(/[{,]\s*(\w+)\s*[,}]/g)].map((m) => m[1]), // 簡寫屬性
  ]);
  const gaps = [];
  for (const f of files.filter((f) => /\/views\/\w+\.js$/.test(f))) {
    for (const m of new Set([...read(f).matchAll(/deps[?]?\.(\w+)/g)].map((x) => x[1]))) {
      if (!provided.has(m)) gaps.push(`${rel(f)}: deps.${m}()`);
    }
  }
  chk('畫面用到的 deps 回呼都有接線', gaps,
    '可選鏈呼叫漏接時不報錯 —— 那顆按鈕只是靜靜地沒反應');

  // ★ 另一半：app.js 提供了，模組也要真的留住。
  //   study.js 原本寫 deps = { inRecallList, onToggleRecall } —— 逐一挑，
  //   於是後來新增的 onPark 被丟掉，🏠 按鈕點下去什麼都不會發生。
  //   上面那道閘門只驗「有沒有提供」，驗不到「有沒有留住」，
  //   是端到端的動線測試才抓到的。
  const dropped = [];
  for (const f of files.filter((f) => /\/views\/\w+\.js$/.test(f))) {
    const src = read(f);
    const used = new Set([...src.matchAll(/deps[?]?\.(\w+)/g)].map((x) => x[1]));
    if (!used.size) continue;
    // 有沒有整包留下來（deps = d）？有的話一定不會漏
    if (/\bdeps\s*=\s*\w+\s*;/.test(src)) continue;
    for (const m of [...src.matchAll(/\bdeps\s*=\s*\{([^}]*)\}/g)]) {
      const kept = new Set(m[1].split(',').map((x) => x.split(':')[0].trim()));
      for (const u of used) if (!kept.has(u)) dropped.push(`${rel(f)}: deps.${u}() 沒有被留下來`);
    }
  }
  chk('模組有留住它用到的 deps', dropped,
    '逐一挑的寫法每加一個回呼就多一次漏掉的機會 —— 整包留下來就不會');
}

// 【別用「撈一批再過濾」找特定的東西】
//
// 這個陷阱今天咬了兩次，兩次都不會報錯：
//   · 建輪次池時 pickItems({ limit: 5000 })
//     —— PostgREST 單次最多回 1000 列，詞庫過千之後一輪會靜靜少一截，
//        而「還剩多少」看起來完全正常（它算的是那份殘缺清單）。
//   · 找形近組的夥伴時 pickItems({ limit: 400 }) 再過濾
//     —— 夥伴排在 400 之後就永遠找不到，而功能看起來正常：
//        它只是沒把該加的加進去。
//
// 共同點：limit 是「我猜這麼多夠了」，而不是「我只要這麼多」。
// 真的只要取樣時（例如抽 60 題來練）給 limit 是對的；
// 要找特定的東西就該用條件去查，或撈完整份。
//
// 【為什麼查大於 200 的 limit】
//   小的 limit 多半是真的取樣（一輪 10 題、弱項 8 個）。
//   大的那些幾乎都是「我猜這麼多夠了」—— 而那個猜測會過期。
const bigLimit = [];
for (const f of files) {
  for (const m of read(f).matchAll(/limit:\s*(\d{3,})/g)) {
    if (Number(m[1]) > 200) bigLimit.push(`${rel(f)}: limit: ${m[1]}`);
  }
}
chk('沒有「猜一個大 limit 再過濾」的查詢', bigLimit,
  'PostgREST 單次最多 1000 列 —— 猜的那個數字會過期，而截斷不會報錯');


// 【導覽列不准攔截】
//   曾經有過：「有進行中的一輪時，按首頁就接回那一輪」。
//   結果是使用者在首頁以外的任何一頁按「首頁」都會被彈進學習畫面，
//   唯一的出口是學習畫面裡那顆 🏠 —— 等於回不了首頁。
//   導覽列是使用者對「我能去哪」的唯一保證。
const routerSrc = read(`${ROOT}/views/router.js`);
chk('分頁按鈕不做攔截',
  /resumeTab|dataset\.tab === 'view-home' &&/.test(routerSrc) ? ['router.js 的 initTabs 有條件式攔截'] : [],
  '按「首頁」就該去首頁，沒有例外');

// 【輪次池的規則不准回到 app.js】
//   埋在 app.js 裡就驗不到（那裡碰得到 supabase 與 DOM），
//   而驗不到的結果已經發生過：空的 queue 被當成「走完一輪」，
//   線上某使用者被推到第 17 輪，實際一輪都沒走完。
const appR = read(`${ROOT}/app.js`);
chk('app.js 不自己判斷輪次的邊界',
  /round\.pos\s*\+=|roundNo:\s*\(/.test(appR) ? ['app.js 又在自己算輪次'] : [],
  '規則放在 study/round.js，那裡是純函式、驗得到');


// 【要等網路的入口按鈕，一律包 busy()】
//   沒有忙碌回饋的等待會製造重試，而重試曾經是有代價的
//   （一按就吃掉輪次池 10 個詞，見 docs/LESSONS.md L-002）。
//   代價已經拿掉了，但「按了像沒反應」本身就是 bug。
//
//   查的是 home.js 裡直接呼叫 deps.onXxx() 的 onclick ——
//   那些全都會打網路。包了 busy 的寫法是 busy(e.currentTarget, () => deps.onXxx())。
const homeSrc = read(`${ROOT}/views/home.js`);
const bare = [];
for (const m of homeSrc.matchAll(/onclick\s*=\s*\(([^)]*)\)\s*=>\s*([^;]+);/g)) {
  const body = m[2];
  if (/deps\.on[A-Z]/.test(body) && !/busy\(/.test(body)) bare.push(m[0].slice(0, 60));
}
chk('要等網路的入口按鈕都有忙碌狀態', bare,
  '按了沒反應時使用者會連按 —— 那正是輪次池被吃掉的觸發方式');

console.log(fails ? `\n❌ ${fails} 項約束被違反` : '\n✅ 所有架構約束通過');
process.exit(fails ? 1 : 0);
