// =====================================================================
// 把 esm.sh 上 supabase-js 的相依圖抓下來，存成 shared/cdn-graph.json
//
// 【為什麼要存成檔案，而不是建置時現抓】
//   建置要能離線跑、要能重現。現抓的話：沒網路就建不出來，
//   而 esm.sh 哪天多回一個檔就會讓 --check 無緣無故變紅。
//   抓一次、存下來、進版控 —— 升級 supabase 時再手動跑這支。
//
// 【它解決什麼】
//   esm.sh 的模組是逐層發現的：載完入口才知道要 auth-js，
//   載完 auth-js 才知道要 tslib。實測**深度 4 層、17 個檔、83 KB**。
//   手機上每層約 150–300 ms，光是「發現」就花掉半秒到一秒。
//   把整張圖預先寫進 <link rel="modulepreload">，4 次序列往返變成 1 波。
//
//     node shared/scripts/refresh-cdn-graph.mjs
// =====================================================================
import fs from 'node:fs';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const clientSrc = fs.readFileSync(`${ROOT}/shared/js/data/client.js`, 'utf8');
const entry = clientSrc.match(/from\s+'(https:\/\/esm\.sh\/[^']+)'/)?.[1];
if (!entry) throw new Error('在 data/client.js 找不到 esm.sh 的 import');
if (/@\d+$/.test(entry)) {
  throw new Error(`版本沒有釘死：${entry}\n`
    + '用 @2 的話每次解析出來的子模組網址可能不同，預載清單會對不上而靜靜失效。');
}

const origin = new URL(entry).origin;
const spec = /(?:from|import)\s*"([^"]+)"/g;
const seen = new Set();
const queue = [entry];
let depth = 0;

while (queue.length) {
  const batch = queue.splice(0);
  depth += 1;
  const bodies = await Promise.all(batch.map(async (u) => {
    if (seen.has(u)) return '';
    seen.add(u);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${r.status} ${u}`);
    return r.text();
  }));
  for (const body of bodies) {
    for (const [, p] of body.matchAll(spec)) {
      const abs = p.startsWith('/') ? origin + p : (p.startsWith('http') ? p : null);
      if (abs && !seen.has(abs)) queue.push(abs);
    }
  }
}

const out = { entry, urls: [...seen].sort(), depth };
fs.writeFileSync(`${ROOT}/shared/cdn-graph.json`, JSON.stringify(out, null, 2) + '\n');
console.log(`  ✅ ${out.urls.length} 個檔、深度 ${depth} 層 → shared/cdn-graph.json`);
