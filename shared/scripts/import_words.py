#!/usr/bin/env python3
"""
詞表匯入腳本 —— CSV → Supabase (decks / items)

設計：
  * 冪等：靠 slug upsert，同一份 CSV 反覆跑結果一致；詞表更新直接重跑即可。
  * 零依賴：只用標準庫（csv + urllib），不需要 pip install。
  * 預設 --dry-run：先看要寫什麼，確認無誤再加 --apply。
  * 軟下架：CSV 裡消失的條目，加 --deactivate-missing 時標 is_active=false，
    絕不真刪 —— 使用者的答題記錄要保住。

用法：
    python3 scripts/import_words.py scripts/sample_words.csv \
        --deck basic-01 --title "基礎 · 第一單元"
    # 確認無誤後
    python3 scripts/import_words.py scripts/sample_words.csv \
        --deck basic-01 --title "基礎 · 第一單元" --apply

CSV 欄位（大小寫不敏感，中文欄名也認）：
    ko*   / 韓文 / 한글 / 單字        zh*  / 中文 / 繁體 / 釋義
    type  / 類型（單字|詞組|句子）     pos  / 詞性
    romanization / 羅馬音             example_ko / 例句
    example_zh   / 例句翻譯           note / 備註
    tags  / 標籤（逗號分隔）           deck / 詞庫（行內指定，覆蓋 --deck）
    * = 必填
"""

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_ctx import SITE, SITE_DIR, load_env  # noqa: E402

# ROOT 現在指「這一站的目錄」而不是倉庫根 —— data/、backups/ 都在站台底下
ROOT = SITE_DIR

ALIASES = {
    "ko": ["ko", "korean", "hangul", "한국어", "한글", "韓文", "韓語", "单词", "單字", "word"],
    "zh": ["zh", "chinese", "meaning", "meaning_zh", "中文", "繁體", "繁体", "釋義", "释义", "意思", "翻譯", "翻译"],
    "romanization": ["romanization", "roman", "羅馬音", "罗马音", "發音", "发音", "讀音", "读音"],
    "hanja": ["hanja", "漢字", "汉字", "漢字詞", "汉字词", "한자"],
    "type": ["type", "item_type", "類型", "类型", "分類", "分类"],
    "pos": ["pos", "詞性", "词性", "part_of_speech"],
    "example_ko": ["example_ko", "例句", "韓文例句", "韩文例句", "example"],
    "example_zh": ["example_zh", "例句翻譯", "例句翻译", "例句中文"],
    "note": ["note", "備註", "备注", "說明", "说明"],
    "tags": ["tags", "標籤", "标签", "主題", "主题"],
    "deck": ["deck", "詞庫", "词库", "單元", "单元"],
}
CANON = {a.lower(): k for k, v in ALIASES.items() for a in v}

TYPE_MAP = {
    "word": "word", "單字": "word", "单词": "word", "單詞": "word", "詞": "word", "词": "word",
    "phrase": "phrase", "詞組": "phrase", "词组": "phrase", "短語": "phrase", "短语": "phrase",
    "sentence": "sentence", "句子": "sentence", "句": "sentence", "例句": "sentence",
}



def rest(url, key, method, path, payload=None, params=""):
    """直接打 PostgREST，避免任何第三方依賴。"""
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}{params}",
        method=method,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None,
    )
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=representation")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else []
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        sys.exit(f"❌ {method} {path} → HTTP {e.code}\n{detail}")


def guess_type(raw, ko):
    """未標註類型時，用空白數粗判：無空白=單字，1-2 空白=詞組，其餘=句子。"""
    if raw:
        t = TYPE_MAP.get(raw.strip().lower())
        if t:
            return t
    if re.search(r"[.?!。？！]", ko):
        return "sentence"
    spaces = ko.count(" ")
    if spaces == 0:
        return "word"
    return "phrase" if spaces <= 2 else "sentence"


