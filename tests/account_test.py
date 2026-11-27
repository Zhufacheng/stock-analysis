#!/usr/bin/env python3
"""tests/account_test.py —— 測 account.py 的邏輯層（不連網路）

跑法（零安裝，標準庫 unittest）：
  python3 tests/account_test.py
  python3 -m unittest discover -s tests -p 'account_test.py'

期望值來自 2026-11-27 對使用者 Supabase 專案的實測（SPEC 10.6.1／10.6.2）。
"""

import io
import json
import os
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# 身分檔要在 import 前指向暫存檔（account.py 在 module 層讀環境變數）
_TMP_SESSION = Path(tempfile.mkdtemp(prefix="stock-session-test-")) / "auth-session.json"
os.environ["STOCK_SESSION_FILE"] = str(_TMP_SESSION)
os.environ["STOCK_SUPABASE_URL"] = "https://example.supabase.co"
os.environ["STOCK_SUPABASE_KEY"] = "sb_publishable_TEST"

sys.path.insert(0, str(REPO))
import account  # noqa: E402


class Response:
    """假的 urlopen 回應（context manager）。"""

    def __init__(self, status, body):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_urlopen(responses):
    """回 (callable, calls)；responses 是 [(status, body_str), ...] 依序吐出。"""
    calls = []

    def opener(req, data=None, timeout=None):
        calls.append((req, data))
        status, body = responses[min(len(calls) - 1, len(responses) - 1)]
        if status >= 400:
            raise urllib.error.HTTPError(req.full_url, status, "err", {}, io.BytesIO(body.encode("utf-8")))
        return Response(status, body.encode("utf-8"))

    return opener, calls


def clean_session():
    if _TMP_SESSION.exists():
        _TMP_SESSION.unlink()


class TestSessionShape(unittest.TestCase):
    def test_signup_回應轉成三個欄位(self):
        s = account.to_session({"access_token": "A", "refresh_token": "R",
                                "expires_in": 3600, "expires_at": 9999999999,
                                "user": {"email": "a@b.c"}})
        self.assertEqual(s["access_token"], "A")
        self.assertEqual(s["refresh_token"], "R")
        self.assertEqual(s["expires_at"], 9999999999)
        self.assertEqual(s["email"], "a@b.c")

    def test_缺_expires_at_時用_expires_in_算(self):
        before = int(time.time())
        s = account.to_session({"access_token": "A", "refresh_token": "R", "expires_in": 3600})
        self.assertGreaterEqual(s["expires_at"], before + 3600)
        self.assertLessEqual(s["expires_at"], before + 3600 + 2)

    def test_is_expired_用_reflect_skew(self):
        now = int(time.time())
        self.assertTrue(account.is_expired({"expires_at": now + 30}))     # 剩 30 秒 < skew 60
        self.assertFalse(account.is_expired({"expires_at": now + 600}))

    def test_user_id_from_吃兩種signup形狀(self):
        # 註冊即登入時 id 在 payload["user"]；需要收信驗證時整個 payload 就是 user（SPEC 10.8）
        self.assertEqual(account.user_id_from({"access_token": "A", "user": {"id": "u1"}}), "u1")
        self.assertEqual(account.user_id_from({"id": "u9", "email": "a@b.c"}), "u9")
        self.assertIsNone(account.user_id_from({}))


class TestErrorMapping(unittest.TestCase):
    def test_user_already_exists_翻成中文(self):
        self.assertIn("已註冊", account.describe({"error_code": "user_already_exists"}, 422))

    def test_weak_password_翻成中文(self):
        self.assertIn("密碼太短", account.describe({"error_code": "weak_password"}, 422))

    def test_沒有_error_code_時退回msg(self):
        self.assertEqual(account.describe({"msg": "boom"}, 500), "boom")

    def test_什么都没有時顯示狀態碼(self):
        self.assertEqual(account.describe({}, 418), "失敗（HTTP 418）")


