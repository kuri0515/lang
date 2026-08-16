// =====================================================================
// 貼上式表格解析（CSV / TSV / 從 Excel 或 Google 試算表直接複製）
//
// 與 scripts/import_words.py 共用同一套欄位別名，
// 網頁貼上與命令列匯入的行為必須一致 —— 改一邊記得改另一邊。
// =====================================================================

const ALIASES = {
  ko: ['ko', 'korean', 'hangul', '한국어', '한글', '韓文', '韓語', '韩文', '韩语', '單字', '单词', 'word'],
  zh: ['zh', 'chinese', 'meaning', 'meaning_zh', '中文', '繁體', '繁体', '釋義', '释义', '意思', '翻譯', '翻译'],
  romanization: ['romanization', 'roman', '羅馬音', '罗马音', '發音', '发音', '讀音', '读音'],
  hanja: ['hanja', '漢字', '汉字', '漢字詞', '汉字词', '한자'],
  item_type: ['type', 'item_type', '類型', '类型', '分類', '分类'],
  pos: ['pos', '詞性', '词性', 'part_of_speech'],
  example_ko: ['example_ko', '例句', '韓文例句', '韩文例句', 'example'],
  example_zh: ['example_zh', '例句翻譯', '例句翻译', '例句中文'],
  note: ['note', '備註', '备注', '說明', '说明'],
  tags: ['tags', '標籤', '标签', '主題', '主题'],
};
const CANON = {};
for (const [k, list] of Object.entries(ALIASES)) for (const a of list) CANON[a.toLowerCase()] = k;

const TYPE_MAP = {
  word: 'word', 單字: 'word', 单词: 'word', 單詞: 'word', 詞: 'word', 词: 'word',
  phrase: 'phrase', 詞組: 'phrase', 词组: 'phrase', 短語: 'phrase', 短语: 'phrase',
  sentence: 'sentence', 句子: 'sentence', 句: 'sentence', 例句: 'sentence',
};

/** 依內容猜分隔符：Excel 複製出來是 Tab，手打多半是逗號 */
function sniff(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const tab = (line.match(/\t/g) || []).length;
  const comma = (line.match(/,/g) || []).length;
  return tab >= comma && tab > 0 ? '\t' : ',';
}

/** 支援引號包裹的單行切分 */
function splitLine(line, sep) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// 韓文（諺文）字元範圍。用來提示「這欄看起來不像韓文」——
// 認不出表頭時會退回按欄位順序解析，若第一欄其實不是韓文就會導入垃圾。
// 不直接拒絕（可能有外來語寫法），只標記讓人在預覽時看到。
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF]/;

function guessType(raw, ko) {
  const t = TYPE_MAP[String(raw || '').trim().toLowerCase()];
  if (t) return t;
  if (/[.?!。？！]/.test(ko)) return 'sentence';
  const spaces = (ko.match(/ /g) || []).length;
  if (spaces === 0) return 'word';
  return spaces <= 2 ? 'phrase' : 'sentence';
}

/**
 * @returns {{rows: object[], headers: object, sep: string, skipped: number, error: string|null}}
 */
export function parseTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], headers: {}, sep: ',', skipped: 0, error: '沒有內容' };

  const sep = sniff(text);
  const first = splitLine(lines[0], sep);
  const mapped = first.map((c) => CANON[c.toLowerCase()]);
  const hasHeader = mapped.filter(Boolean).length >= 2;

  let cols, body;
  if (hasHeader) {
    cols = mapped;
    body = lines.slice(1);
  } else {
    // 沒表頭 → 按最常見的兩欄／三欄慣例：韓文, 中文[, 羅馬音]
    cols = ['ko', 'zh', 'romanization', 'item_type', 'pos', 'example_ko', 'example_zh', 'note', 'tags']
      .slice(0, Math.max(2, first.length));
    body = lines;
  }

  if (!cols.includes('ko') || !cols.includes('zh')) {
    return { rows: [], headers: {}, sep, skipped: 0,
             error: '認不出韓文與中文欄位。請確保有表頭（ko／zh 或 韓文／中文），或直接用「韓文,中文」兩欄格式。' };
  }

  const rows = [];
  let skipped = 0;
  for (const line of body) {
    const cells = splitLine(line, sep);
    const r = {};
    cols.forEach((c, i) => { if (c) r[c] = (cells[i] || '').trim(); });
    if (!r.ko || !r.zh) { skipped++; continue; }
    r.item_type = guessType(r.item_type, r.ko);
    r.tags = String(r.tags || '').split(/[,，;；]/).map((t) => t.trim()).filter(Boolean);
    r.warn = HANGUL.test(r.ko) ? null : '韓文欄裡沒有諺文字元';
    rows.push(r);
  }

  const headers = {};
  cols.forEach((c, i) => { if (c) headers[first[i] ?? `第${i + 1}欄`] = c; });
  return { rows, headers: hasHeader ? headers : { '（無表頭，按欄位順序）': cols.join(' / ') },
           sep, skipped, error: null };
}