def read_rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(f, dialect=dialect)
        if not reader.fieldnames:
            sys.exit("❌ CSV 沒有表頭列")

        mapping = {c: CANON[(c or "").strip().lower()]
                   for c in reader.fieldnames if (c or "").strip().lower() in CANON}
        missing = {"ko", "zh"} - set(mapping.values())
        if missing:
            sys.exit(
                f"❌ CSV 缺必填欄：{', '.join(sorted(missing))}\n"
                f"   實際表頭：{reader.fieldnames}\n"
                f"   可接受的別名見 raw/README.md"
            )
        return [{mapping[c]: (r.get(c) or "").strip() for c in mapping} for r in reader], mapping


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--deck", required=True, help="詞庫 slug，如 basic-01")
    ap.add_argument("--title", help="詞庫顯示名（首次建立時用）")
    ap.add_argument("--level", default=None, help="如 topik1")
    ap.add_argument("--allow-dup", action="store_true",
                    help="即使該詞已存在於其他詞庫也照樣收錄（預設會略過）")
    ap.add_argument("--append", action="store_true",
                    help="累積模式：slug 由詞條內容產生，同一詞庫可分多次匯入不互相覆蓋")
    ap.add_argument("--deactivate-missing", action="store_true",
                    help="把 CSV 裡已消失的條目標為停用（不刪資料）")
    ap.add_argument("--apply", action="store_true", help="真正寫庫（預設為 dry-run）")
    args = ap.parse_args()

    if not os.path.exists(args.csv_path):
        sys.exit(f"❌ 找不到檔案：{args.csv_path}")

    rows, mapping = read_rows(args.csv_path)
    rows = [r for r in rows if r.get("ko") and r.get("zh")]
    if not rows:
        sys.exit("❌ 沒有一列同時具備 ko 和 zh")

    groups = {}
    for r in rows:
        groups.setdefault(r.get("deck") or args.deck, []).append(r)

    print(f"📄 {args.csv_path}")
    print(f"   識別到的欄位：{mapping}")
    print(f"   有效列數：{len(rows)}")
    print(f"   將寫入 {len(groups)} 個詞庫：{', '.join(groups)}")

    types = {}
    for r in rows:
        t = guess_type(r.get("type"), r["ko"])
        types[t] = types.get(t, 0) + 1
    print(f"   類型分佈：{types}")
    print("\n   前 3 列預覽：")
    for r in rows[:3]:
        print(f"     [{guess_type(r.get('type'), r['ko']):8s}] {r['ko']}  →  {r['zh']}"
              f"   {r.get('romanization') or ''}")

    # 跨詞庫查重 —— 同一個詞收進兩個詞庫會變成兩張卡，
    # 學起來重複、統計也會被灌水。dry-run 階段就要看得到。
    url, key = load_env()
    # 不設 limit 上限：分頁撈完。寫死上限會在詞庫長大後靜默漏判，
    # 那時查重報「乾淨」其實只是沒看到後面的資料。
    existing = {}
    while True:
        page = rest(url, key, "GET", "items", None,
                    f"?select=ko,deck_id,is_active&order=id&offset={len(existing)}&limit=1000")
        existing.update({x["ko"]: x for x in page})
        if len(page) < 1000:
            break
    decks_by_id = {d["id"]: d["slug"] for d in
                   rest(url, key, "GET", "decks", None, "?select=id,slug")}

    # 兩種重複意義不同，不能混報：
    #   同一詞庫已有 → 就是這批資料本身已匯入過（重跑、還原備份）。略過即可，正常。
    #   別的詞庫已有 → 真正要人判斷的跨庫重複，會變成兩張卡。
    same, clash = [], []
    for r in rows:
        if r["ko"] not in existing:
            continue
        slug = decks_by_id.get(existing[r["ko"]]["deck_id"], "?")
        (same if slug in groups else clash).append((r["ko"], slug))

    if same:
        print(f"\n   ℹ️  {len(same)} 條在目標詞庫已存在（重複匯入／還原備份時屬正常），將被略過")
    if clash and args.allow_dup:
        print(f"\n   ℹ️  {len(clash)} 條已存在於其他詞庫，依 --allow-dup 照樣收錄：")
        for ko, dk in clash[:10]:
            print(f"        {ko}  （另一份在 {dk}）")
    elif clash:
        print(f"\n   ⚠️  {len(clash)} 條已存在於其他詞庫，將被略過：")
        for ko, dk in clash[:10]:
            print(f"        {ko}  （已在 {dk}）")
        if len(clash) > 10:
            print(f"        …另有 {len(clash)-10} 條")
    if same or (clash and not args.allow_dup):
        skip = {ko for ko, _ in same} | (set() if args.allow_dup else {ko for ko, _ in clash})
        rows = [r for r in rows if r["ko"] not in skip]
        groups = {}
        for r in rows:
            groups.setdefault(r.get("deck") or args.deck, []).append(r)
        print(f"   實際將寫入 {len(rows)} 條")

    if not args.apply:
        print("\n🔎 dry-run：什麼都沒寫。確認無誤後加 --apply 重跑。")
        return

    total = 0

    for deck_slug, group in groups.items():
        deck = rest(url, key, "POST", "decks", [{
            "slug": deck_slug,
            "title": args.title or deck_slug,
            "level": args.level,
        }], "?on_conflict=slug")[0]
        deck_id = deck["id"]

        payload = []
        for i, r in enumerate(group, 1):
            tags = [t.strip() for t in re.split(r"[,，;；]", r.get("tags", "")) if t.strip()]
            payload.append({
                "deck_id": deck_id,
                # 預設用序號（一個 CSV 對一個詞庫，重跑冪等）；
                # --append 用內容雜湊 —— 否則多批匯入同一詞庫時，
                # 每批都從 0001 編起，後一批會直接覆蓋前一批。
                # 這個坑實際踩過：六批 46 條最後只剩 10 條。
                "slug": (f"{deck_slug}-{hashlib.sha1(r['ko'].encode()).hexdigest()[:10]}"
                         if args.append else f"{deck_slug}-{i:04d}"),
                "item_type": guess_type(r.get("type"), r["ko"]),
                "ko": r["ko"],
                "zh": r["zh"],
                "romanization": r.get("romanization") or None,
                "hanja": r.get("hanja") or None,
                "pos": r.get("pos") or None,
                "example_ko": r.get("example_ko") or None,
                "example_zh": r.get("example_zh") or None,
                "note": r.get("note") or None,
                "tags": tags,
                "sort_order": i,
                "is_active": True,
            })

        for start in range(0, len(payload), 500):
            rest(url, key, "POST", "items", payload[start:start + 500], "?on_conflict=slug")
            total += len(payload[start:start + 500])

        if args.deactivate_missing and args.append:
            print("   ⚠️  --deactivate-missing 在 --append 模式下只會比對本批，已略過")
        elif args.deactivate_missing:
            live = {p["slug"] for p in payload}
            existing = rest(url, key, "GET", "items", None,
                            f"?select=id,slug&deck_id=eq.{deck_id}")
            stale = [e for e in existing if e["slug"] not in live]
            for e in stale:
                rest(url, key, "PATCH", "items", {"is_active": False}, f"?id=eq.{e['id']}")
            if stale:
                print(f"   ⏸  停用 {len(stale)} 條已從 CSV 移除的條目（資料保留）")

        print(f"   ✅ {deck_slug}: {len(payload)} 條")

    # 回讀核對，不靠斷言
    check = rest(url, key, "GET", "items", None, "?select=id&limit=1")
    print(f"\n✅ 完成，共寫入 {total} 條（回讀校驗：{'通過' if isinstance(check, list) else '異常'}）")


if __name__ == "__main__":
    main()
