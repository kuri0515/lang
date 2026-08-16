#!/usr/bin/env python3
"""
建立帳號 —— 走 Supabase Admin API（需要 service_role key）

為什麼需要這支腳本：
  Supabase Auth 只認 email，不認使用者名稱。本站的做法是把
  `kuri` 透明映射成 `kuri@kuri0515.local`（見 js/auth-map.js，前後端同一套規則）。
  管理員角色也只能在建號時由 service_role 寫進 metadata，
  一般註冊走 anon key 無法偽造 —— 這是防提權的關鍵。

用法：
    python3 scripts/create_user.py kuri --password 0515 --admin
    python3 scripts/create_user.py kuri --password 0515 --admin --apply
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ★ 與前端 js/auth-map.js 必須完全一致，改一邊等於改壞登入
EMAIL_DOMAIN = "kuri0515.local"
PASSWORD_PAD = "-k0515"          # 補位字串：Supabase 要求密碼至少 6 位
MIN_LEN = 6


def to_email(username):
    u = username.strip().lower()
    return u if "@" in u else f"{u}@{EMAIL_DOMAIN}"


def to_password(raw):
    """短密碼透明補位。注意：這不增加強度，只是滿足平台下限。"""
    return raw if len(raw) >= MIN_LEN else raw + PASSWORD_PAD


def load_env():
    path = os.path.join(ROOT, ".env.local")
    if not os.path.exists(path):
        sys.exit("❌ 缺少 .env.local")
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("❌ .env.local 裡缺 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY")
    return url.rstrip("/"), key


def api(url, key, method, path, payload=None):
    req = urllib.request.Request(
        f"{url}{path}",
        method=method,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None,
    )
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        return {"__error__": e.code, "__detail__": e.read().decode("utf-8", "replace")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("username")
    ap.add_argument("--password", required=True)
    ap.add_argument("--display-name", default=None)
    ap.add_argument("--admin", action="store_true", help="設為管理員")
    ap.add_argument("--apply", action="store_true", help="真正建立（預設 dry-run）")
    args = ap.parse_args()

    email = to_email(args.username)
    pwd = to_password(args.password)

    print(f"👤 帳號名   : {args.username}")
    print(f"   對應 email: {email}")
    print(f"   密碼      : 你輸入 {len(args.password)} 位"
          + (f"，實際存 {len(pwd)} 位（自動補位 '{PASSWORD_PAD}'）" if pwd != args.password else ""))
    print(f"   角色      : {'admin 管理員' if args.admin else 'user 一般使用者'}")

    if not args.apply:
        print("\n🔎 dry-run：沒有建立任何帳號。確認無誤後加 --apply 重跑。")
        return

    url, key = load_env()

    res = api(url, key, "POST", "/auth/v1/admin/users", {
        "email": email,
        "password": pwd,
        "email_confirm": True,        # 內部網域收不到信，直接標為已驗證
        "user_metadata": {
            "username": args.username.strip().lower(),
            "display_name": args.display_name or args.username,
            **({"role": "admin"} if args.admin else {}),
        },
    })

    if "__error__" in res:
        sys.exit(f"❌ 建立失敗 HTTP {res['__error__']}\n{res['__detail__']}")

    uid = res.get("id")
    print(f"\n✅ 已建立 auth 使用者 {uid}")

    # 回讀 profile 核對 —— 不靠斷言，確認 trigger 真的落了 role
    prof = api(url, key, "GET", f"/rest/v1/profiles?id=eq.{uid}&select=username,display_name,role")
    if "__error__" in prof:
        print(f"⚠️  profile 回讀失敗：{prof['__detail__']}")
    elif prof:
        p = prof[0]
        print(f"✅ profile 回讀：username={p['username']} role={p['role']}")
        if args.admin and p["role"] != "admin":
            sys.exit("❌ 角色沒落地！檢查 handle_new_user trigger 是否已建立")
    else:
        print("⚠️  profile 不存在 —— on_auth_user_created trigger 可能沒建")

    print(f"\n🔑 登入方式：帳號 {args.username} ／ 密碼 {args.password}")


if __name__ == "__main__":
    main()
