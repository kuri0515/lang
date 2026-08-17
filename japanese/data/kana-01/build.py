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

HEADER = ['ko', 'zh', 'romanization', 'type', 'note', 'tags']


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
        'note': f"{L['mnemonic']}\n{L['origin']}",
        'tags': f"清音,平假名,{L['row']}",
    })
    # ② 單字
    for ja, ro, zh, topic in L['words']:
        rows.append({
            'ko': ja, 'zh': zh, 'romanization': ro, 'type': 'word',
            'note': '', 'tags': f"清音,{L['row']},{topic}",
        })
    # ③ 對話。說話者 A/B 交替；情境名稱是我下的標籤，書上只給句子
    for i, (ja, ro, zh) in enumerate(L['dialogue']):
        rows.append({
            'ko': ja, 'zh': zh, 'romanization': ro, 'type': 'sentence',
            'note': f"對話 {'AB'[i % 2]}｜{L['scene']}｜",
            'tags': f"清音,{L['row']},會話",
        })
    return rows


# 書上的慣例：羅馬音按「拍」分寫。不合這個慣例的挑出來給人看。
MORA_OK = re.compile(r'^[a-zA-Z]{1,3}$')


def suspicious(ro):
    """回傳可疑的理由；沒問題回 None。"""
    reasons = []
    if re.search(r'[āīūēō]', ro):
        reasons.append('用了長音符號（書上多數地方是拆成兩拍寫，如 to u）')
    for tok in re.split(r'[\s,.。、？?！!]+', ro):
        if not tok:
            continue
        if not MORA_OK.match(tok):
            reasons.append(f'「{tok}」不像單一個拍')
    return '；'.join(dict.fromkeys(reasons)) or None


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


def main():
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
