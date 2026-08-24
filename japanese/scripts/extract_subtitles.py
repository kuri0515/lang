#!/usr/bin/env python3
# =====================================================================
# 從雙語 ASS 字幕抽出精讀素材
#
# 【輸入】喵萌版 .ass（TC 版本），一集裡：
#   Dial-JP / Dial-JP2 是日文，Dial-CH / Dial-CH2 是繁中，
#   兩者用**完全相同的時間碼**成對出現（實測第 1 集 479 對，零缺漏）。
#
# 【輸出】japanese/raw/<work>/<ep>.json —— 只留在本機，不進版控。
#   原始字幕與完整台詞都屬於別人的著作，這個專案要的是
#   「從裡面長出來的學習素材」，不是字幕本身。
#
# 【為什麼要自己生注音】
#   這份字幕幾乎沒有 Ruby（第 1 集 479 行裡只有 7 行），
#   而含漢字的日文行有 369 行 —— 初學者看不了。
#   用 Sudachi 斷詞取讀音，再把讀音**只對齊到漢字**上：
#   「読んで」要標成 読[よ]んで，不能標成 読んで[よんで]，
#   否則送り仮名會被當成漢字的一部分，學習者會記錯讀音。
#
# 【為什麼一幕一幕切】
#   一集 479 行，攤成一份清單沒有人讀得完，也沒有「今天讀到哪」的單位。
#   照時間空檔切幕：畫面切換時對白會停頓，那個停頓就是天然的段落線。
#
#     python3 japanese/scripts/extract_subtitles.py <字幕檔> --work spy --ep S1E01
# =====================================================================
import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

TAG = re.compile(r"\{[^}]*\}")
KANJI = re.compile(r"[㐀-䶿一-鿿\U00020000-\U0002ebef々〆ヶ]")
# 注音要標在「漢字或數字」上。
# ★ 數字也要算：「1人暮らし」讀 ひとりぐらし，而「1」讀作 ひと ——
#   只把漢字當錨點的話，詞首那個數字分不到讀音，整詞退回
#   1人暮らし[ひとりぐらし]，送り仮名被算進讀音裡。
#   這是注音閘門實際攔下來的（第 2 集）。
ANNOT = re.compile(r"[㐀-䶿一-鿿\U00020000-\U0002ebef々〆ヶ0-9０-９]")
HIRA = re.compile(r"[ぁ-ゖー]")
KATA = re.compile(r"[ァ-ヺ]")

# 幕與幕之間的停頓門檻（秒）。低於它算同一幕。
#
# ★ 這個數字是**量出來的，不是猜的**。第 1 集的行間空檔中位數只有 0.61 秒，
#   所以一開始設的 4 秒幾乎不會觸發 —— 45 幕裡有 22 幕正好卡在行數上限，
#   也就是說「照畫面停頓切幕」根本沒有發生，切出來的是等長的塊。
#   實測：>1.0s 得 122 幕（太碎）、>2.0s 得 56 幕（平均 8.6 行）、
#   >4.0s 得 24 幕（平均 20 行，一次讀不完）。
#   2 秒落在「一次能讀完，又還是一段完整對話」的區間。
SCENE_GAP = 2.0
# 一幕最多幾行。長鏡頭獨白會讓某一幕特別長，硬切比讓人面對 40 行好。
# 這是**保險**不是主要機制：靠它切出來的幕應該是少數，
# 多數要來自真實停頓 —— 所以下面會印出硬切的比例，比例一高就代表門檻又錯了。
SCENE_MAX = 12


def t2s(t):
    """ASS 時間碼 → 秒"""
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def kata2hira(s):
    out = []
    for ch in s:
        o = ord(ch)
        out.append(chr(o - 0x60) if 0x30A1 <= o <= 0x30F6 else ch)
    return "".join(out)


