#!/usr/bin/env python3
# =====================================================================
# 把抽好的一集匯入精讀資料表
#
# 【冪等】以 slug（spy-s1e01）認人：重跑會覆蓋同一集，不會長出第二份。
#   行用 (episode_id, idx) 認人，同理。
#   ★ 這一點在字幕改版、切幕門檻調整時會反覆用到 ——
#     沒有冪等的話每次重跑都要先手動刪，而「先刪再匯入」中間任何一步
#     失敗就會留下一集只有一半的行。
#
# 【只寫台詞，不寫單字】
#   單字要有中文意思才能成為卡片，而那份意思不在字幕裡
#   （字幕只有整句翻譯，拆不出單詞對應）。
#   由另一支腳本處理，這裡不假裝自己有。
#
#     python3 japanese/scripts/import_script.py japanese/raw/spy/S1E01.json \
#       --work-title 'SPY×FAMILY'
# =====================================================================
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def env():
    out = {}
    for line in (ROOT / ".env.local").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            out[k] = v.strip()
    url = out["SUPABASE_URL"].rstrip("/")
    key = out.get("SUPABASE_SERVICE_ROLE_KEY") or out["SERVICE_ROLE_KEY"]
    # ★ 一定要印出專案 ref。兩個站各自一個 Supabase 專案，
    #   而腳本認錯站就會把日文的內容寫進韓文站的線上資料。
    print(f"  站台 japanese · Supabase 專案 {url.split('//')[1].split('.')[0]}")
    return url, key


def call(url, key, method, path, body=None, prefer=None):
    h = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}", method=method, headers=h,
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"  ❌ {method} {path} → {e.code}\n     {e.read().decode()[:400]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--work-title", required=True)
    ap.add_argument("--title", default=None, help="該集標題")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    d = json.loads(Path(args.data).read_text(encoding="utf-8"))
    work, ep = d["work"], d["ep"]
    season = int(ep.split("E")[0].lstrip("Ss"))
    episode = int(ep.split("E")[1])
    slug = f"{work}-s{season}e{episode:02d}"

    # 行號 → 幕號。幕邊界只在這裡用一次，之後真相就在行上（見 migration）
    scene_of = {}
    for n, b in enumerate(d["scenes"], start=1):
        for i in range(b["from"], b["to"] + 1):
            scene_of[i] = n

    lines = [{
        "idx": l["i"], "scene": scene_of[l["i"]],
        "start_s": l["start"], "end_s": l["end"],
        "ja": l["ja"], "ruby": l["ruby"], "zh": l["zh"],
    } for l in d["lines"]]

    print(f"  {slug}：{len(lines)} 行 · {len(d['scenes'])} 幕 · 詞彙 {len(d['words'])} 個（本次不匯入）")
    if args.dry_run:
        print("  （dry-run，沒有寫入）")
        return

    url, key = env()
    row = call(url, key, "POST", "script_episodes",
               {"slug": slug, "work": work, "work_title": args.work_title,
                "season": season, "episode": episode, "title": args.title,
                "line_count": len(lines), "scene_count": len(d["scenes"]),
                "sort_order": season * 1000 + episode,
                "updated_at": "now()"},
               prefer="resolution=merge-duplicates,return=representation")
    eid = row[0]["id"]

    # 先清掉這一集的舊行再寫入。
    # 用 upsert 的話，若新版行數變少，多出來的舊行會留在資料庫裡 ——
    # 而它們看起來完全正常，只是接在結尾多出幾行不屬於這一集的台詞。
    call(url, key, "DELETE", f"script_lines?episode_id=eq.{eid}")
    for i in range(0, len(lines), 500):
        chunk = [{**l, "episode_id": eid} for l in lines[i:i + 500]]
        call(url, key, "POST", "script_lines", chunk, prefer="return=minimal")

    back = call(url, key, "GET",
                f"script_lines?select=idx,scene&episode_id=eq.{eid}&order=idx&limit=2000")
    scenes_back = len({r["scene"] for r in back})
    ok = len(back) == len(lines) and scenes_back == len(d["scenes"])
    print(f"  回讀：{len(back)} 行 · {scenes_back} 幕 → {'✅ 對得上' if ok else '❌ 對不上'}")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
