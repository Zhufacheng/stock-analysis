/* js/app.js —— 頁面接线（DOM）。核心邏輯在 js/auth-api.js（可用 node --test 測）。
   本檔無依賴、無 build；渲染結果只能由使用者的瀏覽器驗證（本機沒有圖形瀏覽器）。 */
(function () {
  "use strict";

  const cfg = window.STOCK_CONFIG;
  const client = globalThis.StockAuth.makeClient(cfg);
  const $ = function (id) { return document.getElementById(id); };
  let activeTab = null;  // 目前選中的分頁；setSignedIn(false) 靠它把該顯示的面板還原
  let recoveryMode = false;  // 點信回來時只顯示設密碼面板，不要把登入表單也開出來

  // Supabase 回的是 error_code（實測欄位名），這裡翻成使用者看得懂的一句話
  const MESSAGES = {
    user_already_exists: "這個 email 已註冊，直接登入即可。",
    weak_password: "密碼太短，至少要 " + cfg.min_password_length + " 碼。",
    invalid_credentials: "帳號或密碼不對（或這帳號不存在）。",
    email_not_confirmed: "這帳號還沒完成 email 確認。",
    session_not_found: "登出過了，這組登入身分已失效。",
    refresh_token_not_found: "登入狀態已失效，請重新登入。",
    network_error: "連不到 Supabase（網路或網址設定）。"
  };
  function failText(r) {
    return MESSAGES[r.error_code] || (r.msg ? r.msg : "失敗（HTTP " + r.status + "）");
  }
  function msg(text, kind) {
    const el = $("msg");
    el.textContent = text || "";
    el.className = "msg" + (kind ? " " + kind : "");
  }

  // ── 登入身分的本地存放（網頁層用 localStorage；終端層用 repo 內 auth-session.json，SPEC 10.7）
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(cfg.session_storage_key) || "null"); }
    catch (e) { return null; }
  }
  function saveSession(s) { localStorage.setItem(cfg.session_storage_key, JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem(cfg.session_storage_key); }

  // access token 只有 3600 秒（實測）→ 過期就先刷新。refresh 會換新 refresh_token，必須寫回。
  function ensureSession() {
    const s = loadSession();
    if (!s) return Promise.resolve(null);
    if (!globalThis.StockAuth.isExpired(s, cfg.refresh_skew_seconds)) return Promise.resolve(s);
    return client.refresh(s.refresh_token).then(function (r) {
      if (!r.ok || !r.session) { clearSession(); msg(failText(r), "err"); return null; }
      saveSession(r.session);
      return r.session;
    });
  }

  function setSignedIn(on) {
    $("whoami").hidden = !on;
    $("tabs").hidden = on;
    ["panel-signup", "panel-login", "panel-recover"].forEach(function (id) { $(id).hidden = true; });
    // 未登入時要把選中的分頁還原，否則頁面只剩分頁按鈕、內容全空（要點一下才出現）
    if (!on && activeTab && !recoveryMode) selectTab(activeTab);
  }

  function showWho(session) {
    $("who-text").textContent = "讀取中…";
    setSignedIn(true);
    return client.whoami(session.access_token).then(function (r) {
      if (!r.ok) { clearSession(); setSignedIn(false); msg(failText(r), "err"); return; }
      const user = r.data;
      return client.fetchProfile(session.access_token, user.id).then(function (p) {
        const name = (p.ok && p.displayName) ? p.displayName : null;
        if (name) $("who-text").textContent = "你好，" + name + "（" + user.email + "）";
        else $("who-text").textContent = user.email + "（顯示名稱尚未寫入，請先跑 sql/profile.sql）";
      });
    });
  }

  // ── 分頁切換
  const tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  function selectTab(btn) {
    activeTab = btn;
    tabs.forEach(function (t) {
      t.setAttribute("aria-selected", t === btn ? "true" : "false");
      $(t.dataset.panel).hidden = t !== btn;
    });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { selectTab(t); }); });

  function formValues(form) {
    const fd = new FormData(form);
    const out = {};
    fd.forEach(function (v, k) { out[k] = String(v).trim(); });
    return out;
  }

  // ── 註冊：實測 Confirm email 關掉後 signup 直接回 session → 註冊即登入（SPEC 10.6.2）
  $("form-signup").addEventListener("submit", function (ev) {
    ev.preventDefault();
    const v = formValues(ev.target);
    if (!v.email || !v.password || !v.display_name) { msg("三個欄位都要填。", "err"); return; }
    if (v.password.length < cfg.min_password_length) { msg(MESSAGES.weak_password, "err"); return; }
    msg("註冊中…");
    client.signup(v.email, v.password).then(function (r) {
      if (!r.ok) { msg(failText(r), "err"); return; }
      saveSession(r.session);
      return client.insertProfile(r.session.access_token, r.data.user.id, v.display_name).then(function (pr) {
        if (!pr.ok && pr.status === 404) msg("帳號建好了，但 profile 表不存在 —— 先在 dashboard 的 SQL Editor 跑 sql/profile.sql。", "err");
        else if (!pr.ok) msg("帳號建好了，但顯示名稱寫入失敗：" + failText(pr), "err");
        else msg("註冊完成，已登入。", "ok");
        return showWho(r.session);
      });
    });
  });

  $("form-login").addEventListener("submit", function (ev) {
    ev.preventDefault();
    const v = formValues(ev.target);
    msg("登入中…");
    client.login(v.email, v.password).then(function (r) {
      if (!r.ok) { msg(failText(r), "err"); return; }
      saveSession(r.session);
      msg("登入成功。", "ok");
      showWho(r.session);
    });
  });

  // SPEC 10.7 定案：先清本地 → 再打 /logout（實測打完舊 token 立刻 403 session_not_found）
  $("btn-logout").addEventListener("click", function () {
    const s = loadSession();
    clearSession();
    setSignedIn(false);
    if (!s) { msg("目前沒登入。", "ok"); return; }
    msg("登出中…");
    client.logout(s.access_token).then(function (r) {
      msg(r.ok ? "已登出。" : "已清掉本機登入狀態（伺服器端：" + failText(r) + "）", r.ok ? "ok" : "err");
    });
  });

  $("form-recover").addEventListener("submit", function (ev) {
    ev.preventDefault();
    const v = formValues(ev.target);
    msg("寄出中…");
    client.recover(v.email).then(function (r) {
      msg(r.ok ? "已寄出重置連結（若這 email 有帳號）。信可能落在垃圾郵件夾。" : failText(r), r.ok ? "ok" : "err");
    });
  });

  // 重置密碼：Supabase 把連結導到 SITE_URL，參數在 URL fragment（#access_token=…&type=recovery）
  function recoveryParams() {
    const raw = location.hash.replace(/^#/, "") || location.search.replace(/^\?/, "");
    const p = new URLSearchParams(raw);
    if (p.get("type") === "recovery" && p.get("access_token")) {
      return { access_token: p.get("access_token"), refresh_token: p.get("refresh_token") };
    }
    return null;
  }

  const rec = recoveryParams();
  if (rec) {
    recoveryMode = true;
    ["panel-signup", "panel-login", "panel-recover"].forEach(function (id) { $(id).hidden = true; });
    $("tabs").hidden = true;
    $("panel-reset").hidden = false;
    msg("請設新密碼。", "ok");
    $("form-reset").addEventListener("submit", function (ev) {
      ev.preventDefault();
      const v = formValues(ev.target);
      if (v.password.length < cfg.min_password_length) { msg(MESSAGES.weak_password, "err"); return; }
      client.updatePassword(rec.access_token, v.password).then(function (r) {
        if (!r.ok) { msg(failText(r), "err"); return; }
        const s = { access_token: rec.access_token, refresh_token: rec.refresh_token,
                    expires_at: Math.floor(Date.now() / 1000) + 3600 };
        saveSession(s);
        $("panel-reset").hidden = true;  // 套用成功後收掉設密碼表單，只留狀態列
        msg("新密碼已套用。", "ok");
        showWho(s);
      });
    });
  }

  $("pw-hint").textContent = "密碼至少 " + cfg.min_password_length + " 碼（實測：太短回 weak_password）。";
  if (!rec) selectTab(tabs[0]);  // recovery 時內容只有設密碼面板，不要把任何分頁開出來
  // recovery 模式下不收尾成「未登入」畫面：分頁列不該出現，內容只有設密碼面板
  ensureSession().then(function (s) {
    if (s && !rec) showWho(s);
    else if (!s && !rec) setSignedIn(false);
  });
})();
