/* 帳號層前端模組：零依賴、零 build。
   只用 fetch 打 Supabase 的 GoTrue（/auth/v1/*）與 PostgREST（/rest/v1/*）。
   所有行為都是 2026-11-27 對使用者專案實測過的（SPEC 10.6.1／10.6.2），註解裡標了出處。 */
(function (global) {
  "use strict";

  const AUTH = "/auth/v1";
  const REST = "/rest/v1";

  // 實測：expires_in 3600、另有 expires_at（epoch 秒）。缺 expires_at 時用 expires_in 自己算。
  function toSession(payload) {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: payload.expires_at || (now + (payload.expires_in || 0))
    };
  }

  function isExpired(session, skewSeconds) {
    if (!session || !session.expires_at) return true;
    return session.expires_at - (skewSeconds === undefined ? 0 : skewSeconds) <= Math.floor(Date.now() / 1000);
  }

  // 工廠函式：測試時塞假 fetch，前端塞真 fetch
  function makeClient(cfg, fetchImpl) {
    const fetchFn = fetchImpl ? fetchImpl : global.fetch.bind(global);

    function request(method, path, opts) {
      const o = opts || {};
      const headers = { apikey: cfg.supabase_public_key };
      if (o.token) headers["Authorization"] = "Bearer " + o.token;
      if (o.body !== undefined) headers["Content-Type"] = "application/json";
      let p = fetchFn(cfg.supabase_url + path, {
        method: method,
        headers: headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body)
      });
      return p.then(function (res) {
        return res.text().then(function (text) {
          let data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
          const ok = res.status >= 200 && res.status < 300;
          return {
            ok: ok,
            status: res.status,
            // GoTrue 的錯誤判別欄位是 error_code（實測：weak_password / user_already_exists / session_not_found …）
            error_code: data && data.error_code ? data.error_code : null,
            msg: (data && (data.msg || data.message)) || null,
            data: data
          };
        });
      }, function (err) {
        return { ok: false, status: 0, error_code: "network_error", msg: String(err), data: null };
      });
    }

    // PostgREST 的 select 參數要帶中文欄名 → 必須 URL 編碼（SPEC 10.7 的中文欄名代價）
    function profileSelect() {
      return "?select=" + encodeURIComponent(cfg.profile_id_column + "," + cfg.profile_display_column);
    }

    function profilePath() { return REST + "/" + cfg.profile_table; }

    return {
      // 註冊：實測 Confirm email 關掉後**直接回 session** → 註冊即登入，呼叫端不必再打登入
      signup: function (email, password) {
        return request("POST", AUTH + "/signup", { body: { email: email, password: password } })
          .then(function (r) {
            if (r.ok && r.data && r.data.access_token) r.session = toSession(r.data);
            return r;
          });
      },

      login: function (email, password) {
        return request("POST", AUTH + "/token?grant_type=password", { body: { email: email, password: password } })
          .then(function (r) {
            if (r.ok && r.data && r.data.access_token) r.session = toSession(r.data);
            return r;
          });
      },

      // 實測：**每次 refresh 都會換一支新的 refresh_token** → 呼叫端必須把回傳的新值寫回儲存
      refresh: function (refreshToken) {
        return request("POST", AUTH + "/token?grant_type=refresh_token", { body: { refresh_token: refreshToken } })
          .then(function (r) {
            if (r.ok && r.data && r.data.access_token) r.session = toSession(r.data);
            return r;
          });
      },

      whoami: function (accessToken) {
        return request("GET", AUTH + "/user", { token: accessToken });
      },

      // 實測：204 無 body，且**服务端撤銷 session**（舊 access token 立刻 403 session_not_found）
      // → 呼叫端順序要「先清本地、再打這個」（SPEC 10.7 定案）
      logout: function (accessToken) {
        return request("POST", AUTH + "/logout", { token: accessToken });
      },

      // 忘記密碼：寄重置信（要 dashboard 已設好 SMTP 與 Site URL）
      recover: function (email) {
        return request("POST", AUTH + "/recover", { body: { email: email } });
      },

      // 點信回來後用 URL 帶的 access_token 改密碼（GoTrue 的標準流程：更新 user 就是改密碼）
      updatePassword: function (accessToken, newPassword) {
        return request("PUT", AUTH + "/user", { token: accessToken, body: { password: newPassword } });
      },

      insertProfile: function (accessToken, userId, displayName) {
        const body = {};
        body[cfg.profile_id_column] = userId;
        body[cfg.profile_display_column] = displayName;
        return request("POST", profilePath() + "?select=" + encodeURIComponent(cfg.profile_id_column), {
          token: accessToken,
          body: body
        });
      },

      fetchProfile: function (accessToken, userId) {
        const filter = encodeURIComponent(cfg.profile_id_column) + "=eq." + userId;
        return request("GET", profilePath() + profileSelect() + "&" + filter, { token: accessToken })
          .then(function (r) {
            if (r.ok && Array.isArray(r.data)) {
              r.displayName = r.data.length ? r.data[0][cfg.profile_display_column] : null;
            }
            return r;
          });
      },

      // 給測試用：直接暴露低層請求
      _request: request
    };
  }

  global.StockAuth = { makeClient: makeClient, toSession: toSession, isExpired: isExpired };
  if (typeof module !== "undefined" && module.exports) module.exports = global.StockAuth;
})(typeof globalThis !== "undefined" ? globalThis : this);