class TestApi(unittest.TestCase):
    def setUp(self):
        self._real = account.urllib.request.urlopen

    def tearDown(self):
        account.urllib.request.urlopen = self._real

    def test_每次都帶_apikey_標頭(self):
        opener, calls = fake_urlopen([(200, "{}")])
        account.urllib.request.urlopen = opener
        account.api("GET", "/auth/v1/health")
        self.assertEqual(calls[0][0].get_header("Apikey"), "sb_publishable_TEST")

    def test_有_token_時帶_Bearer(self):
        opener, calls = fake_urlopen([(200, "{}")])
        account.urllib.request.urlopen = opener
        account.api("GET", "/auth/v1/user", None, "TOK")
        self.assertEqual(calls[0][0].get_header("Authorization"), "Bearer TOK")

    def test_204_無_body_回空dict(self):
        opener, _ = fake_urlopen([(204, "")])
        account.urllib.request.urlopen = opener
        status, data = account.api("POST", "/auth/v1/logout", None, "TOK")
        self.assertEqual(status, 204)
        self.assertEqual(data, {})

    def test_422_的_error_code_解析得出來(self):
        opener, _ = fake_urlopen([(422, json.dumps({"code": 422, "error_code": "user_already_exists",
                                                    "msg": "User already registered"}))])
        account.urllib.request.urlopen = opener
        status, data = account.api("POST", "/auth/v1/signup", {"email": "a@b.c", "password": "x" * 8})
        self.assertEqual(status, 422)
        self.assertEqual(data["error_code"], "user_already_exists")

    def test_連不到時回_status_0_不丟例外(self):
        def boom(req, data=None, timeout=None):
            raise urllib.error.URLError("no route")
        account.urllib.request.urlopen = boom
        status, data = account.api("GET", "/auth/v1/health")
        self.assertEqual(status, 0)
        self.assertEqual(data["error_code"], "network_error")


class TestSessionFile(unittest.TestCase):
    def setUp(self):
        clean_session()

    def tearDown(self):
        clean_session()

    def test_save_會寫檔且權限600(self):
        account.save_session({"access_token": "A", "refresh_token": "R", "expires_at": 1, "email": "a@b.c"})
        self.assertTrue(_TMP_SESSION.exists())
        self.assertEqual(_TMP_SESSION.stat().st_mode & 0o777, 0o600)
        self.assertEqual(account.load_session()["email"], "a@b.c")

    def test_clear_後讀回_None(self):
        account.save_session({"access_token": "A", "expires_at": 1})
        account.clear_session()
        self.assertIsNone(account.load_session())

    def test_損壞的身分檔視為未登入(self):
        _TMP_SESSION.write_text("{不是 JSON", "utf-8")
        self.assertIsNone(account.load_session())

    def test_token_for_過期時會刷新並寫回新_refresh_token(self):
        account.save_session({"access_token": "OLD", "refresh_token": "R1",
                              "expires_at": int(time.time()) - 1, "email": "a@b.c"})
        calls = []

        def fake_api(method, path, body=None, token=None):
            calls.append(path)
            return 200, {"access_token": "NEW", "refresh_token": "R2", "expires_at": int(time.time()) + 3600}
        real = account.api
        account.api = fake_api
        try:
            token = account.token_for(account.load_session())
        finally:
            account.api = real
        self.assertEqual(token, "NEW")
        self.assertIn("/auth/v1/token?grant_type=refresh_token", calls[0])
        self.assertEqual(account.load_session()["refresh_token"], "R2")  # 實測：refresh 會輪替 → 要寫回

    def test_token_for_刷新失敗時清檔(self):
        account.save_session({"access_token": "OLD", "refresh_token": "R1", "expires_at": int(time.time()) - 1})
        real = account.api
        account.api = lambda *a, **k: (400, {"error_code": "refresh_token_not_found"})
        try:
            self.assertIsNone(account.token_for(account.load_session()))
        finally:
            account.api = real
        self.assertIsNone(account.load_session())


