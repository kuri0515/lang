#!/usr/bin/env python3
"""
全量備份 —— 把雲端資料抓成本地檔案。

    python3 scripts/backup.py                    # 備份到 backups/YYYY-MM-DD-HHMM/
    python3 scripts/backup.py --verify <目錄>     # 驗證某份備份的完整性
    python3 scripts/backup.py --restore-plan <目錄>  # 列出還原步驟（不執行）

為什麼需要：
  Supabase 免費方案沒有自動備份，976 條詞庫與全部學習記錄只有雲端一份。
  誤刪、誤改、專案被停用，任何一種都會全沒。這支腳本讓資料至少有兩份。

備份內容分兩類，處理方式不同：
  內容（decks / items）  → 同時存 JSON 與 CSV。CSV 可直接餵回 import_words.py，
                          是真正可用的還原路徑，不只是躺著的存檔。
  使用者資料（profiles / user_cards / reviews / item_edits）
                        → 只存 JSON。這是個人學習記錄，
                          備份目錄已列入 .gitignore，不會被推上公開倉庫。

還原不做成自動指令：覆蓋線上資料是不可逆的，必須人看過再決定。
--restore-plan 會列出該做什麼。
"""

import argparse
import csv
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_ctx import SITE, SITE_DIR, load_env  # noqa: E402

# ROOT 現在指「這一站的目錄」而不是倉庫根 —— data/、backups/ 都在站台底下
ROOT = SITE_DIR

# 表名 → (是否為使用者個人資料, 分頁排序欄位)
#
# 排序欄位不能一律寫 id：user_cards 是複合主鍵、沒有 id 欄，
# schema_migrations 的主鍵是 version。分頁不指定排序會在並發寫入時
# 給出錯誤答案（同一列落進兩頁），所以每張表都要指定得對。
TABLES = {
    "decks":             (False, "id"),
    "items":             (False, "id"),
    "profiles":          (True,  "id"),
    "user_cards":        (True,  "user_id,item_id,direction"),
    "reviews":           (True,  "id"),
    "item_edits":        (True,  "id"),
    "schema_migrations": (True,  "version"),
}

CSV_FIELDS = ["ko", "zh", "romanization", "hanja", "item_type", "pos",
              "example_ko", "example_zh", "note", "tags"]



def rest(url, key, path, tries=3):
    """帶重試 —— 大表一次撈太多容易在傳輸中斷"""
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(f"{url}/rest/v1/{path}")
        req.add_header("apikey", key)
        req.add_header("Authorization", f"Bearer {key}")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode() or "[]")
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            if e.code == 404:
                return None          # 表不存在，不是錯誤
            sys.exit(f"❌ {path} -> {e.code}\n{body}")
        except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(1 + attempt)
    sys.exit(f"❌ {path} 連續 {tries} 次失敗：{last}")


def fetch_all(url, key, table, order, page=300):
    out = []
    while True:
        rows = rest(url, key, f"{table}?select=*&order={order}&offset={len(out)}&limit={page}")
        if rows is None:
            return None
        out += rows
        if len(rows) < page:
            return out


