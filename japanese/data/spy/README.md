# SPY×FAMILY 精讀的手寫資料

這裡放的是**我們自己寫的**東西，所以進版控：

- `gloss-*.json` — 詞形 → 繁中詞義。一個詞只寫一次，全劇 75 集共用。
- `drop.json` — 被排除的詞形與**理由**。斷詞碎片、誤判、擬聲詞等。
  記理由是為了日後能重新判斷，而不是留下一份「不知道為什麼被丟掉」的清單。

## 為什麼不放在 `raw/`

`raw/` 是 gitignore 的，那裡放原始字幕與抽取出來的完整台詞 ——
那些是別人的著作，不該進版控。

而詞義是辭典層級的事實資料，由我們逐條寫成，跟字幕無關。
放在 `raw/` 底下的後果是：**幾千條手寫的詞義只存在一台機器上**。
實際發生過 —— 第 4 集提交時才發現前四集的 2013 條詞義全部沒有版控。

## 加一集的流程

```bash
# 1. 抽取（產物在 raw/，不進版控）
python3 japanese/scripts/extract_subtitles.py <字幕.ass> --work spy --ep S1E05

# 2. 看還缺哪些詞義，補進 gloss-*.json（或把碎片寫進 drop.json）
python3 japanese/scripts/build_cards.py --ep S1E05

# 3. 匯入。順序不能反：先詞卡，再台詞
#    （台詞匯入時會抽查詞庫命中率，順序顛倒會被擋下）
python3 japanese/scripts/import_script_words.py japanese/raw/spy/S1E05.cards.json \
  --deck-slug spy-s1 --deck-title 'SPY×FAMILY 第一季' --ep S1E05
python3 japanese/scripts/import_script.py japanese/raw/spy/S1E05.json \
  --work-title 'SPY×FAMILY' --deck-slug spy-s1
```
