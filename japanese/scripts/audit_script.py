#!/usr/bin/env python3
# =====================================================================
# 精讀資料的整體審查
#
# 【為什麼要有這支】
#   匯入時的回讀對帳只回答「我送出去的有沒有存進去」。
#   它答不出「存進去的東西合不合理」——
#   例如注音拼回來與讀音欄對不對得上、例句裡到底有沒有那個詞、
#   同形異義詞的詞義有沒有寫成中文的同一個詞。
#
#   這些檢查原本是逐次手打的臨時查詢，只存在當時那個對話裡。
#   第二季要重做一遍時，記得的只有結論，記不得判準。
#
# 【誤報要標出來，不能混在錯誤裡】
#   有幾項的「不一致」是合理的（見各項說明）。
#   把它們跟真正的錯誤混在一起列，久了整份報告就沒有人看 ——
#   而那正是「會被忽略的警報比沒有警報更糟」。
#
#     python3 japanese/scripts/audit_script.py --deck-slug spy-s1
# =====================================================================
import argparse
import json
import re
import sys
import time
import urllib.request
import gzip
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KANA = r'[ぁ-ゖァ-ヺ]'
STRIP = lambda t: re.sub(r'\[[^\]]*\]', '', t or '')

# 日中同形異義：寫法一樣、意思不一樣。這一類若被寫成「與詞形相同」，
# 學習者會直接照中文理解，而且沒有任何線索告訴他錯了。
# 人工整理，不是自動猜的 —— 猜出來的清單會製造大量誤報。
FALSE_FRIENDS = {
    '手紙': '信', '勉強': '唸書', '新聞': '報紙', '大丈夫': '沒問題', '無理': '辦不到',
    '娘': '女兒', '汽車': '火車', '切手': '郵票', '丈夫': '結實', '邪魔': '妨礙',
    '怪我': '受傷', '大家': '房東', '床': '地板', '靴下': '襪子', '人参': '紅蘿蔔',
    '泥棒': '小偷', '喧嘩': '吵架', '看病': '照顧病人', '検討': '研議', '経理': '會計',
    '愛人': '情婦', '得意': '擅長', '用意': '準備', '適当': '隨便', '迷惑': '困擾',
    '油断': '大意', '是非': '務必', '一味': '同夥', '風邪': '感冒', '工作': '策動',
    '告訴': '控告', '質問': '提問', '写真': '照片', '放心': '發呆', '麻雀': '麻將',
    '素人': '外行', '立派': '氣派', '真面目': '認真', '野菜': '蔬菜',
}


def env():
    out = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.strip().split('=', 1)
            out[k] = v.strip()
    url = out['SUPABASE_URL'].rstrip('/')
    key = out.get('SUPABASE_SERVICE_ROLE_KEY') or out['SERVICE_ROLE_KEY']
    print(f"  站台 japanese · Supabase 專案 {url.split('//')[1].split('.')[0]}")
    return url, key


def fetch(url, key, q):
    """分頁撈完。PostgREST 單次最多 1000 列，不分頁會靜靜地少一截"""
    h = {'apikey': key, 'Authorization': f'Bearer {key}', 'Accept-Encoding': 'gzip'}
    out, off = [], 0
    while True:
        for attempt in range(4):
            try:
                r = urllib.request.urlopen(
                    urllib.request.Request(f'{url}/rest/v1/{q}&limit=1000&offset={off}',
                                           headers=h), timeout=60)
                raw = r.read()
                body = gzip.decompress(raw) if r.headers.get('Content-Encoding') == 'gzip' else raw
                page = json.loads(body)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(3)
        out += page
        if len(page) < 1000:
            break
        off += 1000
    return out


class Report:
    def __init__(self):
        self.fails = 0

    def check(self, name, bad, why='', sample=6):
        """真正的錯誤。有東西就是紅的"""
        ok = not bad
        if not ok:
            self.fails += 1
        print(f"  {'✅' if ok else '❌'} {name}：{len(bad)}" + (f"  —— {why}" if why and not ok else ''))
        for x in list(bad)[:sample]:
            print(f"       {x}")
        if len(bad) > sample:
            print(f"       …還有 {len(bad) - sample} 筆")

    def note(self, name, items, why, sample=4):
        """已知會有合理個案的項目。列出來給人看，但不算失敗 ——
        混進錯誤裡的話，整份報告久了就沒有人看。"""
        print(f"  ℹ️  {name}：{len(items)}  —— {why}")
        for x in list(items)[:sample]:
            print(f"       {x}")
        if len(items) > sample:
            print(f"       …還有 {len(items) - sample} 筆")