def ruby_for(surface, reading):
    """
    把整詞讀音對齊到漢字上，回傳 [(片段, 讀音或 None)]。

    做法：把表層切成「漢字段／假名段」，用假名段當錨點在讀音裡定位 ——
    假名段在讀音裡長什麼樣就是什麼樣，夾在中間的就是漢字的讀音。

    對不齊時回傳整詞一個注音（保守），而不是硬猜：
    猜錯的注音比沒有注音更糟，學習者沒有辦法察覺它是錯的。
    """
    if not reading or not ANNOT.search(surface):
        return [(surface, None)]
    reading = kata2hira(reading)
    # 切成交替的段：漢字段與假名段
    parts, buf, buf_is_kanji = [], "", None
    for ch in surface:
        is_k = bool(ANNOT.match(ch))
        if buf and is_k != buf_is_kanji:
            parts.append((buf, buf_is_kanji))
            buf = ""
        buf, buf_is_kanji = buf + ch, is_k
    if buf:
        parts.append((buf, buf_is_kanji))

    out, pos = [], 0
    for i, (seg, is_k) in enumerate(parts):
        if not is_k:
            seg_h = kata2hira(seg)
            # ★ 前面若有還沒分到讀音的漢字段，錨點必須從 pos+1 開始找 ——
            #   漢字至少要吃掉一個字。
            #   從 pos 找的話：「奪う」的讀音是「うばう」，
            #   送り仮名「う」會命中**開頭**那個う，於是「奪」分不到讀音，
            #   整詞退回 奪う[うばう] —— 送り仮名被算進讀音裡。
            #   同類：最も[もっとも]、謡う[うたう]、命拾い[いのちびろい]。
            pending = bool(out) and out[-1][1] is None and ANNOT.search(out[-1][0])
            start = pos + 1 if pending else pos
            # ★ 詞尾的假名要從**右邊**找。
            #   「見失う」讀 みうしなう，送り仮名「う」從左邊找會命中 index 1，
            #   於是「見失」只分到「み」，剩下的「しなう」對不齊 → 整詞退回
            #   見失う[みうしなう]，送り仮名被算進讀音裡。
            #   從右邊找會命中最後那個 う，得到 見失[みうしな]う。
            #   （更細的 見[み]失[うしな]う 需要逐字對照表，這裡不猜 ——
            #     猜錯的注音比粗一點的注音更糟。）
            is_last = (i == len(parts) - 1)
            at = reading.rfind(seg_h) if is_last else reading.find(seg_h, start)
            if is_last and at < start:
                at = reading.find(seg_h, start)
            if at < 0:
                return [(surface, reading)]      # 對不齊，保守處理
            if at > pos:                          # 中間那段是前一個漢字段的讀音
                if out and out[-1][1] is None and ANNOT.search(out[-1][0]):
                    out[-1] = (out[-1][0], reading[pos:at])
                else:
                    return [(surface, reading)]
            out.append((seg, None))
            pos = at + len(seg_h)
        else:
            out.append((seg, None))               # 讀音稍後由下一個假名段回填
            if i == len(parts) - 1:               # 結尾就是漢字，剩下全給它
                out[-1] = (seg, reading[pos:])
                pos = len(reading)
    if pos != len(reading):
        return [(surface, reading)]
    if any(ANNOT.search(s) and r is None for s, r in out):
        return [(surface, reading)]
    return out


def ruby_text(segs):
    """[(片段, 讀音)] → 站上既有的注音字串格式：漢字[かんじ]"""
    return "".join(f"{s}[{r}]" if r else s for s, r in segs)


def parse_ass(path):
    """回傳依時間排序的 [(start, end, 日文, 中文)]"""
    text = Path(path).read_text(encoding="utf-8-sig", errors="replace")
    jp, ch = {}, {}
    for line in text.splitlines():
        if not line.startswith("Dialogue:"):
            continue
        f = line.split(",", 9)
        if len(f) < 10:
            continue
        start, end, style, body = f[1], f[2], f[3], TAG.sub("", f[9]).strip()
        body = body.replace(r"\N", " ").replace(r"\n", " ").strip()
        if not body:
            continue
        key = (start, end)
        if style.startswith("Dial-JP"):
            jp[key] = (jp.get(key, ("", ))[0] + " " + body).strip() if key in jp else body
        elif style.startswith("Dial-CH"):
            ch[key] = (ch.get(key, ("", ))[0] + " " + body).strip() if key in ch else body
    rows = []
    for key in sorted(jp, key=lambda k: t2s(k[0])):
        if key in ch:
            rows.append((t2s(key[0]), t2s(key[1]), jp[key], ch[key]))
    return rows, len(jp), len(ch)


