# 單字卡 · 韓語 / 日語

> **接手先讀 [`docs/HANDOFF.md`](docs/HANDOFF.md)** —— 現況、下一步、做事的標準、新增條目的流程都在那裡。

目標語言 ↔ 中文（繁體）**雙向**間隔重複學習站。單字 / 詞組 / 句子同站，
記錄每次作答與正確率，靠 SRS 排定回顧節奏。

| 站台 | 狀態 | 線上 |
|---|---|---|
| `korean/` | 上線中，1289 條 | `kuri0515.github.io/lang/korean/` |
| `japanese/` | 上線中，826 條（五十音入門書已完整收錄） | `kuri0515.github.io/lang/japanese/` |

- 前端：純靜態 HTML + ES Module（零建置，GitHub Pages 直接部署）
- 後端：Supabase（Auth + Postgres + RLS），**每站一個獨立專案**
- 演算法：**費氏階梯**（1,2,3,5,8,13,21,34,55,89 天），封裝在 `shared/js/core/srs.js`

---

## 架構

```
index.html            岔路口：選語言。不吃 shared/css，它只是兩張卡片

shared/               ★ 程式碼只有一份，兩站共用
  js/
    core/               葉子層：無任何向上依賴，可獨立測試
      lang.js             ★ 語言設定登記處 —— 整個 monorepo 的樞紐
      dom.js              $ / esc / 骨架屏 / 訊息條 等共用工具
      bus.js              事件匯流排 —— 跨模組通知，取代互相直呼
      srs.js              費氏階梯排程（純函式）；評分決定爬幾階，不乘係數
      ruby.js             振り仮名：漢字[かな] → <ruby>，假名標在字的正上方
      speech.js           朗讀（語音優選 + 語速），語言相關的部分走 lang()
      parse-table.js      CSV/TSV 解析（與 import_words.py 共用欄位別名）
      taxonomy.js         分組／排序／下一課的**演算法**（不含任何課程內容）
      auth-map.js         帳號名 ↔ email 映射
    data/               資料層：不碰 DOM
      client.js           supabase client + 欄位清單等共用常量
      auth.js content.js progress.js admin.js
    study/
      session.js          ★ 會話引擎：佇列、評分、撤銷、導覽、延遲寫入
      modes/              ★ 題型註冊表 —— 可插拔的殼
    views/              畫面：只負責畫與轉發操作
    app.js              ★ 只做啟動與裝配，不含業務邏輯
  index.template.html ★ 兩站 index.html 的唯一真理源（95% 相同，差的只有語言字）
  css/style.css       design token + 元件樣式，深淺色三態
  scripts/            匯入、建帳號、備份、稽核（零依賴、預設 dry-run）
    site_ctx.py         ★ 站台解析 + 密鑰載入，所有腳本的共同入口
  supabase/migrations/  schema + RLS。SQL 一份，兩站各自套用到自己的專案

korean/  japanese/    ★ 站台：只有「這個語言是什麼」，沒有程式邏輯
  index.html            ⚠️ 由 shared/index.template.html 產生，別手改
                        （npm test 會比對；要改請改樣板再 npm run build:sites）
  main.js               進入點：先 setLang，才動態載入 shared/js/app.js
  lang.config.js        ★ 這個語言的一切：稱呼、TTS、正則、欄位別名、Supabase
  taxonomy.js           ★ 這個語言的課程內容：發音序列、導言、生活場景
  config.js             Supabase URL + anon key（公開，安全靠 RLS）
  data/                 版控的詞表
  manifest.json icon.svg icon-maskable.svg

tests/                見 tests/README.md
```

### 依賴方向

```
core  ←  data  ←  study  ←  views  ←  app          （層與層之間）
shared/  ←  korean/ · japanese/                     （站台注入設定，反過來不行）
```

只往一個方向走，有自動檢查（見下方「架構約束」）。

### 四個關鍵解耦

**內容 / 學習狀態 / 記錄** 三層分離：`items` 是內容真理源，`user_cards` 是排程，
`reviews` 是只追加日誌。換 SRS 演算法只改 `core/srs.js`，換詞表只重跑匯入腳本。

**題型是可插拔的殼**：每種題型宣告自己的 id、方向約束、適用條件、掛載邏輯，
註冊進 `modes/index.js` 就能用。加題型 = 新增一個檔案 + 加一行。

**事件匯流排取代互相直呼**：編輯器存檔後只廣播 `ITEM_UPDATED`，誰關心誰自己訂閱。

**語言是注入的，不是寫死的**：`shared/js` 底下沒有一行程式碼認識「韓文」或「日文」。
要語言相關的東西一律向 `lang()` 要，由站台在 `main.js` 裡交進去。
方向是 站台 → shared，所以 shared 永遠不需要因為多一個語言而改動。

