#!/usr/bin/env python3
"""
補上缺漏的詞性（pos）。

    python3 scripts/fill_pos.py            # dry-run
    python3 scripts/fill_pos.py --apply

【為什麼「缺 313 條」這個數字是錯的】
  313 條沒有 pos，其中 271 條是句子。句子沒有詞性 —— 那不是缺，是不適用。
  真正該補的只有 36 個詞組 + 6 個單字 = 42 條。

【判定原則】
  沿用資料庫既有的 9 個詞性，不自創新類別。
  詞組依「中心詞」的詞性判定（깎아 주세요 的中心是 주다 → 동사）。
  整句型的詞組沒有單一中心詞，維持空白 —— 硬套一個詞性是編造，
  空白在這裡是正確答案，不是待辦事項。

每一條都是逐條人工判定，不是規則批次推導。
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------
# 逐條判定。key = ko，value = pos
# ---------------------------------------------------------------------

ASSIGN = {
    # 인사말 —— 社交固定用語。沿用資料庫既有的 8 條 인사말 慣例。
    "괜찮아요": "인사말", "잠시만요": "인사말", "어서 오세요": "인사말",
    "처음 뵙겠습니다": "인사말", "만나서 반갑습니다": "인사말",
    "잘 먹겠습니다": "인사말", "잘 먹었습니다": "인사말",
    "실례합니다": "인사말", "잘 부탁드립니다": "인사말",
    "수고하셨습니다": "인사말", "잘 자": "인사말",

    # 수사 —— 時刻。學習點正是固有數詞的短形變化，標 수사 才篩得出來。
    "한 시": "수사", "두 시": "수사", "세 시": "수사", "네 시": "수사",
    "다섯 시": "수사", "열한 시": "수사", "열두 시": "수사",

    # 명사
    "좌절금지": "명사",       # 挫折禁止，漢字詞複合名詞
    "섀도우 박스": "명사",
    "끝이": "명사",          # 中心詞 끝；이 是主格助詞（這條是顎化發音例）
    "어머니의": "명사",       # 名詞 + 屬格助詞
    "친구의": "명사",

    # 대명사 —— 人稱代名詞的屬格形
    "저의": "대명사", "우리의": "대명사",

    # 동사 —— 中心詞是動詞
    "이거 주세요": "동사",     # 주다
    "깎아 주세요": "동사",     # 주다
    "계산해 주세요": "동사",    # 주다
    "심쿵해": "동사",         # 심쿵하다

    # 형용사 —— 中心詞是形容詞
    "너무 비싸요": "형용사",    # 비싸다
    "짜다": "형용사",         # 主要語義「鹹」是形容詞；「擠」的動詞義已寫在 note
    "짱이다": "형용사",
    "핫해 핫해": "형용사",     # 핫하다
}

# 維持空白，並記下理由。這些不是還沒做，是做完後的結論。
LEAVE_BLANK = {
    "얼마예요?":        "疑問句，不是詞。中心是助動詞 이다，標詞性沒有意義",
    "꽃길만 걷자!":      "完整句（勸誘形）",
    "이불 밖은 위험해":   "完整句",
    "나 자신이 죽도록 싫다": "完整句",
    "두말하면 잔소리죠.":  "完整句（俗諺）",
    "맛있으면 0칼로리":   "完整句（條件句）",
    "다이어트는 내일부터":  "完整句（省略謂語）",
    "할많하않":         "整個子句的縮語（할 말은 많지만 하지 않겠다），無單一中心詞",
    "낄끼빠빠":         "整句順口溜的縮語（낄 때 끼고 빠질 때 빠져라），無單一中心詞",
}


def load_env():
    env = {}
    with open(os.path.join(ROOT, ".env.local"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


def req(url, key, method, path, body=None):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    r = urllib.request.Request(
        f"{url}/rest/v1/{urllib.parse.quote(path, safe='?&=,.()*')}",
        data=data, method=method)
    for h, v in [("apikey", key), ("Authorization", f"Bearer {key}"),
                 ("Content-Type", "application/json"),
                 ("Prefer", "return=representation")]:
        r.add_header(h, v)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode() or "[]")


def fetch_items(url, key):
    rows = []
    while True:
        page = req(url, key, "GET",
                   "items?select=id,ko,zh,pos,item_type&is_active=eq.true"
                   f"&offset={len(rows)}&limit=1000")
        rows += page
        if len(page) < 1000:
            return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    url, key = load_env()
    items = fetch_items(url, key)
    by_ko = {}
    for r in items:
        by_ko.setdefault(r["ko"], []).append(r)

    missing = [r for r in items if not r.get("pos") and r["item_type"] != "sentence"]
    print(f"全庫 {len(items)} 條")
    print(f"缺 pos 共 {sum(1 for r in items if not r.get('pos'))} 條，"
          f"其中 {sum(1 for r in items if not r.get('pos') and r['item_type']=='sentence')}"
          f" 條是句子（不適用，不算缺）")
    print(f"實際待補：{len(missing)} 條\n")

    # 對帳：判定表必須剛好蓋滿待補清單，不多不少。
    # 少了＝有詞條漏判；多了＝判定表寫了庫裡沒有的詞（可能是打錯字）。
    todo = {r["ko"] for r in missing}
    covered = set(ASSIGN) | set(LEAVE_BLANK)
    if todo - covered:
        sys.exit(f"❌ 有 {len(todo-covered)} 條未判定：{sorted(todo-covered)}")
    if covered - todo:
        sys.exit(f"❌ 判定表有 {len(covered-todo)} 條不在待補清單（打錯字？）："
                 f"{sorted(covered-todo)}")
    print("✅ 判定表與待補清單完全對上\n")

    plan = []
    for r in missing:
        pos = ASSIGN.get(r["ko"])
        if pos:
            plan.append((r, pos))

    groups = {}
    for r, pos in plan:
        groups.setdefault(pos, []).append(r)
    for pos in sorted(groups, key=lambda p: -len(groups[p])):
        rows = groups[pos]
        print(f"  {pos}（{len(rows)}）")
        for r in rows:
            print(f"      {r['ko']:18s} {r['zh'][:20]}")

    print(f"\n  維持空白（{len(LEAVE_BLANK)}）—— 空白在這裡是結論，不是待辦")
    for ko, why in LEAVE_BLANK.items():
        print(f"      {ko:18s} {why}")

    if not args.apply:
        print(f"\n🔎 dry-run：什麼都沒寫。將寫入 {len(plan)} 條，加 --apply 生效。")
        return

    print(f"\n寫入 {len(plan)} 條…")
    for r, pos in plan:
        req(url, key, "PATCH", f"items?id=eq.{r['id']}", {"pos": pos})

    # 回讀驗證 —— 不驗就不算做完
    after = {x["id"]: x for x in fetch_items(url, key)}
    bad = [(r["ko"], pos, after[r["id"]].get("pos")) for r, pos in plan
           if after[r["id"]].get("pos") != pos]
    if bad:
        print(f"❌ {len(bad)} 條回讀不符：")
        for ko, want, got in bad:
            print(f"      {ko}  期望 {want} 實得 {got}")
        sys.exit(1)
    still = sum(1 for x in after.values()
                if not x.get("pos") and x["item_type"] != "sentence")
    print(f"✅ {len(plan)} 條全部回讀相符")
    print(f"✅ 非句子條目仍缺 pos：{still} 條（＝刻意留白的 {len(LEAVE_BLANK)} 條）")


if __name__ == "__main__":
    main()
