#!/usr/bin/env python3
"""
把貼上的原始詞表整理成待加工的 CSV 骨架。

    pbpaste | python3 scripts/prep_paste.py --out data/vocab/vocab_batch_24.csv
    python3 scripts/prep_paste.py --in raw/paste.txt --out data/vocab/vocab_batch_24.csv

為什麼要這一步：
  原始貼上的內容只有「韓文 + 中文」兩欄，而入庫需要羅馬音、類型、詞性、
  漢字、備註、標籤。這裡把「機械可推導的」全部自動填好 ——
  分隔符、表頭、簡繁、類型判定、多行條目合併、對話說話人剝離、
  重複偵測、羅馬音初稿 —— 剩下需要判斷的（漢字詞源、語感備註、標籤）
  留空給人補。

  這樣人只需要做判斷題，不必再逐條抄格式；也避免了先前手動處理時
  漏掉某欄、或把對話的「A：」寫進卡片正面這類失誤。

★ 自動產生的羅馬音是「初稿」，一定要人眼複查再入庫：
  韓語有連音、硬音化、ㅎ 脫落等音變，規則轉寫無法全對。
"""

import argparse
import csv
import io
import re
import sys

# --- 諺文分解表（用於規則轉寫）------------------------------------
CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj",
       "ch", "k", "t", "p", "h"]
JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe",
        "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"]
# 終聲讀音。注意 ㄺ(9) 在子音前讀 k（읽다＝ikda），不是 l；
# ㄻ(10) 讀 m、ㄿ(14) 讀 p —— 複合終聲取哪個子音各不相同。
JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p",
        "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"]

HANGUL_RE = re.compile(r"[가-힣]")
SPEAKER_RE = re.compile(r"^\s*[A-Za-z][:：]\s*")
PAREN_RE = re.compile(r"^\s*[（(](.+)[）)]\s*$")


# 終聲移到下一音節當初聲時的讀音（連音）。
# 這是最常見也最顯眼的音變：물을 若不處理會轉成 "muleul"，正確是 "mureul"。
LIAISON = {1: "g", 2: "kk", 4: "n", 7: "d", 8: "r", 16: "m", 17: "b",
           19: "s", 20: "ss", 22: "j", 23: "ch", 24: "k", 25: "t", 26: "p"}

# 複合終聲後接母音時會「拆開」：前一個子音留下，後一個移到下個音節。
#   넓어요 → 널버요（neolbeoyo），不是 neoleoyo
#   읽어요 → 일거요（ilgeoyo）
# (終聲索引) → (留下的音, 移過去的音)
CLUSTER_LIAISON = {
    3: ("k", "s"), 5: ("n", "j"), 9: ("l", "g"), 10: ("l", "m"),
    11: ("l", "b"), 12: ("l", "s"), 13: ("l", "t"), 14: ("l", "p"),
    18: ("p", "s"),
    # ㄶ 與 ㅀ 特殊：遇母音時 ㅎ 脫落，前一個子音整個移到下一音節當初聲，
    # 前面不留音。많아요＝[마나요]、싫어요＝[시러요]（不是 sileoyo）。
    6: ("", "n"), 15: ("", "r"),
}

# 激音化：終聲帶 ㅎ（ㅎ/ㄶ/ㅀ）後接 ㄱ/ㄷ/ㅈ 時，下一個初聲送氣。
# 좋다→jota、많다→manta、싫다→silta、어떻게→eotteoke 都是這條。
# 規則明確、不需詞彙知識，是少數能安全自動化的音變。
H_FINALS = {6: "n", 15: "l", 27: ""}          # ㄶ→n殘留、ㅀ→l殘留、ㅎ→無
ASPIRATE = {0: "k", 3: "t", 12: "ch"}          # 初聲 ㄱ/ㄷ/ㅈ 的索引 → 送氣音

# 鼻音化：終聲遇到後接的 ㄴ/ㅁ 時同化為同部位鼻音。
#   -습니다 → seumnida（不是 seupnida）、맛있는 → masinneun
#   這條與激音化一樣是純語音規則，不需要詞彙知識，可以安全自動化。
# (終聲索引集合) → 同化後的音
NASAL_K = {1, 2, 3, 9, 24}                    # ㄱ ㄲ ㄳ ㄺ ㅋ → ng
NASAL_T = {7, 19, 20, 22, 23, 25, 27}         # ㄷ ㅅ ㅆ ㅈ ㅊ ㅌ ㅎ → n
NASAL_P = {11, 14, 17, 18, 26}                # ㄼ ㄿ ㅂ ㅄ ㅍ → m
NASAL_ONSETS = {2, 6}                          # 後接 ㄴ / ㅁ

# 流音的鼻音化：ㅁ/ㅇ 之後的 ㄹ 讀作 ㄴ。음료수 → eumnyosu
LIQUID_TO_N = {16, 21}                         # 前面是 ㅁ / ㅇ