### 為什麼 `taxonomy` 要拆成兩半

拆 monorepo 時才看清楚，原本那個檔混了兩種東西：

- **演算法**：怎麼分組、怎麼排序、怎麼算下一課、掌握門檻多少 —— 兩個語言完全一樣
- **課程內容**：有哪些課、每課導言、生活場景有哪些 —— 兩個語言完全不一樣

所以演算法留 `shared/js/core/taxonomy.js`，內容搬到 `<site>/taxonomy.js`。
換一份 `taxonomy.js`，同一套引擎就變成另一個語言的課程。

### 為什麼欄位名還叫 `ko` / `example_ko`

兩站共用同一套 schema，欄位語意是「**目標語言**」而不是「韓文」。
日文站的 `ko` 存日文、`romanization` 存假名、`hanja` 存漢字表記 ——
對日文其實比韓文更合身。改名要動韓文站的線上資料庫，風險遠大於收益。

### 為什麼 `user_cards` 的主鍵含 `direction`

「看目標語言想中文」和「看中文想目標語言」是兩種不同能力。
認得 `사람 → 人` 不代表看到 `人` 就寫得出 `사람`。
所以每個條目在兩個方向上各有**獨立的到期時間、熟練度、正確率**，絕不互相污染。

---

## 幾個關鍵設計（改之前先讀）

### 複習間隔：費氏階梯，不是乘係數

```
1 → 2 → 3 → 5 → 8 → 13 → 21 → 34 → 55 → 89 天（封頂）
很簡單 +2 階｜記得 +1 階｜有點難 原地｜忘了 回學習階段當天再練
```

乘係數（`interval × ease`）會複利：ease 稍微高一點，幾次之後就跑到幾百天甚至
幾年。實測過連按五次「很簡單」排到 3275 天後 —— 那等於這張卡永遠消失，
而「九年後還記不記得」本來就不是這套系統該預測的事。

停在 89（≈三個月）是刻意的：再往外推就變成幾乎不再出現，
和刪掉它沒有差別，卻讓人以為自己還記得。

**「有點難」原地而不退階** —— 退階會讓一張詞在 3→2→3→2 之間來回，永遠畢不了業。

`ease_factor` 不再參與排程，仍記錄下來當難度訊號（`reviews.prev_ease_factor`
是歷史資料，日後換 FSRS 之類的演算法用得上）。

### 新卡在本輪內循環到會為止

學習步驟（1 分鐘、10 分鐘）在同一輪內跑完 —— 還在學習階段的卡會排回隊尾，
直到畢業。8 條的一課，一次坐下來能走到「今天都會了」。

先前只有「忘了」會重排，於是按「記得」的新卡當輪就消失，得跨兩次工作階段
才畢業，「今天學到會為止」根本做不到。

### 回顧清單：只縮不放

自己標記想多練的詞（卡片右上角 ☆）。答得好**完全不動排程**、「有點難」
把到期日拉近一半、「忘了」照正規遺忘處理，而且**算出來比原訂還晚就不動**。

臨時多背幾遍就把複習日推遠，會往「看起來更熟、實際更容易忘」的方向壞。
標記一個形近字時，同組的其他字會一起加入並註明理由 ——
使用者標 ぬ 想的是「這個字我不熟」，真正的問題是「ぬ 和 め 分不出來」。

### 形近字辨別

`<site>/taxonomy.js` 的 `confusable` 宣告形近組與「怎麼分」的那一句。
它有兩個用途，都是為了練到真正會錯的地方：

- **四選一的干擾項優先取同組成員**。否則所有假名都共享「清音／平假名」標籤，
  干擾項是隨機的，看到 ぬ 時選項可能是 ぬ/か/せ/ほ —— 不必分辨就答對。
- **佇列編排讓同組相鄰出現**（`orderForDiscrimination`）。打散到頭尾等於各自
  單獨練，而各自單獨練本來就都會。組內照宣告順序（教學順序），組間隨機。

答錯時才顯示「怎麼分」，並把停留時間拉長 —— 答對還講一遍是噪音，
提前給等於送分，答錯那一刻是唯一真正記得住的時機。

### 課程清單是動態的，順序才是靜態的

`pronOrder` 是**完整的教學序列**（平假名 46 + 片假名 46 + 規則課 11），
不是「目前有內容的清單」。畫面只顯示有內容的（`total > 0`），
所以片假名的位置先留著，資料一進雲端就自動亮起來，**不必動一行程式碼**。

清音課的導言就是那張假名卡的口訣，存在 `items.note`；
程式碼裡不再抄第二份（`introFromData` 宣告哪些課走這條路）。
先前把清單編在程式碼裡，結果內容已 46 課、畫面停在 38。

