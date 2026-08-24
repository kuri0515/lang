#!/usr/bin/env python3
# =====================================================================
# 把一集的核心詞匯入 items（＝進複習池）
#
# 【為什麼詞進 items 而台詞不進】
#   使用者的決定：核心詞進複習池、台詞不進。
#   詞是要長期記住的東西，句子是理解與語感的載體 ——
#   前者需要排程把它帶回來，後者需要的是「讀到哪一幕」。
#
# 【頻率層級標籤】
#   全部的詞都建卡（使用者的決定），但每張卡帶上 freq-high/mid/low。
#   理由：一集 768 個詞裡有六成此生只出現一次，
#   日後若想「先練高頻的」，資料已經分好了，不必回頭重跑整條流程。
#   標籤是免費的，重跑不是。
#
# 【例句用首次出現的那一行】
#   一個詞脫離句子就只剩下字面。首次出現的那一行是它在這部作品裡
#   第一次被使用的樣子 —— 而學習者接下來就會在精讀裡讀到那一幕。
#
#     python3 japanese/scripts/import_script_words.py japanese/raw/spy/S1E01.cards.json \
#       --deck-slug spy-s1 --deck-title 'SPY×FAMILY 第一季' --ep S1E01
# =====================================================================
import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from extract_subtitles import ruby_for, ruby_text, KANJI   # noqa: E402


def env():
    out = {}
    for line in (ROOT / ".env.local").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            out[k] = v.strip()
    url = out["SUPABASE_URL"].rstrip("/")
    key = out.get("SUPABASE_SERVICE_ROLE_KEY") or out["SERVICE_ROLE_KEY"]
    print(f"  站台 japanese · Supabase 專案 {url.split('//')[1].split('.')[0]}")
    return url, key


def call(url, key, method, path, body=None, prefer=None):
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(f"{url}/rest/v1/{path}", method=method, headers=h,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"  ❌ {method} {path} → {e.code}\n     {e.read().decode()[:400]}")


