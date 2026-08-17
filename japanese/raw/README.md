# raw/ —— 原始素材投放區

把你的詞表、教材、音檔丟進這裡。**本目錄內容不進 git**（見 `.gitignore`）。
匯入腳本從這裡讀，寫進 Supabase；**Supabase 是唯一真理源**。

## 詞表格式（CSV，欄名中英文皆可）

| 欄位          | 必填 | 說明 |
|---------------|------|------|
| `ko`          | ✅   | 韓文（한글）—— 單字 / 詞組 / 句子都放這欄 |
| `zh`          | ✅   | 中文（**繁體**） |
| `type`        |      | `單字` / `詞組` / `句子`；留空則自動判斷 |
| `romanization`|      | 羅馬音 |
| `pos`         |      | 詞性：명사 / 동사 / 형용사 / 부사 … |
| `example_ko`  |      | 韓文例句（`type=句子` 時通常留空） |
| `example_zh`  |      | 例句中譯 |
| `note`        |      | 補充說明（語感、慣用法、敬語提示） |
| `tags`        |      | 主題標籤，逗號分隔（食物,家庭,數字） |
| `deck`        |      | 行內指定詞庫 slug，覆蓋 `--deck` |

**欄位不全沒關係** —— 只有 `ko` + `zh` 也能先跑起來，其餘後續增量補。
範例檔見 `scripts/sample_words.csv`。

## 詞表更新

直接改 CSV 再重跑一次匯入即可，靠 `slug` 冪等 upsert：

```bash
python3 scripts/import_words.py raw/my_list.csv --deck basic-01 --title "..." --apply
```

若 CSV 裡刪掉了某些條目，加 `--deactivate-missing`：
它們會被標成 `is_active=false`（前端不再出現），**但資料與你的答題記錄都保留**。

## 音檔

- 沒有現成音檔：留空 `audio_url`，前端自動用瀏覽器 TTS（`ko-KR`）朗讀。
- 有檔案：放 `raw/audio/<slug>.mp3`，後續由上傳腳本推到 Supabase Storage。
