#!/usr/bin/env python3
"""
內容品質稽核 —— 每次匯入後跑一次，把人眼看不出來的問題挑出來。

    python3 scripts/audit_content.py            # 全部檢查
    python3 scripts/audit_content.py --fix      # 順手修可自動修的（會先列出再問）

為什麼需要這支：
  詞條是一批批貼進來的，人工加工（羅馬音、漢字、備註、標籤）無法每條都複查。
  有些問題不會報錯、只會靜默存在 —— 同一個詞收進兩個詞庫、標籤拼寫漂移、
  句子被標了漢字。這些等到使用者撞見才發現就太晚了。

檢查項目與判準都寫在各函式的註解裡；判準有爭議的一律只警告、不自動改。
"""

import argparse
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HANGUL = re.compile(r"[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯]")
HANJA = re.compile(r"[一-鿿]")


def load_env():
    path = os.path.join(ROOT, ".env.local")
    if not os.path.exists(path):
        sys.exit("❌ 缺少 .env.local")
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]


def rest(url, key, method, path, payload=None, tries=3):
    """
    帶重試。回應被截斷（IncompleteRead）在大量資料時會發生 ——
    實際踩過：一次撈 1000 列全欄位時連線中斷，稽核直接崩掉。
    """
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(
            f"{url}/rest/v1/{path}", method=method,
            data=json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None)
        req.add_header("apikey", key)
        req.add_header("Authorization", f"Bearer {key}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Prefer", "return=representation")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read().decode()
                return json.loads(b) if b else []
        except urllib.error.HTTPError as e:
            sys.exit(f"❌ {method} {path} -> {e.code}\n{e.read().decode()[:300]}")
        except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(1 + attempt)
    sys.exit(f"❌ {method} {path} 連續 {tries} 次失敗：{last}")


def fetch_all(url, key, table, select, page=300, order="id"):
    """
    分頁撈完 —— PostgREST 單次有上限，寫死 limit 會靜默截斷。
    頁大小取 300 而非 1000：全欄位的列很大，一次要太多容易在傳輸中斷。

    ★ 必須 order=id：offset/limit 分頁在沒有確定排序時，
      資料庫可以任意決定行序。若此時有別的程序正在寫入，
      同一行會落進兩頁（看起來像重複收錄）、另一行被跳過（計數短少）。
      實際踩過：補 note 的腳本還在跑時跑稽核，
      憑空報出兩筆「同一詞庫內重複」與詞庫計數偏移，查下去資料其實完好。
      分頁不排序不是效能問題，是會給出錯誤答案的問題。

      order 可指定：user_cards 是複合主鍵、沒有 id 欄，
      要傳 "user_id,item_id,direction"。
    """
    out = []
    while True:
        rows = rest(url, key, "GET",
                    f"{table}?select={select}&order={order}&offset={len(out)}&limit={page}")
        out += rows
        if len(rows) < page:
            return out


# =====================================================================
# 檢查項
# =====================================================================
ISSUES = []


def issue(level, title, rows, hint=""):
    ISSUES.append({"level": level, "title": title, "rows": rows, "hint": hint})


def check_duplicates(items):
    """
    重複收錄分兩種，嚴重度不同：

    同一詞庫內重複 → 一定是錯的。同一份清單裡出現兩次沒有任何理由。
    跨詞庫重複     → 可能是刻意的（匯入時加 --allow-dup）。
                    後果是那個詞會有兩張卡、「已掌握」統計各算一次，
                    使用者知情選擇即可，不該由稽核擋下。
    """
    by = defaultdict(list)
    for x in items:
        by[x["ko"]].append(x)

    same_deck, cross_deck = [], []
    for k, v in by.items():
        if len(v) < 2:
            continue
        decks = [r["deck"] for r in v]
        line = f"{k}  →  " + " ／ ".join(f"{r['deck']}:{r['zh']}" for r in v)
        (same_deck if len(set(decks)) < len(decks) else cross_deck).append(line)

    issue("error", "同一詞庫內重複收錄", same_deck,
          "同一份清單裡不該有兩條相同的詞。刪除前確認沒有學習記錄掛在上面。")
    issue("info", "跨詞庫重複（可能是刻意的）", cross_deck,
          "該詞會有兩張卡、統計各算一次。若非本意，刪掉其中一條。")


