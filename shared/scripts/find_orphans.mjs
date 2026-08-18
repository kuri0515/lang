// =====================================================================
// 找出沒有任何地方呼叫的匯出
//
//     node shared/scripts/find_orphans.mjs
//
// 【為什麼需要】
//   每次搬移或移除功能都會留下孤兒：函式還在、匯出還在，但沒有人呼叫。
//   實際發生過（2026-08-18 一天之內就三次）：
//     · 取消每日新卡上限 → newCardsToday 沒人用了
//     · 移除首頁的詞庫卡 → countItems 沒人用了
//     · monorepo 重構時被取代的舊歷史 API → listHistory / masteredItems /
//       itemTimeline 已經孤立好幾個月
//
//   孤兒不會報錯，只會讓下一個人以為它還有作用，
//   然後花時間維護一個不存在的行為 —— 或更糟，照著它去改，
//   改完發現畫面沒反應，再回頭查為什麼。
//
// 【為什麼是腳本不是測試】
//   「沒人呼叫」不等於「該刪」：
//     · 測試用的（checkRuby、_resetLang）本來就只有測試會呼叫
//     · 剛寫好、還沒接上畫面的功能
//     · 給日後用的公開 API
//   做成測試會逼人為了讓它變綠而刪掉不該刪的，或加一長串例外清單。
//   所以只報告，由人判斷 —— 搬完東西之後跑一次。
//
// 【判斷要點：孤兒 vs 斷掉的功能】
//   看到「沒人呼叫」時，先問哪一種：
//     真孤兒     → 它的功能已經被別的東西取代（history 那三個就是）
//     斷掉的功能 → 本來該呼叫的地方漏了，那是 bug 不是垃圾
//   分辨的方法是去看「這個功能現在還在不在畫面上」。
// =====================================================================
import fs from 'fs';
import path from 'path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const SCAN = ['shared/js'];
const ALSO = ['tests', 'korean', 'japanese', 'shared/index.template.html'];

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  if (fs.statSync(dir).isFile()) return (out.push(dir), out);
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    fs.statSync(p).isDirectory() ? walk(p, out)
      : /\.(js|mjs|html)$/.test(n) && out.push(p);
  }
  return out;
};

const own = walk(path.join(ROOT, 'shared/js'));
const others = ALSO.flatMap((d) => walk(path.join(ROOT, d)));
const read = (f) => fs.readFileSync(f, 'utf8');
const outside = others.map(read).join('\n');

const orphans = [];
for (const f of own) {
  const src = read(f);
  const names = [...src.matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)]
    .map((m) => m[1]);
  for (const n of names) {
    const re = new RegExp(`\\b${n}\\b`, 'g');
    // 別的共用碼有沒有用？（扣掉自己這一檔）
    const inShared = own.filter((o) => o !== f).some((o) => re.test(read(o)));
    re.lastIndex = 0;
    const inOther = re.test(outside);
    re.lastIndex = 0;
    // 自己檔案內部有沒有再用到。
    //
    // ★ 要數「所有出現」，不能只數 `名稱(` 那種呼叫 ——
    //   常數會被當值用（MODE_MAP[id]、p.length >= MIN_LEN、setTimeout(f, UNDO_MS)），
    //   只數呼叫的話這些全變成假警報。
    //   第一版就是這樣，四個報告裡三個是誤報，而誤報會讓人不再細看，
    //   於是真正的那一個（resetPassword 沒有畫面入口）也一起被略過。
    const selfUses = (src.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length - 1;
    if (!inShared && !inOther && selfUses <= 0) {
      orphans.push(`${path.relative(ROOT, f)}: ${n}`);
    }
  }
}

console.log('【沒有任何地方呼叫的匯出】');
if (!orphans.length) console.log('  ✅ 沒有');
else {
  orphans.forEach((o) => console.log('  ·', o));
  console.log(`\n  共 ${orphans.length} 個。`);
  console.log('  ★ 逐一判斷是「真孤兒」還是「本來該呼叫卻漏了」——');
  console.log('    後者是 bug，刪掉等於把 bug 藏起來。');
}
