#!/usr/bin/env python3
# =====================================================================
# 設定 vs 雲端資料：設定裡點名的標籤，雲端真的有內容嗎？
#
#     python3 shared/scripts/audit_config_vs_data.py --site japanese
#
# 【為什麼需要這一支】
#   兩站的大架構一致，所以建新站時很自然會把設定整份複製過去再改。
#   改漏的地方不會報錯 —— 它只是指向一個不存在的標籤，
#   而「指向不存在的東西」在這套程式裡一律是靜默的：
#   排序鍵找不到就退回預設，場景查不到就顯示 0 條。
#
#   實際發生過：日文站的 starterTopics 沿用韓文站的
#   問候／自我介紹／基礎／回應，在日文站是 0／0／1／0 條，
#   「起步優先」這件事整個沒有發生，而畫面上看不出任何異狀。
#
# 【為什麼是腳本不是測試】
#   要對照的是雲端的真實內容。npm test 不該打網路 ——
#   斷網就紅的測試，跑久了大家會學會忽略它，那比沒有更糟。
#   所以放成手動稽核：改設定、匯完資料之後跑一次。
#
# 【判準】
#   0 條      = ❌ 這個宣告完全沒有作用
#   1–2 條    = ⚠️  可能是標籤打錯字（少數幾條剛好也用了那個名字）
#   其餘      = ✅
#   不直接判「少於 N 就是錯」—— 新標籤本來就會從少開始長。
# =====================================================================
import argparse
import json
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_env(site):
    env = {}
    p = ROOT / site / '.env.local'
    if not p.exists():
        sys.exit(f"❌ 找不到 {p}")
    for line in p.read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()
    url = env.get('SUPABASE_URL')
    key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SERVICE_ROLE_KEY')
    if not url or not key:
        sys.exit(f"❌ {p} 缺 SUPABASE_URL 或 service_role key")
    # 每次印出目標專案 —— 站台認錯就會去讀（甚至寫）另一站的線上資料
    print(f"  目標專案：{url}")
    return url, key


