# stock-analysis
A stock analysis tool designed for long-term investors and value investors

## 帳號層 v1（已部署：<https://zhufacheng.github.io/stock-analysis/>）

只做註冊＋登入＋登出＋我是誰＋忘記密碼。規格與實測依據在 `SPEC.md` 第 10、11 節。
託管是 GitHub Pages（純靜態、不跑後端），資料庫與登入用 Supabase（PostgreSQL ＋ GoTrue）。

### 檔案

| 檔 | 角色 |
|---|---|
| `index.html`、`css/styles.css`、`js/app.js` | 網頁層：註冊／登入／登出／忘記密碼／設新密碼 |
| `js/auth-api.js` | 呼叫層：只用 `fetch` 打 GoTrue（`/auth/v1/*`）與 PostgREST（`/rest/v1/*`），零依賴、零 build |
| `config.js` | 前端設定。Supabase 的**公開 key** 寫在這裡 —— 它會進 git、會被路人看到，這是設計（安全靠 Postgres 的 RLS） |
| `account.py` | 終端層指令：`register`／`login`／`whoami`／`logout`／`reset`／`status` |
| `sql/profile.sql` | 顯示名稱表 ＋ RLS policy，**要你在 dashboard 的 SQL Editor 跑** |
| `auth-session.json` | 終端登入身分檔（跑 register/login 才產生，已放 `.gitignore`；權限 600） |
| `tests/` | `auth-api.test.js`（node --test）、`account_test.py`（標準庫 unittest） |

### 零安裝跑法（終端層）

```
python3 account.py status      # 看設定與登入狀態，不連網路
python3 account.py register    # 問 email、密碼、顯示名稱 → 註冊即登入
python3 account.py whoami      # 我是誰（token 過期會自動刷新並寫回 auth-session.json）
python3 account.py logout      # 先清本地，再打 /logout 讓服务端撤銷
python3 account.py reset       # 寄重置信
```

腳本／測試想免互動：設 `STOCK_EMAIL`、`STOCK_PASSWORD`、`STOCK_DISPLAY_NAME`。
設定想免改檔：`STOCK_SUPABASE_URL`、`STOCK_SUPABASE_KEY`、`STOCK_SESSION_FILE` 等（看 `account.py` 頂端 CONFIG 區）。

### 測試

```
node --test tests/*.test.js     # 不要用 `node --test tests/`，本機 node 22 不認目錄參數
python3 tests/account_test.py
```

### 一次性設定（都已設好，留作重讀紀錄）

1. **跑 SQL**：dashboard 的 SQL Editor 貼 `sql/profile.sql` 整檔執行（冪等，可重跑）。沒跑之前，註冊/登入照樣成功，只是顯示名稱存不進去（終端會明確提示）。
2. **設 Site URL**：`Authentication → URL Configuration` 的 Site URL 設成 `https://zhufacheng.github.io/stock-analysis/`，否則重置信裡的連結會導向 Supabase 預設的 `http://localhost:3000`。實測注意：`GET /auth/v1/settings` 用**公開 key 讀不到 `site_url`**，只能從下一封信的連結驗。
3. **啟用 Pages**：Settings → Pages → `Deploy from a branch` → `main` / `(root)`。第一次建置要手動觸發 `POST /repos/{owner}/{repo}/pages/builds`（啟用後不會自己跑），之後 push 會自動建置。
4. **SMTP 暫時不用接** —— 內建 SMTP 已實測能把重置信送達（限制：2 封/小時、只發專案團隊成員地址，開放路人註冊前要換第三方）。

### 已驗收／尚未驗收

- ✅ `profile` 表與 RLS：匿名查回 `[]`（不是 404）、註冊寫入顯示名稱、whoami 讀回 —— 三條都對真實專案測過。
- ✅ 重置密碼的寄件與送達：`recover` 回 200，收件匣有信（2026-11-27）。
- ✅ Pages 部署：六個資產（根目錄、`index.html`、`css/styles.css`、`js/app.js`、`js/auth-api.js`、`config.js`）全 200，且 byte 數與本機 commit 內容逐檔一致。
- ⬜ 網頁層的渲染 —— 本機沒有圖形瀏覽器，要開瀏覽器按過註冊/登入/登出才算驗過。
- ⬜ 重置信裡那條連結（點下去設新密碼）—— 等使用者在瀏覽器點過才算。

