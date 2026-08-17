# 詞彙表 · 累積（deck: vocab-01）

按韓文字母順序整理的系列詞表，每組包含詞彙批與句子／對話批。

## 流水線

```bash
# ① 貼上內容 → CSV 骨架（機械部分全自動）
pbpaste | python3 scripts/prep_paste.py --out data/vocab/vocab_batch_NN.csv

# ② 人工補判斷欄位：hanja（只填有把握的）、pos、example、tags、語感備註
#    並複查自動產生的羅馬音

# ③ 匯入（必須加 --append）
python3 scripts/import_words.py data/vocab/vocab_batch_NN.csv \
    --deck vocab-01 --title "詞彙表 · 累積" --append --apply

# ④ 稽核
python3 scripts/audit_content.py
```

`prep_paste.py` 自動處理：分隔符與表頭、簡轉繁（字元級台灣變體）、
類型判定、跨行條目合併、對話說話人剝離、括號展開式收攏、批內查重、
羅馬音初稿（含連音與激音化，對既有 236 條的一致率 96%）。

`audit_content.py` 檢查：重複收錄、漢字欄位格式、句子誤標漢字、
羅馬音格式、type 與內容不符、簡體殘留、標籤漂移、欄位完整度。

匯入（**必須加 `--append`**）：

```bash
python3 scripts/import_words.py data/vocab/vocab_batch_NN.csv \
    --deck vocab-01 --title "詞彙表 · 累積" --append --apply
```

`--append` 讓 slug 由詞條內容產生。不加的話 slug 是「詞庫名+序號」，
每批都從 0001 編起，後一批會直接覆蓋前一批 —— 實際踩過，46 條只剩 10 條。

## 加工原則

- **簡體轉繁體**，與全站一致
- **對話的 `A：`／`B：` 不進卡片正面**，改放 note；抽到卡片時只顯示句子本身
- **網路縮語**的完整展開放 note，並標明語域（正式場合能不能用）
- **漢字詞只標有把握的**。錯的詞源比沒有更糟，會建立錯誤聯想且難糾正
- **跨詞庫重複自動略過**（匯入腳本會列出並跳過）
- 韓語正字法有疑義時依標準寫法錄入，原稿寫法保留在 note 備查

## 批次

| 批 | 內容 |
|----|------|
| 01 / 02 | 아 系列：詞彙 · 句子與對話（問路） |
| 03 / 04 | 야 系列：詞彙 · 句子與對話（約看球） |
| 05 / 06 | 어 系列：詞彙 · 句子與對話（買父母節禮物） |
| 07 / 08 | 여 系列：詞彙 · 句子與對話（聊天氣） |
| 09 / 10 | 오 系列：詞彙 · 句子與對話（約吃飯） |
| 11 / 12 | 요 系列：詞彙 · 句子與對話（下班道別） |