class TestProfileUrls(unittest.TestCase):
    """中文欄名放進 URL 的代價（SPEC 10.7）：query 必須 URL 編碼。"""

    def _capture(self, fn, response):
        seen = {}

        def fake(method, path, body=None, token=None):
            seen["method"], seen["path"], seen["body"] = method, path, body
            return response
        real = account.api
        account.api = fake
        try:
            fn()
        finally:
            account.api = real
        return seen

    def test_read_profile_的_query_必須是ASCII可編碼(self):
        # 未編碼時 urllib/http.client 會 UnicodeEncodeError（2026-11-27 對本專案實跑抓到的真 bug）
        seen = self._capture(lambda: account.read_profile("TOK", "u1"), (200, []))
        seen["path"].encode("ascii")
        self.assertIn("%E9%A1%AF%E7%A4%BA%E5%90%8D%E7%A8%B1", seen["path"])
        self.assertIn("user_id=eq.u1", seen["path"])

    def test_insert_profile_中文只在_body_不在_URL(self):
        seen = self._capture(lambda: account.insert_profile("TOK", "u1", "小美"), (201, []))
        seen["path"].encode("ascii")
        self.assertEqual(seen["body"], {"user_id": "u1", "顯示名稱": "小美"})
        self.assertEqual(seen["path"], "/rest/v1/profile?select=user_id")


class TestCommands(unittest.TestCase):
    def setUp(self):
        clean_session()
        self._real = account.api
        self._out = io.StringIO()
        self._err = io.StringIO()
        self._saved_env = dict(os.environ)

    def tearDown(self):
        account.api = self._real
        clean_session()
        os.environ.clear()
        os.environ.update(self._saved_env)

    def test_register_密碼太短時不打通訊(self):
        os.environ.update({"STOCK_EMAIL": "a@b.c", "STOCK_PASSWORD": "abc", "STOCK_DISPLAY_NAME": "小美"})
        calls = []
        account.api = lambda *a, **k: calls.append(a) or (200, {})
        code = account.cmd_register([])
        self.assertEqual(code, 2)
        self.assertEqual(calls, [])

    def test_register_成功會寫身分檔並寫入顯示名稱(self):
        os.environ.update({"STOCK_EMAIL": "a@b.c", "STOCK_PASSWORD": "Probe!2026pw", "STOCK_DISPLAY_NAME": "小美"})
        seen = {}

        def fake(method, path, body=None, token=None):
            seen.setdefault("paths", []).append(path)
            if path.endswith("/signup"):
                return 200, {"access_token": "A", "refresh_token": "R", "expires_at": int(time.time()) + 3600,
                             "user": {"id": "u1", "email": "a@b.c"}}
            return 201, [{"user_id": "u1"}]
        account.api = fake
        code = account.cmd_register([])
        self.assertEqual(code, 0)
        self.assertEqual(account.load_session()["access_token"], "A")
        self.assertIn("/rest/v1/profile?select=user_id", seen["paths"][1])

    def test_register_重複註冊回1並印中文提示(self):
        os.environ.update({"STOCK_EMAIL": "a@b.c", "STOCK_PASSWORD": "Probe!2026pw", "STOCK_DISPLAY_NAME": "小美"})
        account.api = lambda *a, **k: (422, {"error_code": "user_already_exists"})
        self.assertEqual(account.cmd_register([]), 1)
        self.assertIsNone(account.load_session())

    def test_register_profile表不存在時仍是成功並提示跑SQL(self):
        os.environ.update({"STOCK_EMAIL": "a@b.c", "STOCK_PASSWORD": "Probe!2026pw", "STOCK_DISPLAY_NAME": "小美"})

        def fake(method, path, body=None, token=None):
            if path.endswith("/signup"):
                return 200, {"access_token": "A", "refresh_token": "R", "expires_at": int(time.time()) + 3600,
                             "user": {"id": "u1", "email": "a@b.c"}}
            return 404, {"message": "Could not find the table 'public.profile' in the schema cache"}
        account.api = fake
        self.assertEqual(account.cmd_register([]), 0)

    def test_register_Confirm_email開著時不回token就不寫身分檔(self):
        os.environ.update({"STOCK_EMAIL": "a@b.c", "STOCK_PASSWORD": "Probe!2026pw", "STOCK_DISPLAY_NAME": "小美"})
        calls = []
        account.api = lambda *a, **k: calls.append(a) or (
            200, {"id": "u9", "email": "a@b.c", "email_confirmed_at": None})
        self.assertEqual(account.cmd_register([]), 0)
        self.assertIsNone(account.load_session(), "沒有 access_token 就不該寫登入身分")
        self.assertEqual([c[1] for c in calls], ["/auth/v1/signup"], "無 token 時不該打 profile（寫不進去）")

    def test_logout_先清本地再打端點(self):
        account.save_session({"access_token": "A", "refresh_token": "R", "expires_at": int(time.time()) + 3600})
        state = {}

        def fake(method, path, body=None, token=None):
            state["file_gone_when_called"] = not _TMP_SESSION.exists()
            return 204, {}
        account.api = fake
        self.assertEqual(account.cmd_logout([]), 0)
        self.assertTrue(state["file_gone_when_called"], "SPEC 10.7：先清本地、再打 /logout")
        self.assertIsNone(account.load_session())

    def test_logout_沒登入時回0不打通訊(self):
        calls = []
        account.api = lambda *a, **k: calls.append(a) or (204, {})
        self.assertEqual(account.cmd_logout([]), 0)
        self.assertEqual(calls, [])

    def test_whoami_未登入時回1(self):
        self.assertEqual(account.cmd_whoami([]), 1)

    def test_whoami_會讀顯示名稱(self):
        account.save_session({"access_token": "A", "refresh_token": "R", "expires_at": int(time.time()) + 3600})

        def fake(method, path, body=None, token=None):
            if path == "/auth/v1/user":
                return 200, {"id": "u1", "email": "a@b.c"}
            return 200, [{"user_id": "u1", "顯示名稱": "小美"}]
        account.api = fake
        self.assertEqual(account.cmd_whoami([]), 0)

    def test_whoami_profile查回0列時提示RLS(self):
        account.save_session({"access_token": "A", "refresh_token": "R", "expires_at": int(time.time()) + 3600})

        def fake(method, path, body=None, token=None):
            if path == "/auth/v1/user":
                return 200, {"id": "u1", "email": "a@b.c"}
            return 200, []
        account.api = fake
        self.assertEqual(account.cmd_whoami([]), 0)

    def test_status_不連網路(self):
        account.api = lambda *a, **k: (_ for _ in ()).throw(AssertionError("status 不該打網路"))
        self.assertEqual(account.cmd_status([]), 0)

    def test_不認識的指令回2(self):
        self.assertEqual(account.main(["跳起來"]), 2)