def do_backup():
    url, key = load_env()
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    outdir = os.path.join(ROOT, "backups", stamp)
    os.makedirs(outdir, exist_ok=True)

    manifest = {"created_at": datetime.now().isoformat(), "source": url, "tables": {}}
    print(f"備份到 backups/{stamp}/\n")

    for table, (is_personal, order) in TABLES.items():
        rows = fetch_all(url, key, table, order)
        if rows is None:
            print(f"  ⚠️  {table:<20s} 不存在，略過")
            continue
        with open(os.path.join(outdir, f"{table}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
        manifest["tables"][table] = len(rows)
        tag = "（個人資料）" if is_personal else ""
        print(f"  ✅ {table:<20s} {len(rows):>5d} 列 {tag}")

    # 內容另存 CSV —— 這才是真正能餵回匯入腳本的還原路徑
    items = json.load(open(os.path.join(outdir, "items.json"), encoding="utf-8"))
    decks = {d["id"]: d["slug"] for d in
             json.load(open(os.path.join(outdir, "decks.json"), encoding="utf-8"))}
    by_deck = {}
    for it in items:
        by_deck.setdefault(decks.get(it["deck_id"], "unknown"), []).append(it)

    csvdir = os.path.join(outdir, "csv")
    os.makedirs(csvdir, exist_ok=True)
    print()
    for slug, rows in by_deck.items():
        path = os.path.join(csvdir, f"{slug}.csv")
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: (", ".join(r[k]) if k == "tags" and r.get(k)
                                else (r.get(k) or "")) for k in CSV_FIELDS})
        print(f"  ✅ csv/{slug}.csv        {len(rows):>5d} 條（可餵回 import_words.py）")

    with open(os.path.join(outdir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    # 立刻驗一次 —— 不驗的備份等於沒備份
    print()
    verify(outdir, quiet=False)
    return outdir


def verify(outdir, quiet=True):
    mpath = os.path.join(outdir, "manifest.json")
    if not os.path.exists(mpath):
        sys.exit(f"❌ {outdir} 不是備份目錄（缺 manifest.json）")
    manifest = json.load(open(mpath, encoding="utf-8"))

    print("驗證：")
    bad = 0
    for table, expected in manifest["tables"].items():
        p = os.path.join(outdir, f"{table}.json")
        if not os.path.exists(p):
            print(f"  ❌ {table} 檔案不存在")
            bad += 1
            continue
        got = len(json.load(open(p, encoding="utf-8")))
        okay = got == expected
        bad += not okay
        if not quiet or not okay:
            print(f"  {'✅' if okay else '❌'} {table:<20s} {got}/{expected} 列")

    # 內容抽樣：確認不是空殼
    items = json.load(open(os.path.join(outdir, "items.json"), encoding="utf-8"))
    has_ko = sum(1 for x in items if x.get("ko"))
    has_zh = sum(1 for x in items if x.get("zh"))
    okay = has_ko == len(items) == has_zh
    bad += not okay
    print(f"  {'✅' if okay else '❌'} 內容抽樣：{has_ko}/{len(items)} 條有韓文、{has_zh} 條有中文")

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(outdir) for f in fs)
    print(f"\n{'✅ 備份完整' if not bad else f'❌ {bad} 項有問題'}　{size/1024:.0f} KB　{outdir}")
    return bad == 0


def restore_plan(outdir):
    manifest = json.load(open(os.path.join(outdir, "manifest.json"), encoding="utf-8"))
    print(f"備份時間：{manifest['created_at']}")
    print(f"來源：{manifest['source']}\n")
    print("還原步驟（需人工執行，覆蓋線上資料不可逆）：\n")
    print("  ① 先備份現況，再動任何東西")
    print("       python3 scripts/backup.py\n")
    print("  ② 結構：依序套用 migration")
    print("       scripts/migrate.sh up\n")
    print("  ③ 內容：用備份的 CSV 餵回匯入腳本（靠 slug 冪等，可重跑）")
    for f in sorted(os.listdir(os.path.join(outdir, "csv"))):
        slug = f[:-4]
        print(f"       python3 scripts/import_words.py {outdir}/csv/{f} \\")
        print(f"           --deck {slug} --title '<詞庫名>' --append --apply")
    print("\n  ④ 使用者資料：profiles / user_cards / reviews 的 JSON 需以 service_role")
    print("       逐表 POST 回 PostgREST。reviews 有 identity 欄位，還原後要重設序列：")
    print("       select setval('reviews_id_seq', (select max(id) from reviews));")
    print("\n  ⑤ 還原後跑稽核確認：")
    print("       python3 scripts/audit_content.py")


def selftest():
    """
    每張表都撈得動嗎？

    存在的意義：排序欄位寫錯時（user_cards 沒有 id 欄）備份會整支失敗，
    而失敗發生在「要動資料之前」那一刻 —— 那正是最不能沒有還原點的時候。
    實際踩過：修分頁排序時一律寫 id，備份靜靜壞掉，
    下一次匯入就在沒有還原點的情況下跑完了。

    只撈一列，快，可以在任何寫入動作前先跑。
    """
    url, key = load_env()
    bad = []
    for table, (_, order) in TABLES.items():
        try:
            rest(url, key, f"{table}?select=*&order={order}&limit=1")
        except SystemExit as e:
            bad.append(f"{table}（order={order}）：{e}")
    for table, (_, order) in TABLES.items():
        print(f"  {'❌' if any(t.startswith(table) for t in bad) else '✅'} {table:<20s} order={order}")
    if bad:
        print("\n❌ 備份無法完成 —— 動資料之前請先修好")
        sys.exit(1)
    print("\n✅ 每張表都撈得動，備份可用")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", metavar="DIR")
    ap.add_argument("--restore-plan", metavar="DIR")
    ap.add_argument("--selftest", action="store_true",
                    help="只確認每張表都撈得動（動資料前先跑）")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return

    if args.verify:
        sys.exit(0 if verify(args.verify, quiet=False) else 1)
    if args.restore_plan:
        restore_plan(args.restore_plan)
        return
    do_backup()


if __name__ == "__main__":
    main()
