// tests/auth-api.test.js —— node --test tests/auth-api.test.js
// 測的是 js/auth-api.js 的邏輯層：假 fetch，不打網路、不需要瀏覽器。
// 期望值全部來自 2026-11-27 對使用者 Supabase 專案的實測（SPEC 10.6.1／10.6.2）。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const StockAuth = require("../js/auth-api.js");

const CFG = {
  supabase_url: "https://example.supabase.co",
  supabase_public_key: "sb_publishable_TEST",
  profile_table: "profile",
  profile_display_column: "顯示名稱",
  profile_id_column: "user_id",
  refresh_skew_seconds: 60
};

function fakeFetch(handler) {
  const calls = [];
  const fn = function (url, init) {
    calls.push({ url: url, init: init });
    const r = handler(url, init, calls.length);
    return Promise.resolve({
      status: r.status,
      text: () => Promise.resolve(r.body === undefined ? "" : JSON.stringify(r.body))
    });
  };
  fn.calls = calls;
  return fn;
}

test("signup 成功時把回應轉成 session（實測：Confirm email 關掉後直接回 session）", async () => {
  const f = fakeFetch(() => ({ status: 200, body: { access_token: "A", refresh_token: "R", expires_in: 3600, expires_at: 9999999999, user: { id: "u1", email: "a@b.c" } } }));
  const c = StockAuth.makeClient(CFG, f);
  const r = await c.signup("a@b.c", "Probe!2026pw");
  assert.equal(r.ok, true);
  assert.equal(r.session.access_token, "A");
  assert.equal(r.session.refresh_token, "R");
  assert.equal(r.session.expires_at, 9999999999);
  assert.equal(f.calls[0].url, "https://example.supabase.co/auth/v1/signup");
  assert.equal(f.calls[0].init.headers.apikey, "sb_publishable_TEST");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { email: "a@b.c", password: "Probe!2026pw" });
});

test("缺 expires_at 時用 expires_in 自己算（實測兩個欄位都會回，容錯要有）", () => {
  const s = StockAuth.toSession({ access_token: "A", refresh_token: "R", expires_in: 3600 });
  assert.ok(s.expires_at > Math.floor(Date.now() / 1000));
  assert.ok(s.expires_at <= Math.floor(Date.now() / 1000) + 3600);
});

test("isExpired：剩 30 秒、skew 60 秒視為過期（access token 實測只有 3600 秒）", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(StockAuth.isExpired({ expires_at: now + 30 }, 60), true);
  assert.equal(StockAuth.isExpired({ expires_at: now + 300 }, 60), false);
  assert.equal(StockAuth.isExpired(null, 60), true);
});

test("重複註冊：422 + user_already_exists 要能被判別（前端照 error_code 翻譯）", async () => {
  const f = fakeFetch(() => ({ status: 422, body: { code: 422, error_code: "user_already_exists", msg: "User already registered" } }));
  const r = await StockAuth.makeClient(CFG, f).signup("a@b.c", "Probe!2026pw");
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.error_code, "user_already_exists");
  assert.equal(r.msg, "User already registered");
});

test("refresh 會回新 refresh_token → 呼叫端拿 r.session 寫回（實測每次輪替）", async () => {
  const f = fakeFetch(() => ({ status: 200, body: { access_token: "A2", refresh_token: "R2", expires_in: 3600, expires_at: 9999999999 } }));
  const r = await StockAuth.makeClient(CFG, f).refresh("R1");
  assert.equal(r.session.refresh_token, "R2");
  assert.equal(JSON.parse(f.calls[0].init.body).refresh_token, "R1");
  assert.match(f.calls[0].url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
});

test("logout：204 無 body 要當成功（實測 204 + 空 body）", async () => {
  const f = fakeFetch(() => ({ status: 204, body: undefined }));
  const r = await StockAuth.makeClient(CFG, f).logout("A");
  assert.equal(r.ok, true);
  assert.equal(r.status, 204);
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer A");
});

test("insertProfile：body 的 key 是中文欄名，POST 到 /rest/v1/profile", async () => {
  const f = fakeFetch(() => ({ status: 201, body: [{ user_id: "u1" }] }));
  await StockAuth.makeClient(CFG, f).insertProfile("A", "u1", "小美");
  const call = f.calls[0];
  assert.equal(call.init.method, "POST");
  assert.match(call.url, /^https:\/\/example\.supabase\.co\/rest\/v1\/profile\?select=user_id$/);
  assert.deepEqual(JSON.parse(call.init.body), { user_id: "u1", 顯示名稱: "小美" });
  assert.equal(call.init.headers["Content-Type"], "application/json");
});

test("fetchProfile：select 參數要把中文欄名 URL 編碼（SPEC 10.7 中文欄名的代價）", async () => {
  const f = fakeFetch(() => ({ status: 200, body: [{ user_id: "u1", 顯示名稱: "小美" }] }));
  const r = await StockAuth.makeClient(CFG, f).fetchProfile("A", "u1");
  const qs = new URL(f.calls[0].url).search;
  assert.ok(qs.includes("%E9%A1%AF%E7%A4%BA%E5%90%8D%E7%A8%B1"), "中文欄名要編碼：" + qs);
  assert.ok(qs.includes("user_id=eq.u1"));
  assert.equal(r.displayName, "小美");
});

test("fetchProfile：RLS 讓 anon 查回 0 列時 displayName 是 null，不是报错", async () => {
  const f = fakeFetch(() => ({ status: 200, body: [] }));
  const r = await StockAuth.makeClient(CFG, f).fetchProfile("A", "u1");
  assert.equal(r.ok, true);
  assert.equal(r.displayName, null);
});

test("網路掛掉回 status 0 + network_error，不會噴未處理的 reject", async () => {
  const c = StockAuth.makeClient(CFG, () => Promise.reject(new Error("boom")));
  const r = await c.whoami("A");
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.equal(r.error_code, "network_error");
});

test("登出後拿舊 token 問 /user → 403 session_not_found 能被判別（實測行為）", async () => {
  const f = fakeFetch(() => ({ status: 403, body: { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" } }));
  const r = await StockAuth.makeClient(CFG, f).whoami("A");
  assert.equal(r.error_code, "session_not_found");
});

test("recover 打 /auth/v1/recover 並帶 email", async () => {
  const f = fakeFetch(() => ({ status: 200, body: {} }));
  await StockAuth.makeClient(CFG, f).recover("a@b.c");
  assert.match(f.calls[0].url, /\/auth\/v1\/recover$/);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { email: "a@b.c" });
});

test("updatePassword：點信回來後用 PUT /auth/v1/user 帶新密碼", async () => {
  const f = fakeFetch(() => ({ status: 200, body: { id: "u1" } }));
  await StockAuth.makeClient(CFG, f).updatePassword("A", "New!2026pw");
  assert.equal(f.calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { password: "New!2026pw" });
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer A");
});
