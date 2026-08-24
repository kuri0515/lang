#!/usr/bin/env python3
# =====================================================================
# 把抽取結果 + 手寫詞義 組成可匯入的詞卡清單
#
# 【為什麼要有這支】
#   這一步原本是逐次手打的臨時指令 —— 流程只存在當時那個對話裡。
#   下一次加一集時，「哪些詞形要排除」「詞義從哪裡讀」全靠記憶，
#   而記錯不會報錯，只會安靜地少建幾張卡或多建幾張垃圾卡。
#
# 【排除規則寫在這裡，不是散在各處】
#   單假名碎片、接頭尾辭：斷詞的結構性殘留，不是詞。
#   drop.json：逐條寫明理由的人工判斷（擬聲詞、誤判、方言同形…）。
#   兩者分開是刻意的 —— 前者是規則，後者是判斷，混在一起就分不清
#   「為什麼這個詞不在卡片裡」。
#
#     python3 japanese/scripts/build_cards.py --ep S1E05
#     python3 japanese/scripts/build_cards.py --all
# =====================================================================
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "spy"
DATA = ROOT / "data" / "spy"

KANA1 = re.compile(r"^[ぁ-ゖァ-ヺ]$")
STRUCTURAL_POS = ("接頭辞", "接尾辞")


def load_glosses():
    """詞義庫：多個檔案合成一份。同一個詞在後面的檔案會覆蓋前面的"""
    g = {}
    for f in sorted(DATA.glob("gloss-*.json")):
        g.update(json.loads(f.read_text(encoding="utf-8")))
    return g


def load_drops():
    p = DATA / "drop.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def excluded(w, drops):
    """回傳排除的理由，沒有就回 None"""
    if KANA1.match(w["lemma"]):
        return "單假名碎片"
    if w["pos"].split("/")[0] in STRUCTURAL_POS:
        return "接頭尾辭"
    if w["lemma"] in drops:
        return "人工排除"
    return None


def build(ep, glosses, drops, quiet=False):
    src = RAW / f"{ep}.json"
    if not src.exists():
        raise SystemExit(f"  ❌ 找不到 {src}（先跑 extract_subtitles.py）")
    d = json.loads(src.read_text(encoding="utf-8"))

    need, dropped = [], {}
    for w in d["words"]:
        why = excluded(w, drops)
        if why:
            dropped[why] = dropped.get(why, 0) + 1
        else:
            need.append(w)

    missing = [w for w in need if w["lemma"] not in glosses]
    cards = [{**w, "zh": glosses[w["lemma"]]} for w in need if w["lemma"] in glosses]
    (RAW / f"{ep}.cards.json").write_text(
        json.dumps(cards, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")

    if not quiet:
        print(f"  {ep}: 詞彙 {len(d['words'])} → 排除 {sum(dropped.values())}"
              f"（{'、'.join(f'{k} {v}' for k, v in dropped.items())}）"
              f" → 建卡 {len(cards)}")
    if missing:
        # ★ 缺詞義不是警告，是待辦。列出來給人補，而不是靜靜少建幾張卡。
        print(f"  ★ 還缺 {len(missing)} 條詞義，補進 {DATA.name}/gloss-*.json："
              f"\n    " + " | ".join(
                  f"{w['lemma']}({w['reading']},{w['pos'].split('/')[0]})" for w in missing))
    return len(cards), len(missing)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ep", help="例如 S1E05")
    ap.add_argument("--all", action="store_true", help="重建 raw/spy 底下全部集數")
    args = ap.parse_args()

    glosses, drops = load_glosses(), load_drops()
    print(f"  詞義庫 {len(glosses)} 條 · 人工排除 {len(drops)} 條")

    eps = ([p.stem for p in sorted(RAW.glob("S*.json"))
            if not p.stem.endswith((".cards", ".new", ".words"))]
           if args.all else [args.ep])
    eps = [e for e in eps if e and "." not in e]
    if not eps:
        raise SystemExit("  用 --ep S1E05 或 --all")

    total, miss = 0, 0
    for ep in eps:
        c, m = build(ep, glosses, drops)
        total += c
        miss += m
    if len(eps) > 1:
        print(f"  合計建卡 {total} 張 · 缺詞義 {miss} 條")


if __name__ == "__main__":
    main()
