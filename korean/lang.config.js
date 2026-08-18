// =====================================================================
// 韓文站的語言設定
//
// shared/js 底下的共用碼不寫死任何語言，一律向 lang() 要 ——
// 這個檔就是韓文站交出去的那份答案。日文站有一份平行的同名檔，
// 兩份的欄位必須一致（tests/lang.test.mjs 會比對，缺一個就報錯）。
//
// 加一個新語言 = 複製這個檔 + 寫一份 taxonomy.js，不用動 shared/ 任何一行。
// =====================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { TAXONOMY } from './taxonomy.js';

export const LANG = {
  code: 'ko',

  // ── 畫面上怎麼稱呼這個語言 ──
  // 「拼出來」題型能處理的字：純諺文音節。
  // 諺文是拼合而成的，一個音節一顆鍵 —— 六個以內用點的還算舒服。
  spellRe: /^[가-힣]{1,6}$/,
  // 輪次池的來源：只取「詞彙」這一副。
  // 日常用語與生活興趣是情境式的成句內容，混進來會讓一輪的長度暴增，
  // 而輪次池的用途是「把該記的字掃過一遍」—— 那是詞彙的事。
  roundDeck: 'vocab-01',

  langLabel: '韓語',      // 「系統沒有韓語語音」
  termLabel: '韓文',      // 欄位名、必填提示：「韓文與中文為必填」
  termShort: '韓',        // 方向標籤：「韓→中」
  readingLabel: '羅馬音',
  hanjaLabel: '漢字',
  scriptLabel: '諺文字元',  // 匯入警告：「韓文欄裡沒有諺文字元」

  // ── 朗讀 ──
  ttsLang: 'ko-KR',
  voiceLangRe: /^ko(-|_)?/i,
  // 越前面權重越高。挑的是播報級語音，不是 macOS 那些角色音
  preferredVoices: [
    /yuna|유나/i,                    // Apple 正規韓語女聲
    /premium|enhanced|neural|natural/i,
    /google/i,                       // Chrome 的 Google 한국의
    /sunhi|heami|microsoft/i,        // Windows / Edge
  ],
  // 一個諺文字＝一個音節。用來判斷「這個詞短到該放慢唸」
  syllableRe: /[가-힯]/g,
  // 諺文字元範圍（含字母與古諺文），比 syllableRe 寬 ——
  // 那邊是數音節，這邊只問「這欄看起來像不像韓文」
  scriptRe: /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯]/,

  // ── 匯入表格的欄位別名（與語言無關的那些在 core/parse-table.js）──
  columnAliases: {
    ko: ['ko', 'korean', 'hangul', '한국어', '한글', '韓文', '韓語', '韩文', '韩语', '單字', '单词', 'word'],
    hanja: ['한자'],
    example_ko: ['韓文例句', '韩文例句'],
  },

  // ── 帳號名 → email 的假網域（Supabase Auth 只認 email）──
  // 韓文站建立得早，已有帳號用著這個網域 —— 動了等於把人鎖在門外。
  // 新專案已不接受 .local，所以日文站用別的，見 japanese/lang.config.js。
  authEmailDomain: 'kuri0515.local',
  // 短密碼補位到 Supabase 要求的 6 位。★ 不能改 —— 改了等於改掉所有既有帳號的密碼
  authPasswordPad: '-k0515',

  // ── 這個語言用不了的題型 ──
  // 韓文站四種都能用。空陣列不是佔位 —— 它讓「本站不關任何題型」
  // 成為一個明確的宣告，而不是「欄位剛好沒寫」。
  // tests/lang.test.mjs 會比對兩站欄位，少寫一個就報錯。
  disabledModes: [],

  // ── hanja 欄的用途 ──
  // 韓文站：hanja 欄是漢字詞本身（學校），不是注音來源
  rubyFromHanja: false,

  // ── 語音試聽用的句子 ──
  // 調語速時放短句、按試聽時放長句。必須是本站的語言，
  // 否則會用本站的語音去唸另一種語言的字，出來是亂音。
  voiceSampleShort: '한국어를 배우고 있어요',
  voiceSampleLong: '안녕하세요. 만나서 반갑습니다.',

  // ── 教學結構標籤（不是內容主題）──
  // 收音系列與音變規則是刻意的教學序列。
  // 這些是課程骨架，拿它們去比對「標籤漂移」只會製造誤報 ——
  // 而誤報多了整支稽核就沒人看了（あ 與 あ行 曾被報成同一概念被拆開寫）。
  structuralTagRe: /^收音|^(連音練習|硬音化|鼻音化|流音化|激音化|顎化|의的發音|會話)$/,

  // ── 頁面上的字（index.html 由 shared/index.template.html 產生）──
  // 只放「無法從上面的欄位推導」的那些；能推導的（termLabel 之類）
  // 直接在樣板裡引用，避免同一件事寫兩次。
  html: {
    native: '한국어',          // 用該語言自己的文字寫的站名
    heroIcon: '한',
    siteName: '韓語單字卡',
    importSample: '사랑,愛,sarang,單字,명사,,,,情感',
    posSample: '명사 / 동사 …',
    readingSample: '',
    // 韓文站沒有字母表（諺文是拼合而成，不是逐字表），
    // 這兩句不會被輸出 —— 但仍要有值，否則樣板檢查會直接失敗，
    // 而「悄悄少一段」比報錯難發現得多。
    gridHint: '',
    dakuonHint: '',
    hanjaLabel: '漢字詞（如 學校；固有語留空）',
    hanjaSample: '',
  },

  // ── localStorage 前綴：兩站同網域，不隔開會互相蓋掉語音與語速設定 ──
  storagePrefix: 'kr',

  supabase: { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY },
  taxonomy: TAXONOMY,
};