def check_same_meaning(items):
    """同一中文對多個韓文 —— 多半是正常的同義詞，但選擇題會誤判，值得看一眼"""
    by = defaultdict(list)
    for x in items:
        if x["item_type"] != "sentence":
            by[x["zh"]].append(x["ko"])
    same = {k: v for k, v in by.items() if len(set(v)) > 1}
    issue("warn", "同一中文對應多個韓文（選擇題已排除互為干擾項，僅供確認）",
          [f"{k}: {' / '.join(sorted(set(v)))}" for k, v in same.items()])


# 台灣兩種寫法都通行，或 OpenCC 本身判錯的字對。
# ★ 提升為模組層級常數：fill_examples.py 也要用同一份。
#   以前兩邊各存一份，結果 fill_examples 那份少了 台／臺，
#   寫「舞台」時被誤判成簡體 —— 同一個判準複製兩份必然漂移。
#   里→裡  OpenCC 的已知誤判：萬里的「里」是距離單位，不是「裡面」
#   注→註  注文（訂購，日韓漢字）與註文都有人用
#   泄→洩  排泄在台灣是標準寫法
#   娘→孃  台灣標準是「娘家」，孃是異體字
#   家→傢 · 具→俱  台灣標準是「家具」
#   爲→為  標的是韓文漢字，韓國漢字用的正是 爲
OK_BOTH = {("台", "臺"), ("祕", "秘"), ("秘", "祕"),
           ("里", "裡"), ("注", "註"), ("泄", "洩"), ("布", "佈"), ("才", "纔"),
           ("娘", "孃"), ("家", "傢"), ("具", "俱"), ("爲", "為"),
           # 了→瞭  OpenCC 把「發明了」的「明了」當成詞而轉成「發明瞭」，
           #        但這裡的「了」是動態助詞。台灣「了解／瞭解」兩種寫法都通行，
           #        所以放行不會漏掉真正的問題。
           ("了", "瞭")}


def check_simplified(items):
    """
    簡體字殘留。

    刻意只用「字元級 + 台灣變體」（s2tw）而非詞組級（s2twp）：
    後者不看語境，會把「菜單→選單」（那是 UI 選單）、「對象→物件」
    （那是程式物件）也算成錯，雜訊比訊號多。

    台灣兩種寫法都通行的字（台/臺、祕/秘）列入白名單，不算問題。
    """
    try:
        from opencc import OpenCC
    except ImportError:
        issue("info", "簡繁檢查已略過", ["未安裝 opencc-python-reimplemented"])
        return
    cc = OpenCC("s2tw")
    found = []
    for x in items:
        for f in ("zh", "example_zh", "note"):
            v = x.get(f) or ""
            conv = cc.convert(v)
            if conv == v:
                continue
            diff = [(a, b) for a, b in zip(v, conv) if a != b]
            if all(pair in OK_BOTH for pair in diff):
                continue
            found.append(f"{x['ko']} · {f}: {v}  →  {conv}")
    issue("warn", "疑似簡體字", found, "自動判定會誤報，請人眼確認再改。")


def check_hanja(items):
    """漢字欄位格式；句子不該標漢字（那是詞源標註，不是國漢文混寫）"""
    issue("error", "hanja 欄不含任何漢字",
          [f"{x['ko']}: {x['hanja']}" for x in items if x.get("hanja") and not HANJA.search(x["hanja"])])
    issue("error", "句子被標了漢字",
          [x["ko"] for x in items if x["item_type"] == "sentence" and x.get("hanja")],
          "hanja 是「詞的漢字詞源」，不是把整句改寫成漢字。")
    # 混合詞的 hanja 本來就可能含韓文與拉丁字母（熱情pay、헬朝鮮、工夫하다），
    # 那是刻意保留的形態。只揪真正的雜訊：數字與標點以外的怪東西。
    issue("warn", "hanja 含可疑字元",
          [f"{x['ko']}: {x['hanja']}" for x in items
           if x.get("hanja") and re.search(r"[^一-鿿가-힯A-Za-z\s?!.]", x["hanja"])])


