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

// ── 欄位集合必須一致 ──
console.log('【兩站欄位一致】');
const keys = Object.fromEntries(
  SITES.map((s) => [s, Object.keys(configs[s]).sort()]));
const [a, b] = SITES;
const onlyA = keys[a].filter((k) => !keys[b].includes(k));
const onlyB = keys[b].filter((k) => !keys[a].includes(k));
chk(`${a} 有而 ${b} 沒有的欄位`, onlyA.length === 0, onlyA.join(', '));
chk(`${b} 有而 ${a} 沒有的欄位`, onlyB.length === 0, onlyB.join(', '));

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

console.log(fails ? `\n❌ ${fails} 項不通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);
