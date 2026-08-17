# 日文站詞表

版控的詞表放這裡，用 `shared/scripts/import_words.py` 匯進 Supabase。

```bash
# ★ 一定要帶 --site japanese，否則會寫進韓文站的資料庫
python3 shared/scripts/import_words.py --site japanese japanese/data/starter.csv \
    --deck daily-01 --title "日常用語 · 入門"                    # dry-run

python3 shared/scripts/import_words.py --site japanese japanese/data/starter.csv \
    --deck daily-01 --title "日常用語 · 入門" --apply             # 真的寫
```

腳本每次都會把要連的 Supabase 專案 ref 印在第一行 —— **請每次都看一眼**。
兩站的 project ref 不同，看到不對的就是站台帶錯了，Ctrl-C 還來得及。

## 欄位

| 欄位 | 說明 | 例 |
|---|---|---|
| `ja` / `日文` | 詞條本身，可含漢字 | `時間` |
| `zh` / `中文` | 繁體中文意思 | `時間` |
| `假名` / `よみ` | 讀音假名。**漢字詞一定要填** | `じかん` |
| `漢字表記` | 詞條本身已是漢字時留空 | |
| `type` | word／phrase／sentence，留空會自動猜 | `word` |
| `pos` | 詞性（句子不填） | `名詞` |
| `例文` | 日文例句 | `時間がありません。` |
| `例句中文` | 例句翻譯 | `沒有時間。` |
| `note` | 辨析／文化背景／易混淆 | |
| `tags` | 逗號分隔 | `基礎,時間` |

欄名的別名清單在 `japanese/lang.config.js` 的 `columnAliases`，
與網頁貼上匯入共用同一份 —— 改一邊記得改另一邊。

## 假名欄為什麼是必填

韓文站的「羅馬音」是輔助，少了不影響學習。
日文站的假名不是 —— 純漢字詞條沒有假名讀音，朗讀會唸錯，
而且「一個詞幾拍」算不出來，短詞自動放慢就會失效。

漢字是台灣學習者最大的優勢，也是最大的陷阱：
看得懂 `大丈夫` 的意思不等於唸得出 `だいじょうぶ`。
假名欄留空，等於把這個陷阱原封不動留給學習者。

## 標籤

發音類標籤必須是 `japanese/taxonomy.js` 的 `PRON_ORDER` 裡有的那些
（清音・濁音・長音・促音・撥音・高低重音…）。

日語的發音標籤沒有共同前綴（不像韓語全部叫「收音*」），
所以**沒列進 PRON_ORDER 的發音標籤會被歸到主題組**，不會自動歸位。
新增一類發音時，記得同時加進 `PRON_ORDER` 並補一篇導言 ——
`npm run test:lang` 會擋住漏補導言的情況。
