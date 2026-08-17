#!/usr/bin/env python3
"""把書上的三塊內容展開成可匯入的 CSV，並產出羅馬音待審清單。

    python3 japanese/data/kana-01/build.py

【一課展開成幾條】
    假名卡 ×1   口訣進 note，這是這本書最有價值的部分
    單字   ×5   一般詞條，進雙向 SRS
    對話   ×2   句子條目，note 寫成「對話 A｜情境｜」就會自動歸成情境對話

【為什麼要對帳】
    「看起來都進去了」不是驗收。這支會印出每一課各展開幾條、
    合計幾條，匯入後再拿資料庫實際筆數比對。數字對不上就找得出漏哪一條。

【羅馬音為什麼不自動修】
    書上（或 OCR）有不一致：ten shi 與 te n ki 混用、長音有時標成 ō。
    自動統一看起來很誘人，但「同樣的模式有的合法有的畸形」正是
    不該無腦批次處理的情況 —— 改對了沒人知道，改錯了也沒人知道。
    所以這裡只「標記」，輸出 _romaji_review.md 交人判斷。
"""
import csv
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import glob            # noqa: E402
import importlib        # noqa: E402

# 自動掃描 _source_*.py —— 內容是一頁一頁陸續進來的，
# 每加一批就要回頭改一次 import，遲早會漏掉某一批而不自覺。
# 掃描則是「加檔案就生效」，漏了會在對帳的課數上直接看出來。
LESSONS = []
for f in sorted(glob.glob(os.path.join(HERE, '_source_*.py'))):
    mod = importlib.import_module(os.path.basename(f)[:-3])
    found = [v for k, v in vars(mod).items() if k.startswith('LESSONS_')]
    if not found:
        sys.exit(f"❌ {os.path.basename(f)} 裡沒有 LESSONS_* 變數")
    for lst in found:
        LESSONS.extend(lst)

# 教學順序：五十音表的順序，不是檔名的字母順序
GOJUON = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
LESSONS.sort(key=lambda L: GOJUON.index(L['kana']) if L['kana'] in GOJUON else 999)

from _furigana import FURIGANA   # noqa: E402

HEADER = ['ko', 'zh', 'romanization', 'type', 'note', 'tags', 'hanja']


def compose_note(L):
    """口訣 + 字源，但去掉字源裡「把口訣再講一次」的句子。

    【為什麼在這裡做，不改來源檔】
        來源檔是逐字照書的真理源，動了就失去對照的價值。
        重複只是「兩段各自都對，接在一起才顯得囉嗦」的呈現問題，
        所以在組裝的這一層處理。

    【判準：只砍「重述」，不砍「資訊」】
        砍掉的條件是：這一句與口訣有 ≥6 字連續重疊，
        而且句子裡帶著「口訣／熟記／記憶」這類指涉口訣的字眼。
        單純提到同一個詞（お 那句講圖像記憶法時又提到おばさん）不砍 ——
        它帶著新資訊。寧可留一點囉嗦，也不要砍掉學習者需要的東西。
    """
    mnem = L['mnemonic']
    kept, dropped = [], []
    for sent in re.split(r'(?<=[。！])', L['origin']):
        if not sent.strip():
            continue
        refers = any(w in sent for w in ('口訣', '熟記', '來記憶'))
        overlap = any(mnem[i:i + 6] in sent for i in range(max(0, len(mnem) - 5)))
        # ★ 帶著實際字源說明的句子一律不砍。
        #   第一版的判準砍掉了 う 的「字源是『宇宙』的『宇』，所以用烏鴉…」——
        #   那句同時帶著字源與重述，砍掉重述的代價是連字源一起沒了。
        #   寧可留一句囉嗦，也不要在去重的名義下弄丟學習者要的東西。
        has_info = any(w in sent for w in ('字源是', '字源來自', '字源為'))
        (dropped if (refers and overlap and not has_info) else kept).append(sent)
    return mnem + '\n' + ''.join(kept), dropped


