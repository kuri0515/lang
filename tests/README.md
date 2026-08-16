# 測試

三支測試，涵蓋最容易出錯、且錯了會直接污染使用者資料的部分。

| 檔案 | 依賴 | 涵蓋 |
|------|------|------|
| `session.test.mjs` | 無 | 學習會話引擎：撤銷、回看不重複計分、延遲寫入的定案時機 |
| `modes.test.mjs` | 真實詞庫 JSON | 題型註冊表；四選一的干擾項品質與同義詞歧義；詞序重組的素材與標點洩題 |
| `dom.test.mjs` | `jsdom` | 對真實 `index.html` 跑視圖切換、事件匯流排、主題、題型掛載與 teardown |

```bash
node tests/session.test.mjs

# 先從 Supabase 匯出詞庫（items 的 select 結果）到 pool.json
node tests/modes.test.mjs pool.json

npm i -D jsdom
node tests/dom.test.mjs pool.json
```

## 為什麼是這三支

不追求覆蓋率，只測「壞了但不會立刻被發現」的地方：

- **撤銷與延遲寫入** —— `reviews` 是只追加日誌，RLS 沒開 delete。誤點若已落庫就洗不掉，會永久污染正確率。這段的競態必須有測試守著。
- **干擾項品質** —— 同義詞若互為干擾項（감사합니다／고맙습니다 中文都是「謝謝」），使用者選對也會被判錯。這種錯不會拋例外，只會讓人莫名其妙丟分。
- **標點洩題** —— 詞序重組若詞塊帶著句末標點，一眼就知道哪塊是最後一塊，練不到語序。同樣不會報錯，只是悄悄失去訓練價值。
