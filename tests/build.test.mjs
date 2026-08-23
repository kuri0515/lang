// =====================================================================
// 版號要涵蓋所有會影響線上的檔案
//
// version.json 是判斷「上線了沒」的依據：拿本地的跟線上的比對，
// 一樣就當作已同步。所以版號漏算任何一種檔案，
// 都會讓一次真實的部署被讀成「線上與本地一致」——
// **錯誤方向是假的通過**，而假的通過沒有人會去查。
//
// 這曾經發生：buildId 只雜湊 `.js`，於是改樣板或 CSS 之後版號不變。
//
// 驗法是端到端的：真的去改一個檔案，看 `--check` 會不會抓到。
// 「清單裡有沒有 .css」那種字面檢查證明不了雜湊真的讀了它。
//
//     node tests/build.test.mjs
// =====================================================================
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

/** 跑 --check，回傳它是否通過 */
const checkPasses = () => {
  try {
    execFileSync('node', [`${ROOT}/shared/scripts/build-sites.mjs`, '--check'],
                 { stdio: 'pipe' });
    return true;
  } catch { return false; }
};

const build = () => {
  execFileSync('node', [`${ROOT}/shared/scripts/build-sites.mjs`], { stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(`${ROOT}/version.json`, 'utf8')).build;
};

/**
 * 暫時改一個檔案，重新 build，看**版號**變了沒。finally 保證還原。
 *
 * ★ 不能用 `--check` 是否失敗來判斷。
 *   --check 還會比對產生出來的 index.html 與樣板 ——
 *   改樣板時它一定會紅，不管版號有沒有涵蓋樣板。
 *   （第一版就是這樣寫的：用舊的 buildId 跑，這一條照樣「通過」。）
 *   要驗版號，就只能比版號。
 */
function mustChangeBuildId(path, append) {
  const orig = fs.readFileSync(path);
  const before = build();
  try {
    fs.writeFileSync(path, Buffer.concat([orig, Buffer.from(append)]));
    return build() !== before;
  } finally {
    fs.writeFileSync(path, orig);
    build();                                 // 版號一併還原，不留痕跡
  }
}

console.log('【版號涵蓋範圍】');

chk('乾淨的工作區 --check 會通過', checkPasses(),
    '基準不成立的話，下面每一條都會「通過」而其實什麼都沒驗到');

chk('★ 改 CSS，版號要跟著變',
    mustChangeBuildId(`${ROOT}/shared/css/style.css`, '\n/* probe */\n'),
    'CSS-only 的部署會被讀成「線上與本地一致」，而使用者拿到的是舊樣式');

chk('★ 改樣板，版號要跟著變',
    mustChangeBuildId(`${ROOT}/shared/index.template.html`, '\n<!-- probe -->\n'),
    '搬一個區塊、改一段文案都屬於這一類 —— 全都不會動到任何 .js');

chk('★ 改共用 JS，版號要跟著變',
    mustChangeBuildId(`${ROOT}/shared/js/core/dom.js`, '\n// probe\n'),
    '這一類本來就涵蓋，一起驗是為了確認測試方法本身有效');

chk('改站台設定，版號要跟著變',
    mustChangeBuildId(`${ROOT}/korean/lang.config.js`, '\n// probe\n'));

chk('★ 驗完之後工作區乾淨（每個 probe 都還原了）', checkPasses(),
    'finally 沒還原的話會留下髒檔案，而下一次 build 會靜靜地把它帶上線');


console.log('\n【開站不依賴任何第三方來源】');
{
  // 先前 supabase-js 走 esm.sh：17 個檔、83 KB gzip、深度 4 層、另一個網域。
  // 預載可以把深度攤平，但 DNS + TLS 攤不平，而且 esm.sh 掛掉這個站就開不起來。
  // 改成自託管之後，這裡守的是「別再飄回去」。
  const html = fs.readFileSync(`${ROOT}/korean/index.html`, 'utf8');
  // 只看**程式碼**來源（script / modulepreload / stylesheet）。
  // 連到自己 Supabase 專案的 preconnect 是資料 API，該留 ——
  // 它是這個站的後端，不是第三方程式碼。
  const codeSrc = [...html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*\brel="(?:modulepreload|stylesheet)"[^>]*\bhref)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => /^https?:/.test(u));
  chk('★ 沒有任何第三方程式碼來源', codeSrc.length === 0, codeSrc.slice(0, 3).join(' / '));

  const clientSrc = fs.readFileSync(`${ROOT}/shared/js/data/client.js`, 'utf8');
  chk('★ client.js 不從 CDN import', !/from\s+'https?:/.test(clientSrc),
      'esm.sh 掛掉時整個站開不起來 —— 那不該是一個學習網站的失敗模式');

  chk('打包好的 supabase 有被預載', html.includes('vendor/supabase.js'),
      '不預載的話它仍然是模組瀑布的第 4 層');

  // 產物與 node_modules 的版本必須一致。
  // 不一致代表有人升級了套件卻沒重跑 build-vendor —— 而那不會報錯：
  // 線上跑的是舊版，package.json 說的是新版。
  const meta = JSON.parse(fs.readFileSync(`${ROOT}/shared/vendor/supabase.version.json`, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(
    `${ROOT}/node_modules/@supabase/supabase-js/package.json`, 'utf8'));
  chk('★ 打包產物與 node_modules 版本一致', meta.version === pkg.version,
      `產物 ${meta.version} / 安裝的 ${pkg.version} —— 升級了卻沒重跑 build-vendor.mjs`);

  chk('產物比原本的 CDN 版小', meta.gzip < 83 * 1024,
      `${(meta.gzip / 1024).toFixed(0)} KB gzip（esm.sh 那條鏈是 83 KB）`);
}


console.log('\n【沒宣告的功能不得滲進那一站的模組圖】');
{
  // 功能模組若用靜態 import，它會進入**每一站**的模組圖，
  // 於是沒有這個功能的站台也要預載幾個永遠用不到的檔案。
  // 宣告式的開關，代價不該由沒開的那一站付。
  // （實際發生過：精讀改掛到詞庫底下時，browse.js 靜態 import 了它，
  //   韓文站因此多預載 views/script.js 與 data/script.js。）
  const FEATURE_MODULES = { scriptReading: ['views/script.js', 'data/script.js'] };

  // ★ 判斷抽成純函式，這樣「證明它會報警」不必去改真的檔案。
  //   種壞樣本的老做法是暫時把產出改壞再還原 —— 而還原失敗
  //   就會把壞掉的產出留在工作區，下一次 build 靜靜地帶上線。
  const violations = (sites) => {
    const out = [];
    for (const { name, config, html } of sites) {
      for (const [flag, mods] of Object.entries(FEATURE_MODULES)) {
        const on = new RegExp(`${flag}\\s*:\\s*true`).test(config);
        for (const m of mods) {
          const pre = html.includes(`href="../shared/js/${m}"`);
          if (!on && pre) out.push(`${name} 沒宣告 ${flag} 卻預載了 ${m}`);
          if (on && !pre) out.push(`${name} 宣告了 ${flag} 卻沒預載 ${m}`);
        }
      }
    }
    return out;
  };

  // 先證明它會報警（假資料，不碰任何檔案）
  const fakePre = '<link rel="modulepreload" href="../shared/js/views/script.js">'
                + '<link rel="modulepreload" href="../shared/js/data/script.js">';
  chk('★ 壞樣本一：沒宣告卻被預載 → 會抓到',
      violations([{ name: 'x', config: '{}', html: fakePre }]).length === 2,
      '抓不到的話，這道閘門對真正要防的那件事是瞎的');
  chk('★ 壞樣本二：宣告了卻沒預載 → 會抓到',
      violations([{ name: 'y', config: 'scriptReading: true', html: '' }]).length === 2,
      '反方向也要抓 —— 否則功能會靜靜地少載一半');
  chk('乾淨樣本不會誤報',
      violations([{ name: 'z', config: 'scriptReading: true', html: fakePre },
                  { name: 'w', config: '{}', html: '' }]).length === 0);

  // 再套到真的兩站
  const real = ['korean', 'japanese'].map((name) => ({
    name,
    config: fs.readFileSync(`${ROOT}/${name}/lang.config.js`, 'utf8'),
    html: fs.readFileSync(`${ROOT}/${name}/index.html`, 'utf8'),
  }));
  const bad = violations(real);
  chk('★ 功能模組只出現在宣告了它的站台', bad.length === 0, bad.join(' / '));
}

console.log(fails ? `\n❌ ${fails} 項未過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