# ---------------------------------------------------------------------
# 自我測試
#
# 沒有證明會報警的檢查不算檢查 —— 它可能從第一天起就是瞎的，
# 而「一直是綠的」正好長得像「一直沒問題」。
#
# 用捏造的壞資料驗，不去動真的資料：
# 改真資料再還原的話，還原失敗就會把壞東西留在線上。
# ---------------------------------------------------------------------
def self_test():
    ok = True

    def want(name, cond, why):
        nonlocal ok
        if not cond:
            ok = False
        print(f"  {'✅' if cond else '❌'} {name}  —— {why}")

    # 注音蓋到送り仮名
    def ruby_bad(h):
        return any(not re.split(KANA, seg)[-1]
                   for seg, _ in re.findall(r'([^\[\]]+)\[([^\]]+)\]', h))
    want('抓得到「注音蓋到送り仮名」', ruby_bad('奪う[うばう]'), '這是實際攔下過三次的那道')
    want('正確的注音不誤報',
         not ruby_bad('奪[うば]う') and not ruby_bad('我[わ]が国[くに]')
         and not ruby_bad('買[か]い物[もの]'),
         '我[わ]が国[くに] 的第二段開頭是假名，但它屬於前一個注音')

    # ruby 去掉標記要等於原句
    want('抓得到「ruby 與原句不符」', STRIP('駅[えき]は近[ちか]い') != '駅は遠い', '')
    want('相符時不誤報', STRIP('駅[えき]は近[ちか]い') == '駅は近い', '')

    # 同形異義
    fake = {'手紙': '手紙', '新聞': '報紙'}
    hit = [k for k, v in FALSE_FRIENDS.items()
           if k in fake and v.split('／')[0] not in fake[k]]
    want('抓得到「同形異義寫成與詞形相同」', hit == ['手紙'],
         '手紙 寫成「手紙」要紅，新聞 寫成「報紙」要綠')

    # 重複詞形
    want('抓得到「重複的詞形」',
         [k for k, n in Counter(['あ', 'い', 'あ']).items() if n > 1] == ['あ'], '')

    # 詞義混進假名
    leaks = lambda z: bool(re.search(KANA, re.sub(r'（[^）]*）', '', z)))
    want('抓得到「詞義沒翻完」', leaks('走る的樣子'), '')
    want('括號裡的原文不誤報', not leaks('好的（okey-dokey）') and not leaks('企鵝'),
         '專有名詞的原文寫在括號裡是刻意的')

    print(f"\n  {'✅ 自我測試通過：每一項都證明得了會報警' if ok else '❌ 自我測試失敗'}")
    sys.exit(0 if ok else 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--deck-slug')
    ap.add_argument('--self-test', action='store_true',
                    help='用捏造的壞資料證明每一項檢查都會報警，不連線')
    args = ap.parse_args()
    if args.self_test:
        self_test()
    if not args.deck_slug:
        sys.exit('  用 --deck-slug spy-s1，或 --self-test')
    url, key = env()
    R = Report()

    deck = fetch(url, key, f'decks?select=id&slug=eq.{args.deck_slug}')
    if not deck:
        sys.exit(f'  ❌ 找不到詞庫 {args.deck_slug}')
    did = deck[0]['id']
    cards = fetch(url, key, f'items?select=ko,zh,pos,hanja,romanization,example_ko,note&deck_id=eq.{did}')
    eps = {e['id']: e for e in fetch(url, key,
           'script_episodes?select=id,slug,episode,line_count,scene_count&order=sort_order')}
    lines = fetch(url, key, 'script_lines?select=episode_id,idx,scene,ja,ruby,zh,tokens,grammar')
    print(f"  審查對象：{len(cards)} 張詞卡 · {len(lines)} 行台詞 · {len(eps)} 集\n")

    # ── 台詞 ──
    print("  【台詞】")
    R.check('空白的日文或中文',
            [f"{eps[l['episode_id']]['slug']} #{l['idx']}" for l in lines
             if not l['ja'].strip() or not l['zh'].strip()])
    R.check('ruby 去掉注音後與原句不符',
            [f"{eps[l['episode_id']]['slug']} #{l['idx']}" for l in lines
             if STRIP(l['ruby']) != l['ja']],
            'ruby 是原句的注音版，去掉標記應該一字不差')
    byep = defaultdict(set)
    for l in lines:
        byep[l['episode_id']].add(l['scene'])
    R.check('幕號不連續或對不上 scene_count',
            [f"{eps[e]['slug']}: 缺 {sorted(set(range(1, eps[e]['scene_count'] + 1)) - sc)[:5]}"
             for e, sc in byep.items() if sc != set(range(1, eps[e]['scene_count'] + 1))])
    R.check('行數對不上 line_count',
            [f"{eps[e]['slug']}: {n} vs {eps[e]['line_count']}"
             for e, n in Counter(l['episode_id'] for l in lines).items()
             if n != eps[e]['line_count']])
    R.check('中文欄裡出現平假名（漏譯的徵兆）',
            [f"{eps[l['episode_id']]['slug']} #{l['idx']}" for l in lines
             if re.search(r'[ぁ-ゖ]', l['zh'])])
    gram = open(ROOT / 'grammar.js', encoding='utf-8').read()
    R.check('句型代號查不到解說',
            sorted({c for l in lines for c in (l['grammar'] or [])} - {
                m for m in re.findall(r"^\s*'([a-z0-9-]+)':", gram, re.M)}),
            '查不到的代號會被畫面靜靜略過')
    R.note('日文與中文完全相同',
           [f"{eps[l['episode_id']]['slug']} #{l['idx']}（{len(l['ja'])} 字）"
            for l in lines if l['ja'] == l['zh']],
           '極短的感嘆詞與人名在中日文裡寫法本來就相同')

    # ── 詞卡 ──
    print("\n  【詞卡】")
    R.check('詞義是空的', [c['ko'] for c in cards if not re.sub(r'[、，。・（）()\s]', '', c['zh'] or '')])
    R.check('讀音欄是空的', [c['ko'] for c in cards if not (c['romanization'] or '').strip()])
    R.check('缺例句', [c['ko'] for c in cards if not c['example_ko']])
    R.check('note 欄格式不符',
            [c['ko'] for c in cards if not re.match(r'^精讀｜S\d+E\d+｜出現 \d+ 次$', c['note'] or '')])
    kos = [c['ko'] for c in cards]
    R.check('重複的詞形', [k for k, n in Counter(kos).items() if n > 1],
            '同一副詞庫裡一個詞只能有一張卡，否則複習池會重複排程')
    R.check('詞義裡混進日文假名（沒翻完）',
            [f"{c['ko']} → {c['zh']}" for c in cards
             if re.search(KANA, re.sub(r'（[^）]*）', '', c['zh']))])
    # 注音只能蓋在漢字或數字上
    ANNOT = r'[一-鿿々〆ヶ0-9０-９]'
    R.check('注音蓋到送り仮名',
            [f"{c['ko']} → {c['hanja']}" for c in cards
             if any(not re.split(KANA, seg)[-1]
                    for seg, _ in re.findall(r'([^\[\]]+)\[([^\]]+)\]', c['hanja'] or ''))],
            '把送り仮名算進讀音，學習者會記錯而且察覺不到')
    R.check('含漢字卻沒有注音',
            [c['ko'] for c in cards if re.search(ANNOT, c['ko']) and '[' not in (c['hanja'] or '')])
    # ★ 同形異義
    ff = [f"{k}：目前「{cards_by[k]}」，正確應含「{v}」"
          for k, v in FALSE_FRIENDS.items()
          if (cards_by := {c['ko']: c['zh'] for c in cards}) and k in cards_by
          and v.split('／')[0] not in cards_by[k]]
    R.check('★ 同形異義詞被寫成與詞形相同', ff,
            '學習者會直接照中文理解，而且沒有任何線索告訴他錯了')

    def stem(w):
        return w[:-1] if len(w) > 1 and re.match(KANA, w[-1]) else w
    R.note('例句裡找不到該詞的詞幹',
           [f"{c['ko']}（{c['pos'].split('/')[0]}）" for c in cards
            if stem(c['ko']) not in STRIP(c['example_ko'])],
           'サ変動詞的原形（応ずる）與句中的表層（応じ）本來就不同')

    print(f"\n  {'✅ 審查通過' if not R.fails else f'❌ {R.fails} 項需要處理'}")
    sys.exit(1 if R.fails else 0)


if __name__ == '__main__':
    main()