def rows_for(L):
    """一課 → 一串列。順序即 sort_order：假名卡 → 單字 → 對話。"""
    rows = []
    # ① 假名卡。zh 帶「·平假名」不是裝飾 —— 之後片假名 ア 讀音同樣是 a，
    #    中→日 方向只給 a 的話學習者不知道該寫哪個，會答對卻被判錯。
    rows.append({
        'ko': L['kana'],
        'zh': f"{L['romaji']} ·平假名",
        'romanization': L['romaji'],
        'type': 'word',
        'note': compose_note(L)[0],
        'tags': f"清音,平假名,{L['row']},{L['kana']}",
        'hanja': '',
    })
    # ② 單字
    # を 那一課教的是助詞用法（ごはんを食べる），那是詞組不是單字。
    # 類型標錯會影響四選一的干擾項挑選與統計，所以讓課自己宣告。
    wtype = L.get('word_type', 'word')
    for ja, ro, zh, topic in L['words']:
        rows.append({
            'ko': ja, 'zh': zh, 'romanization': ro, 'type': wtype,
            'note': '', 'tags': f"清音,{L['row']},{L['kana']},{topic}",
            # 單字也可能含漢字（を 那一課的助詞用法：ごはんを食べる）。
            # 標註的判準是「這行字裡有沒有讀不出來的字」，
            # 與它是單字還是對話句無關。
            'hanja': FURIGANA.get(ja, ''),
        })
    # ③ 對話。說話者 A/B 交替；情境名稱是我下的標籤，書上只給句子
    for i, (ja, ro, zh) in enumerate(L['dialogue']):
        rows.append({
            'ko': ja, 'zh': zh, 'romanization': ro, 'type': 'sentence',
            'note': f"對話 {'AB'[i % 2]}｜{L['scene']}｜",
            'tags': f"清音,{L['row']},{L['kana']},會話",
            # hanja 欄在日文站存「ko 的注音版本」，前端據此把假名標在漢字正上方
            'hanja': FURIGANA.get(ja, ''),
        })
    return rows


# 書上的慣例：羅馬音按「拍」分寫。不合這個慣例的挑出來給人看。
#
# ★ 為什麼要列出完整的拍表，而不是用「長度 ≤3」粗篩
#   粗篩會把 nan / hon / ten 放行 —— 它們長度和合法的 kya / sho 一樣，
#   但前者該拆成 na n、ho n、te n。用長度當判準，等於這個檢查
#   對最常見的一種錯誤完全沒作用，卻回報「全部通過」。
#   判準要對著真正的違規案例驗過，否則綠燈只是沒看到。
_BASE = 'a i u e o'.split()
_CONS = ['k', 's', 'sh', 't', 'ch', 'ts', 'n', 'h', 'f', 'm', 'y', 'r', 'w',
         'g', 'z', 'j', 'd', 'b', 'p']
_YOON = ['ky', 'sh', 'ch', 'ny', 'hy', 'my', 'ry', 'gy', 'j', 'by', 'py']
MORA = set(_BASE) | {'n'}
for c in _CONS:
    for v in _BASE:
        MORA.add(c + v)
for c in _YOON:
    for v in ('a', 'u', 'o'):
        MORA.add(c + v)
MORA |= {'shi', 'chi', 'tsu', 'fu', 'ji'}          # 不規則但合法
MORA -= {'si', 'ti', 'tu', 'hu', 'zi', 'yi', 'ye', 'wi', 'wu', 'we'}  # 日語沒有


def suspicious(ro):
    """回傳可疑的理由；沒問題回 None。"""
    reasons = []
    if re.search(r'[āīūēō]', ro):
        reasons.append('用了長音符號（書上多數地方是拆成兩拍寫，如 to u）')
    toks = [t for t in re.split(r'[\s,.。、？?！!]+', ro) if t]
    for i, tok in enumerate(toks):
        t = tok.lower()
        if t in MORA:
            continue
        # ★ 促音（っ）自成一拍，書上寫成單獨一個子音字母：
        #   いっしょに → i s sho ni
        #   那不是打錯，是這本書在教「促音佔一整拍」——
        #   而那正是華語母語者最容易滑過去的地方。
        #   判準是「下一個拍以同一個子音開頭」，避免把真的錯字放行。
        nxt = toks[i + 1].lower() if i + 1 < len(toks) else ''
        if len(t) == 1 and t.isalpha() and t not in 'aiueon' and nxt.startswith(t):
            continue
        # っ 的促音在羅馬音是子音重複（ki tte / ma tte），書上就是這樣寫
        if len(t) > 1 and t[0] == t[1] and t[1:] in MORA:
            continue
        if len(t) > 1 and t.endswith('n') and t[:-1] in MORA:
            reasons.append(f'「{tok}」的 ん 沒有獨立成一拍（應為 {t[:-1]} n）')
        else:
            reasons.append(f'「{tok}」不是一個合法的拍')
    return '；'.join(dict.fromkeys(reasons)) or None