def check_type(items):
    """type 與內容不符 —— 影響詞序重組的取材與統計"""
    bad = []
    for x in items:
        toks = len(x["ko"].split())
        if x["item_type"] == "word" and toks > 1:
            bad.append(f"{x['ko']}  標為單字但有 {toks} 個詞塊")
        # 韓語一個活用形就能構成完整句子（알겠습니다.＝我知道了），
        # 單看詞塊數會大量誤報。只在「單詞塊且無句末標點」時才可疑。
        if x["item_type"] == "sentence" and toks == 1 and not re.search(r"[.?!。？！]$", x["ko"]):
            bad.append(f"{x['ko']}  標為句子但只有一個詞塊且無句末標點")
    issue("warn", "type 與內容不符", bad)


def check_romanization(items):
    issue("warn", "非句子卻缺羅馬音",
          [x["ko"] for x in items if x["item_type"] != "sentence" and not x.get("romanization")])
    issue("error", "羅馬音含非法字元",
          [f"{x['ko']}: {x['romanization']}" for x in items
           if x.get("romanization") and re.search(r"[^a-z0-9 \-']", x["romanization"])])
    issue("error", "羅馬音欄裡出現韓文",
          [f"{x['ko']}: {x['romanization']}" for x in items
           if x.get("romanization") and HANGUL.search(x["romanization"])])


def check_tags(items):
    """
    標籤漂移。一批批加進來時很容易出現 食物／飲食、生活／日常 這種近義標籤，
    分開後每個都湊不滿一組，篩選就失去意義。
    """
    tags = Counter(t for x in items for t in (x["tags"] or []))
    singles = sorted(t for t, n in tags.items() if n == 1)
    issue("info", f"標籤共 {len(tags)} 個，只用過一次的 {len(singles)} 個",
          [", ".join(singles)] if singles else [],
          "只用一次的標籤篩選時沒有意義，考慮併入既有標籤。")
    # 近義標籤：一個是另一個的子字串
    near = []
    ts = list(tags)
    for a in ts:
        for b in ts:
            if a != b and (a in b or b in a):
                pair = tuple(sorted((a, b)))
                if pair not in near:
                    near.append(pair)
    issue("warn", "疑似近義標籤",
          [f"{a}({tags[a]}) ／ {b}({tags[b]})" for a, b in near])


def check_counter_sync(url, key):
    """
    user_cards 的計數應與 reviews 彙總相符。

    會不符的情況：直接 insert reviews 而沒走 log_practice RPC（例如測試腳本
    或手動修資料），或刪了 reviews 卻沒回退計數。reviews 是只追加的權威日誌，
    對不上時一律以它為準重算。
    """
    cards = fetch_all(url, key, "user_cards", "user_id,item_id,direction,total_reviews,correct_reviews",
                      order="user_id,item_id,direction")   # 複合主鍵，沒有 id 欄
    revs = fetch_all(url, key, "reviews", "user_id,item_id,direction,is_correct")
    agg = defaultdict(lambda: [0, 0])
    for r in revs:
        k = (r["user_id"], r["item_id"], r["direction"])
        agg[k][0] += 1
        if r["is_correct"]:
            agg[k][1] += 1
    bad = []
    for c in cards:
        k = (c["user_id"], c["item_id"], c["direction"])
        n, ok = agg.get(k, [0, 0])
        if (c["total_reviews"], c["correct_reviews"]) != (n, ok):
            bad.append(f"{c['item_id'][:8]} {c['direction']}: 卡片 {c['correct_reviews']}/{c['total_reviews']} vs 日誌 {ok}/{n}")
    issue("error", "user_cards 計數與 reviews 日誌不符", bad,
          "以 reviews 為準重算。日誌是只追加的權威來源。")