### 振り仮名

`hanja` 欄在日文站存「`ko` 的注音版本」：`駅[えき]は どこですか。`
純文字、好編輯、好 diff，不必另立欄位或存 HTML。
韓文站的 `hanja` 仍是漢字詞源，兩站用 `rubyFromHanja` 明確宣告用途。

**讀音是人寫的，不是自動產生的**：同一個漢字在不同詞裡讀法不同
（何：なん／なに、上手：じょうず）。自動標註錯了不會報錯，
只會讓學習者背下一個錯的音 —— 比沒有標註更糟。

### 架構約束

```bash
npm test        # 兩站一起驗：設定完備性、模組真的載得起來、依賴方向、DOM 契約
```

| 測試 | 驗什麼 |
|---|---|
| `test:sites` | 兩站的 `index.html` 與樣板一致（產生物被手改會紅） |
| `test:lang` | 兩站設定欄位交叉比對；正則**拿真的詞去試**，不是相信它長得對 |
| `test:boot` | 兩站的模組圖真的載得起來，且字串沒有混到另一站的語言 |
| `test:arch` (+`:ja`) | 依賴方向、DOM 契約、XSS、密鑰、**語言中立**、**站台用字**、**欄位標籤一致**、**匯入完備** |
| `test:session` | 撤銷、延遲寫入、費氏階梯、今日畢業、只縮不放、辨別編排 |
| `test:modes` (+`:ja`) | 干擾項品質、同義詞歧義、**形近組互為干擾項** |
| `test:dom` (+`:ja`) | 端到端 DOM、多行 note、振り仮名、五十音表、語法說明 |

底下這幾道是這個專案吃過虧才加的，動它們之前先讀程式碼裡的理由：

- **語言中立** —— 共用碼不得寫死任何語言的說法。曾經 `dialogue.js` 寫死
  「看韓文想中文」，把日文站 HTML 裡正確的字蓋掉：HTML 改對了、畫面還是錯的。
- **站台用字** —— 按**字元範圍**檢查（不是列舉字詞）。列舉式的判準漏掉了
  `명사 / 동사` 這個 placeholder，是使用者截圖才發現的。
- **欄位標籤一致** —— 畫面標籤必須與 `lang.config` 相符。曾經 romanization 欄
  標成「假名」但存的是羅馬音，使用者會照著標籤填錯東西。
- **匯入完備** —— 用到卻沒有匯入的識別字。依賴檢查看不到「根本沒寫的那一行 import」。

---

## 新增一個語言站

`shared/` 一行都不用改。

1. `mkdir <lang>`，複製 `main.js` `manifest.json` `icon*.svg`
   （**不要複製 `index.html`** —— 它由樣板產生，見第 6 步）
2. 寫 `<lang>/taxonomy.js` —— 發音序列、每課導言、生活場景
3. 寫 `<lang>/lang.config.js` —— 照現有兩份的欄位填齊（目前 25 個，
   `npm run test:lang` 會逐一比對，少一個就紅）
4. 在 Supabase 開**新專案**，填 `<lang>/config.js` 與 `<lang>/.env.local`
5. `SITE=<lang> shared/scripts/migrate.sh up`
6. 把 `<lang>` 加進 `shared/scripts/build-sites.mjs` 的 `SITES` 與
   `tests/lang.test.mjs` 的 `SITES`／`SAMPLES`，跑 `npm run build:sites && npm test`

第 6 步不是形式：`lang.test.mjs` 會逼你把每一課的導言補齊、
把正則拿真的詞驗過，漏一項就紅。

---

## 建置步驟

> **所有腳本都吃 `--site` 或 `SITE=`，預設 `korean`。**
> 每支腳本執行時都會把要連的 Supabase project ref 印在第一行 ——
> **請每次都看一眼**。這些腳本拿的是 service_role key，RLS 對它無效，
> 站台認錯就是把資料寫進另一站的線上資料庫。

### 1. 建資料表

```bash
brew install libpq                                  # 提供 psql
shared/scripts/migrate.sh status                    # korean
SITE=japanese shared/scripts/migrate.sh status      # japanese
SITE=japanese shared/scripts/migrate.sh check       # 只驗語法（交易中跑完即 rollback）
SITE=japanese shared/scripts/migrate.sh up          # 套用待套用的
```

migration 與登記在同一個交易裡，要嘛都成功要嘛都回滾，不會出現
「跑了但沒登記」或「登記了但沒跑」的半套狀態。

<details><summary>手動方式（沒有資料庫密碼時）</summary>

Supabase Dashboard → SQL Editor → 依序貼上 `shared/supabase/migrations/*.sql` → Run。
</details>

