#!/usr/bin/env python3
# =====================================================================
# 只重算句型標註，其餘一個位元都不動
#
# 【為什麼不重跑 extract_subtitles.py】
#   那支要吃原始字幕（.ass），而字幕檔不在版控裡（是別人的著作）。
#   但重算句型並不需要字幕 —— raw/<work>/<ep>.json 裡已經有每一行的 ja。
#
#   而且「只動一個欄位」本身就是更安全的做法：
#   幕號一旦重排，閱讀進度（script_progress 按幕號存）就會指到別的內容。
#   這支腳本從結構上保證那件事不可能發生 ——
#   它逐行比對 i / scene / ja / ruby / zh / tokens，有任何一項對不上就中止。
#
#     python3 japanese/scripts/retag_grammar.py --work spy [--dry-run]
# =====================================================================
import argparse
import importlib.util
import json
from pathlib import Path

from sudachipy import dictionary, tokenizer as sudatok

ROOT = Path(__file__).resolve().parents[2]
EX = ROOT / "japanese" / "scripts" / "extract_subtitles.py"

spec = importlib.util.spec_from_file_location("extract_subtitles", EX)
ex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ex)

KEEP = ("i", "start", "end", "ja", "ruby", "zh", "tokens")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="spy")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tk = dictionary.Dictionary(dict="core").create()
    mode = sudatok.Tokenizer.SplitMode.C

    def parse(ja):
        return [(m.surface(), m.dictionary_form(),
                 m.part_of_speech()[0], m.part_of_speech()[1])
                for m in tk.tokenize(ja, mode)]

    files = sorted((ROOT / "japanese" / "raw" / args.work).glob("S*E*.json"))
    files = [f for f in files if f.name.count(".") == 1]     # 排除 .cards.json 等衍生檔
    if not files:
        raise SystemExit("找不到 raw 檔")

    tot_before = tot_after = tot_lines = 0
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        before = sum(1 for l in d["lines"] if l.get("grammar"))
        new_lines = []
        for l in d["lines"]:
            g = ex.grammar_of(parse(l["ja"]))
            row = dict(l)
            row["grammar"] = g
            # ★ 除了 grammar，其餘欄位必須逐字相同 —— 這支不該碰它們
            for k in KEEP:
                if row.get(k) != l.get(k):
                    raise SystemExit(f"{f.name} 第 {l['i']} 行的 {k} 被動到了，中止")
            new_lines.append(row)
        after = sum(1 for l in new_lines if l["grammar"])
        tot_before += before
        tot_after += after
        tot_lines += len(new_lines)
        print(f"  {f.stem}: {len(new_lines)} 行 · 有句型 {before} → {after}")
        if not args.dry_run:
            d["lines"] = new_lines
            f.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")

    pct = lambda n: f"{n * 100 / tot_lines:.0f}%"
    print(f"\n合計 {tot_lines} 行：{tot_before}（{pct(tot_before)}）→ "
          f"{tot_after}（{pct(tot_after)}）"
          + ("　※ dry-run，沒有寫檔" if args.dry_run else ""))


if __name__ == "__main__":
    main()
