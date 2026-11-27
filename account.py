#!/usr/bin/env python3
"""account.py —— stock-analysis 帳號層的終端指令（SPEC.md 第 10 節）

最低需求
- python3 3.9+（開發用 3.12.3），**只用標準庫**：urllib、json、getpass、pathlib、os。免 pip、免安裝。
- 能連 https://<專案代碼>.supabase.co 的對外網路（本機 2026-11-27 實測 443 可達）。
- 免建置：git clone 後直接 `python3 account.py <指令>` 就能跑。
- 註冊會寫顯示名稱到 public.profile 表；表還沒建時會明確告诉你去跑 sql/profile.sql，不算註冊失敗。

用法
  python3 account.py register      註冊（問 email、密碼、顯示名稱）→ 註冊即登入
  python3 account.py login         登入
  python3 account.py whoami        我是誰（含顯示名稱；token 過期會自動刷新）
  python3 account.py logout        登出（先清本地，再打 /logout 讓服务端撤銷）
  python3 account.py reset         忘記密碼：寄重置信（要 dashboard 已設好 SMTP 與 Site URL）
  python3 account.py status        不連網路，只看本地身分檔與設定

非互動（測試／腳本用）：設 STOCK_EMAIL、STOCK_PASSWORD、STOCK_DISPLAY_NAME 就不會問。

行為依據（2026-11-27 對本專案實測，SPEC 10.6.1／10.6.2）
- signup 在 Confirm email 關掉後直接回 session → 註冊即登入。
- access token 生命期 3600 秒；refresh **每次換新 refresh_token** → 本檔每次刷新都寫回 auth-session.json。
- logout 回 204 且服务端撤銷 session → 先清本地再打，打完舊 token 就廢。
- 重複註冊回 422 user_already_exists；密碼短於 6 碼回 422 weak_password。
"""

from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

# ─── CONFIG ───（環境變數優先，檔內是預設值；本檔其餘部分只讀這些變數）
REPO_ROOT = Path(__file__).resolve().parent

SUPABASE_URL = os.environ.get("STOCK_SUPABASE_URL", "https://dkhgksmcpvvxhelerkbo.supabase.co")
# 公開 key（sb_publishable_）：會進 git 是設計，安全靠 Postgres 的 RLS（SPEC 10.2）
SUPABASE_KEY = os.environ.get("STOCK_SUPABASE_KEY", "sb_publishable_kidthFjgE6Xf1Oxv0CbPmQ_qqbB6Usd")
PROFILE_TABLE = os.environ.get("STOCK_PROFILE_TABLE", "profile")
DISPLAY_COLUMN = os.environ.get("STOCK_DISPLAY_COLUMN", "顯示名稱")  # 中文欄名（SPEC 10.7）
ID_COLUMN = os.environ.get("STOCK_ID_COLUMN", "user_id")
MIN_PASSWORD_LENGTH = int(os.environ.get("STOCK_MIN_PASSWORD_LENGTH", "6"))  # 實測值
# 終端身分檔（SPEC 10.7 定案：repo 內 gitignored 檔。實測 refresh 會輪替 → 這個檔要能寫回）
SESSION_FILE = Path(os.environ.get("STOCK_SESSION_FILE", str(REPO_ROOT / "auth-session.json")))
HTTP_TIMEOUT = float(os.environ.get("STOCK_HTTP_TIMEOUT", "20"))
REFRESH_SKEW_SECONDS = int(os.environ.get("STOCK_REFRESH_SKEW", "60"))  # 剩不到這個秒數就先刷新
# ─── END CONFIG ───

# Supabase 回的 error_code → 給人看的一句話
MESSAGES = {
    "user_already_exists": "這個 email 已註冊，直接 login 即可。",
    "weak_password": f"密碼太短，至少要 {MIN_PASSWORD_LENGTH} 碼。",
    "invalid_credentials": "帳號或密碼不對（或這帳號不存在）。",
    "email_not_confirmed": "這帳號還沒完成 email 確認。",
    "session_not_found": "登出過了，這組登入身分已失效。",
    "refresh_token_not_found": "登入狀態已失效，請重新 login。",
}