### 2. 設定密鑰

```bash
cp korean/.env.example korean/.env.local       # 各站一份，互不共用
cp japanese/.env.example japanese/.env.local
```

> `anon key` 在 `<site>/config.js` 裡是**設計上公開**的 —— 靜態站前端必須攜帶它，
> 真正的門禁邊界是資料庫 RLS。`service_role key` 只在本地匯入腳本使用，永不進 git。

### 3. 匯入詞表

```bash
# 先 dry-run 看要寫什麼
python3 shared/scripts/import_words.py --site japanese japanese/data/starter.csv \
    --deck daily-01 --title "日常用語 · 入門"

# 確認第一行印的 project ref 沒錯，再寫庫
python3 shared/scripts/import_words.py --site japanese japanese/data/starter.csv \
    --deck daily-01 --title "日常用語 · 入門" --apply
```

### 4. 本地預覽

```bash
python3 -m http.server 8000
# http://localhost:8000/           選語言
# http://localhost:8000/korean/    韓文站
# http://localhost:8000/japanese/  日文站
```

★ 必須從**倉庫根**起服務，不能 `cd korean && python3 -m http.server` ——
站台是用 `../shared/` 引用共用碼的，從站台目錄起服務會 404 到整站白屏。

### 5. 部署

GitHub → Settings → Pages → Source 選 `main` / `root`。推上去即上線。

---

## 操作

| 鍵       | 動作 |
|----------|------|
| `空白鍵` | 顯示答案 |
| `1`–`4`  | 忘了 / 有點難 / 記得 / 很簡單 |
| `S`      | 朗讀目標語言 |

評分 ≥ 3（記得 / 很簡單）記為答對，正確率即由此統計。

---

## 備份

Supabase 免費方案沒有自動備份。詞庫與全部學習記錄只有雲端一份，
誤刪、誤改、專案被停用，任何一種都會全沒。

```bash
npm run backup          # korean → backups/YYYY-MM-DD-HHMM/
npm run backup:ja       # japanese
```

備份目錄在 `.gitignore` 裡 —— 裡面含個人學習記錄，不該推上公開倉庫。

存兩種格式，用途不同：

| 檔案 | 內容 | 用途 |
|------|------|------|
| `*.json` | 全部七張表的原始列 | 完整存檔，含使用者資料 |
| `csv/<deck>.csv` | 詞條內容 | **可直接餵回 `import_words.py`** |

CSV 這份才是真正能用的還原路徑 —— 存檔如果沒有回得去的路，等於沒存。

```bash
python3 shared/scripts/backup.py --verify backups/<目錄>
python3 shared/scripts/backup.py --restore-plan backups/<目錄>
```

還原刻意不做成一鍵指令：覆蓋線上資料不可逆，必須人看過再決定。
`--restore-plan` 會印出該做什麼，包含 `reviews` 還原後要重設 identity 序列這類容易漏掉的細節。

建議在每次大批匯入或改結構之前先跑一次。

---

## 待辦

### 日文站 —— 入門書已完整收錄 ✅

- [x] Supabase 專案、migration、管理員帳號
- [x] **97 課、826 條**：平假名 46 + 片假名 46 + 規則課 5（濁音・半濁音・拗音・長音・促音）
- [x] 振り仮名 124 條、形近／易混 13 組、對話語法說明 49 條
- [ ] 生活場景的實際內容（場景定義已寫好，等條目掛標籤）
- [ ] 詞性（pos）目前 0% —— 填了能讓四選一的干擾項更精準

課程序列裡還留著 `撥音`／`高低重音`／`連濁`／`音讀`／`訓讀`／`母音無聲化` 的位置，
但這本入門書沒有教。**位置留著不是忘了刪** —— 資料一進雲端就自動出現，
而在那之前五十音表會顯示成「還沒加入」，不會讓學習者以為自己漏學了。

### 兩站共通

- [ ] 拼寫模式（看中文，鍵盤打出目標語言，自動批改）
- [ ] 詞性（pos）目前 0% —— 填了能讓四選一的干擾項更精準（同詞性加權）
- [ ] 音檔上傳到 Supabase Storage，取代 TTS（`audio_url` 目前全空）
- [ ] 學習曲線圖表（資料已在 `v_daily_stats`）
- [ ] 每日新卡上限（欄位已在 `profiles`，UI 未接）
- [ ] 開放註冊前必須換掉管理員弱密碼

已完成：選擇題、詞序重組、聽力、自由練習、學習記錄、批次匯入、快速編輯、備份、
monorepo 拆分與語言注入層、費氏階梯排程、回顧清單、形近字辨別、
振り仮名、五十音表、index.html 樣板化。
