// config.js —— 前端設定（零安裝：純靜態檔，GitHub Pages 直接服務）
//
// 這裡的 key 是 Supabase 的**公開 key**（前綴 sb_publishable_），它會出現在前端原始碼裡、
// 也會進 git，這是設計而非外洩：安全靠 Postgres 的 RLS，不靠藏这把 key（SPEC 10.2）。
// 秘密 key（sb_secret_ / service_role）不在這裡，前端不該拿到它。
//
// 要換專案／換環境：建一個同格式的 config.local.js（已寫進 .gitignore），
// 它在 config.js 之後載入，會覆寫下面的值。
window.STOCK_CONFIG = {
  // 專案代碼是 `dkhgksmcpvvxhelerkbo`（SPEC 10.5）
  supabase_url: "https://dkhgksmcpvvxhelerkbo.supabase.co",
  supabase_public_key: "sb_publishable_kidthFjgE6Xf1Oxv0CbPmQ_qqbB6Usd",

  // 帳號主檔由 Supabase 管，顯示名稱在我們這張表
  profile_table: "profile",
  profile_display_column: "顯示名稱", // 中文欄名（SPEC 10.7）；PostgREST 查詢要 URL 編碼
  profile_id_column: "user_id",

  min_password_length: 6, // 實測值：太短回 422 weak_password（SPEC 10.6.1）

  // 忘記密碼的重置連結會跳到這里（Supabase dashboard 的 Site URL 要設成同一個值，
  // 否則信裡的連結會導向 Supabase 預設的 http://localhost:3000）
  site_url: "https://zhufacheng.github.io/stock-analysis/",

  session_storage_key: "stock.session.v1",
  // Confirm email 開著時，註冊回的是 user、沒有 token → 顯示名稱先暫存在這裡，
  // 等使用者點驗證連結回到頁面（URL 帶 type=signup 與 token）才寫進 profile 表。
  pending_profile_key: "stock.pendingProfile.v1",
  // access token 實測生命期 3600 秒（SPEC 10.6.2）；提前這個秒數就視為過期、先刷新
  refresh_skew_seconds: 60
};
