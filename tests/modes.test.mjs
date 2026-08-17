// =====================================================================
// 題型註冊表與各題型的純邏輯測試（對真實詞庫資料）
//     node tests/modes.test.mjs <pool.json>
// =====================================================================
import fs from 'fs';
import { SHARED, SITE, siteReady } from './_site.mjs';

// 先裝語言設定再載入題型 —— 題型的 hint 是模板字串，載入當下就要 lang()
const LANG = await siteReady();
const { MODES, getMode, forcedDirection, needsPool } = await import(`${SHARED}/js/study/modes/index.js`);
const { buildChoices } = await import(`${SHARED}/js/study/modes/choice.js`);
const { scrambleSource } = await import(`${SHARED}/js/study/modes/scramble.js`);

const pool = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let fails = 0;
const chk = (n, c, e = '') => { console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); if (!c) fails++; };

console.log(`【註冊表】（站台：${SITE}）`);
// 題型數量隨站台設定變動 —— 日文站關掉了詞序重組（日文不用空格分詞）。
// 所以斷言的是「設定說幾種就幾種」，而不是寫死 4。
const off = LANG.disabledModes || [];
chk(`註冊 ${4 - off.length} 種題型`, MODES.length === 4 - off.length,
    MODES.map((m) => m.id).join('/') + (off.length ? `（本站關閉：${off.join('/')}）` : ''));
chk('每種都有 id/label/hint', MODES.every((m) => m.id && m.label && m.hint));
chk('未知 id 退回 flip', getMode('nope').id === 'flip');
chk('被本站關掉的題型也退回 flip',
    off.every((id) => getMode(id).id === 'flip'),
    off.length ? '否則畫面會掛上一個學不到東西的題型' : '本站沒關任何題型');
if (!off.includes('scramble')) {
  chk('詞序重組鎖定 zh2ko', forcedDirection('scramble') === 'zh2ko');
}
chk('聽音選義鎖定 ko2zh', forcedDirection('listen') === 'ko2zh');
chk('翻卡與四選一不鎖方向', !forcedDirection('flip') && !forcedDirection('choice'));
chk('需要干擾項池的是 choice/listen',
    needsPool('choice') && needsPool('listen') && !needsPool('flip'));

console.log('\n【四選一 · 對真實資料】');
let short = 0, ambiguous = 0;
for (const it of pool) {
  for (const dir of ['ko2zh', 'zh2ko']) {
    const { options, answer, filled } = buildChoices(it, dir, pool);
    if (filled < 3) short++;
    const key = dir === 'ko2zh' ? 'zh' : 'ko';
    const ask = dir === 'ko2zh' ? 'ko' : 'zh';
    // 干擾項若與正解題面相同 → 兩者都對，會誤判
    for (const o of options) {
      if (o === answer) continue;
      if (pool.some((x) => x[key] === o && x[ask] === it[ask])) ambiguous++;
    }
    if (new Set(options).size !== options.length) { console.log('  ❌ 選項重複', it.ko); fails++; }
  }
}
chk(`${pool.length * 2} 種組合都湊得齊 4 個選項`, short === 0, short ? `${short} 個不足` : '');
chk('沒有同義詞歧義', ambiguous === 0,
    ambiguous ? `${ambiguous} 處` : '感謝/謝謝這類一義多詞不會互為干擾項');

console.log('\n【詞序重組 · 對真實資料】');
const src = pool.map(scrambleSource).filter(Boolean);
chk('有可重組素材', src.length > 0, `${src.length} / ${pool.length} 條`);
chk('詞塊都 ≥2', src.every((s) => s.tokens.length >= 2));
const leak = src.filter((s) => s.tokens.some((t) => /[.?!。？！]$/.test(t)));
chk('詞塊不帶句末標點', leak.length === 0,
    leak.length ? `${leak.length} 條洩題` : '帶標點的詞塊一眼看出是最後一塊，等於送分');
chk('單字類拆不開時正確回 null',
    pool.filter((i) => !i.ko.includes(' ') && !i.example_ko).every((i) => !scrambleSource(i)));

console.log('\n【形近字辨別】');
{
  const { confusableOf } = await import(`${SHARED}/js/core/taxonomy.js`);
  const groups = LANG.taxonomy.confusable || [];
  if (!groups.length) {
    console.log('  ⏭  本站沒有整理形近組');
  } else {
    // 每組至少要有兩個成員在資料裡，否則這組練不起來
    const present = (k) => pool.some((x) => x.ko === k);
    const usable = groups.filter((g) => g.keys.filter(present).length >= 2);
    chk(`${usable.length}/${groups.length} 組的成員已在資料庫裡`, usable.length > 0,
        '其餘的等該課內容進來就會自動生效');

    // ★ 核心：同組的成員必須真的成為彼此的干擾項
    const bad = [];
    for (const g of usable) {
      for (const dir of ['ko2zh', 'zh2ko']) {
        for (const k of g.keys.filter(present)) {
          const item = pool.find((x) => x.ko === k);
          const key = dir === 'ko2zh' ? 'zh' : 'ko';
          const { options } = buildChoices(item, dir, pool);
          const mates = g.keys.filter((x) => x !== k && present(x))
            .map((x) => pool.find((p) => p.ko === x)[key]);
          if (!mates.some((m) => options.includes(m))) {
            bad.push(`${k} [${dir}] → ${options.join('/')}`);
          }
        }
      }
    }
    chk('形近組的成員互為干擾項（兩個方向都是）', bad.length === 0, bad.slice(0, 3).join('  '));

    // 反面樣本：沒有形近組的詞不該被硬塞
    const plain = pool.find((x) => x.item_type === 'word' && !confusableOf(x.ko));
    chk('沒有形近組的詞照常隨機取干擾項', !!plain && buildChoices(plain, 'zh2ko', pool).options.length === 4,
        plain?.ko || '');

    chk('每組都有「怎麼分」的說明', groups.every((g) => g.hint && g.hint.length > 5),
        '說「這兩個很像」沒有用，要給抓得住的差別');
  }
}

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