def tier(n):
    return "freq-high" if n >= 5 else ("freq-mid" if n >= 2 else "freq-low")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cards")
    ap.add_argument("--deck-slug", required=True)
    ap.add_argument("--deck-title", required=True)
    ap.add_argument("--ep", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cards = json.loads(Path(args.cards).read_text(encoding="utf-8"))
    lines = json.loads((Path(args.cards).parent / f"{args.ep}.json").read_text())["lines"]

    rows = []
    for i, c in enumerate(cards, start=1):
        # 注音：漢字才需要。純假名/片假名的詞不加，免得畫面上多一層沒有資訊的括號
        ruby = ruby_text(ruby_for(c["lemma"], c["reading"])) if KANJI.search(c["lemma"]) else ""
        src = lines[c["first_line"]] if c["first_line"] is not None else None
        rows.append({
            "slug": f"{args.deck_slug}-{args.ep.lower()}-w{i:04d}",
            "item_type": "word",
            "ko": c["lemma"],
            "zh": c["zh"],
            "romanization": c["reading"],
            "hanja": ruby,
            "pos": c["pos"],
            "example_ko": (src["ruby"] if src else None),
            "example_zh": (src["zh"] if src else None),
            "note": f"精讀｜{args.ep}｜出現 {c['count']} 次",
            "tags": [args.deck_slug, args.ep, tier(c["count"])]
                    + (["專有名詞"] if c.get("proper") else []),
            "sort_order": i,
            "is_active": True,
        })

    from collections import Counter
    print(f"  {len(rows)} 張卡 · 層級 {dict(Counter(r['tags'][2] for r in rows))}")
    print(f"  帶注音的 {sum(1 for r in rows if r['hanja'])} 張 · 帶例句的 {sum(1 for r in rows if r['example_ko'])} 張")

    # ★ 驗注音**對不對**，不是只驗有沒有。
    #   實際踩過：卡片正面放原形（行く），而讀音存的是當下活用形（いか），
    #   兩者對不齊時對齊器退回「整詞一個注音」→ 行く[いか]、企てる[くわだて]，
    #   送り仮名被算進讀音裡。而「有沒有注音」這個檢查對它全部亮綠燈。
    #   判準：被注音的那一段必須**以漢字結尾**。
    #
    #   ★ 第一版判準寫錯了，記在這裡：本來要求整段前綴都是漢字，
    #     於是 我[わ]が国[くに]、買[か]い物[もの]、お嬢[じょう]ちゃん
    #     這些**正確**的注音全被判成錯（43 張偽陽性）——
    #     因為擷取到的前綴是「が国」，而開頭那個假名屬於**前一個**注音。
    #     只看結尾就對了：奪う[うばう] 的前綴以「う」結尾，那才是真的錯。
    bad = []
    for r in rows:
        for seg, _ in re.findall(r"([^\[\]]+)\[([^\]]+)\]", r["hanja"] or ""):
            if not re.split(r"[ぁ-ゖァ-ヺ]", seg)[-1]:
                bad.append(f"{r['ko']} → {r['hanja']}")
                break
    print(f"  注音只蓋在漢字上：{len(rows) - len(bad)}/{len(rows)}"
          + (f"  ❌ 有 {len(bad)} 張蓋到送り仮名：{bad[:4]}" if bad else "  ✅"))
    if bad:
        sys.exit("  注音有誤，不匯入")
    if args.dry_run:
        print("  （dry-run，沒有寫入）")
        return

    url, key = env()

    # ★ 同一副詞庫裡，一個詞只能有一張卡。
    #   卡片編號是按集編的（…-s1e02-w0001），所以同一個詞在第二集會拿到
    #   不同的 slug —— upsert 認不出它，於是建出第二張一模一樣的卡。
    #   後果不是報錯：複習池裡會有兩張同樣的詞，各自排程、各自算進度，
    #   而使用者只會覺得「這個詞怎麼一直出現」。
    #   實測第 2 集有 217 個詞與第 1 集重複。
    deck0 = call(url, key, "GET",
                 f"decks?select=id&slug=eq.{urllib.parse.quote(args.deck_slug)}")
    if deck0:
        have = set()
        off = 0
        while True:
            page = call(url, key, "GET",
                        f"items?select=ko&deck_id=eq.{deck0[0]['id']}&limit=1000&offset={off}")
            have |= {r["ko"] for r in page}
            if len(page) < 1000:
                break
            off += 1000
        skipped = [r for r in rows if r["ko"] in have]
        rows = [r for r in rows if r["ko"] not in have]
        if skipped:
            print(f"  已存在於這副詞庫、略過：{len(skipped)} 張（前面的集數已經建過）")
        if not rows:
            print("  沒有新的詞要建卡。")
            return

    # on_conflict 一定要指定 —— PostgREST 沒有它就當成純 INSERT，
    # 重跑會撞 unique 而失敗（而這支腳本的前提就是可以重跑）
    deck = call(url, key, "POST", "decks?on_conflict=slug",
                {"slug": args.deck_slug, "title": args.deck_title, "sort_order": 50},
                prefer="resolution=merge-duplicates,return=representation")
    did = deck[0]["id"]
    for r in rows:
        r["deck_id"] = did
    for i in range(0, len(rows), 200):
        call(url, key, "POST", "items?on_conflict=slug", rows[i:i + 200],
             prefer="resolution=merge-duplicates,return=minimal")

    back = []
    off = 0
    while True:
        page = call(url, key, "GET",
                    f"items?select=id,ko,hanja&deck_id=eq.{did}&limit=1000&offset={off}")
        back += page
        if len(page) < 1000:
            break
        off += 1000
    kos = [r["ko"] for r in back]
    # 這副詞庫裡不該有重複的詞形 —— 有的話就是上面那道去重沒擋住
    dups = len(kos) - len(set(kos))
    ok = dups == 0 and all(r["ko"] in set(kos) for r in rows)
    print(f"  回讀：這副詞庫共 {len(back)} 張（本次新增 {len(rows)}）· "
          f"重複詞形 {dups} → {'✅ 對得上' if ok else '❌ 對不上'}")
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