def split_scenes(rows):
    """照停頓切幕；太長的幕硬切，不讓任何一幕超過 SCENE_MAX 行"""
    scenes, cur = [], []
    for i, r in enumerate(rows):
        if cur and (r[0] - rows[i - 1][1] > SCENE_GAP or len(cur) >= SCENE_MAX):
            scenes.append(cur)
            cur = []
        cur.append(r)
    if cur:
        scenes.append(cur)
    return scenes


# 這些詞性不是「要背的詞」——助詞、助動詞、標點、補助動詞。
# 它們該在句子裡學（那是語法），不該變成單字卡。
SKIP_POS = {"助詞", "助動詞", "補助記号", "記号", "空白", "接尾辞", "代名詞"}
# 專有名詞另外標記：人名地名要認得，但不該混進一般詞彙的頻率統計裡
PROPER = "固有名詞"


_LEMMA_READING = {}


def lemma_reading(lemma, tokenizer, split_mode):
    """原形的讀音。快取起來 —— 同一個詞會被問很多次"""
    if lemma not in _LEMMA_READING:
        toks = tokenizer.tokenize(lemma, split_mode)
        _LEMMA_READING[lemma] = kata2hira("".join(t.reading_form() for t in toks))
    return _LEMMA_READING[lemma]


def analyse(rows, tokenizer, split_mode):
    """逐行產生注音，並累積詞彙統計"""
    lines, vocab = [], defaultdict(lambda: {"count": 0, "first": None, "surfaces": Counter()})
    for idx, (st, en, ja, zh) in enumerate(rows):
        segs, toks = [], []
        parsed = [(m.surface(), m.dictionary_form(),
                   m.part_of_speech()[0], m.part_of_speech()[1])
                  for m in tokenizer.tokenize(ja, split_mode)]
        for m in tokenizer.tokenize(ja, split_mode):
            surface, reading = m.surface(), m.reading_form()
            pos = m.part_of_speech()
            segs.extend(ruby_for(surface, reading))
            if pos[0] in SKIP_POS or not surface.strip():
                continue
            if not (KANJI.search(surface) or HIRA.search(surface) or KATA.search(surface)):
                continue
            lemma = m.dictionary_form()
            key = (lemma, pos[0])
            v = vocab[key]
            v["count"] += 1
            v["surfaces"][surface] += 1
            # ★ 要的是**原形**的讀音，不是當下活用形的。
            #   m.reading_form() 給的是表層的讀音（「行か」→ イカ），
            #   而卡片正面放的是原形（行く）。兩者對不齊時，
            #   注音對齊器會退回「整詞一個注音」——
            #   於是卡片變成 行く[いか]、企てる[くわだて]，
            #   送り仮名被算進讀音裡，而那正是這套對齊要防的事。
            #   把原形再斷一次詞取讀音，才是原形自己的讀音。
            v["reading"] = lemma_reading(lemma, tokenizer, split_mode)
            v["pos"] = "/".join(p for p in pos[:2] if p != "*")
            v["proper"] = pos[1] == PROPER
            if v["first"] is None:
                v["first"] = idx
            toks.append(lemma)
        lines.append({
            "i": idx, "start": round(st, 2), "end": round(en, 2),
            "ja": ja, "ruby": ruby_text(segs), "zh": zh, "tokens": toks,
            "grammar": grammar_of(parsed),
        })
    return lines, vocab


