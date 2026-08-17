#!/usr/bin/env python3
"""站台解析與密鑰載入 —— 所有腳本共用的入口。

【為什麼要獨立成一個模組】
    拆成 monorepo 之後，每支腳本都多了一個問題要回答：「這是要動哪一站的資料庫？」
    六支腳本各自寫一份 load_env()，就是六個各自漂移的答案。

【為什麼答錯的代價特別大】
    這些腳本拿的是 service_role key —— RLS 對它無效，它想寫什麼就寫什麼。
    站台認錯，等於把日文詞表寫進韓文站的線上資料庫，或反過來。
    所以這裡的設計原則是「寧可吵，不要猜」：

      1. 站台可以用 --site 或 SITE 環境變數指定，沒指定才退回 korean
      2. 每次載入密鑰都印出「正要連哪一個 Supabase 專案」，
         而且印的是從 URL 解出來的 project ref，不是我以為的那個名字
      3. .env.local 找不到就直接結束，不會退回去用別站的

    第 2 點是重點：靜默地連對或連錯，人是看不出差別的。
"""
import os
import re
import sys

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(SCRIPTS))
KNOWN_SITES = ("korean", "japanese")


def resolve_site(argv=None):
    """從 --site / SITE 決定站台，並把 --site 從 argv 拿掉。

    直接改 sys.argv，讓各腳本原本的 argparse 不必知道這件事。
    """
    argv = sys.argv if argv is None else argv
    site = os.environ.get("SITE")
    if "--site" in argv:
        i = argv.index("--site")
        if i + 1 >= len(argv):
            sys.exit("❌ --site 後面要接站台名稱")
        site = argv[i + 1]
        del argv[i:i + 2]
    site = site or "korean"
    if site not in KNOWN_SITES:
        sys.exit(f"❌ 不認得的站台 {site!r}，可用：{'／'.join(KNOWN_SITES)}")
    return site


SITE = resolve_site()
SITE_DIR = os.path.join(REPO, SITE)


def project_ref(url):
    """從 Supabase URL 解出 project ref —— 這是分辨兩個專案的唯一可靠依據"""
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", url.rstrip("/"))
    return m.group(1) if m else url


def load_env(need_key=True):
    """讀該站的 .env.local，並把要連的專案印出來。"""
    path = os.path.join(SITE_DIR, ".env.local")
    if not os.path.exists(path):
        sys.exit(f"❌ 缺少 {SITE}/.env.local —— 複製 {SITE}/.env.example 並填入 service_role key")
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

    url = env.get("SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url:
        sys.exit(f"❌ {SITE}/.env.local 裡缺 SUPABASE_URL")
    if need_key and not key:
        sys.exit(f"❌ {SITE}/.env.local 裡缺 SUPABASE_SERVICE_ROLE_KEY")

    # 站台認錯是這類腳本最貴的錯誤，所以每次都印，不做成 --verbose
    print(f"🎯 站台 {SITE} · Supabase 專案 {project_ref(url)}", file=sys.stderr)
    return url.rstrip("/"), key


def env_value(name):
    """取 .env.local 裡的其他值（例如 migrate.sh 要的資料庫密碼）"""
    path = os.path.join(SITE_DIR, ".env.local")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

def auth_config():
    """從 <site>/lang.config.js 讀帳號網域與密碼補位字串。

    【為什麼從 JS 檔讀，而不是在這裡再寫一份】
        前端與這支腳本必須用完全相同的值 —— 不一致的症狀是
        「建得出帳號但登不進去」，而且兩邊各自看起來都對。
        所以只留一個真理源（lang.config.js），Python 這邊用嚴格的
        正則取值，取不到就直接結束，不猜也不給預設值。

        tests/lang.test.mjs 會把 JS 讀到的值與這裡讀到的值做比對，
        任一邊改了另一邊沒跟上就會紅。
    """
    path = os.path.join(SITE_DIR, "lang.config.js")
    if not os.path.exists(path):
        sys.exit(f"❌ 找不到 {SITE}/lang.config.js")
    src = open(path, encoding="utf-8").read()
    out = {}
    for key in ("authEmailDomain", "authPasswordPad"):
        m = re.search(rf"^\s*{key}:\s*'([^']*)',", src, re.M)
        if not m:
            sys.exit(f"❌ {SITE}/lang.config.js 裡找不到 {key}")
        out[key] = m.group(1)
    return out["authEmailDomain"], out["authPasswordPad"]


def structural_tag_re():
    """站台宣告的「教學結構標籤」正則。

    這些標籤是課程骨架（一課、一章、階段），不是內容主題。
    標籤漂移的檢查只該看內容主題 —— 拿 あ 和 あ行 去比
    「是不是同一個概念被拆開寫」，永遠會報一堆假的，
    而假的多了真的就沒人看了。

    來源與前端同一份（lang.config.js），兩邊各自維護必然漂移。
    這裡用到的正則語法（字元類、錨點、選擇、$）JS 與 Python 相同。
    """
    path = os.path.join(SITE_DIR, "lang.config.js")
    src = open(path, encoding="utf-8").read()
    m = re.search(r"^\s*structuralTagRe:\s*/(.+)/,\s*$", src, re.M)
    if not m:
        return None
    try:
        return re.compile(m.group(1))
    except re.error as e:
        sys.exit(f"❌ {SITE}/lang.config.js 的 structuralTagRe 轉不成 Python 正則：{e}")
