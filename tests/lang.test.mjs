// =====================================================================
// 語言設定的完備性檢查
//
//     node tests/lang.test.mjs
//
// 【這支為什麼存在】
//   共用碼向 lang() 要東西，要到 undefined 不會當場報錯 ——
//   它會安靜地變成畫面上的 "undefined"，或是一個永遠比對不到的正則。
//   新增語言時漏填一個欄位，症狀會出現在離現場很遠的地方。
//
//   所以這裡不只檢查「有沒有」，還檢查「像不像」：型別對不對、
//   正則真的抓得到該語言的字、兩站的欄位集合完全一致。
//
// 【為什麼要跨站比對，而不是對一份硬名單】
//   硬名單得靠人記得更新，漏了就等於沒檢查。
//   拿兩站互相對照，任何一邊多寫或少寫都會浮出來。
// =====================================================================
import { setLang, _resetLang } from '../shared/js/core/lang.js';
import { execFileSync } from 'child_process';
import fs from 'fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SITES = ['korean', 'japanese'];

let fails = 0;
const chk = (n, c, e = '') => {
  console.log(`  ${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

const configs = {};
for (const site of SITES) {
  const { LANG } = await import(`${ROOT}/${site}/lang.config.js`);
  configs[site] = LANG;
}

// README 說「照現有兩份的欄位填齊（目前 N 個）」—— 那個數字會過期，
// 而過期的文件比沒有文件更糟：照著做的人會以為自己填完了。
// 這裡把它釘住：數字不對就報，逼人順手改掉。
{
  const n = Object.keys(configs.korean).length;
  const readme = fs.readFileSync(`${ROOT}/README.md`, 'utf8');
  const m = readme.match(/照現有兩份的欄位填齊（目前 (\d+) 個/);
  console.log('【文件與現況一致】');
  chk(`README 寫的欄位數與實際相符（實際 ${n} 個）`,
      !!m && Number(m[1]) === n,
      m ? `README 寫 ${m[1]} 個` : 'README 找不到那句話');
}

// ── 欄位集合必須一致 ──
//
// ★ 功能旗標例外。它們的語意就是「這一站有沒有這個功能」——
//   兩站都要有的話，關掉的那一站得寫 false，而那是一個
//   「宣告了卻是假的」的欄位；共用碼只看真假，多一個 false
//   不會讓任何事情更安全，只會讓人以為兩站都支援。
//
//   代價是打錯字不會被抓（scriptReadng 會被當成「這站沒有」），
//   所以一律列在這裡 —— 名字寫在測試裡，等於多一道對照。
//
//   值是期望的型別。旗標必須是布林：寫成字串 'false' 的話，
//   共用碼那句 !!flag 會判成真，功能會在沒宣告的站台打開。
//   功能內容（例如句型解說庫）必須是物件：給成陣列或字串時，
//   查表會回 undefined，而畫面只會安靜地少一塊。
const FEATURE_FIELDS = { scriptReading: 'boolean', grammar: 'object' };
const FEATURE_FLAGS = Object.keys(FEATURE_FIELDS);
console.log('【兩站欄位一致】');
const keys = Object.fromEntries(
  SITES.map((s) => [s, Object.keys(configs[s]).sort()]));
const [a, b] = SITES;
const diff = (x, y) => keys[x].filter((k) => !keys[y].includes(k) && !FEATURE_FLAGS.includes(k));
const onlyA = diff(a, b);
const onlyB = diff(b, a);
chk(`${a} 有而 ${b} 沒有的欄位`, onlyA.length === 0, onlyA.join(', '));
chk(`${b} 有而 ${a} 沒有的欄位`, onlyB.length === 0, onlyB.join(', '));
// 旗標得是布林。寫成字串 'false' 的話，共用碼那句 !!flag 會判成真 ——
// 功能會在沒宣告的站台打開，而且不報錯。
const badFlag = SITES.flatMap((s2) => Object.entries(FEATURE_FIELDS)
  .filter(([f, want]) => f in configs[s2]
    && (typeof configs[s2][f] !== want || (want === 'object' && Array.isArray(configs[s2][f]))))
  .map(([f]) => `${s2}.${f} 是 ${Array.isArray(configs[s2][f]) ? 'array' : typeof configs[s2][f]}`));
chk('功能欄位的型別正確', badFlag.length === 0, badFlag.join(', '));

// 宣告了精讀就必須有句型解說庫 —— 少了它，語法那張卡永遠是空的，
// 而畫面不會說出原因（見 views/script.js 的 renderGrammar）
const missGram = SITES.filter((s2) => configs[s2].scriptReading && !configs[s2].grammar);
chk('★ 宣告了精讀的站台都有句型解說庫', missGram.length === 0, missGram.join(', '));

// ── 每站各自的內容檢查 ──
const STRINGS = ['code', 'langLabel', 'termLabel', 'termShort',
                 'readingLabel', 'hanjaLabel', 'scriptLabel',
                 'ttsLang', 'storagePrefix', 'authEmailDomain', 'authPasswordPad'];
const REGEXES = ['voiceLangRe', 'syllableRe', 'scriptRe'];

// 各語言的實例字：拿真的詞去試正則，而不是相信正則長得對。
// 「看起來對的正則」是這種設定檔最容易出的錯 ——
// 日文站漏掉漢字範圍時，時間・世界 這種純漢字詞會全部被判成「不像日文」。
const SAMPLES = {
  korean:   { script: ['사람', '한국어', '안녕하세요'], syllables: [['오빠', 2], ['한국어', 3]] },
  japanese: { script: ['ひらがな', 'カタカナ', '時間', '世界'], syllables: [['ねこ', 2], ['きって', 3], ['とうきょう', 5]] },
};

for (const site of SITES) {
  const L = configs[site];
  console.log(`\n【${site}】`);

  chk('必要字串欄位都有值',
    STRINGS.every((k) => typeof L[k] === 'string' && L[k].length > 0),
    STRINGS.filter((k) => !L[k]).join(', ') || '');
  chk('正則欄位都是 RegExp',
    REGEXES.every((k) => L[k] instanceof RegExp),
    REGEXES.filter((k) => !(L[k] instanceof RegExp)).join(', ') || '');

  chk('supabase 設定有 url 與 anonKey 兩個鍵',
    L.supabase && 'url' in L.supabase && 'anonKey' in L.supabase);

  // ★ 前端絕不能出現 service_role key。anon key 公開是設計如此，安全靠 RLS
  const isServiceRole = (jwt) => {
    try { return JSON.parse(atob(String(jwt).split('.')[1])).role === 'service_role'; }
    catch { return false; }
  };
  chk('anonKey 不是 service_role key', !isServiceRole(L.supabase.anonKey),
      'RLS 對 service_role 無效，外洩等於整個資料庫公開');

  // ── 正則拿真字去試 ──
  const s = SAMPLES[site];
  chk('scriptRe 認得出這個語言的詞',
    s.script.every((w) => L.scriptRe.test(w)),
    s.script.filter((w) => !L.scriptRe.test(w)).join('／') || s.script.join('／'));
  chk('scriptRe 不會把純中文誤判成目標語言',
    !L.scriptRe.test('這是中文') || site === 'japanese',
    site === 'japanese' ? '日文站例外：日文本來就用漢字，這條分不開也不該分' : '');
  chk('syllableRe 數得出拍／音節數',
    s.syllables.every(([w, n]) => (w.match(L.syllableRe) || []).length === n),
    s.syllables.map(([w, n]) => `${w}→${(w.match(L.syllableRe) || []).length}(期望${n})`).join(' '));
  chk('syllableRe 帶 g 旗標', L.syllableRe.flags.includes('g'),
      '沒有 g 的話 match() 只回第一個，短詞放慢會全部失效');

  // ── 帳號網域：前端與 create_user.py 必須讀到同一個值 ──
  // ★ 不一致的症狀是「建得出帳號但登不進去」，而且兩邊各自看起來都對。
  //   所以這裡真的去跑 Python，比對它讀到的值，而不是相信註解說它們一致。
  chk('authEmailDomain 不是 .local 就是有意為之',
    typeof L.authEmailDomain === 'string' && L.authEmailDomain.includes('.'),
    L.authEmailDomain);
  let py = null;
  try {
    py = execFileSync('python3', ['-c',
      `import sys; sys.path.insert(0,'shared/scripts')\nfrom site_ctx import auth_config\nd,p=auth_config(); print(d+'|'+p)`],
      { cwd: ROOT, env: { ...process.env, SITE: site }, encoding: 'utf8' }).trim();
  } catch (e) { py = `執行失敗：${e.message.split('\n')[0]}`; }
  chk('Python 與 JS 讀到同一組帳號設定',
    py === `${L.authEmailDomain}|${L.authPasswordPad}`,
    `python=${py}  js=${L.authEmailDomain}|${L.authPasswordPad}`);

  // ── localStorage 前綴必須各站不同 ──
  const others = SITES.filter((x) => x !== site).map((x) => configs[x].storagePrefix);
  chk('storagePrefix 與其他站不衝突', !others.includes(L.storagePrefix),
      '同網域下相同前綴會互相蓋掉語音與語速設定');

  // ── 課程內容 ──
  const t = L.taxonomy;
  // 導言有兩個來源，判準是「這一課在不在字母表上」：
  //   在表上（あ、ア…）→ 導言就是那張假名卡的口訣，存在雲端 items.note
  //   不在表上（濁音、長音…）→ 沒有對應的卡，只能寫在設定裡
  // 資料側的檢查在 dom.test.mjs（那裡才有真實的 pool）。
  const fromData = (x) => !!t.introFromData && t.introFromData.test(x);
  const needStatic = t.pronOrder.filter((x) => !fromData(x));
  chk('導言不來自資料的課都有靜態導言',
    needStatic.every((x) => t.lessonIntro[x]),
    needStatic.filter((x) => !t.lessonIntro[x]).join('／'));
  chk('沒有多餘的導言（對不上任何一課）',
    Object.keys(t.lessonIntro).every((x) => t.pronOrder.includes(x)),
    Object.keys(t.lessonIntro).filter((x) => !t.pronOrder.includes(x)).join('／'));
  chk('導言來自資料的課不重複寫靜態導言',
    t.pronOrder.filter(fromData).every((x) => !t.lessonIntro[x]),
    t.pronOrder.filter(fromData).filter((x) => t.lessonIntro[x]).join('／') ||
      '抄第二份的代價是加一課要改兩個地方，而且要重新部署才看得到');
  chk('教學序列無重複', new Set(t.pronOrder).size === t.pronOrder.length);
  chk('靜態導言夠短（≤60 字）',
    Object.values(t.lessonIntro).every((v) => v.length <= 60),
    Object.entries(t.lessonIntro).filter(([, v]) => v.length > 60).map(([k]) => k).join('／'));
  chk('靜態導言都帶該語言的實例',
    Object.values(t.lessonIntro).every((v) => L.scriptRe.test(v)),
    '規則講完要有一個看得到的例子，否則只是抽象敘述');
  // ★ 收尾話的判準是「在不在教學序列裡」，不是「有沒有靜態導言」。
  //   導言搬到雲端之後，用 lessonIntro 判斷會把 92 個假名課全部排除 ——
  //   它們的收尾話從此不再出現，而且不會報錯。
  {
    const withOutro = t.pronOrder.filter((x) => {
      for (const f of t.lessonFamilies || []) if (f.match(x)) return true;
      return t.outroOk[x] || t.outroLow[x];
    });
    chk(`收尾話涵蓋教學序列裡的課（${withOutro.length} 課有）`,
        withOutro.length > 0,
        '一句都沒有，多半是判準把整類課排除掉了');
    const orphan = [...new Set([...Object.keys(t.outroOk), ...Object.keys(t.outroLow)])]
      .filter((x) => !t.pronOrder.includes(x));
    chk('沒有對不上任何一課的收尾話', orphan.length === 0, orphan.join('／'));
  }

  chk('收尾話刻意留白（不是每課都有）',
    t.pronOrder.filter((x) => {
      for (const f of t.lessonFamilies || []) if (f.match(x)) return true;
      return t.outroOk[x];
    }).length < t.pronOrder.length,
    '每課都稱讚等於每句都不算數');
  chk('生活場景都有標籤與說明',
    t.lifeScenes.length > 0 && t.lifeScenes.every((x) => x.tags.length && x.label && x.hint));
  chk('生活場景刻意沒有順序',
    t.lifeScenes.every((x) => !('order' in x) && !('requires' in x)),
    '興趣驅動的東西一旦排順序就變成作業');

  // ── 形近組 ──
  const groups = t.confusable || [];
  const seen = new Map();
  const dup = [];
  for (const g of groups) for (const k of g.keys) {
    if (seen.has(k)) dup.push(`${k}（在「${seen.get(k).join('/')}」與「${g.keys.join('/')}」兩組）`);
    seen.set(k, g.keys);
  }
  // ★ 一個字只能屬於一組。屬於兩組時 confusableOf 只會回第一組，
  //   於是另一組的成員永遠不會成為干擾項 —— 那一組等於沒有作用，
  //   而且不會報錯。實際踩過：さ 同時在 さ/ち 與 き/さ 兩組裡。
  chk('每個字只屬於一組形近組', dup.length === 0, dup.join('；'));
  chk('每組至少兩個成員', groups.every((g) => g.keys.length >= 2));
  chk('每組都有「怎麼分」的說明',
      groups.every((g) => g.hint && g.hint.length > 5),
      '說「這兩個很像」沒有用，要給抓得住的差別');

  // 裝得上共用碼才算真的可用 —— 只驗欄位不驗裝配，等於沒驗
  _resetLang();
  setLang(L);
  const tax = await import(`${ROOT}/shared/js/core/taxonomy.js`);
  const grouped = tax.groupTags(t.pronOrder.map((x) => [x, 1]).concat([['食物', 9]]));
  chk('發音標籤全部歸進發音組',
    grouped.pron.length === t.pronOrder.length && grouped.topic.length === 1,
    `發音 ${grouped.pron.length}／主題 ${grouped.topic.length}`);
  chk('發音組照教學序排',
    grouped.pron.map(([x]) => x).join() === t.pronOrder.join());
}


// ── 句型偵測與解說必須對得上 ──
//
// 偵測寫在 japanese/scripts/extract_subtitles.py（Python），
// 解說寫在 japanese/grammar.js（JS）—— 兩個檔、兩種語言，漂了沒有人會發現：
//   有規則沒解說 → 那條句型永遠不顯示（renderGrammar 會略過查不到的代號）
//   有解說沒規則 → 那條解說永遠不會出現
// 兩種都不報錯。
{
  // 判斷抽成純函式，證明它會報警時不必去改真的檔案
  const diff = (rules, docs) => [
    ...[...rules].filter((k) => !docs.has(k)).map((k) => `規則 ${k} 沒有解說`),
    ...[...docs].filter((k) => !rules.has(k)).map((k) => `解說 ${k} 沒有規則`),
  ];
  chk('★ 壞樣本：有規則沒解說 → 抓得到',
      diff(new Set(['a', 'b']), new Set(['a'])).length === 1);
  chk('★ 壞樣本：有解說沒規則 → 抓得到',
      diff(new Set(['a']), new Set(['a', 'b'])).length === 1);
  chk('乾淨樣本不誤報', diff(new Set(['a']), new Set(['a'])).length === 0);

  const site = SITES.find((s2) => configs[s2].scriptReading);
  if (site) {
    const py = fs.readFileSync(`${ROOT}/${site}/scripts/extract_subtitles.py`, 'utf8');
    const rules = new Set([...py.matchAll(/^\s*"([a-z0-9-]+)":\s*lambda/gm)].map((m) => m[1]));
    const docs = new Set(Object.keys(configs[site].grammar || {}));
    chk(`★ ${site}：偵測規則與解說一一對應（各 ${rules.size} / ${docs.size} 條）`,
        rules.size > 0 && diff(rules, docs).length === 0,
        diff(rules, docs).slice(0, 4).join('、'));
  }
}

console.log(fails ? `\n❌ ${fails} 項不通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
