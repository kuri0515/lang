#!/usr/bin/env python3
"""
把音檔上傳到私密桶，並寫進 items.audio_url。

用法（預設 dry-run，加 --apply 才真的動線上）：
    python3 shared/scripts/attach_audio.py <音檔目錄> <manifest.csv> \
        --deck haerin-schedule --bucket haerin-audio [--apply]

manifest.csv 欄位：file（音檔名）、ko（要掛到哪一條，與線上完全相同）

設計：
  * 對應靠 ko 全文比對，且限定在 --deck 之內。找不到、或同一個 ko 對到兩條，
    整批都不動 —— 寧可停下來問，也不要把錄音掛到錯的卡上
    （掛錯是靜默的：卡片看起來完全正常，只是播出來是另一句話）。
  * 上傳用 upsert：重切、重傳同名檔案會覆蓋，不會留下孤兒。
  * audio_url 存 sb:<桶>/<檔名>（見 migration 0028、shared/js/data/audio.js），
    不是網址 —— 私密桶的檔案要播放時才換成有時效的簽名網址。
  * 只動 audio_url 這一個欄位，不碰別的。
"""
import argparse, csv, json, os, sys, urllib.parse, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_ctx import load_env  # noqa: E402  （會印出目標 project ref）


def call(url, key, method, path, body=None, headers=None, raw=None):
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if headers:
        h.update(headers)
    data = raw if raw is not None else (json.dumps(body, ensure_ascii=False).encode() if body is not None else None)
    if body is not None:
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(f"{url}{path}", method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read()
            return json.loads(b) if b else None
    except urllib.error.HTTPError as e:
        sys.exit(f"❌ {method} {path} → HTTP {e.code}\n{e.read().decode('utf-8', 'replace')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio_dir")
    ap.add_argument("manifest")
    ap.add_argument("--deck", required=True)
    ap.add_argument("--bucket", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    rows = list(csv.DictReader(open(a.manifest, encoding="utf-8-sig")))
    if not rows:
        sys.exit("❌ manifest 是空的")
    missing = [r["file"] for r in rows if not os.path.exists(os.path.join(a.audio_dir, r["file"]))]
    if missing:
        sys.exit(f"❌ 音檔不存在：{missing[:5]}{' …' if len(missing) > 5 else ''}")

    url, key = load_env()
    deck = call(url, key, "GET", f"/rest/v1/decks?select=id&slug=eq.{a.deck}")
    if not deck:
        sys.exit(f"❌ 找不到詞庫 {a.deck}")
    items = call(url, key, "GET",
                 f"/rest/v1/items?select=id,ko,audio_url&deck_id=eq.{deck[0]['id']}&is_active=eq.true&limit=2000")
    by_ko = {}
    for it in items:
        by_ko.setdefault(it["ko"], []).append(it)

    plan, problems = [], []
    for r in rows:
        hit = by_ko.get(r["ko"], [])
        if len(hit) != 1:
            problems.append((r["file"], r["ko"], f"對到 {len(hit)} 條"))
        else:
            plan.append((r["file"], hit[0]))
    print(f"   {len(rows)} 個音檔 → 對得上 {len(plan)} 條，對不上 {len(problems)} 條；詞庫共 {len(items)} 條")
    for p in problems[:10]:
        print("   ⚠️ ", p)
    if problems:
        sys.exit("❌ 有對不上的，整批不動。先修 manifest 或線上的 ko。")
    already = sum(1 for _, it in plan if it.get("audio_url"))
    if already:
        print(f"   ℹ️  其中 {already} 條已經有 audio_url，將被覆蓋")

    if not a.apply:
        print("\n🔎 dry-run：什麼都沒傳、沒寫。確認無誤後加 --apply。")
        return

    for f, it in plan:
        with open(os.path.join(a.audio_dir, f), "rb") as fh:
            call(url, key, "POST", f"/storage/v1/object/{a.bucket}/{urllib.parse.quote(f)}",
                 raw=fh.read(), headers={"Content-Type": "audio/mpeg", "x-upsert": "true"})
        call(url, key, "PATCH", f"/rest/v1/items?id=eq.{it['id']}",
             {"audio_url": f"sb:{a.bucket}/{f}"}, headers={"Prefer": "return=minimal"})
    print(f"\n✅ 已上傳並掛上 {len(plan)} 條")


if __name__ == "__main__":
    main()
