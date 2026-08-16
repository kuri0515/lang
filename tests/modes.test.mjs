// =====================================================================
// 題型註冊表與各題型的純邏輯測試（對真實詞庫資料）
//     node tests/modes.test.mjs <pool.json>
// =====================================================================
import fs from 'fs';
import { MODES, getMode, forcedDirection, needsPool } from '../js/study/modes/index.js';
import { buildChoices } from '../js/study/modes/choice.js';
import { scrambleSource } from '../js/study/modes/scramble.js';

const pool = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let fails = 0;
const chk = (n, c, e = '') => { console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); if (!c) fails++; };

console.log('【註冊表】');
chk('註冊 4 種題型', MODES.length === 4, MODES.map((m) => m.id).join('/'));
chk('每種都有 id/label/hint', MODES.every((m) => m.id && m.label && m.hint));
chk('未知 id 退回 flip', getMode('nope').id === 'flip');
chk('詞序重組鎖定 zh2ko', forcedDirection('scramble') === 'zh2ko');
chk('聽音選義鎖定 ko2zh', forcedDirection('listen') === 'ko2zh');
chk('翻卡與四選一不鎖方向', !forcedDirection('flip') && !forcedDirection('choice'));
chk('需要干擾項池的是 choice/listen',
    needsPool('choice') && needsPool('listen') && !needsPool('flip') && !needsPool('scramble'));

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

console.log(fails ? `\n❌ 失敗 ${fails} 項` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
