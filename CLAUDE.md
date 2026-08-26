# kuri0515 / lang —— 接手協定

> 這個倉庫**不屬於** 25Maths 那六個專案，慣例不同：
> 沒有 `DEVELOPMENT-PLAN.md`、沒有 build 步驟、版本號由 `build-sites.mjs` 產生。
> 別套那邊的交接 checklist，照這一份走。

## 動手之前一定要讀的兩份

1. **`docs/HANDOFF.md`** —— 現況、這一輪改了什麼、刻意沒做什麼
2. **`docs/LESSONS.md`** —— L-001…L-013，真的發生過的錯與它們留下的規矩。
   **改邏輯前讀完**，裡面每一條都對應一支「守門的測試」。

## 這是什麼

給一位特定學習者做的單字卡網站，靜態前端（GitHub Pages）+ Supabase，零建置。
一個倉庫兩個站：

```
shared/     程式碼只有一份。★ 沒有一行認識「韓文」或「日文」
korean/     韓 vmztwoqguwljuxfdfzhl · 1289 條
japanese/   日 ihkrmcbhzmzlczedswyv · 7049 條 ＋ 精讀 25 集 9949 行
```

## 常用指令

```bash
npm test                                   # 23 組，兩站一起驗。動 shared/js 之前先跑
npm run build:sites                        # 改過 index.template.html 之後必跑
python3 -m http.server 8000                # 本機預覽，★ 必須從倉庫根起服務

python3 shared/scripts/audit_content.py            # 韓文站
SITE=japanese python3 shared/scripts/audit_content.py
SITE=japanese python3 japanese/scripts/audit_script.py --deck-slug spy-s1   # 精讀
SITE=japanese bash shared/scripts/migrate.sh status
```

## 五條會咬人的

1. **`<site>/index.html` 是產生物** —— 手改會被 `npm test` 擋下。改 `shared/index.template.html`。
2. **腳本預設連韓文站**。動日文站一律 `SITE=japanese`。每支腳本都會印出目標
   project ref —— **每次都看一眼**：它們拿 service_role key，RLS 對它無效，
   站台認錯就寫進另一站的線上資料。
3. **動資料前先備份**：`python3 shared/scripts/backup.py --selftest` 再 `backup.py`。
   （selftest 是必要的：`user_cards` 沒有 id 欄，備份曾經靜靜壞掉。）
4. **加測試就要種壞樣本**證明它會紅。沒有輸出不等於通過。
5. **替身要比正式程式更嚴**，不能更鬆（L-012，一週撞了三次）。

## 現在在做什麼

SPY×FAMILY 第一季已收官。下一步是**第二季**，流程見 `japanese/data/spy/README.md`
（**先詞卡、再台詞，順序不能反**）。

刻意擱著的：`shared/vendor/supabase.js` 216 KB，可只打包用到的模組，
但要重做 esbuild 設定並重驗登入流程 —— 使用者 2026-08-25 決定先不動。
