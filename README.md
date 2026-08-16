# 한국어 · 韓語單字卡

韓文 ↔ 中文（繁體）**雙向**間隔重複學習站。單字 / 詞組 / 句子同站，
記錄每次作答與正確率，靠 SRS 排定回顧節奏。

- 前端：純靜態 HTML + ES Module（零建置，GitHub Pages 直接部署）
- 後端：Supabase（Auth + Postgres + RLS）
- 演算法：SM-2 變體，封裝在 `js/srs.js`，可整檔替換為 FSRS

---

## 架構

```
index.html          單一頁面，底部 Tab 分四區
config.js           Supabase URL + anon key（公開，安全靠 RLS）
css/style.css       design token + 元件樣式，深淺色三態

js/
  core/             ★ 葉子層：無任何向上依賴，可獨立測試
    dom.js            $ / esc / 骨架屏 / 訊息條 等共用工具
    bus.js            事件匯流排 —— 跨模組通知，取代互相直呼
    srs.js            SM-2 排程演算法（純函式）
    speech.js         韓語朗讀（語音優選 + 語速）
    parse-table.js    CSV/TSV 解析（與 import_words.py 共用欄位別名）
    auth-map.js       帳號名 ↔ email 映射
  data/             ★ 資料層：不碰 DOM
    client.js         supabase client + 欄位清單等共用常量
    auth.js           登入註冊、profile
    content.js        decks / items 讀取、搜尋、漢字詞
    progress.js       user_cards / reviews、統計、歷史
    admin.js          管理員寫入（RLS 把關）
  study/
    session.js        ★ 會話引擎：佇列、評分、撤銷、導覽、延遲寫入
                        完全不碰 DOM，故可純 node 測試
    modes/            ★ 題型註冊表 —— 可插拔的殼
      flip.js choice.js scramble.js listen.js index.js
  views/            畫面：只負責畫與轉發操作
    router.js theme.js voice.js auth.js home.js
    study.js browse.js history.js editor.js importer.js
  app.js            ★ 只做啟動與裝配，不含業務邏輯

supabase/migrations/  0001 schema+RLS · 0002 防提權 · 0003 帳號名登入
                      0004 記錄來源 · 0005 漢字詞
scripts/              匯入、建帳號、漢字標註（零依賴、預設 dry-run）
data/                 版控的詞表
tests/                見 tests/README.md
```

### 依賴方向

```
core  ←  data  ←  study  ←  views  ←  app
```

只往一個方向走，有自動檢查（見下方「架構約束」）。

### 三個關鍵解耦

**內容 / 學習狀態 / 記錄** 三層分離：`items` 是內容真理源，`user_cards` 是排程，
`reviews` 是只追加日誌。換 SRS 演算法只改 `core/srs.js`，換詞表只重跑匯入腳本。

**題型是可插拔的殼**：每種題型宣告自己的 id、方向約束、適用條件、掛載邏輯，
註冊進 `modes/index.js` 就能用。加題型 = 新增一個檔案 + 加一行，
不動 `render()`、不動鍵盤處理、不動方向鎖定、不動佇列過濾。

**事件匯流排取代互相直呼**：編輯器存檔後只廣播 `ITEM_UPDATED`，
誰關心誰自己訂閱。它不需要知道站上有哪些畫面會顯示條目，
新畫面也不必回頭去改編輯器。

### 為什麼 `user_cards` 的主鍵含 `direction`

「看韓文想中文」和「看中文想韓文」是兩種不同能力。
認得 `사람 → 人` 不代表看到 `人` 就寫得出 `사람`。
所以每個條目在兩個方向上各有**獨立的到期時間、熟練度、正確率**，絕不互相污染。

### 架構約束

```bash
# 檢查依賴方向、core 無向上依賴、data 與 session 不碰 DOM
node tests/session.test.mjs && node tests/modes.test.mjs pool.json
```

---

## 建置步驟

### 1. 建資料表

```bash
brew install libpq                    # 提供 psql
scripts/migrate.sh status             # 看已套用／待套用
scripts/migrate.sh check              # 只驗語法（交易中跑完即 rollback）
scripts/migrate.sh up                 # 套用待套用的
```

migration 與登記在同一個交易裡，要嘛都成功要嘛都回滾，不會出現
「跑了但沒登記」或「登記了但沒跑」的半套狀態。

<details><summary>手動方式（沒有資料庫密碼時）</summary>

Supabase Dashboard → SQL Editor → 依序貼上 `supabase/migrations/*.sql` → Run。
</details>

### 2. 設定密鑰

```bash
cp .env.example .env.local   # 填入 service_role key（已被 .gitignore 擋住）
```

> `anon key` 在 `config.js` 裡是**設計上公開**的 —— 靜態站前端必須攜帶它，
> 真正的門禁邊界是資料庫 RLS。`service_role key` 只在本地匯入腳本使用，永不進 git。

### 3. 匯入詞表

```bash
# 先 dry-run 看要寫什麼
python3 scripts/import_words.py data/daily_korean.csv \
    --deck daily-01 --title "日常用語 · 入門"

# 確認無誤再寫庫
python3 scripts/import_words.py data/daily_korean.csv \
    --deck daily-01 --title "日常用語 · 入門" --apply
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

## 備份

Supabase 免費方案沒有自動備份。詞庫與全部學習記錄只有雲端一份，
誤刪、誤改、專案被停用，任何一種都會全沒。

```bash
npm run backup          # 抓到 backups/YYYY-MM-DD-HHMM/，抓完自動驗一次
```

備份目錄在 `.gitignore` 裡 —— 裡面含個人學習記錄，不該推上公開倉庫。

存兩種格式，用途不同：

| 檔案 | 內容 | 用途 |
|------|------|------|
| `*.json` | 全部七張表的原始列 | 完整存檔，含使用者資料 |
| `csv/<deck>.csv` | 詞條內容 | **可直接餵回 `import_words.py`** |

CSV 這份才是真正能用的還原路徑 —— 存檔如果沒有回得去的路，等於沒存。

```bash
python3 scripts/backup.py --verify backups/<目錄>        # 事後再驗一次
python3 scripts/backup.py --restore-plan backups/<目錄>  # 列出還原步驟
```

還原刻意不做成一鍵指令：覆蓋線上資料不可逆，必須人看過再決定。
`--restore-plan` 會印出該做什麼，包含 `reviews` 還原後要重設 identity 序列這類容易漏掉的細節。

建議在每次大批匯入或改結構之前先跑一次。

---

## 待辦

- [ ] 拼寫模式（看中文，鍵盤打出韓文，自動批改）
- [ ] 音檔上傳到 Supabase Storage，取代 TTS（`audio_url` 目前全空）
- [ ] 學習曲線圖表（資料已在 `v_daily_stats`）
- [ ] 每日新卡上限（欄位已在 `profiles`，UI 未接）
- [ ] 開放註冊前必須換掉管理員弱密碼

已完成：選擇題、詞序重組、聽力、自由練習、學習記錄、批次匯入、快速編輯、備份。
