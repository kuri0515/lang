# Haerin's Schedule 錄音對照

`manifest.csv`：音檔 ↔ 句子（`ko`）的對照，以及該句在原始錄音裡的起訖秒數。

- 來源：B 站 `BV1sqkoBkE3c`（上傳者 kittyrin515）的音軌，約 194 秒。
- **音檔本身不進版控**（別人的著作）：本機留在 `korean/raw/haerin-audio/`（已 gitignore），
  線上放在 Supabase 私密桶 `haerin-audio`，只有登入的使用者拿得到有時效的簽名網址。
- 切分：Whisper `large-v3-turbo` 對齊 → 能量曲線收緊 → 逐句重新識別挑較準的切法。
  第 43、48、54、56 句機器識別有出入，需要人耳確認。
- 重切後重新上傳：改 manifest 的 start/end 重切 mp3，再跑
  `python3 shared/scripts/attach_audio.py korean/raw/haerin-audio korean/data/haerin-audio/manifest.csv --deck haerin-schedule --bucket haerin-audio --apply`
