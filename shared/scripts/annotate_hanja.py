#!/usr/bin/env python3
"""
標註漢字詞 —— 韓語約 60% 詞彙源自漢字，這是中文母語者的最大紅利。

為什麼值得單獨做這件事：
  百詞斬教英語詞根詞綴，那對中文母語者是「外來知識」，要重新學。
  但韓語的漢字詞你天生就懂一半 —— 知道 학교=學校、학생=學生
  共享 학(學)，就能一次帶出 학년(學年)、대학(大學)、유학(留學)…
  這是韓語學習產品該有的獨門優勢，英語產品做不到。

原則：
  * 只標有把握的。拿不準的留空 —— 錯的詞源比沒有詞源更糟，
    會讓人建立錯誤的聯想，之後很難糾正。
  * 固有語（순우리말）與外來語一律留空，不硬湊。
  * 漢字用正體，與站上的繁體中文一致。

用法：
    python3 scripts/annotate_hanja.py            # dry-run
    python3 scripts/annotate_hanja.py --apply
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_ctx import SITE, SITE_DIR, load_env  # noqa: E402

# ROOT 現在指「這一站的目錄」而不是倉庫根 —— data/、backups/ 都在站台底下
ROOT = SITE_DIR

# 韓文 → 漢字詞寫法。逐條核對過，沒把握的不列。
HANJA = {
    # 國家 · 語言
    "한국": "韓國", "대만": "臺灣", "중국": "中國", "일본": "日本",
    # 身分
    "학생": "學生", "선생님": "先生님", "회사원": "會社員", "친구": "親舊",
    # 時間
    "내일": "來日", "지금": "只今", "점심": "點心", "주말": "週末", "시간": "時間",
    # 家庭
    "가족": "家族", "동생": "同生",
    # 飲食
    "차": "茶", "맥주": "麥酒", "음식": "飮食", "식당": "食堂",
    # 購物 · 金錢
    "시장": "市場", "백화점": "百貨店", "편의점": "便宜店", "현금": "現金",
    # 場所 · 交通
    "학교": "學校", "회사": "會社", "병원": "病院", "은행": "銀行",
    "역": "驛", "공항": "空港", "화장실": "化粧室", "지하철": "地下鐵",
    # 狀態 · 動作
    "행복하다": "幸福하다", "피곤하다": "疲困하다", "공부하다": "工夫하다",
    # 詞組 · 句子裡的漢字詞
    "안녕하세요": "安寧하세요",
    "안녕히 가세요": "安寧히 가세요",
    "안녕히 계세요": "安寧히 계세요",
    "안녕히 주무세요": "安寧히 주무세요",
    "감사합니다": "感謝합니다",
    "죄송합니다": "罪悚합니다",
    "실례합니다": "失禮합니다",
    "계산해 주세요": "計算해 주세요",
    "잘 부탁드립니다": "잘 付託드립니다",
    "수고하셨습니다": "受苦하셨습니다",
}

# ★ 刻意不標句子。
#   hanja 這欄是「這個詞的漢字詞源」，不是「把整句改寫成漢字」（那是
#   國漢文混用，另一回事）。若給句子也標，同源詞串聯會被污染 ——
#   查 韓 會串出「한국어를 배우고 있어요.」，但那不是同源詞，
#   只是句子裡剛好含這個詞。

# 明確標記為「非漢字詞」，避免日後有人以為只是漏標
KNOWN_NATIVE = {
    "사람", "이름", "나이", "오늘", "어제", "아침", "저녁", "밤", "밥", "물",
    "고기", "김치", "비빔밥", "불고기", "돈", "가게", "집", "날씨", "비", "눈",
    "바람", "여기", "거기", "저기", "앞", "뒤", "옆", "안", "밖", "위", "아래",
}
KNOWN_LOAN = {"커피", "빵", "라면", "메뉴", "카드", "버스", "택시"}



def rest(url, key, method, path, payload=None, params=""):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}{params}", method=method,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read().decode("utf-8")
            return json.loads(b) if b else []
    except urllib.error.HTTPError as e:
        sys.exit(f"❌ {method} {path} -> {e.code}\n{e.read().decode('utf-8','replace')[:400]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    url, key = load_env()
    items = rest(url, key, "GET", "items", None, "?select=id,ko,zh,hanja&limit=1000")

    hit, miss = [], []
    for it in items:
        h = HANJA.get(it["ko"])
        if h:
            hit.append((it, h))
        elif it["ko"] not in KNOWN_NATIVE and it["ko"] not in KNOWN_LOAN:
            miss.append(it)

    print(f"條目總數      : {len(items)}")
    print(f"可標漢字詞    : {len(hit)}")
    print(f"已知固有語    : {len(KNOWN_NATIVE)}（明確不標）")
    print(f"已知外來語    : {len(KNOWN_LOAN)}（明確不標）")
    print(f"未分類（留空）: {len(miss)}")

    print("\n漢字詞樣本：")
    for it, h in hit[:12]:
        print(f"  {it['ko']:<12s} {h:<14s} {it['zh']}")

    # 共享漢字的詞群 —— 這才是漢字詞的真正價值
    from collections import defaultdict
    by_char = defaultdict(list)
    for it, h in hit:
        for c in h:
            if "一" <= c <= "鿿":
                by_char[c].append(it["ko"])
    groups = {c: v for c, v in by_char.items() if len(set(v)) > 1}
    print(f"\n可串聯的漢字：{len(groups)} 個")
    for c, v in sorted(groups.items(), key=lambda x: -len(x[1]))[:8]:
        print(f"  {c} → {' · '.join(sorted(set(v)))}")

    if not args.apply:
        print("\n🔎 dry-run：沒有寫入。確認無誤後加 --apply。")
        return

    for it, h in hit:
        rest(url, key, "PATCH", "items", {"hanja": h}, f"?id=eq.{it['id']}")

    # 回讀核對，不靠斷言
    after = rest(url, key, "GET", "items", None, "?select=ko,hanja&hanja=not.is.null&limit=1000")
    print(f"\n✅ 已標註 {len(hit)} 條（回讀確認 {len(after)} 條有 hanja）")
    if len(after) != len(hit):
        print(f"⚠️ 筆數不符，請檢查")


if __name__ == "__main__":
    main()