def fetch_tags(url, key):
    rows, off = [], 0
    while True:
        req = urllib.request.Request(
            f"{url}/rest/v1/items?select=tags&is_active=eq.true&limit=1000&offset={off}",
            headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        batch = json.load(urllib.request.urlopen(req))
        rows += batch
        # PostgREST 一次最多 1000 列 —— 不分頁會把「剛好 1000」讀成「全部」
        if len(batch) < 1000:
            break
        off += 1000
    return rows, Counter(t for r in rows for t in (r.get('tags') or []))


def check_duplicates(url, key):
    """完全重複的條目：ko 與 zh 都一樣。

    【為什麼是缺陷而不是無害】
      學習者會看到兩張一模一樣的卡，而且各自獨立排程 ——
      同一個詞要學兩次、複習兩次，卻沒有任何跡象說明為什麼。
      他只會覺得「這個 App 怎麼一直重複問我」。

    【實際抓到】
      韓文站有 7 組，全部同時存在於 daily-01 與 vocab-01
      （匯入兩批詞表時各收了一次）。都沒有學習記錄，已軟下架。

    【為什麼只看「ko 與 zh 都相同」】
      同中文對到不同的詞（미안해요／죄송합니다 都是「對不起」）是正常的，
      那是同義詞，四選一已經處理（不會拿其一當干擾項）。
      真正的缺陷是同一個詞收兩次。
    """
    rows, off = [], 0
    while True:
        req = urllib.request.Request(
            f"{url}/rest/v1/items?select=ko,zh,item_type&is_active=eq.true"
            f"&limit=1000&offset={off}",
            headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        b = json.load(urllib.request.urlopen(req))
        rows += b
        if len(b) < 1000:
            break
        off += 1000
    seen = Counter((x['ko'], x['zh']) for x in rows
                   if x['item_type'] in ('word', 'phrase'))
    dups = [(k, n) for k, n in seen.items() if n > 1]
    print('【重複條目】')
    if not dups:
        print(f"  ✅ 沒有完全重複的條目（{len(rows)} 條）\n")
        return 0
    for (ko, zh), n in dups[:10]:
        print(f"  ❌ {ko}（{zh}）出現 {n} 次")
    print(f"  → 共 {len(dups)} 組。軟下架多餘的那一份（is_active=false），不要真刪。\n")
    return len(dups)


def deck_exists(url, key, slug):
    req = urllib.request.Request(f"{url}/rest/v1/decks?select=slug&slug=eq.{slug}",
                                 headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    return bool(json.load(urllib.request.urlopen(req)))


def declared_tags(site):
    """從 taxonomy.js / lang.config.js 讀出設定裡點名的標籤。

    用文字剖析而不是 import —— 這支是 python，而設定是 ESM；
    為了跑一個稽核去起 node、再把結果序列化回來，多兩層可能出錯的東西。
    這裡只要標籤字串，正則夠用，讀不到會在下面直接說「沒讀到」而不是靜靜跳過。
    """
    out = {}
    tx = (ROOT / site / 'taxonomy.js').read_text(encoding='utf-8')
    m = re.search(r'const STARTER_TOPICS = \[([^\]]*)\]', tx)
    if m:
        out['starterTopics'] = re.findall(r"'([^']+)'", m.group(1))
    for m in re.finditer(r"\{\s*key: '[^']+',\s*label: '([^']+)',\s*tags: \[([^\]]*)\]", tx):
        out.setdefault('lifeScenes', []).extend(re.findall(r"'([^']+)'", m.group(2)))
    return out


VALID_POS_FILE = {
    'japanese': 'data/kana-01/_pos.py',
    'korean': 'data/_pos_backfill.py',
}


def valid_pos(site):
    """各站合法的詞性集合。兩站用不同的語言寫詞性名 ——
    韓文站是 명사／동사，日文站是 名詞／動詞。共用碼不該知道哪個是哪個。"""
    import importlib.util
    p = ROOT / site / VALID_POS_FILE[site]
    spec = importlib.util.spec_from_file_location('_pos_' + site, p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.VALID


def check_pos(url, key, site):
    """詞性的覆蓋率與合法性。

    【為什麼要盯】
      四選一挑干擾項時同詞性會加分。詞性空著或打錯字都不會報錯 ——
      只是那個詞永遠配不到同類的干擾項，練了很多次沒練到會錯的那一下。
      而這兩種情況在畫面上長得跟正常的一模一樣。

    【句子與假名卡本來就不該有詞性】
      一整句沒有單一詞性；假名不是單字，掛「名詞」會讓它跟幾百個名詞
      互為干擾項 —— 問「あ」時選項出現「蘋果」，那不是在練假名。
      所以只查 word / phrase，且日文站要扣掉假名卡（ko 本身就是課程標籤）。
    """
    rows, off = [], 0
    while True:
        req = urllib.request.Request(
            f"{url}/rest/v1/items?select=ko,pos,item_type,tags&is_active=eq.true"
            f"&limit=1000&offset={off}",
            headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        b = json.load(urllib.request.urlopen(req))
        rows += b
        if len(b) < 1000:
            break
        off += 1000

    def is_kana_card(x):
        return len(x['ko']) == 1 and x['ko'] in (x['tags'] or [])

    words = [x for x in rows if x['item_type'] in ('word', 'phrase')
             and not is_kana_card(x)]
    miss = [x['ko'] for x in words if not x['pos']]
    valid = valid_pos(site)
    illegal = sorted({x['pos'] for x in words if x['pos'] and x['pos'] not in valid})

    print('【詞性】')
    n = len(words) - len(miss)
    print(f"  {'✅' if not miss else '❌'} 覆蓋 {n}/{len(words)}"
          + (f"　缺：{'、'.join(miss[:8])}{' …' if len(miss) > 8 else ''}" if miss else ''))
    if illegal:
        print(f"  ❌ 不在白名單裡的詞性（打錯字？）：{'、'.join(illegal)}")
    else:
        print(f"  ✅ 詞性值都在白名單裡（{len(valid)} 種）")
    print()
    return len(miss) + len(illegal)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', required=True, choices=['korean', 'japanese'])
    a = ap.parse_args()

    url, key = load_env(a.site)
    rows, counts = fetch_tags(url, key)
    print(f"  雲端 {len(rows)} 條、{len(counts)} 種標籤\n")

    decl = declared_tags(a.site)
    # 生活場景只有在 life-01 這副牌存在時才會顯示。牌還沒建就查它的標籤，
    # 會得到一整排永遠不會變綠的紅字 —— 而永遠紅的稽核，跑幾次之後
    # 大家就學會直接忽略它，那比沒有這支稽核更糟。
    if 'lifeScenes' in decl and not deck_exists(url, key, 'life-01'):
        print("  ⏭  跳過 lifeScenes：這一站還沒有 life-01 這副牌，"
              "整張卡片本來就是隱藏的\n")
        decl.pop('lifeScenes')
    if not decl:
        sys.exit("❌ 從設定檔一個標籤都沒讀到 —— 是格式變了，不是設定乾淨。"
                 "\n   （這種情況必須報錯：讀不到卻印『全部通過』最危險。）")

    bad = 0
    for field, tags in decl.items():
        print(f"【{field}】")
        for t in dict.fromkeys(tags):
            n = counts.get(t, 0)
            mark = '❌' if n == 0 else ('⚠️ ' if n <= 2 else '✅')
            if n == 0:
                bad += 1
            note = ''
            if n == 0:
                note = '  ← 這個宣告完全沒有作用'
            elif n <= 2:
                note = '  ← 太少，確認不是打錯字'
            print(f"  {mark} {t:<10} {n:>4} 條{note}")
        print()

    bad += check_pos(url, key, a.site)
    bad += check_duplicates(url, key)

    if bad:
        print(f"❌ 有 {bad} 項問題（標籤沒有內容，或詞性缺漏／打錯字）。")
        print("   設定指向不存在的標籤不會拋錯，只會讓那個功能默默不生效。")
        sys.exit(1)
    print("✅ 設定點名的標籤在雲端都有內容")


if __name__ == '__main__':
    main()