def check_examples(items):
    """
    例句的兩種錯，人眼一條條掃時最容易放行。

    【敬語不一致】主語是尊稱時，謂語必須帶 -시-。
      「사장님은 아직 젊어요」文法沒錯但失禮，學生照著學會得罪人。
      只在 님 後面接主格助詞（은/는/이/가/께서）時才算主語 ——
      「선생님께 질문이 있어요」的 님 是與格，主語是「我」，不必加敬語。
      分不清這點會誤報，而誤報多了整項檢查就沒人看了。

    【主語對不上】韓語常省略主語，中文譯文卻寫了「他」。
      學生會以為那個「他」在韓語句子裡有對應的詞，其實沒有。
    """
    ex = [x for x in items if x.get("example_ko")]

    hon = re.compile(r"(세요|셨|시어|십니|으시|께서|시죠|시네)")
    # 손님／아드님／따님 的 님 已詞彙化，不是敬稱後綴 ——
    # 「손님이 와요」是完全自然的韓語，不該要求 -시-。
    # 用否定環視排除，否則每碰到這些詞都會誤報。
    subj_hon = re.compile(
        r"(?<!손)(?<!아드)(?<!따)(님|할아버지|할머니|어머니|아버지)\s*(은|는|이|가|께서)")
    issue("warn", "例句敬語不一致（主語尊稱，謂語無敬語詞尾）",
          [f"{x['ko']}: {x['example_ko']}" for x in ex
           if subj_hon.search(x["example_ko"]) and not hon.search(x["example_ko"])],
          "主語是尊稱時謂語要用 -시-，否則文法對但失禮。")

    # 【翻譯腔：의 用過頭】
    # 中文的「的」幾乎逢名詞就用，韓語的 의 卻多半省略：
    #   두 가게의 가격 → 두 가게 가격
    #   회사의 규칙   → 회사 규칙
    # 對中文母語者這是最典型的翻譯腔來源，例句若照中文結構寫就會不自然。
    # 只列出來給人看，不自動改 —— 의 有非省不可的時候（제 친구의 집）。
    # 兩種要排除，否則噪音蓋過訊號：
    #   ① 詞條本身就是在教 의（어머니의、우리의、친구의、저의）——
    #      例句裡的 의 正是教學點，不是翻譯腔
    #   ② 의 是詞的一部分而非助詞（자유주의、민주주의、의의）
    issue("info", "例句含 의（中文母語者的翻譯腔熱點，確認是否該省略）",
          [f"{x['ko']}: {x['example_ko']}" for x in ex
           if re.search(r"[가-힣]의\s", x["example_ko"])
           and not x["ko"].endswith("의")
           and not re.search(r"(주의|의의)\s", x["example_ko"])],
          "韓語的 의 多半省略，寫成中文那樣逢「的」就加會不自然。")

    third = re.compile(r"[他她]")
    # 걔／얘／쟤 是口語的第三人稱（걔 ＝ 그 애）。網路用語那批全用半語，
    # 少了它們會把「걔는 진짜 고답이야」誤報成沒有主語。
    ko_subj = re.compile(r"(그|그녀|그분|그 사람|저 사람|걔|얘|쟤|선배|"
                         r"배우|사장|선생|친구|동생|언니|누나|형|오빠)")
    issue("warn", "例句主語與譯文對不上",
          [f"{x['ko']}: {x['example_ko']}  →  {x['example_zh']}" for x in ex
           if third.search(x.get("example_zh") or "") and not ko_subj.search(x["example_ko"])],
          "譯文寫了「他／她」但韓語句裡沒有對應的詞，學生會找不到。")