# 流音化（標準發音法第20項）：ㄴ 與 ㄹ 相鄰時一律同化為 ㄹㄹ。
#   ㄴ + ㄹ → 난로[날로] nallo、신라[실라] silla
#   ㄹ + ㄴ → 설날[설랄] seollal、일년[일련] illyeon
# 羅馬字表記法規定流音化要反映（신라 Silla、별내 Byeollae），
# 與硬音化（不反映）相反。

# ★ 刻意不做「逆向激音化」（終聲 ㄱ/ㄷ/ㅂ + 初聲 ㅎ → 送氣）。
#
#   羅馬字法規定：體言（名詞）中 ㄱ/ㄷ/ㅂ 後接 ㅎ 要保留 ㅎ ——
#   백화점 baekhwajeom、묵호 Mukho；只有動詞語幹接語尾時才合併 ——
#   좋고 joko。兩者機械上分不出來，需要詞性知識。
#
#   實測代價：加上這條規則後，백화점／행복하다／예습하다 三條反而錯了，
#   對既有資料的一致率從 96% 掉到 95%。少做比做錯好。
#   특히（teuki）這類仍需人工修正。


def romanize(text):
    """
    規則轉寫（修訂羅馬字近似）。

    有處理：連音（終聲後接無初聲音節時移過去）、ㅎ 終聲脫落。
    沒處理：硬音化、鼻音化、口蓋音化等其他音變 —— 需要詞彙與語法資訊
    才判斷得準，規則寫死反而會錯。所以這仍是初稿，入庫前要人眼複查。
    """
    # 先全部拆成 (初聲, 中聲, 終聲) 或原字元
    jamo = []
    for ch in text:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:
            i = code - 0xAC00
            jamo.append([i // 588, (i % 588) // 28, i % 28])
        else:
            jamo.append(ch)

    out = []
    for idx, j in enumerate(jamo):
        if isinstance(j, str):
            out.append(" " if j in " -" else (j.lower() if j.isalnum() else ""))
            continue
        cho, jung, jong = j
        nxt = jamo[idx + 1] if idx + 1 < len(jamo) else None

        onset = CHO[cho]
        if idx > 0 and isinstance(jamo[idx - 1], list):
            pj = jamo[idx - 1][2]
            if cho == 11 and pj in LIAISON:      # 本音節無初聲（ㅇ）且前面有終聲
                onset = LIAISON[pj]
            elif cho == 11 and pj in CLUSTER_LIAISON:
                onset = CLUSTER_LIAISON[pj][1]
            elif pj in H_FINALS and cho in ASPIRATE:
                onset = ASPIRATE[cho]            # 激音化
            elif pj == 8 and cho == 5:           # ㄹ + ㄹ → ll
                onset = "l"
            elif cho == 5 and pj in LIQUID_TO_N:  # ㅁ/ㅇ + ㄹ → ㄴ
                onset = "n"
            elif cho == 5 and pj == 4:           # ㄴ + ㄹ → ll（前面的 ㄴ 已改讀 l）
                onset = "l"
            elif cho == 2 and pj == 8:           # ㄹ + ㄴ → ll
                onset = "l"

        coda = ""
        if jong:
            if isinstance(nxt, list) and nxt[0] == 11 and jong in LIAISON:
                coda = ""                        # 終聲移到下一音節，這裡不寫
            elif isinstance(nxt, list) and nxt[0] == 11 and jong in CLUSTER_LIAISON:
                coda = CLUSTER_LIAISON[jong][0]  # 複合終聲拆開，前半留下
            elif jong in H_FINALS and isinstance(nxt, list) and nxt[0] in ASPIRATE:
                coda = H_FINALS[jong]            # 激音化：ㅎ 併入下一個初聲
            elif jong == 4 and isinstance(nxt, list) and nxt[0] == 5:
                coda = "l"                       # ㄴ + ㄹ：ㄴ 同化為 ㄹ
            elif isinstance(nxt, list) and nxt[0] in NASAL_ONSETS:
                # 鼻音化
                if jong in NASAL_K: coda = "ng"
                elif jong in NASAL_T: coda = "n"
                elif jong in NASAL_P: coda = "m"
                else: coda = JONG[jong]
            elif jong == 27:
                coda = ""                        # ㅎ 終聲基本不發音
            else:
                coda = JONG[jong]

        out.append(onset + JUNG[jung] + coda)

    return re.sub(r"\s+", " ", "".join(out)).strip()


def guess_type(ko):
    """無空白＝單字；1-2 空白＝詞組；更長或有句末標點＝句子"""
    if re.search(r"[.?!。？！]$", ko.strip()):
        return "句子"
    n = len(ko.split())
    if n == 1:
        return "單字"
    return "詞組" if n <= 2 else "句子"


def to_traditional(text):
    """
    簡轉繁只用字元級台灣變體（s2tw）。
    詞組級（s2twp）不看語境，會把「菜單→選單」（UI 選單）、
    「對象→物件」（程式物件）也換掉，錯得比對得多。
    """
    try:
        from opencc import OpenCC
    except ImportError:
        return text, False
    return OpenCC("s2tw").convert(text), True


def parse(raw):
    """
    處理原始貼上內容的各種形狀：
      * Tab 或多空格分隔
      * 可有可無的表頭（韓文/中文）
      * 條目跨兩行：第二行是括號說明（縮語的完整形）
      * 對話行帶「A：」「B：」說話人標記
      * 可有可無的第三欄說明（時態、語體、用法）→ 併入 note
    """
    lines = [l.rstrip() for l in raw.splitlines()]
    rows, pending = [], None
    conv_ok = True

    for line in lines:
        if not line.strip():
            continue
        # 表頭
        if re.match(r"^\s*(韓文|韩文|ko|Korean)\b", line, re.I):
            continue

        # 純括號行 → 併入上一條當作展開式
        m = PAREN_RE.match(line)
        if m and rows:
            rows[-1]["_expand"] = m.group(1).strip()
            continue

        parts = re.split(r"\t+|\s{2,}", line.strip())
        parts = [p.strip() for p in parts if p.strip()]
        if len(parts) < 2:
            # 只有韓文沒中文 → 可能是跨行條目的上半
            if HANGUL_RE.search(line):
                pending = line.strip()
            continue

        # 有些來源附第三欄說明（時態、語體、用法）—— 收進 note，別丟掉
        ko, zh = parts[0], parts[1]
        src_note = parts[2].strip() if len(parts) > 2 else ""
        if pending:
            ko, pending = pending + " " + ko, None

        speaker = ""
        sm = SPEAKER_RE.match(ko)
        if sm:
            speaker = sm.group(0).strip().rstrip(":：").strip()
            ko = SPEAKER_RE.sub("", ko)
            zh = SPEAKER_RE.sub("", zh)

        # 條目本身帶括號：兩種情況都要把括號從 ko 剝掉，
        #   韓文括號 → 是縮語的完整形，移進 note
        #   英文括號 → 是原文對照（Emoticon、air-conditioner），移進 note
        # 留在 ko 裡會讓卡片正面出現「이모티콘(Emoticon)」，等於送答案。
        inline = re.match(r"^(.+?)\s*[（(]([^)）]+)[）)]\s*$", ko)
        expand = ""
        if inline:
            ko, expand = inline.group(1).strip(), inline.group(2).strip()

        zh_t, ok = to_traditional(zh)
        conv_ok &= ok
        note_t, _ = to_traditional(src_note)
        rows.append({"ko": ko.strip(), "zh": zh_t, "_speaker": speaker,
                     "_expand": expand, "_note": note_t})

    return rows, conv_ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", help="輸入檔；不給則讀 stdin")
    ap.add_argument("--out", required=True, help="輸出 CSV")
    ap.add_argument("--deck", default="vocab-01")
    args = ap.parse_args()

    raw = open(args.src, encoding="utf-8").read() if args.src else sys.stdin.read()
    rows, conv_ok = parse(raw)
    if not rows:
        sys.exit("❌ 沒有解析出任何條目")

    seen = set()
    dups = []
    out = []
    for r in rows:
        if r["ko"] in seen:
            dups.append(r["ko"])
            continue
        seen.add(r["ko"])
        parts_note = []
        if r["_speaker"]:
            parts_note.append(f"對話 {r['_speaker']}")
        note = ""
        if r["_expand"]:
            # 韓文的是縮語展開；拉丁文的是外來語原文
            parts_note.append(f"完整形為 {r['_expand']}" if HANGUL_RE.search(r["_expand"])
                              else f"外來語 {r['_expand']}")
        if r.get("_note"):
            parts_note.append(r["_note"])
        note = "｜".join(parts_note)
        out.append({
            "ko": r["ko"], "zh": r["zh"],
            "romanization": romanize(r["ko"]),
            "hanja": "",                      # 需人工判斷，寧缺勿錯
            "type": guess_type(r["ko"]),
            "pos": "",
            "example_ko": "", "example_zh": "",
            "note": note,
            "tags": "",
        })

    fields = ["ko", "zh", "romanization", "hanja", "type", "pos",
              "example_ko", "example_zh", "note", "tags"]
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out)

    types = {}
    for r in out:
        types[r["type"]] = types.get(r["type"], 0) + 1
    print(f"✅ {args.out}")
    print(f"   {len(out)} 條  類型 {types}")
    if dups:
        print(f"   本批內重複已略過：{dups}")
    if not conv_ok:
        print("   ⚠️  未安裝 opencc，簡繁未轉換")
    speakers = sum(1 for r in rows if r["_speaker"])
    if speakers:
        print(f"   已剝離 {speakers} 個對話說話人標記（移入 note）")
    expands = sum(1 for r in rows if r["_expand"])
    if expands:
        print(f"   已收攏 {expands} 個括號展開式（移入 note）")
    print()
    print("   ⚠️  羅馬音是規則轉寫的初稿，未處理連音與硬音化，入庫前請人眼複查。")
    print("   待補欄位：hanja（只填有把握的）、pos、example、tags")


if __name__ == "__main__":
    main()
