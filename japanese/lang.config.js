// =====================================================================
// 日文站的語言設定
//
// 與 korean/lang.config.js 平行，欄位必須一一對應
// （tests/lang.test.mjs 會比對兩站，缺一個就報錯）。
// =====================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { TAXONOMY } from './taxonomy.js';

export const LANG = {
  code: 'ja',

  // ── 畫面上怎麼稱呼這個語言 ──
  // 「拼出來」題型能處理的字：純假名（含長音符號）。
  // 含漢字的詞排除 —— 鍵盤上放不下漢字，硬要拼只會卡住。
  // 長度上限 8：再長的詞用點的太痛苦，那是在考耐心不是考記憶。
  spellRe: /^[ぁ-ゖァ-ヺー]{1,8}$/,
  // 輪次池的來源。日文站目前只有這一副（五十音 · 入門）。
  roundDeck: 'kana-01',

  // 精讀：照影片台詞一幕一幕讀。宣告在站台這一層 ——
  // 共用碼不該知道「哪一站有精讀」，它只看這個旗標。
  // 韓文站沒有宣告，分頁就整個不存在（不是灰掉，是不存在）。
  scriptReading: true,

  langLabel: '日語',
  termLabel: '日文',
  termShort: '日',
  readingLabel: '羅馬音',   // 書上按「拍」分寫（a ki／i chi go），那是節奏的教學裝置，原樣保留
  // 這一欄在日文站存的是注音版本（駅[えき]は…），不是漢字詞源，
  // 所以標籤不能叫「漢字」—— 會讓人以為要填漢字寫法。
  hanjaLabel: '注音',
  scriptLabel: '假名或漢字',  // 匯入警告：「日文欄裡沒有假名或漢字」

  // ── 朗讀 ──
  ttsLang: 'ja-JP',
  voiceLangRe: /^ja(-|_)?/i,
  // 越前面權重越高。挑播報級語音，避開 macOS 那些角色音
  preferredVoices: [
    /kyoko|きょうこ/i,                 // Apple 正規日語女聲
    /premium|enhanced|neural|natural/i,
    /google/i,                        // Chrome 的 Google 日本語
    /nanami|ayumi|haruka|microsoft/i, // Windows / Edge
  ],

  // ── 怎麼算「一拍」 ──
  //   日語的節奏單位是拍（モーラ）不是音節，而拍幾乎等於「一個假名」——
  //   拗音的小ゃゅょ 不算一拍（きょ＝1拍），所以排除小書き假名。
  //   長音的ー、促音的っ、撥音的ん 各算一拍，所以要算進去。
  //   漢字算不出拍數，但詞條多半有假名讀音欄可補，這裡寧可低估：
  //   低估的結果是唸慢一點，高估才會讓該慢的詞唸太快。
  syllableRe: /[ぁ-んァ-ヴー]/g,

  // 目標語言字元範圍：平假名 + 片假名 + 漢字 + 長音符。
  // ★ 必須含漢字 —— 日文詞條大量是純漢字（時間・世界・注意），
  //   只認假名的話會把它們全部誤報成「這欄不像日文」。
  scriptRe: /[ぁ-ゖァ-ヺー一-龯]/,

  // ── 匯入表格的欄位別名（與語言無關的那些在 core/parse-table.js）──
  columnAliases: {
    ko: ['ja', 'japanese', 'kana', '日文', '日語', '日文', '日语', '日本語', '單字', '单词', 'word'],
    romanization: ['romaji', 'ローマ字', '羅馬字', '罗马字'],
    hanja: ['kanji', '漢字表記'],
    example_ko: ['日文例句', '日语例句', '例文'],
  },

  // ── 帳號名 → email 的假網域（Supabase Auth 只認 email）──
  // 不能沿用韓文站的 .local —— 新的 Supabase 專案拒絕這個 TLD。
  // .invalid 是 RFC 2606 保留的，保證永遠不會真的送出信。
  // 這只是「沒綁真實信箱時」的退路；有真 email 的帳號走 email_for_username()。
  authEmailDomain: 'kuri0515.invalid',
  // 短密碼補位到 Supabase 要求的 6 位。★ 不能改 —— 改了等於改掉所有既有帳號的密碼
  authPasswordPad: '-k0515',

  // ── 這個語言用不了的題型 ──
  // 詞序重組靠空格切詞塊，日文不用空格分詞：實測 301 條只有 1 條有素材。
  // 留著只會讓學生點進一個永遠沒題目的模式。
  disabledModes: ['scramble'],

  // ── hanja 欄的用途 ──
  // 日文站：hanja 欄存「ko 的注音版本」（駅[えき]は…），漢字上方標假名
  rubyFromHanja: true,

  // ── 語音試聽用的句子 ──
  // 調語速時放短句、按試聽時放長句。必須是本站的語言，
  // 否則會用本站的語音去唸另一種語言的字，出來是亂音。
  voiceSampleShort: '日本語を勉強しています',
  voiceSampleLong: 'こんにちは。はじめまして。',

  // ── 教學結構標籤（不是內容主題）──
  // 單一假名＝一課、あ行＝一章、清音＝階段、會話＝條目性質。
  // 這些是課程骨架，拿它們去比對「標籤漂移」只會製造誤報 ——
  // 而誤報多了整支稽核就沒人看了（あ 與 あ行 曾被報成同一概念被拆開寫）。
  structuralTagRe: /^[ぁ-ゖァ-ヺ]$|行$|^(清音|濁音|半濁音|拗音|長音|促音|撥音|高低重音|連濁|音讀|訓讀|母音無聲化|平假名|片假名|會話)$/,

  // ── 頁面上的字（index.html 由 shared/index.template.html 產生）──
  html: {
    native: '日本語',
    heroIcon: 'あ',
    siteName: '日語單字卡',
    importSample: 'ねこ,貓,ne ko,單字,名詞,,,,動物',
    posSample: '名詞 / 動詞 …',
    readingSample: 'ha wo mi ga ki',
    gridHint: '橫是「行」、縱是「段」。這不只是排版 —— 動詞活用就是在同一行上移動'
            + '（書く → 書きます → 書いた）。',
    dakuonHint: '濁音・半濁音不是新字 —— 在清音右上加兩點（゛）或小圈（゜）就變成它。'
              + '要學的是規則，不是 25 個新符號。',
    hanjaLabel: '注音（漢字[かな]，沒有漢字就留空）',
    hanjaSample: '歯[は]を磨[みが]きましょう。',
  },

  // ── localStorage 前綴：兩站同網域，不隔開會互相蓋掉語音與語速設定 ──
  storagePrefix: 'ja',

  supabase: { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY },
  taxonomy: TAXONOMY,
};
