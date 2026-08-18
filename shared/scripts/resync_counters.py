#!/usr/bin/env python3
"""
以 reviews 為準，重算 user_cards 的計數。

    python3 shared/scripts/resync_counters.py            # dry-run
    python3 shared/scripts/resync_counters.py --apply

【為什麼以 reviews 為準】
  reviews 是只追加的日誌：每答一題插一列，不改不刪。
  user_cards 的 total_reviews / correct_reviews 是它的彙總，
  兩者不符時一律以日誌為真 —— 彙總算錯可以重算，日誌少了就補不回來。

【什麼情況會不符】
  把「加一」算在客戶端。saveReview 原本寫 (prevCard.total_reviews ?? 0) + 1，
  而同一輪內重排的卡片 prevCard 不會更新，於是第 2、3、4 次都寫同一個值。
  已於 0021 改成資料庫 +1（log_review），這支是把既有落差補回來。

  ★ 只補「卡片少於日誌」的情況。卡片多於日誌反而要人看 ——
    那表示有 reviews 被刪過，重算會把使用者的次數改小，
    那不是修復是二次破壞。
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = os.environ.get("SITE", "korean")


def load_env():
    for p in (os.path.join(ROOT, SITE, ".env.local"), os.path.join(ROOT, ".env.local")):
        if os.path.exists(p):
            env = {}
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
            return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]
    sys.exit(f"❌ 找不到 {SITE}/.env.local")


def rq(url, key, method, path, body=None, tries=4):
    for i in range(tries):
        try:
            data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
            r = urllib.request.Request(
                f"{url}/rest/v1/{urllib.parse.quote(path, safe='?&=,.()*')}",
                data=data, method=method)
            for h, v in [("apikey", key), ("Authorization", f"Bearer {key}"),
                         ("Content-Type", "application/json"),
                         ("Prefer", "return=representation")]:
                r.add_header(h, v)
            with urllib.request.urlopen(r, timeout=40) as resp:
                return json.loads(resp.read().decode() or "[]")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))


def page(url, key, table, select, order, size=500):
    out = []
    while True:
        rows = rq(url, key, "GET",
                  f"{table}?select={select}&order={order}&offset={len(out)}&limit={size}")
        out += rows
        if len(rows) < size:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    url, key = load_env()
    print(f"🎯 站台 {SITE} · {url.split('//')[1].split('.')[0]}\n")

    cards = page(url, key, "user_cards",
                 "user_id,item_id,direction,total_reviews,correct_reviews",
                 "user_id,item_id,direction")
    revs = page(url, key, "reviews", "user_id,item_id,direction,is_correct", "id")

    agg = defaultdict(lambda: [0, 0])
    for r in revs:
        k = (r["user_id"], r["item_id"], r["direction"])
        agg[k][0] += 1
        agg[k][1] += 1 if r["is_correct"] else 0

    behind, ahead = [], []
    for c in cards:
        k = (c["user_id"], c["item_id"], c["direction"])
        n, ok = agg[k]
        cur = (c["total_reviews"], c["correct_reviews"])
        if cur == (n, ok):
            continue
        (behind if c["total_reviews"] < n else ahead).append((c, n, ok))

    print(f"卡片 {len(cards)} 張 · 日誌 {len(revs)} 筆")
    print(f"  卡片少於日誌（可自動補回）：{len(behind)}")
    print(f"  卡片多於日誌（★ 不動，需要人看）：{len(ahead)}")
    for c, n, ok in ahead[:5]:
        print(f"     {c['item_id'][:8]} {c['direction']}: "
              f"卡片 {c['correct_reviews']}/{c['total_reviews']} vs 日誌 {ok}/{n}")
    if ahead:
        print("     → 卡片比日誌多，表示 reviews 被刪過。"
              "重算會把使用者的次數改小，那不是修復是二次破壞。")

    if not behind:
        print("\n✅ 沒有需要補的")
        return
    print("\n前 5 筆將要補的：")
    for c, n, ok in behind[:5]:
        print(f"  {c['item_id'][:8]} {c['direction']}: "
              f"{c['correct_reviews']}/{c['total_reviews']} → {ok}/{n}")

    if not args.apply:
        print(f"\n🔎 dry-run：什麼都沒寫。將補 {len(behind)} 筆，加 --apply 生效。")
        return

    for c, n, ok in behind:
        rq(url, key, "PATCH",
           f"user_cards?user_id=eq.{c['user_id']}&item_id=eq.{c['item_id']}"
           f"&direction=eq.{c['direction']}",
           {"total_reviews": n, "correct_reviews": ok})

    # 回讀驗證 —— 不驗就不算做完
    after = page(url, key, "user_cards",
                 "user_id,item_id,direction,total_reviews,correct_reviews",
                 "user_id,item_id,direction")
    bad = 0
    for c in after:
        k = (c["user_id"], c["item_id"], c["direction"])
        n, ok = agg[k]
        if c["total_reviews"] < n:
            bad += 1
    print(f"\n✅ 補了 {len(behind)} 筆")
    print(f"{'✅' if not bad else '❌'} 回讀：仍落後的 {bad} 筆")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