# =====================================================================
# 句型偵測
#
# 【為什麼用詞形序列，不用字串比對】
#   「ている」直接對字串會咬到不該咬的切法；而「の」「が」這兩個
#   高頻助詞若不看前後詞性，會把所有格與主格全部誤判成
#   說明語氣（んだ）與逆接。實測誤中率：の 109 行、が 59 行 ——
#   而那種錯看起來完全合理，學習者只會照單全收學到錯的東西。
#   收緊之後：んだ 在這一集**一次都沒出現**（原本報 109），が 剩 10。
#
# 【寧可漏，不可錯】
#   覆蓋率 36%（171/479 行）。分不出來的一律不標 ——
#   標錯一個句型比沒標更糟，因為學習者沒有辦法察覺它是錯的。
# =====================================================================
def build_rules():
    def seq(ws,*pat):
        n=len(pat)
        for i in range(len(ws)-n+1):
            if all(ws[i+j][f] in (v if isinstance(v,tuple) else (v,)) for j,(f,v) in enumerate(pat)):
                return True
        return False
    def has(ws,f,*v): return any(w[f] in v for w in ws)
    def after_pred(ws, particle):
        # 接在述語後面才算接續助詞；接在名詞後面的是格助詞
        for i,x in enumerate(ws):
            if i and x[0]==particle and x[2]=='助詞' and ws[i-1][1] in ('です','ます','だ','た','ない','ん'):
                return True
        return False
    R={
    "te-iru":    lambda w: seq(w,(0,('て','で')),(1,'いる')) or has(w,0,'てる','でる','てん'),
    "te-shimau": lambda w: seq(w,(0,('て','で')),(1,('しまう','ちゃう','じゃう'))),
    "te-kureru": lambda w: seq(w,(0,('て','で')),(1,('くれる','もらう','あげる','くださる','いただく'))),
    "te-oku":    lambda w: seq(w,(0,('て','で')),(1,('おく','とく'))),
    "te-miru":   lambda w: seq(w,(0,('て','で')),(1,'みる')),
    "te-iku":    lambda w: seq(w,(0,('て','で')),(1,('いく','くる'))),
    "te-kudasai":lambda w: seq(w,(0,('て','で')),(0,('ください','くれ','ちょうだい'))),
    "te-mo":     lambda w: seq(w,(0,('て','で')),(0,'も')),
    "te-kara":   lambda w: seq(w,(0,('て','で')),(0,'から')),
    "tara": lambda w: has(w,0,'たら','だら'),
    "ba":   lambda w: any(x[1]=='ば' and x[2]=='助詞' for x in w),
    "nara": lambda w: has(w,0,'なら'),
    "to-jouken": lambda w: any(w[i][0]=='と' and w[i][2]=='助詞' and w[i-1][2]=='動詞' for i in range(1,len(w))),
    "kara-riyuu": lambda w: any(x[0]=='から' and x[2]=='助詞' for x in w),
    "node":  lambda w: has(w,0,'ので','んで'),
    "noni":  lambda w: has(w,0,'のに'),
    "kedo":  lambda w: has(w,0,'けど','けれど','けれども','けども'),
    "ga-gyaku": lambda w: after_pred(w,'が'),
    "shi":   lambda w: any(x[0]=='し' and x[2]=='助詞' for x in w),
    "tari":  lambda w: has(w,0,'たり','だり'),
    "nakereba": lambda w: has(w,0,'なけれ','なきゃ','なくちゃ','ねば'),
    "naide":    lambda w: has(w,0,'ないで','ずに'),
    "nakute":   lambda w: has(w,0,'なくて'),
    "shika":    lambda w: has(w,0,'しか'),
    "passive":   lambda w: has(w,1,'れる','られる'),
    "causative": lambda w: has(w,1,'せる','させる'),
    "tai":     lambda w: has(w,1,'たい','たがる'),
    "volition":lambda w: any(x[2]=='助動詞' and x[0] in ('う','よう') for x in w),
    "darou":   lambda w: has(w,0,'だろう','でしょう','だろ'),
    "kamo":    lambda w: has(w,0,'かも'),
    "sou-da":  lambda w: has(w,1,'そう'),
    "mitai":   lambda w: has(w,1,'みたい'),
    "rashii":  lambda w: has(w,1,'らしい'),
    "hazu":    lambda w: has(w,1,'はず'),
    "tsumori": lambda w: has(w,1,'つもり'),
    "koto-dekiru": lambda w: seq(w,(1,'こと'),(0,'が'),(1,'できる')),
    "you-ni":  lambda w: seq(w,(1,'よう'),(0,'に')),
    "tame":    lambda w: has(w,1,'ため'),
    "nagara":  lambda w: has(w,0,'ながら'),
    "mama":    lambda w: has(w,1,'まま'),
    "bakari":  lambda w: has(w,0,'ばかり','ばっかり','ばっか'),
    "dake":    lambda w: has(w,0,'だけ'),
    "made":    lambda w: has(w,0,'まで','までに'),
    "toki":    lambda w: has(w,1,'とき','時'),
    "masu":    lambda w: has(w,1,'ます'),
    "kenjou":  lambda w: has(w,1,'いたす','おる','申す','伺う','いただく','ござる'),
    "sonkei":  lambda w: has(w,1,'いらっしゃる','くださる','なさる','おっしゃる'),
    }
    return R

