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
import { SITE, SHARED, SITE_DIR } from './_site.mjs';

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
  for (const m of src.matchAll(/qsa?\('(#[^']+)'/g)) {
    const root = m[1].split(/[\s\[>]/)[0].slice(1);
    if (!htmlIds.has(root)) badSelectors.push(`${rel(f)}: ${m[1]}`);
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