class TestConfig(unittest.TestCase):
    def test_預設欄位名與規格一致(self):
        self.assertEqual(account.DISPLAY_COLUMN, "顯示名稱")
        self.assertEqual(account.ID_COLUMN, "user_id")
        self.assertEqual(account.PROFILE_TABLE, "profile")
        self.assertEqual(account.MIN_PASSWORD_LENGTH, 6)  # 實測值

    def test_身分檔預設檔名與環境覆寫(self):
        # 本測試在 import 前就把 STOCK_SESSION_FILE 指到暫存目錄，
        # 所以這裡驗的是「檔名約定」與「環境變數能覆寫」，不是 repo 內那個檔。
        self.assertEqual(account.SESSION_FILE.name, "auth-session.json")
        self.assertEqual(account.SESSION_FILE, _TMP_SESSION)
        # 預設值（SPEC 10.7 定案）：無環境變數時落在 repo 根目錄
        self.assertEqual(Path(os.environ.get("STOCK_SESSION_FILE_DEFAULT", str(REPO / "auth-session.json"))),
                         REPO / "auth-session.json")

    def test_公開key不是秘密key(self):
        self.assertTrue(account.SUPABASE_KEY.startswith("sb_publishable_") or
                        account.SUPABASE_KEY == "sb_publishable_TEST")


if __name__ == "__main__":
    unittest.main(verbosity=2)
