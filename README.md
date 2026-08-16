# 한국어 · 韓語單字卡

韓文 ↔ 中文（繁體）**雙向**間隔重複學習站。單字 / 詞組 / 句子同站，
記錄每次作答與正確率，靠 SRS 排定回顧節奏。

- 前端：純靜態 HTML + ES Module（零建置，GitHub Pages 直接部署）
- 後端：Supabase（Auth + Postgres + RLS）
- 演算法：SM-2 變體，封裝在 `js/srs.js`，可整檔替換為 FSRS

---

## 架構

```
index.html          單一頁面，四個視圖（登入 / 首頁 / 學習 / 完成）
config.js           Supabase URL + anon key（公開，安全靠 RLS）
css/style.css       設計 token + 元件樣式，自動深淺色
js/
  srs.js            ★ 純函式排程引擎，不碰 DOM 不碰網路
  db.js             ★ 所有 Supabase 呼叫，UI 不直接碰 client
  app.js            視圖切換與事件編排
supabase/migrations/
  0001_init.sql     schema + RLS + 統計 view
scripts/
  import_words.py   CSV → Supabase，零依賴、冪等、預設 dry-run
  sample_words.csv  25 條範例資料
raw/                你的原始素材（不進 git）
```

**三層解耦**：內容層（`decks`/`items`）· 學習狀態層（`user_cards`）· 記錄層（`reviews`）。
換演算法只改 `srs.js`；換詞表只重跑匯入腳本；兩者互不影響。

### 為什麼 `user_cards` 的主鍵含 `direction`

「看韓文想中文」和「看中文想韓文」是兩種不同能力。
認得 `사람 → 人` 不代表看到 `人` 就寫得出 `사람`。
所以每個條目在兩個方向上各有**獨立的到期時間、熟練度、正確率**，絕不互相污染。

---

## 建置步驟

### 1. 建資料表

Supabase Dashboard → SQL Editor → 貼上 `supabase/migrations/0001_init.sql` → Run。

### 2. 設定密鑰

```bash
cp .env.example .env.local   # 填入 service_role key（已被 .gitignore 擋住）
```

> `anon key` 在 `config.js` 裡是**設計上公開**的 —— 靜態站前端必須攜帶它，
> 真正的門禁邊界是資料庫 RLS。`service_role key` 只在本地匯入腳本使用，永不進 git。

### 3. 匯入詞表

```bash
# 先 dry-run 看要寫什麼
python3 scripts/import_words.py scripts/sample_words.csv \
    --deck basic-01 --title "基礎 · 第一單元"

# 確認無誤再寫庫
python3 scripts/import_words.py scripts/sample_words.csv \
    --deck basic-01 --title "基礎 · 第一單元" --apply
```

### 4. 本地預覽

```bash
python3 -m http.server 8000
# 開 http://localhost:8000
```

### 5. 部署

GitHub → Settings → Pages → Source 選 `main` / `root`。推上去即上線。

---

## 操作

| 鍵       | 動作 |
|----------|------|
| `空白鍵` | 顯示答案 |
| `1`–`4`  | 忘了 / 有點難 / 記得 / 很簡單 |
| `S`      | 朗讀韓文 |

評分 ≥ 3（記得 / 很簡單）記為答對，正確率即由此統計。

---

## 待辦

- [ ] 拼寫模式（看中文，鍵盤打出韓文，自動批改）
- [ ] 選擇題模式（四選一，適合零基礎起步）
- [ ] 音檔上傳到 Supabase Storage，取代 TTS
- [ ] 學習曲線圖表（資料已在 `v_daily_stats`）
- [ ] 每日新卡上限（欄位已在 `profiles`，UI 未接）