def api(method: str, path: str, body=None, token: str | None = None):
    """打一個 Supabase 端點，回 (status, data)。network 失敗回 (0, {"msg": ...})。"""
    req = urllib.request.Request(SUPABASE_URL + path, method=method)
    req.add_header("apikey", SUPABASE_KEY)  # 實測：連 /auth/v1/health 都要帶，沒帶一律 401
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = None if body is None else json.dumps(body).encode("utf-8")
    try:
        with urllib.request.urlopen(req, data, timeout=HTTP_TIMEOUT) as resp:
            raw, status = resp.read().decode("utf-8"), resp.status
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode("utf-8"), e.code
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, {"msg": f"連不到 {SUPABASE_URL}：{e}", "error_code": "network_error"}
    if not raw.strip():  # logout 回 204 無 body（實測）
        return status, {}
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, {"msg": raw[:200]}


def describe(payload: dict, status: int) -> str:
    code = payload.get("error_code")
    if code in MESSAGES:
        return MESSAGES[code]
    return payload.get("msg") or payload.get("message") or f"失敗（HTTP {status}）"


# ── 身分檔（SPEC 10.7：要能寫回，因為每次 refresh 都會換新 refresh_token）
def load_session() -> dict | None:
    try:
        return json.loads(SESSION_FILE.read_text("utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        print(f"身分檔損壞，視為未登入：{SESSION_FILE}", file=sys.stderr)
        return None


def save_session(session: dict) -> None:
    SESSION_FILE.write_text(json.dumps(session, ensure_ascii=False, indent=1) + "\n", "utf-8")
    SESSION_FILE.chmod(0o600)  # 里面有 token，別讓同機其他帳號讀到


def clear_session() -> None:
    try:
        SESSION_FILE.unlink()
    except FileNotFoundError:
        pass


def is_expired(session: dict) -> bool:
    import time
    return session.get("expires_at", 0) - REFRESH_SKEW_SECONDS <= int(time.time())


def token_for(session: dict) -> str | None:
    """要用了就檢查生命期；過期就 refresh 並把新值寫回（實測 refresh 每次換新）。"""
    if not session:
        return None
    if not is_expired(session):
        return session["access_token"]
    status, data = api("POST", "/auth/v1/token?grant_type=refresh_token",
                       {"refresh_token": session.get("refresh_token")})
    if status != 200 or "access_token" not in data:
        print(f"刷新失敗：{describe(data, status)}", file=sys.stderr)
        clear_session()
        return None
    save_session(to_session(data))
    print("（token 已過期，自動刷新並寫回 " + SESSION_FILE.name + "）")
    return data["access_token"]


def to_session(payload: dict) -> dict:
    """login/signup/refresh 的回應 → 要存的三個欄位。缺 expires_at 時用 expires_in 自己算。"""
    import time
    now = int(time.time())
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token"),
        "expires_at": payload.get("expires_at", now + int(payload.get("expires_in", 0))),
        "email": (payload.get("user") or {}).get("email"),
    }


# ── profile 表（PostgREST）
def insert_profile(token: str, user_id: str, display_name: str):
    body = {ID_COLUMN: user_id, DISPLAY_COLUMN: display_name}
    return api("POST", f"/rest/v1/{PROFILE_TABLE}?select={ID_COLUMN}", body, token)


def read_profile(token: str, user_id: str):
    # 中文欄名必須 URL 編碼：urllib/http.client 把 request line 用 ASCII 編碼，
    # 未編碼的「顯示名稱」會直接 UnicodeEncodeError（2026-11-27 對本專案實跑抓到的）。
    select = quote(f"{ID_COLUMN},{DISPLAY_COLUMN}", safe=",")
    q = f"?select={select}&{quote(ID_COLUMN)}=eq.{user_id}"
    return api("GET", f"/rest/v1/{PROFILE_TABLE}{q}", None, token)


# ── 互動輸入（有環境變數就不問；密碼走 getpass，不進 shell 紀錄）
def ask_email(argv_default: str | None = None) -> str:
    v = os.environ.get("STOCK_EMAIL") or argv_default
    return v.strip() if v else input("Email: ").strip()


def ask_password() -> str:
    v = os.environ.get("STOCK_PASSWORD")
    return v if v else getpass.getpass("密碼: ")


def ask_display_name() -> str:
    v = os.environ.get("STOCK_DISPLAY_NAME")
    return v.strip() if v else input("顯示名稱: ").strip()


# ── 指令
def cmd_register(argv) -> int:
    email = ask_email(argv[0] if argv else None)
    password = ask_password()
    name = ask_display_name()
    if not email or not password or not name:
        print("三個欄位都要填。", file=sys.stderr)
        return 2
    if len(password) < MIN_PASSWORD_LENGTH:
        print(MESSAGES["weak_password"], file=sys.stderr)
        return 2
    status, data = api("POST", "/auth/v1/signup", {"email": email, "password": password})
    if status != 200:
        print(f"註冊失敗：{describe(data, status)}", file=sys.stderr)
        return 1
    session = to_session(data)
    save_session(session)
    print(f"已註冊並登入：{email}")
    status, pdata = insert_profile(session["access_token"], data["user"]["id"], name)
    if status in (200, 201):
        print(f"顯示名稱已寫入 {PROFILE_TABLE}：{name}")
    elif status == 404:
        print(f"顯示名稱還沒存：{PROFILE_TABLE} 表不存在 → 先在 dashboard 的 SQL Editor 跑 sql/profile.sql", file=sys.stderr)
    else:
        print(f"顯示名稱寫入失敗：{describe(pdata, status)}", file=sys.stderr)
    return 0


def cmd_login(argv) -> int:
    email = ask_email(argv[0] if argv else None)
    password = ask_password()
    status, data = api("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password})
    if status != 200:
        print(f"登入失敗：{describe(data, status)}", file=sys.stderr)
        return 1
    save_session(to_session(data))
    print(f"已登入：{data['user']['email']}")
    return 0


def cmd_whoami(argv) -> int:
    session = load_session()
    if not session:
        print("目前沒登入（跑 login 或 register）。")
        return 1
    token = token_for(session)
    if not token:
        return 1
    status, data = api("GET", "/auth/v1/user", None, token)
    if status != 200:
        print(f"讀取失敗：{describe(data, status)}", file=sys.stderr)
        return 1
    print(f"已登入：{data['email']}（id {data['id']}）")
    status, rows = read_profile(token, data["id"])
    if status == 200 and rows:
        print(f"顯示名稱：{rows[0].get(DISPLAY_COLUMN)}")
    elif status == 404:
        print(f"{PROFILE_TABLE} 表不存在 → 跑 sql/profile.sql。", file=sys.stderr)
    elif rows == []:
        print(f"{PROFILE_TABLE} 查回 0 列（RLS 沒給讀權，或這帳號還沒寫過顯示名稱）。", file=sys.stderr)
    return 0


def cmd_logout(argv) -> int:
    session = load_session()
    if not session:
        print("目前沒登入。")
        return 0
    token = session.get("access_token")
    clear_session()  # SPEC 10.7 定案：先清本地，再打 /logout
    status, data = api("POST", "/auth/v1/logout", None, token)
    if status == 204:  # 實測：logout 回 204 無 body，且服务端撤銷 session
        print("已登出（服务端 session 已撤銷）。")
        return 0
    print(f"本機狀態已清掉，但服务端登出未成功：{describe(data, status)}", file=sys.stderr)
    return 1


def cmd_reset(argv) -> int:
    email = ask_email(argv[0] if argv else None)
    status, data = api("POST", "/auth/v1/recover", {"email": email})
    if status != 200:
        print(f"寄送失敗：{describe(data, status)}", file=sys.stderr)
        return 1
    print(f"已寄出重置連結給 {email}（信可能落在垃圾郵件夾）。")
    print("注意：信裡的連結指向 dashboard 的 Site URL，要用重置流程就得把它設成網頁位址。")
    return 0


def cmd_status(argv) -> int:
    print(f"Supabase URL   : {SUPABASE_URL}")
    print(f"公開 key       : {SUPABASE_KEY[:22]}…（會進 git 是設計）")
    print(f"profile 表     : {PROFILE_TABLE}（顯示名稱欄 {DISPLAY_COLUMN}、id 欄 {ID_COLUMN}）")
    print(f"密碼最短       : {MIN_PASSWORD_LENGTH}")
    print(f"身分檔         : {SESSION_FILE}")
    session = load_session()
    if not session:
        print("登入狀態       : 未登入")
        return 0
    import time
    left = int(session.get("expires_at", 0)) - int(time.time())
    print(f"登入狀態       : {session.get('email')}（access token 剩 {left} 秒）")
    return 0


COMMANDS = {
    "register": cmd_register, "login": cmd_login, "whoami": cmd_whoami,
    "logout": cmd_logout, "reset": cmd_reset, "status": cmd_status,
}


def main(argv) -> int:
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        print("\n指令：" + "、".join(COMMANDS))
        return 0
    handler = COMMANDS.get(argv[0])
    if not handler:
        print(f"不认识的指令：{argv[0]}\n可用：" + "、".join(COMMANDS), file=sys.stderr)
        return 2
    return handler(argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
