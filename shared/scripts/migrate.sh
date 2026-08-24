#!/usr/bin/env bash
# =====================================================================
# Migration 執行器
#
# 為什麼需要它：先前 10 次 schema 變更全靠手動貼進 Supabase 後台，
# 沒有「已套用哪些」的記錄，也無法在送出前驗證 SQL ——
# 第 10 次就撞上 create-or-replace-view 不能改欄位順序而失敗。
#
# 用法：
#   scripts/migrate.sh status          列出已套用／待套用
#   scripts/migrate.sh check           只驗證語法（在交易中跑完即 rollback）
#   scripts/migrate.sh up              套用所有待套用的
#   scripts/migrate.sh up 0011         只套用指定的一個
#   scripts/migrate.sh baseline 0010   把 0010 及之前登記為已套用（不執行）
#                                      —— 給「先前已手動跑過」的那批用。
#                                      必須指定上限，否則會把還沒跑的也
#                                      登記掉，之後 up 就會跳過它們。
#
# 站台：SITE=japanese scripts/migrate.sh up（預設 korean）
#   migration SQL 只有一份，兩站共用同一套 schema，
#   但跑在各自的 Supabase 專案上。連錯專案是這支腳本最貴的錯誤，
#   所以每次都把 project ref 印出來 —— 靜默地連對或連錯，人看不出差別。
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."          # → shared/
REPO="$(cd .. && pwd)"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

SITE="${SITE:-korean}"
ENV_FILE="$REPO/$SITE/.env.local"
[ -f "$ENV_FILE" ] || { echo "❌ 缺少 $SITE/.env.local" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
REF=$(echo "$SUPABASE_URL" | sed 's#https://##;s#\.supabase\.co##')
echo "🎯 站台 $SITE · Supabase 專案 $REF" >&2
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
# 連線主機：優先直連，解不到就走 pooler。
#
# ★ Supabase 已經把直連（db.<ref>.supabase.co）改成 IPv6-only，
#   而多數網路沒有 IPv6 出口 —— 那個主機在這裡連 A 與 AAAA 紀錄都查不到。
#   症狀是 psql 說「could not translate host name」，
#   看起來像網路壞了，實際上是這條路已經沒有了。
#   IPv4 要走 pooler，使用者名稱也不同（postgres.<ref>）。
#
#   區域寫在各站的 .env.local（SUPABASE_DB_REGION）——
#   它不是密鑰，但每站不同，而且從 API 的回應標頭問不出來。
DB_HOST="db.$REF.supabase.co"
DB_USER="postgres"
if ! python3 -c "import socket,sys; socket.getaddrinfo('$DB_HOST',5432)" 2>/dev/null; then
  if [ -z "$SUPABASE_DB_REGION" ]; then
    echo "❌ 直連主機 $DB_HOST 解不到，而 .env.local 裡沒有 SUPABASE_DB_REGION。"
    echo "   Supabase 的直連已改成 IPv6-only，IPv4 要走 pooler。"
    echo "   請在 <站台>/.env.local 加一行，例如：SUPABASE_DB_REGION=ap-northeast-1"
    exit 1
  fi
  DB_HOST="aws-0-$SUPABASE_DB_REGION.pooler.supabase.com"
  DB_USER="postgres.$REF"
  echo "   （直連無 DNS，改走 pooler：${DB_HOST}）"
fi
PSQL=(psql -h "$DB_HOST" -p 5432 -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -q)

ensure_table() {
  "${PSQL[@]}" -c "
    create table if not exists public.schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now(),
      checksum   text
    );" >/dev/null
}

applied() { "${PSQL[@]}" -tAc "select version from public.schema_migrations order by version"; }

files() { ls supabase/migrations/*.sql | sort; }
ver()   { basename "$1" .sql; }

cmd="${1:-status}"

case "$cmd" in
  status)
    ensure_table
    A=$(applied)
    echo "已套用："
    [ -z "$A" ] && echo "  （無）" || echo "$A" | sed 's/^/  ✅ /'
    echo "待套用："
    P=0
    for f in $(files); do
      grep -qx "$(ver "$f")" <<<"$A" || { echo "  ⏳ $(ver "$f")"; P=1; }
    done
    [ "$P" = 0 ] && echo "  （無，全部已套用）" || true
    ;;

  baseline)
    # 登記但不執行。用在「這些 migration 先前已手動跑過」的情況 ——
    # 重跑雖然多半安全（多數語句是 if-not-exists），但其中夾雜
    # 回填用的 UPDATE，沒必要冒險再動一次資料。
    #
    # ★ 必須指定上限版本。第一次寫這支時沒有這個限制，結果把當時
    #   剛寫好、還沒執行的 0011 也登記了，up 便直接跳過 —— 資料庫
    #   裡的舊函式其實還在，但記錄上顯示已套用。
    if [ -z "${2:-}" ]; then
      echo "錯誤：baseline 必須指定上限版本，例如 $0 baseline 0010" >&2
      echo "     否則會把還沒執行的 migration 也登記成已套用。" >&2
      exit 1
    fi
    ensure_table
    for f in $(files); do
      V=$(ver "$f")
      [[ "$V" > "$2" && "$V" != "$2"* ]] && continue
      SUM=$(shasum -a 256 "$f" | cut -c1-16)
      "${PSQL[@]}" -c "insert into public.schema_migrations(version,checksum)
        values ('$V','$SUM') on conflict (version) do nothing;" >/dev/null
      echo "  登記 $V"
    done
    echo "完成（未執行任何 SQL）。"
    ;;

  check)
    # 在交易中跑完立刻 rollback —— 驗證語法但不留下任何改動
    for f in $(files); do
      [ -n "${2:-}" ] && [[ "$(ver "$f")" != "$2"* ]] && continue
      printf "  %-28s " "$(ver "$f")"
      if (echo "begin;"; cat "$f"; echo "rollback;") | "${PSQL[@]}" >/dev/null 2>/tmp/mig_err; then
        echo "✅ 語法通過"
      else
        echo "❌"; sed 's/^/       /' /tmp/mig_err | head -6
      fi
    done
    ;;

  up)
    ensure_table
    A=$(applied)
    for f in $(files); do
      V=$(ver "$f")
      [ -n "${2:-}" ] && [[ "$V" != "$2"* ]] && continue
      grep -qx "$V" <<<"$A" && continue
      SUM=$(shasum -a 256 "$f" | cut -c1-16)
      printf "  套用 %-28s " "$V"
      # 整份 migration 與登記在同一個交易裡：要嘛都成功，要嘛都回滾，
      # 不會出現「跑了但沒登記」或「登記了但沒跑」的半套狀態。
      if (echo "begin;"; cat "$f";
          echo "insert into public.schema_migrations(version,checksum) values ('$V','$SUM')
                on conflict (version) do update set applied_at=now(), checksum=excluded.checksum;";
          echo "commit;") | "${PSQL[@]}" >/dev/null 2>/tmp/mig_err; then
        echo "✅"
      else
        echo "❌ 已回滾"; sed 's/^/       /' /tmp/mig_err | head -8; exit 1
      fi
    done
    echo "完成。"
    ;;

  *) echo "用法：$0 {status|check|up} [version]"; exit 1 ;;
esac