def _selftest():
    """★ 檢查本身要先對著已知的違規案例驗過，才敢相信它的綠燈。"""
    must_flag = ['nan de su ka', 'ten ki', 'ni hon go', 'a ri ga tō u', 'hi roi',
                 's ka', 'k a ki']                # 單獨子音後面沒有同子音 = 真的錯
    must_pass = ['a ki', 'i chi go', 'kyo u', 'cho tto ma tte', 'sho u sho u',
                 'ha i', 'ko re, a ge ru', 'go hya ku e n de su', 'shi tte i ma su ka',
                 'i s sho ni', 'ki t te']          # 促音自成一拍的寫法
    bad = [x for x in must_flag if not suspicious(x)]
    wrong = [(x, suspicious(x)) for x in must_pass if suspicious(x)]
    if bad:
        sys.exit(f'❌ 檢查失效：這些違規沒被抓到 {bad}')
    if wrong:
        sys.exit(f'❌ 誤報：這些合法的被抓了 {wrong}')
    print('  ✅ 羅馬音檢查自我測試通過（會抓真違規，不誤報合法寫法）')


def merge_duplicates(all_rows):
    """同一個 ko 只能有一條 —— 但不能默默丟掉，要合併並講清楚。

    【為什麼會重複】
        ① 同一句話在多課出現：ありがとう 在 あ・か・た 三課都教。
           它本來就是同一個詞條，該是一條卡片，但標籤要帶齊三課。
        ② 假名本身就是一個單字：て 是假名，也是「手」。
           兩者長得一樣，對學習者也真的是同一張卡 —— 翻開該同時看到
           「這是 te」和「意思是手」，分成兩條反而是騙人的。

    【為什麼一定要處理，不能放著】
        slug 由 ko 算出來，重複的 ko 會讓 Postgres 整批拒絕
        （ON CONFLICT DO UPDATE cannot affect row a second time），
        而且是整個檔案一起死 —— て 課 8 條只進了 1 條就是這樣來的。

    合併規則：標籤取聯集；zh／note 以「資訊量大的優先」，
    假名卡的口訣一定保留，實義的中文意思蓋過「te ·平假名」這種佔位。
    """
    by_ko = {}
    order = []
    merges = []
    for r in all_rows:
        # ★ 對話句不合併。同一句話出現在不同情境時，各段對話都要有自己那一行 ——
        #   併掉的話，後面幾段各只剩一行，而 groupDialogues 要求 ≥2 行才成組，
        #   那幾段會從情境對話裡整組消失。它們的唯一性靠匯入時的
        #   --slug-scope note 保證（ko+note 一起算雜湊），不是靠這裡合併。
        k = r['ko'] + '\x1f' + r['note'] if r['type'] == 'sentence' else r['ko']
        if k not in by_ko:
            by_ko[k] = dict(r)
            order.append(k)
            continue
        a = by_ko[k]
        merges.append((k, a['zh'], r['zh']))
        a['tags'] = ','.join(dict.fromkeys(a['tags'].split(',') + r['tags'].split(',')))
        # 口訣不能掉：哪一邊有就留哪一邊，兩邊都有就接起來
        notes = [n for n in (a['note'], r['note']) if n]
        a['note'] = '\n'.join(dict.fromkeys(notes))
        # 「te ·平假名」是佔位，真的中文意思優先
        if a['zh'].endswith('·平假名') and not r['zh'].endswith('·平假名'):
            a['zh'] = f"{r['zh']}（假名 {a['romanization']}）"
        elif not a['zh'].endswith('·平假名') and r['zh'].endswith('·平假名'):
            a['zh'] = f"{a['zh']}（假名 {r['romanization']}）"
        elif a['zh'] != r['zh']:
            a['zh'] = '／'.join(dict.fromkeys([a['zh'], r['zh']]))
        # 句子 > 單字：同一串文字若被判成兩種類型，以句子為準
        if r['type'] == 'sentence':
            a['type'] = 'sentence'
    return [by_ko[k] for k in order], merges


# 需要標註的不只是漢字 —— 數字也要（5つ 唸 いつつ，看字面猜不到）。
# 第一版只認漢字，於是「りんごを5つください。」的標註被判成「多餘的」，
# 而它其實是必要的。判準寫窄的代價是把正確的東西擋掉。
NEEDS_READING = re.compile(r'[一-鿿0-9０-９]')


def check_furigana():
    """標註寫錯不會報錯，只會讓學習者背下一個錯的音 —— 所以這裡硬擋。"""
    all_lines = ([ja for L in LESSONS for ja, _, _ in L['dialogue']]
                 + [ja for L in LESSONS for ja, _, _, _ in L['words']])
    plain = [x for x in all_lines if NEEDS_READING.search(x)]
    missing = [x for x in plain if x not in FURIGANA]
    if missing:
        sys.exit('❌ 這些含漢字的句子沒有振り仮名標註：\n   ' + '\n   '.join(missing))
    bad = []
    for src, ann in FURIGANA.items():
        stripped = re.sub(r'([^\[\]]+?)\[([^\[\]]+)\]', r'\1', ann)
        if stripped != src:
            bad.append(f'{src}\n     去掉標註後變成：{stripped}')
        for m in re.finditer(r'\[([^\[\]]+)\]', ann):
            if not re.fullmatch(r'[ぁ-ゖァ-ヺー]+', m.group(1)):
                bad.append(f'{src} → 讀音「{m.group(1)}」不是純假名')
    # 對得上任何一句就不算多餘 —— 判斷「該不該標」是上面 plain 的事
    orphan = [k for k in FURIGANA if k not in all_lines]
    if orphan:
        bad.append('標註了但沒有對應句子：' + '／'.join(orphan))
    if bad:
        sys.exit('❌ 振り仮名有問題：\n   ' + '\n   '.join(bad))
    print(f'  ✅ 振り仮名 {len(FURIGANA)} 條，去標註後與原句一字不差')