def check_hanja_consistency(items):
    """
    同一標籤內 hanja 標註不一致 —— 這是漏標的訊號。

    「hanja 覆蓋率只有 26%」本身不是缺陷：詞庫裡大多數是固有語
    （꽃、돈、물、밥、옷、집）與外來語，本來就沒有漢字詞源，硬標是編造。
    分母錯了，那個百分比永遠看起來像有一大筆待辦。

    真正抓得到問題的是「同類詞不一致」：日期 31 條裡只有 6 條標了漢字，
    其餘 25 條空著 —— 同一類詞不可能有的有詞源有的沒有，那就是漏標。
    只在該標籤過半已標時才報，否則整組沒標（例如「固有語」標籤）會被誤判。
    """
    # note 已寫明不是漢字詞的先排除 —— 固有語、外來語、專名、網路縮語
    # 本來就沒有詞源，把它們算成「漏標」會讓這條檢查整片誤報，
    # 而誤報整片就等於沒有檢查。
    non_sino = re.compile(r"固有語|外來語|외래어|源自日語|國名|人名|縮語|"
                          r"沒有漢字|不標漢字|純韓語|詞源有爭議")

    by_tag = defaultdict(list)
    for x in items:
        if x["item_type"] == "sentence" or non_sino.search(x.get("note") or ""):
            continue
        for t in x.get("tags") or []:
            by_tag[t].append(x)

    bad = []
    for tag, rows in sorted(by_tag.items()):
        if len(rows) < 4:
            continue
        have = [r for r in rows if r.get("hanja")]
        if not (len(rows) * 0.6 <= len(have) < len(rows)):
            continue          # 沒過半＝這組本來就多半不是漢字詞，不報
        missing = [r["ko"] for r in rows if not r.get("hanja")]
        bad.append(f"{tag}：{len(have)}/{len(rows)} 已標，缺 " + "、".join(missing[:8])
                   + (f" …另 {len(missing)-8} 條" if len(missing) > 8 else ""))
    issue("warn", "同標籤內 hanja 標註不一致（漏標的訊號）", bad,
          "同一類詞不會有的有詞源有的沒有。"
          "★ 這條只抓得到「幾乎標完、漏了零星幾個」——"
          "日期原本 6/31 已標（19%），低於門檻，是人工翻出來的，不是它抓到的。")


def check_note_hanja(items):
    """
    note 裡寫的漢字要與 hanja 欄一致。

    note 常寫「漢字是「便宜店」而非便利店」，而 hanja 欄另存一份同樣的資訊。
    同一件事存在兩個地方就會漂移 —— 改了一邊忘了另一邊，
    學生看到兩種說法不知道信哪個。這個檢查把兩邊釘在一起。

    只比對 note 裡第一組「漢字」引號內的字串，且僅在 hanja 欄有值時比。
    hanja 欄允許混合形態（工夫하다、熱情pay），比對前先去掉韓文與拉丁字母。
    """
    bad = []
    for x in items:
        note, hanja = x.get("note") or "", x.get("hanja") or ""
        if not hanja:
            continue
        m = re.search(r"漢字[^「]*「([^」]+)」", note)
        if not m:
            continue
        said = m.group(1)
        # 兩邊都只留漢字再比
        norm = lambda t: "".join(c for c in t if "一" <= c <= "鿿")
        if norm(said) != norm(hanja):
            bad.append(f"{x['ko']}: note 說「{said}」，hanja 欄是「{hanja}」")
    issue("error", "note 與 hanja 欄說法不一致", bad,
          "同一件事存在兩處必然漂移，學生會不知道信哪個。")


