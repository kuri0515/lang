// =====================================================================
// 由 shared/index.template.html 產生各站的 index.html
//
//     node shared/scripts/build-sites.mjs           產生（會覆寫）
//     node shared/scripts/build-sites.mjs --check   只檢查是否與現有檔案一致
//
// 【為什麼要產生，而不是兩站各維護一份】
//   兩份 HTML 有 479 行、95% 相同，相異的只有 44 行語言相關的字。
//   維護兩份的代價不是「多打一次」，是「漏改一次不會報錯」——
//   實際發生過：日文站的詞性欄 placeholder 一直是韓文的「명사 / 동사」，
//   使用者截圖才發現。
//
// 【為什麼不做成執行期替換】
//   HTML 留空殼、JS 啟動後才填字，會讓首屏閃一下沒有文字的骨架。
//   這是每天要開的應用，那一下閃爍會被看見幾百次。
//
// 【--check 是給 npm test 用的】
//   產生物有進 git（GitHub Pages 直接吃，部署仍是零建置）。
//   進了 git 就可能被手動改，所以要有檢查確認它仍與樣板一致 ——
//   否則「單一真理源」只是口號，改久了兩邊還是會分家。
// =====================================================================
import fs from 'fs';
import crypto from 'crypto';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const SITES = ['korean', 'japanese'];
const check = process.argv.includes('--check');

const template = fs.readFileSync(`${ROOT}/shared/index.template.html`, 'utf8');

/**
 * 建置編號＝所有 JS 內容的雜湊。
 *
 * 【為什麼需要】
 *   GitHub Pages 對 JS 設 cache-control: max-age=600 ——
 *   十分鐘內瀏覽器根本不會去問伺服器，於是部署完看到的還是舊版。
 *   而使用者無從分辨「改壞了」與「還沒生效」，
 *   每次判斷都要猜，猜錯就往錯的方向查。
 *
 *   我們改不了 Pages 的標頭，但可以讓畫面誠實說出自己是哪一版：
 *   頁面裡嵌一個編號，另外放一份 version.json（讀取時不走快取）。
 *   兩者不一致就表示「有新版，但你手上這份還是舊的」。
 *
 * 【為什麼用內容雜湊而不是時間戳】
 *   時間戳會讓每次跑 build 都產生差異，即使一個字都沒改 ——
 *   那會讓 --check 永遠失敗，也讓 git 每次都有雜訊。
 */
/**
 * 參與版號計算的檔案。
 *
 * ★ 這份清單曾經只有 `.js` —— 於是改樣板或 CSS 之後版號不變，
 *   而 version.json 的比對正是判斷「上線了沒」的依據：
 *   一個 CSS-only 的部署會被讀成「線上與本地一致」，
 *   實際上使用者拿到的還是舊樣式。錯誤方向是**假的通過**，最糟的那種。
 *
 *   產生出來的 index.html 刻意不列入 —— 它裡面就嵌著版號，會自我循環。
 *   列的是它的來源：樣板。
 */
export function buildInputs() {
  const files = [];
  const walk = (dir, ext) => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = `${dir}/${name}`;
      if (fs.statSync(full).isDirectory()) walk(full, ext);
      else if (ext.some((e) => name.endsWith(e))) files.push(full);
    }
  };
  walk(`${ROOT}/shared/js`, ['.js']);
  walk(`${ROOT}/shared/css`, ['.css']);
  files.push(`${ROOT}/shared/index.template.html`);
  walk(`${ROOT}/shared/vendor`, ['.js']);
  for (const site of SITES) {
    for (const f of ['main.js', 'lang.config.js', 'taxonomy.js']) {
      files.push(`${ROOT}/${site}/${f}`);
    }
  }
  return files;
}

export function buildId() {
  const h = crypto.createHash('sha1');
  // 路徑也要進雜湊：只雜湊內容的話，把一個檔案改名（內容不動）
  // 算出來的版號一模一樣，而那確實是一次會影響線上的變更。
  for (const f of buildInputs()) {
    h.update(f.slice(ROOT.length));
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex').slice(0, 8);
}
const BUILD = buildId();

/**
 * 掃出某個入口的完整模組圖，產生 <link rel="modulepreload">。
 *
 * 【為什麼需要】
 *   ES module 是逐層發現的：瀏覽器要先載完 app.js 才知道它要 dom.js，
 *   載完 dom.js 才知道下一層。實測這個站有 4 層，
 *   等於開站前要 6 次往返，每次約 500 ms。
 *   modulepreload 讓瀏覽器一開始就並行抓全部，深度不再乘以延遲。
 *
 * 【為什麼用掃描而不是手寫清單】
 *   手寫的清單會漂：新增一個模組沒加進去只是「少優化一點」，
 *   不會報錯也不會有人發現；刪掉一個模組沒拿掉則會產生 404 預載。
 *   從真實的 import 圖產生，兩種都不會發生。
 */
function moduleGraph(entry) {
  const out = [];
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    out.push(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const target = new URL(spec, `file://${file}`).pathname;
      if (fs.existsSync(target)) walk(target);
    }
  };
  walk(entry);
  return out;
}