_RULES = build_rules()


def grammar_of(tokens):
    """回傳這一行命中的句型代號"""
    return [k for k, f in _RULES.items() if f(tokens)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("subtitle")
    ap.add_argument("--work", required=True, help="作品代號，例如 spy")
    ap.add_argument("--ep", required=True, help="集號，例如 S1E01")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    try:
        from sudachipy import Dictionary, SplitMode
    except ImportError:
        sys.exit("需要 sudachipy：pip3 install sudachipy sudachidict_core")
    tok = Dictionary(dict="core").create()

    rows, n_jp, n_ch = parse_ass(args.subtitle)
    if not rows:
        sys.exit("這個檔案裡找不到成對的日中字幕行")
    lines, vocab = analyse(rows, tok, SplitMode.C)
    scenes = split_scenes(rows)

    # 幕的邊界用行號表示，行本身不重複存 —— 兩份會漂
    bounds, at = [], 0
    for sc in scenes:
        bounds.append({"from": at, "to": at + len(sc) - 1,
                       "start": round(sc[0][0], 2), "end": round(sc[-1][1], 2)})
        at += len(sc)

    words = []
    for (lemma, _), v in sorted(vocab.items(), key=lambda kv: (-kv[1]["count"], kv[1]["first"])):
        words.append({
            "lemma": lemma, "reading": v.get("reading", ""), "pos": v.get("pos", ""),
            "count": v["count"], "first_line": v["first"], "proper": v.get("proper", False),
            "surface": v["surfaces"].most_common(1)[0][0],
        })

    out = Path(args.out) if args.out else Path(__file__).resolve().parents[1] / "raw" / args.work / f"{args.ep}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "work": args.work, "ep": args.ep, "source": Path(args.subtitle).name,
        "scenes": bounds, "lines": lines, "words": words,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    with_ruby = sum(1 for l in lines if "[" in l["ruby"])
    print(f"  來源 JP {n_jp} 行 / CH {n_ch} 行 → 成對 {len(rows)} 行"
          f"（漏配 {n_jp - len(rows)}）")
    hard = sum(1 for b in bounds if b["to"] - b["from"] + 1 == SCENE_MAX)
    print(f"  切成 {len(bounds)} 幕，每幕 "
          f"{min(b['to']-b['from']+1 for b in bounds)}–{max(b['to']-b['from']+1 for b in bounds)} 行"
          f"（其中 {hard} 幕是撞到上限硬切的"
          + ("，比例偏高表示 SCENE_GAP 需要重調" if hard > len(bounds) * 0.25 else "") + "）")
    # 分母要用「需要注音的行」＝含漢字或數字，與 ANNOT 一致。
    # 只算漢字的話，只有數字的那幾行會被注音卻不計入分母 ——
    # 印出 371 / 369 這種分子大於分母的數字，而那會讓人不再相信這些統計。
    need_ruby = sum(1 for l in lines if ANNOT.search(l["ja"]))
    print(f"  標了注音的行：{with_ruby} / {need_ruby} 需要注音的行")
    print(f"  詞彙 {len(words)} 個（其中專有名詞 {sum(1 for w in words if w['proper'])}）")
    gl = [l for l in lines if l["grammar"]]
    gset = {g for l in lines for g in l["grammar"]}
    empty = sum(1 for b in bounds
                if not {g for i in range(b["from"], b["to"] + 1) for g in lines[i]["grammar"]})
    print(f"  句型 {len(gset)} 種，出現在 {len(gl)} 行（{len(gl)/len(lines):.0%}）；"
          f"沒有句型的幕 {empty}/{len(bounds)}")
    print(f"  → {out}")


if __name__ == "__main__":
    main()