def check_completeness(items, decks):
    """
    完整度只對「該有這個欄位的條目」計算。

    以前 pos 的分母是全部條目，於是 271 條句子被算成「缺詞性」——
    但句子沒有詞性，那不是缺，是不適用。分母放錯會讓這個數字
    永遠停在偏低，看起來像有一大筆待辦，實際上沒有。

    example_ko 同理：句子本身就是例句，不需要再附一句。
    """
    # 欄位 → 哪些條目該有它。None = 全部都該有。
    APPLIES = {
        "romanization": None,
        # hanja 不列入完整度：分母無法定義。
        # 詞庫大多數是固有語與外來語，本來就沒有漢字詞源，硬標是編造。
        # 用全部條目當分母算出的 26%，看起來像有一大筆待辦，其實沒有 ——
        # 那個數字唯一的作用是誤導。改由 check_hanja_consistency 從
        # 「同類詞不一致」的角度找漏標，並在下面單獨報三分法。
        "pos":          lambda x: x["item_type"] != "sentence",
        "example_ko":   lambda x: x["item_type"] != "sentence",
        "note":         None,
    }
    by_deck = defaultdict(list)
    for x in items:
        by_deck[x["deck"]].append(x)
    lines = []
    for deck, rows in sorted(by_deck.items()):
        parts = []
        for f, applies in APPLIES.items():
            scope = [x for x in rows if applies(x)] if applies else rows
            if not scope:
                continue
            n = sum(1 for x in scope if x.get(f))
            mark = "" if applies is None else f"/{len(scope)}"
            parts.append(f"{f} {n*100//len(scope)}%{mark}")
        lines.append(f"{deck}（{len(rows)} 條）  " + " · ".join(parts))
    issue("info", "欄位完整度", lines,
          "pos 與 example_ko 的分母已排除句子 —— 句子沒有詞性，本身就是例句。")

    # hanja 單獨用三分法報，不算百分比
    non_sino = re.compile(r"固有語|外來語|외래어|源自日語|國名|人名|縮語|"
                          r"沒有漢字|不標漢字|純韓語|詞源有爭議")
    words = [x for x in items if x["item_type"] != "sentence"]
    marked = sum(1 for x in words if x.get("hanja"))
    known_native = sum(1 for x in words if not x.get("hanja")
                       and non_sino.search(x.get("note") or ""))
    unknown = len(words) - marked - known_native
    issue("info", "漢字詞源標註（不算百分比，因為分母無法定義）",
          [f"已標漢字 {marked} 條 · 已註明非漢字詞 {known_native} 條 · 未判定 {unknown} 條"],
          "未判定的多半也是固有語，只是 note 沒寫明；要讓這個數字有意義，"
          "得逐條標記詞源，而不是把百分比衝高。")


# =====================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet-info", action="store_true", help="只顯示 error 與 warn")
    args = ap.parse_args()

    url, key = load_env()
    raw = fetch_all(url, key, "items",
                    "id,slug,ko,zh,romanization,hanja,pos,item_type,example_ko,example_zh,note,tags,deck_id,is_active")
    decks = {d["id"]: d["slug"] for d in rest(url, key, "GET", "decks?select=id,slug")}
    items = [{**x, "deck": decks.get(x["deck_id"], "?")} for x in raw if x["is_active"]]

    print(f"稽核 {len(items)} 條（{len(decks)} 個詞庫）\n")

    check_duplicates(items)
    check_hanja(items)
    check_romanization(items)
    check_type(items)
    check_simplified(items)
    check_same_meaning(items)
    check_examples(items)
    check_note_hanja(items)
    check_hanja_consistency(items)
    check_tags(items)
    check_counter_sync(url, key)
    check_completeness(items, decks)

    icon = {"error": "❌", "warn": "⚠️ ", "info": "ℹ️ "}
    n_err = n_warn = 0
    for it in ISSUES:
        if not it["rows"]:
            if it["level"] != "info":
                print(f"  ✅ {it['title']}")
            continue
        if it["level"] == "error":
            n_err += len(it["rows"])
        elif it["level"] == "warn":
            n_warn += len(it["rows"])
        if args.quiet_info and it["level"] == "info":
            continue
        print(f"\n{icon[it['level']]} {it['title']}（{len(it['rows'])}）")
        for r in it["rows"][:20]:
            print(f"     {r}")
        if len(it["rows"]) > 20:
            print(f"     …另有 {len(it['rows'])-20} 項")
        if it["hint"]:
            print(f"     → {it['hint']}")

    print(f"\n{'='*60}")
    print(f"error {n_err} 項 · warn {n_warn} 項")
    sys.exit(1 if n_err else 0)


if __name__ == "__main__":
    main()