/** 從 LANG 取值，支援 html.xxx 這種巢狀路徑 */
const pick = (lang, path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), lang);

function render(lang, site) {
  let out = template;

  // 預載清單：站台自己的模組 + 共用碼。順序照發現順序，
  // 瀏覽器會並行抓，所以順序只影響優先度不影響正確性。
  const files = [
    ...moduleGraph(`${ROOT}/${site}/main.js`),
    ...moduleGraph(`${ROOT}/shared/js/app.js`),
  ];
  // supabase 現在是自託管的一般模組（shared/vendor/supabase.js），
  // 會被上面的 moduleGraph 掃到並一起預載 —— 不再需要 CDN 專用的處理。
  const links = [
    ...[...new Set(files)]
      .map((f) => f.replace(`${ROOT}/${site}/`, '').replace(`${ROOT}/`, '../'))
      .map((href) => `  <link rel="modulepreload" href="${href}">`),
  ].join('\n');
  out = out.replace('{{modulepreload}}', links);
  out = out.replace('{{build}}', BUILD);

  // ① 條件區塊：{{#grid}}…{{/grid}} —— 只有宣告了字母表的站台才留
  out = out.replace(/\{\{#grid\}\}\n([\s\S]*?)\{\{\/grid\}\}\n/g,
    (_, body) => (lang.taxonomy?.grid ? body : ''));

  // ② 可為空的屬性：{{attr readingSample placeholder}}
  //    值是空字串時整個屬性都不輸出，而不是留一個 placeholder=""
  out = out.replace(/\{\{attr (\w+) (\w+)\}\}/g, (_, key, attr) => {
    const v = lang.html?.[key];
    return v ? ` ${attr}="${v}"` : '';
  });

  // ③ 一般插槽
  out = out.replace(/\{\{([\w.]+)\}\}/g, (m, path) => {
    const v = pick(lang, path);
    if (v == null) {
      console.error(`❌ ${lang.code}：樣板要 ${path}，但 lang.config.js 沒有這個值`);
      process.exit(1);
    }
    return String(v);
  });

  const left = out.match(/\{\{[^}]*\}\}/g);
  if (left) {
    console.error(`❌ ${lang.code}：還有沒填的插槽 ${left.join(' ')}`);
    process.exit(1);
  }
  return out;
}

let bad = 0;
for (const site of SITES) {
  const { LANG } = await import(`${ROOT}/${site}/lang.config.js`);
  const out = render(LANG, site);
  const path = `${ROOT}/${site}/index.html`;
  const cur = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null;

  if (check) {
    if (cur === out) {
      console.log(`  ✅ ${site}/index.html 與樣板一致`);
    } else {
      bad++;
      console.log(`  ❌ ${site}/index.html 與樣板不一致`);
      // 指出第一處差異，比丟一句「不一致」有用得多
      const a = (cur || '').split('\n');
      const b = out.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.log(`       第 ${i + 1} 行`);
          console.log(`       現在：${(a[i] ?? '（沒有這一行）').trim().slice(0, 78)}`);
          console.log(`       樣板：${(b[i] ?? '（沒有這一行）').trim().slice(0, 78)}`);
          break;
        }
      }
    }
  } else {
    fs.writeFileSync(path, out);
    console.log(`  ✅ ${site}/index.html ${cur === out ? '（無變化）' : '已更新'}`);
  }
}

// version.json 供執行期比對。放在網站根目錄，兩站共用一份 ——
// 兩站永遠一起部署，分開兩份只會多一個會不一致的地方。
const vPath = `${ROOT}/version.json`;
const vBody = JSON.stringify({ build: BUILD }) + '\n';
if (check) {
  const cur = fs.existsSync(vPath) ? fs.readFileSync(vPath, 'utf8') : null;
  if (cur !== vBody) { bad++; console.log('  ❌ version.json 與程式碼不一致'); }
  else console.log(`  ✅ version.json 與程式碼一致（${BUILD}）`);
} else {
  fs.writeFileSync(vPath, vBody);
  console.log(`  ✅ version.json ${BUILD}`);
}

if (check && bad) {
  console.log('\n❌ 請跑 node shared/scripts/build-sites.mjs 重新產生，'
    + '或改樣板而不是改產生出來的檔案');
  process.exit(1);
}
