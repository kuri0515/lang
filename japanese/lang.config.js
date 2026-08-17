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
  langLabel: '日語',
  termLabel: '日文',
  termShort: '日',
  readingLabel: '假名',     // 韓文站這欄是羅馬音；日文站放假名讀音才有用
  hanjaLabel: '漢字',
  scriptLabel: '假名',      // 匯入警告：「日文欄裡沒有假名」

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
    romanization: ['kana', 'よみ', '讀音假名', '假名', 'furigana', 'ふりがな', 'romaji', '羅馬字'],
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

  // ── localStorage 前綴：兩站同網域，不隔開會互相蓋掉語音與語速設定 ──
  storagePrefix: 'ja',

  supabase: { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY },
  taxonomy: TAXONOMY,
};