def main():
    _selftest()
    check_furigana()
    review = []
    print('【展開對帳】')
    all_rows = []
    per_lesson = []
    for L in LESSONS:
        rows = rows_for(L)
        all_rows.extend(rows)
        per_lesson.append((L, rows))
        for r in rows:
            why = suspicious(r['romanization'])
            if why:
                review.append((L['kana'], r['ko'], r['romanization'], why))

    trimmed = [(L['kana'], d) for L in LESSONS for d in compose_note(L)[1]]
    if trimmed:
        print(f"\n【口訣去重：砍掉 {len(trimmed)} 句重述】原始來源檔未更動")
        for k, d in trimmed:
            print(f"   {k}：{d}")

    merged, merges = merge_duplicates(all_rows)
    merged_by_key = {
        (m['ko'] + '\x1f' + m['note'] if m['type'] == 'sentence' else m['ko']): m
        for m in merged
    }

    # 每課一個檔，但只寫「這一課第一次出現」的那些 ko，
    # 重複的統一由第一次出現的那一課帶走（標籤已經合併齊了）。
    assigned = set()
    total = 0
    for L, rows in per_lesson:
        mine = []
        for r in rows:
            key = r['ko'] + '\x1f' + r['note'] if r['type'] == 'sentence' else r['ko']
            if key in assigned:
                continue
            assigned.add(key)
            key = r['ko'] + '\x1f' + r['note'] if r['type'] == 'sentence' else r['ko']
            mine.append(merged_by_key[key])
        path = os.path.join(HERE, f"{L['romaji']}.csv")
        with open(path, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=HEADER)
            w.writeheader()
            w.writerows(mine)
        dropped = len(rows) - len(mine)
        note = f"（{dropped} 條與前面的課重複，已併入前面）" if dropped else ''
        print(f"  {L['kana']} ({L['row']})  展開 {len(rows)} → 寫入 {len(mine)} 條 {note}")
        total += len(mine)

    print(f"\n  共 {len(LESSONS)} 課，展開 {len(all_rows)} 條，合併重複後 {total} 條")
    print(f"  展開明細：假名 {len(LESSONS)} + 單字 {sum(len(L['words']) for L in LESSONS)}"
          f" + 對話 {sum(len(L['dialogue']) for L in LESSONS)} = {len(all_rows)}")
    if merges:
        print(f"\n【合併了 {len(merges)} 處重複】—— 沒有丟掉任何一課的標籤")
        for k, a, b in merges:
            print(f"   「{k}」  {a}  ＋  {b}")
    assert total == len(merged), f"對帳不符：寫出 {total} 條，去重後應為 {len(merged)} 條"

    # ★ 這裡曾經產生 kana-lessons.js（課程清單 + 導言）給前端用。
    #   已移除：課程清單改成程式碼裡的完整教學序列（含還沒開課的片假名），
    #   導言改成直接讀雲端的假名卡 note。
    #   原本的做法要「重新部署程式碼」才能反映新加的內容，
    #   而內容是天天在加的 —— 實際踩過：資料 46 課、畫面停在 38。

    rv = os.path.join(HERE, '_romaji_review.md')
    with open(rv, 'w', encoding='utf-8') as f:
        f.write('# 羅馬音待審清單\n\n')
        f.write('書上的慣例是按「拍」分寫（a ki／i chi go）。以下是不合慣例的，\n')
        f.write('多半是 OCR 造成的，但也可能是書上原本就這樣寫。\n')
        f.write('**沒有自動改** —— 同樣的模式有的合法有的畸形，只能人看。\n\n')
        f.write('| 課 | 詞條 | 目前的羅馬音 | 可疑之處 |\n|---|---|---|---|\n')
        for k, ko, ro, why in review:
            f.write(f'| {k} | {ko} | `{ro}` | {why} |\n')
    print(f"\n⚠️ {len(review)} 條羅馬音待人審 → _romaji_review.md")


if __name__ == '__main__':
    main()
