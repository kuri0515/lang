#!/usr/bin/env python3
"""
補例句（example_ko / example_zh）。

    python3 scripts/fill_examples.py            # dry-run，含全部校驗
    python3 scripts/fill_examples.py --apply

【為什麼分批】
  非句子條目 705 條，缺例句 497 條。例句是內容創作，寫錯就是教錯，
  不適合一次灌完。每批逐條手寫、跑完校驗、線上看過，再進下一批。
  批次記在 BATCHES，補過的批次留著不刪 —— 這是台帳，不是暫存。

【校驗抓什麼】
  單句的韓語寫得對不對，只能靠人眼 —— 這支腳本不宣稱能驗那個。
  它守的是批量寫入特有的風險：「行錯位」，例句配到隔壁的詞上。
  那種錯人眼一條條掃很容易放行，機器反而抓得準。

  做法是比對詞與例句首音節的「初聲＋中聲」（丟掉終聲以容忍活用變形，
  빠르다 → 빨라요 的 빠 與 빨 相同）。

  這是批次層級的警報，不是逐條鐵證：
  韓語句子碰巧含到某個音節的機率不低，實測整批錯開一格時
  逐條命中率約 70–85%。也就是說單條漏放有可能，
  但整批錯位會同時噴出幾十條警告，不可能靜悄悄地通過。
  只比初聲的版本命中率僅三成，加上中聲後才夠用。
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CHO = list("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")


def onset(ch):
    """取韓文音節的初聲；非韓文回傳字元本身"""
    if not ("가" <= ch <= "힣"):
        return ch
    return CHO[(ord(ch) - 0xAC00) // 588]


def head(ch):
    """
    取音節的「初聲＋中聲」，丟掉終聲。

    只比初聲太弱：聲母只有 19 個，十來個音節的句子裡碰巧撞上很容易，
    實測整批錯開一格只抓得到三成。加上中聲後組合數近 400，命中率升到 70–85%。
    丟掉終聲是為了容忍活用變形：빠르다 → 빨라요，빠 與 빨 的初聲中聲相同。
    """
    if not ("가" <= ch <= "힣"):
        return ch
    i = ord(ch) - 0xAC00
    return chr(0xAC00 + (i // 588) * 588 + ((i % 588) // 28) * 28)


# ---------------------------------------------------------------------
# 第一批：動詞與形容詞。
# 這兩類最需要例句 —— 助詞搭配與活用形光看詞條學不到
# （뜨겁다 的 ㅂ 不規則要看到「뜨거워요」才知道長什麼樣）。
# ---------------------------------------------------------------------

BATCH_1 = {
    # ---- 동사 ----
    "깨지다":     ("컵이 깨졌어요.",                  "杯子破了。"),
    "나오다":     ("수도에서 물이 안 나와요.",          "水龍頭沒水出來。"),
    "다투다":     ("사소한 일로 친구와 다퉜어요.",       "為了小事跟朋友吵了一架。"),
    "닫히다":     ("바람에 문이 닫혔어요.",            "門被風關上了。"),
    "따르다":     ("회사 규칙을 따라야 해요.",          "必須遵守公司規定。"),
    "떠들다":     ("교실에서 떠들지 마세요.",           "請不要在教室裡喧鬧。"),
    "말하다":     ("조금만 천천히 말해 주세요.",        "請說慢一點。"),
    "묻히다":     ("보물이 땅속에 묻혀 있어요.",        "寶物埋在地底下。"),
    "비교하다":    ("두 가게의 가격을 비교해 봤어요.",     "比較了兩家店的價格。"),
    "빠지다":     ("명단에서 제 이름이 빠졌어요.",       "名單上漏掉了我的名字。"),
    "빼다":      ("십에서 삼을 빼면 칠이에요.",        "十減三等於七。"),
    "뿌리다":     ("화분에 물을 뿌렸어요.",            "給花盆噴了水。"),
    "사다":      ("시장에서 과일을 샀어요.",           "在市場買了水果。"),
    "시도하다":    ("새로운 방법을 시도해 봤어요.",       "嘗試了新的方法。"),
    "싸우다":     ("동생과 크게 싸웠어요.",            "跟弟弟大吵了一架。"),
    "쑤시다":     ("비가 오면 무릎이 쑤셔요.",          "一下雨膝蓋就痠痛。"),
    "쓰다":      ("친구에게 편지를 한 통 썼어요.",      "寫了一封信給朋友。"),
    "씹다":      ("제 메시지를 씹지 마세요.",          "別無視我的訊息。"),
    "아까워하다":   ("음식 버리는 걸 아까워해요.",        "覺得丟掉食物很可惜。"),
    "않다":      ("오늘은 별로 춥지 않아요.",          "今天不太冷。"),
    "알다":      ("그 사람을 잘 알아요.",             "我很瞭解那個人。"),
    "애정하다":    ("저는 이 가수를 정말 애정해요.",      "我超愛這個歌手。"),
    "얹다":      ("밥 위에 계란을 얹었어요.",          "在飯上放了顆蛋。"),
    "연기하다":    ("이번 드라마에서 의사를 연기했어요.",    "這部劇裡他演了醫生。"),
    "예습하다":    ("수업 전에 미리 예습했어요.",        "上課前先預習了。"),
    "원망하다":    ("저는 아무도 원망하지 않아요.",       "我不埋怨任何人。"),
    "읊다":      ("시를 한 편 읊었어요.",             "吟誦了一首詩。"),
    "읊조리다":    ("혼자 노래를 읊조렸어요.",          "一個人低聲哼著歌。"),
    "의지하다":    ("저는 언니에게 많이 의지해요.",       "我很依賴姐姐。"),
    "일어나다":    ("매일 일곱 시에 일어나요.",         "每天七點起床。"),
    "일하다":     ("저는 은행에서 일해요.",            "我在銀行工作。"),
    "읽씹당하다":   ("어제 보낸 문자가 읽씹당했어요.",     "昨天發的訊息被已讀不回。"),
    "읽씹하다":    ("바빠서 그만 읽씹했어요.",          "因為太忙就已讀不回了。"),
    "자다":      ("어젯밤에는 일찍 잤어요.",           "昨晚很早就睡了。"),
    "조사하다":    ("경찰이 사건을 조사하고 있어요.",     "警察正在調查案件。"),
    "체하다":     ("급하게 먹어서 체했어요.",          "吃太急結果消化不良。"),
    "투표하다":    ("내일 투표하러 가요.",             "明天要去投票。"),
    "패하다":     ("우리 팀이 결승에서 패했어요.",       "我們隊在決賽落敗。"),
    "핥다":      ("고양이가 앞발을 핥아요.",           "貓在舔前腳。"),
    "흩다":      ("바람이 낙엽을 흩어 놓았어요.",       "風把落葉吹散了。"),

    # ---- 형용사 ----
    "넓다":      ("이 방은 생각보다 넓어요.",          "這個房間比想像中寬敞。"),
    "느리다":     ("인터넷이 너무 느려요.",            "網路太慢了。"),
    "늙다":      ("할아버지가 많이 늙으셨어요.",        "爺爺老了許多。"),
    "따뜻하다":    ("오늘은 날씨가 따뜻해요.",          "今天天氣很溫暖。"),
    "따사하다":    ("봄 햇살이 따사해요.",             "春天的陽光很和煦。"),
    "뜨겁다":     ("국이 아직 뜨거워요.",             "湯還很燙。"),
    "맛없다":     ("이 빵은 좀 맛없어요.",            "這個麵包有點不好吃。"),
    "멋있다":     ("저 배우 정말 멋있어요.",           "那個演員真帥。"),
    "빠르다":     ("지하철이 버스보다 빨라요.",         "地鐵比公車快。"),
    "쉽다":      ("이번 문제는 쉬웠어요.",            "這次的題目很容易。"),
    "슬프다":     ("그 영화는 너무 슬퍼요.",           "那部電影太令人傷心了。"),
    "시끄럽다":    ("공사 때문에 밖이 시끄러워요.",       "因為施工，外面很吵。"),
    "시원하다":    ("바람이 아주 시원해요.",            "風很涼爽。"),
    "싫다":      ("저는 매운 음식이 싫어요.",          "我討厭辣的食物。"),
    "예쁘다":     ("이 옷이 정말 예뻐요.",            "這件衣服真漂亮。"),
    "옳다":      ("네 생각이 옳아요.",               "你的想法是對的。"),
    "우아하다":    ("그분은 몸짓이 우아해요.",          "那位的舉止很優雅。"),
    "작다":      ("신발이 조금 작아요.",              "鞋子有點小。"),
    "재미없다":    ("이 드라마는 재미없어요.",          "這部劇很無聊。"),
    "적다":      ("이번 달은 월급이 적어요.",          "這個月薪水很少。"),
    "젊다":      ("사장님은 아직 젊어요.",             "老闆還很年輕。"),
    "짧다":      ("머리를 짧게 잘랐어요.",            "把頭髮剪短了。"),
    "행복하다":    ("저는 지금 아주 행복해요.",         "我現在很幸福。"),
    "허하다":     ("아침을 걸러서 속이 허해요.",        "沒吃早餐，肚子空空的。"),
}

BATCHES = {"1｜동사·형용사": BATCH_1}


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
                   "items?select=id,ko,zh,pos,item_type,example_ko,example_zh"
                   f"&is_active=eq.true&offset={len(rows)}&limit=1000")
        rows += page
        if len(page) < 1000:
            return rows


# 活用時連中聲都會變的詞，錯位偵測對它們無效，逐個列出並註明原因。
# 白名單只能因「檢查本身判不了」而放行，不能因為「改起來麻煩」。
IRREGULAR_HEAD = {
    "쓰다": "으 脫落：쓰 → 썼（中聲由 ㅡ 變 ㅕ），首音節比對不到",
}


def validate(pairs):
    """pairs = [(ko, ex_ko, ex_zh)]。回傳問題清單。"""
    problems = []

    for ko, ex_ko, ex_zh in pairs:
        # ① 錯位偵測：詞與例句首音節的初聲＋中聲要對得上。
        #    活用會變形（빠르다→빨라요），所以丟掉終聲再比。
        if ko not in IRREGULAR_HEAD:
            want = head(ko[0])
            if want not in [head(c) for c in ex_ko]:
                problems.append(f"錯位？ {ko} 的首音節 {want} 沒出現在例句「{ex_ko}」")

        # ② 例句要是韓文，不能混進中文（貼錯欄位的典型症狀）
        if any("一" <= c <= "鿿" for c in ex_ko):
            problems.append(f"例句混入漢字：{ko} → {ex_ko}")

        # ③ 譯文不能混進韓文（同上，反向）
        if any("가" <= c <= "힣" for c in ex_zh):
            problems.append(f"譯文混入韓文：{ko} → {ex_zh}")

        # ④ 譯文必須是正體中文
        try:
            from opencc import OpenCC
            conv = OpenCC("s2tw").convert(ex_zh)
            OK = {("里", "裡"), ("注", "註"), ("泄", "洩"), ("布", "佈"),
                  ("才", "纔"), ("娘", "孃"), ("家", "傢"), ("具", "俱")}
            diff = [(a, b) for a, b in zip(ex_zh, conv) if a != b]
            if diff and not all(p in OK for p in diff):
                problems.append(f"疑似簡體：{ko} → {ex_zh}  建議 {conv}")
        except ImportError:
            pass

        # ⑤ 例句要是完整句子，有句末標點
        if not ex_ko.endswith((".", "?", "!")):
            problems.append(f"例句缺句末標點：{ko} → {ex_ko}")

    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--batch", default=None, help="只處理某一批（預設全部）")
    args = ap.parse_args()

    url, key = load_env()
    items = fetch_items(url, key)
    by_ko = {}
    for r in items:
        by_ko.setdefault(r["ko"], []).append(r)

    nonsent = [r for r in items if r["item_type"] != "sentence"]
    miss = [r for r in nonsent if not r.get("example_ko")]
    print(f"非句子 {len(nonsent)} 條，缺例句 {len(miss)} 條\n")

    todo = {}
    for name, batch in BATCHES.items():
        if args.batch and args.batch not in name:
            continue
        todo.update(batch)

    unknown = [ko for ko in todo if ko not in by_ko]
    if unknown:
        sys.exit(f"❌ 這些詞不在資料庫（打錯字？）：{unknown}")

    pairs = [(ko, v[0], v[1]) for ko, v in todo.items()]
    problems = validate(pairs)
    print("校驗：")
    if problems:
        for p in problems:
            print(f"  ❌ {p}")
        sys.exit(f"\n共 {len(problems)} 個問題，先修好再寫。")
    print(f"  ✅ 錯位偵測（首音節比對）{len(pairs)} 條全數對上")
    print("  ✅ 例句無漢字混入 · 譯文無韓文混入 · 譯文皆正體")

    # 一個詞可能有多筆（跨詞庫重複），全部一起補
    targets = [(r, todo[r["ko"]]) for r in nonsent if r["ko"] in todo]
    print(f"\n將寫入 {len(targets)} 筆（{len(todo)} 個詞，含跨詞庫重複）\n")
    for r, (ek, ez) in sorted(targets, key=lambda t: t[0]["ko"])[:8]:
        print(f"  {r['ko']:12s} {ek}   {ez}")
    print(f"  …共 {len(targets)} 筆")

    if not args.apply:
        print("\n🔎 dry-run：什麼都沒寫。加 --apply 生效。")
        return

    for r, (ek, ez) in targets:
        req(url, key, "PATCH", f"items?id=eq.{r['id']}",
            {"example_ko": ek, "example_zh": ez})

    after = {x["id"]: x for x in fetch_items(url, key)}
    bad = [r["ko"] for r, (ek, ez) in targets
           if (after[r["id"]].get("example_ko"), after[r["id"]].get("example_zh")) != (ek, ez)]
    if bad:
        sys.exit(f"❌ {len(bad)} 筆回讀不符：{bad}")
    still = sum(1 for x in after.values()
                if x["item_type"] != "sentence" and not x.get("example_ko"))
    print(f"✅ {len(targets)} 筆全部回讀相符")
    print(f"✅ 非句子條目仍缺例句：{still} 條")


if __name__ == "__main__":
    main()
