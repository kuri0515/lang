// =====================================================================
// 把 supabase-js 打包成一個自託管的檔案：shared/vendor/supabase.js
//
// 【為什麼不繼續用 esm.sh】
//   量到的成本：17 個檔、83 KB gzip、相依深度 4 層，而且在**另一個網域**。
//   預載已經把 4 層攤平成 1 波，但剩下兩筆省不掉：
//     · 新網域的 DNS + TLS 交握（手機上約 300–600 ms）
//     · 17 個跨源請求
//   更重要的是可靠性：esm.sh 掛掉 = 這個站開不起來。
//   一個學習網站不該把「能不能開」交給第三方 CDN。
//
// 【為什麼這不算破壞「零建置」】
//   產物進版控，開發時照樣直接改原始碼、直接開網頁 ——
//   要跑這支的時機只有一個：升級 supabase-js。
//   產物與版本資訊都進版控，diff 看得到升級了什麼。
//
//     node shared/scripts/build-vendor.mjs
// =====================================================================
import fs from 'node:fs';
import * as esbuild from 'esbuild';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const pkg = JSON.parse(fs.readFileSync(`${ROOT}/node_modules/@supabase/supabase-js/package.json`, 'utf8'));
const OUT = `${ROOT}/shared/vendor/supabase.js`;

const r = await esbuild.build({
  stdin: {
    // 只匯出實際用到的那一個 —— 匯出全部會讓 tree-shaking 什麼都不敢丟
    contents: "export { createClient } from '@supabase/supabase-js';",
    resolveDir: ROOT,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',       // 與 esm.sh 先前提供的相同，不改變瀏覽器支援範圍
  minify: true,
  platform: 'browser',
  outfile: OUT,
  legalComments: 'none',
  metafile: true,
  banner: { js: `// @supabase/supabase-js@${pkg.version} —— 由 shared/scripts/build-vendor.mjs 產生，請勿手改\n` },
});

const bytes = fs.statSync(OUT).size;
const gz = (await import('node:zlib')).gzipSync(fs.readFileSync(OUT)).length;
fs.writeFileSync(`${ROOT}/shared/vendor/supabase.version.json`,
  JSON.stringify({ version: pkg.version, bytes, gzip: gz }, null, 2) + '\n');
console.log(`  ✅ supabase-js@${pkg.version} → shared/vendor/supabase.js`);
console.log(`     ${(bytes / 1024).toFixed(0)} KB（gzip ${(gz / 1024).toFixed(0)} KB）· 1 個檔 · 同源`);
if (r.warnings.length) console.log('  ⚠️ ', r.warnings.map((w) => w.text).join('\n'));
