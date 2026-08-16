#!/usr/bin/env python3
"""
標籤整併。

    python3 scripts/merge_tags.py            # dry-run
    python3 scripts/merge_tags.py --apply

【為什麼要併】
  110 個標籤管 976 條，已經多到不能當篩選用 —— 學習者要在下拉選單裡
  滑過 收音ㄼ 才找得到「食物」。而且同一個概念被拆成好幾個標籤
  （家庭／家人、情緒／情感）後，每個都湊不滿一組，篩出來沒幾條。

【什麼不併：單例不等於漂移】
  收音ㄾ 與 收音ㄽ 各只用過一次，但它們是「複合收音」教學序列的一員
  （收音ㄼ·ㅀ·ㄻ·ㅄ·ㄿ·ㄺ·ㄶ·ㄳ·ㄵ）。學生在練複合收音時要的正是這幾條，
  併掉會拆散教學結構。只用一次是現象，漂移才是問題，兩者不能劃等號。
"""
import argparse, json, os, sys, urllib.parse, urllib.request
from collections import Counter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 舊標籤 → 新標籤。理由寫在旁邊，日後回頭看才知道當初怎麼判的。
MERGE = {
    "家人": "家庭",   # 同一概念被拆開寫
    "情感": "情緒",   # 同上
    "家居": "家具",   # 同上
    "日常": "生活",   # 同上
    "居住": "生活",   # 單例，語意落在生活裡
    "設施": "場所",   # 單例，設施就是場所的一種
    "健康": "醫療",   # 單例
    "閱讀": "學習",   # 單例
    "語言": "學習",   # 單例
    "宗教": "文化",   # 單例
    "奇幻": "文化",   # 單例（요술）
    "人名": "文化",   # 單例（에디슨）
    "文具": "物品",   # 單例
    "材質": "物品",   # 單例
    "顏色": "形容",   # 單例（빨간색）
    "娛樂": "休閒",   # 單例
}
# 刻意保留的單例，連同理由（避免日後有人「順手清乾淨」）
KEEP_SINGLE = {
    "收音ㄾ": "複合收音教學序列的一員（핥다·흩다），併掉會拆散教學結構",
    "收音ㄽ": "同上（외곬）",
}

def load_env():
    env={}
    for line in open(os.path.join(ROOT,".env.local"),encoding="utf-8"):
        line=line.strip()
        if line and not line.startswith("#") and "=" in line:
            k,v=line.split("=",1); env[k.strip()]=v.strip().strip('"').strip("'")
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_ROLE_KEY"]

def req(url,key,method,path,body=None):
    data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None
    r=urllib.request.Request(f"{url}/rest/v1/{urllib.parse.quote(path,safe='?&=,.()*')}",
                             data=data,method=method)
    for h,v in [("apikey",key),("Authorization",f"Bearer {key}"),
                ("Content-Type","application/json"),("Prefer","return=representation")]:
        r.add_header(h,v)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode() or "[]")

def fetch(url,key):
    rows=[]
    while True:
        p=req(url,key,"GET","items?select=id,ko,tags&is_active=eq.true"
                            f"&order=id&offset={len(rows)}&limit=1000")
        rows+=p
        if len(p)<1000: return rows

def new_tags(tags):
    """套用整併，去重且保持原順序"""
    out=[]
    for t in tags or []:
        t2=MERGE.get(t,t)
        if t2 not in out:
            out.append(t2)
    return out

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--apply",action="store_true")
    a=ap.parse_args()
    url,key=load_env()
    items=fetch(url,key)
    before=Counter(t for x in items for t in (x["tags"] or []))

    absent=[t for t in MERGE if t not in before]
    if absent: sys.exit(f"❌ 這些舊標籤不存在（打錯字？）：{absent}")

    changed=[(x,new_tags(x["tags"])) for x in items if new_tags(x["tags"])!=(x["tags"] or [])]
    after=Counter()
    for x in items:
        for t in new_tags(x["tags"]): after[t]+=1

    print(f"標籤 {len(before)} → {len(after)} 個，影響 {len(changed)} 條詞條\n")
    for old,new in MERGE.items():
        print(f"  {old}({before[old]:>2}) → {new}  合併後 {after[new]}")
    print(f"\n刻意保留的單例（{len(KEEP_SINGLE)}）：")
    for t,why in KEEP_SINGLE.items():
        print(f"  {t}  {why}")
    left=[t for t,n in after.items() if n==1]
    print(f"\n整併後仍為單例的：{left or '無'}")

    if not a.apply:
        print("\n🔎 dry-run：什麼都沒寫。加 --apply 生效。"); return

    for x,nt in changed:
        req(url,key,"PATCH",f"items?id=eq.{x['id']}",{"tags":nt})

    # 回讀驗證：舊標籤必須完全消失，且總掛載數不變（只是改名，不該掉條目）
    post=fetch(url,key)
    now=Counter(t for x in post for t in (x["tags"] or []))
    ghost=[t for t in MERGE if now.get(t)]
    if ghost: sys.exit(f"❌ 舊標籤仍殘留：{ghost}")
    if sum(now.values())!=sum(after.values()):
        sys.exit(f"❌ 掛載總數對不上：期望 {sum(after.values())} 實得 {sum(now.values())}")
    print(f"✅ 舊標籤全數消失，標籤數 {len(now)}，掛載總數 {sum(now.values())} 與預期相符")

if __name__=="__main__": main()
