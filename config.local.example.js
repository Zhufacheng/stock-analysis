// config.local.example.js —— config.js 的機器專屬覆寫範例
//
// 用法：複製成同資料夾的 config.local.js（已寫進 .gitignore，所以不會進 git、
// 也不會被推到 GitHub Pages），只改你要動的欄位。index.html 會在 config.js 之後載入它。
// 沒建立也沒關係：載入 404 是無害的，只是 console 會多一行。
//
// 典型情境：本機測试要暫時的指向另一個 Supabase 專案。
window.STOCK_CONFIG = Object.assign({}, window.STOCK_CONFIG, {
  // supabase_url: "https://别的專案.supabase.co",
  // supabase_public_key: "sb_publishable_…………",
  // site_url: "http://localhost:8080/stock-analysis/",  // 本機開靜態伺服器時的位址
});
