# stock-analysis 規格（草案 v0）

最後更新：2026-11-27。本檔是規格記錄，未決項照實寫「未決定」，不代使用者填。

## 1. 定位

長期投資者與價值投資者的股票分析工具。第一版只做**台股**：輸入股票代碼（如 `2330`），以新台幣計價。

## 2. 第一版範圍（四個用途全數納入）

| 編號 | 用途 | 規格上要能做到什麼 |
|---|---|---|
| U1 | 單股深度報告 | 打一檔股票，看到該公司的估值、財務、成長性、風險等指標 |
| U2 | 歷史回看 | 看該股票過去若干年的指標與股價區間，判斷現在相對貴或便宜 |
| U3 | 多股篩選 | 一組條件過濾多檔股票，輸出通過的名單與排行 |
| U4 | 追蹤清單管理 | 自行維護一組股票，重複查看它的指標與估值變化 |

## 3. 已決定的前提

- 市場：只有台股。美股、港股第一版不支援。
- 估值方法：**第一版不定**（使用者 2026-11-26 指示「先不用管」）。
  → 含義：報告只**呈現計算好的原始指標**，不輸出「内在價值/目標價/買或不買」這類需要估值模型才有定義的結論。
- **資料架構（2026-11-27 定案）**：自建本地資料庫，**資料先进庫、分析只讀庫**。分析時不現場打網路（使用者原話：「你每次需要就去yahoo拿嗎？我不要 我要自己搜集資料庫」）。
  → 含義：資料源被擋或改版，只影響某次更新，不會讓報告開不起來。
- **庫的格式（2026-11-27 定案）**：**純文字 CSV 檔群是唯一真相**。使用者给的條件是「要是你能讀取的」——SQLite 對助手是二進位檔，需經 python3 才看得到內容；CSV 助手直接可讀、使用者直接可改、`git diff` 直接可看。
- **資料新鲜度**：等於上次更新時間，所以**每份報告要印「資料截至日期」**。
- **歷史範圍（2026-11-27 定案）**：使用者要的是**一檔股票的全部歷史**，不是十年（原話「我想要不止十年 要有一檔股票的所有歷史」）。
  → 實測：Yahoo 對 `.TW` 有資料下限，**2330、1101（1962 年掛牌的台泥）、2002、2618 四檔老股的第一筆月度資料全都在 1999-12-31**，`meta.firstTradeDate` 全為 2000-01-04，各 324 個月點 ≈ **26.9 年**。掛牌晚於 2000 者從掛牌日起（6449 自 2014-01-31、155 點；3090 自 2007-11-30、229 點）。
  → 含義：在 Yahoo 上「所有歷史」＝**約 27 年**。要 2000 年以前（台泥 1962、中鋼 1976 這批老股的頭 30 年），Yahoo 給不出，得另找源——列為未決。
  → **使用者 2026-11-27 裁決：「沒關係 那就2000年以後的」** → 第一版歷史範圍就是 **1999-12-31 起，2000 年以前不做**。
  → 連帶結論：老歷史不是必要項，**Goodinfo（Cloudflare 403）與 MOPS（JS 轉址）從必要項移除**。資料層只剩兩塊：Yahoo 抓股價與估值快照 ＋ 使用者自填 CSV。**第一版不需要任何 scraping。**
  → 庫不假設各檔同期：CSV append 天然容納長度不一的序列。
- **快照類欄位**（本益比、殖利率等「今天的值」）**按取得日期 append，不覆蓋寫**，否則留不下歷史。
- **每列必填的共用欄位**：`股票代碼`、`年度（民國年）`或`日期`、`來源`、`取得日期`。沒有來源欄，兩年後無法分辨該數值是官方財報還是抓來的網頁。

## 4. 未決定的規格點

| 項目 | 現況 | 為什麼重要 |
|---|---|---|
| 資料取得來源 | **取得方式已定**（自建庫，見第 3 節）；**欄位由誰提供**未定——使用者 2026-11-27 說要自己找資料，檔還沒進來 | 見第 5 節，它是 U2/U3 的可行性前提 |
| 庫的更新方式 | **未答**（手動跑一次／cron 排程自動抓，兩案皆已口頭說明） | 決定要不要寫更新腳本與排程，也決定資料最多會舊多久 |
| 輸出形式 | 未選（終端表格／網頁報告／兩層都要，尚未決定） | 決定要不要前端與部署方式 |
| 追蹤清單的存放 | 未定 | U4 需要一個可持久化的清單檔（位置與欄位待選） |
| 股價顆粒度與價格基準 | **未答**（助手提議：存月度；同時存「調整後」與「未調整收盤」兩欄） | 全史下每日約 6,750 列／檔，月度約 324 列／檔，差 20 倍 |
| 使用者自填資料的格式條件 | 未確認（「每股為單位」「民國年＋現金股利屬獲利年度或配發年度」「EPS 與股價同一填權基準」三條由助手提出） | 條件沒定，資料找回來要重工 |

## 5. 四個用途對「資料面」的硬性要求

這是本規格目前最關鍵的推論：**資料來源未定，U2 與 U3 無法定案**。
（2026-11-27 更新：資料架構＝自建 CSV 庫、歷史範圍＝1999-12-31 起，兩項都已定案，此推論的障礙只剩**使用者自填的資料檔尚未進 repo**。）

- U2 歷史回看 → 需要**多年時間序列**（不是最新一欄），年營收、獲利、殖利率、本益比等都要有歷史。
- U3 多股篩選 → 需要**批次取數**（幾十到幾百檔），還要考慮快取，否則每次篩選都重抓一次。
  → 2026-11-27 自建庫定案後，篩選變成**在本地 CSV 上過濾**，幾百檔也不打網路，此項成本大降。
- U4 追蹤清單 → 需要**可寫入的清單資料**，與前兩項的資料存放方式應共用同一套。
- U1 單股深度報告 → 只需**一檔的當期資料**，是唯一可以完全脫離批次取數先做出来的用途。

結論：U1 是四个用途裡唯一在資料來源未定時就能动工并驗證的。

## 6. 開發順序（提案，尚未拍板）

依第 5 節的依賴關係提議：

1. U1 單股深度報告 —— 先定「一份報告要列哪些指標」，這一步不需要資料來源定案（可先用一份手写样例資料跑通）。
2. U2 歷史回看 —— 资料來源在此變成硬需求。
3. U4 追蹤清單 —— 複用 U1/U2 的資料層，加一個清單檔。
4. U3 多股篩選 —— 批次取數與效能壓力最大，放最後。

## 7. 庫的表結構（助手提議，檔名與欄位尚未經使用者認）

一個資料表一個 CSV 檔，全部為純文字：

| 檔（暫名） | 內容 | 主要 key |
|---|---|---|
| 股票清單 | 代碼、公司名、產業、上市／上櫃、掛牌日期 | 股票代碼 |
| 股價 | 日期、開／高／低／收、成交股數 | 股票代碼 + 日期 |
| 股利 | 年度、每股現金股利、每股股票股利 | 股票代碼 + 年度 |
| 财務 | 年度、EPS、每股淨值、負債比、ROE、毛利率、營業利益率、每股現金流 | 股票代碼 + 年度 |
| 估值快照 | 取得日期、本益比、殖利率、每股盈餘（rolling）、帳面值、ROE、自由現金流 | 股票代碼 + 取得日期（append，不覆蓋） |

每張表另需 `來源` 與 `取得日期` 兩欄（見第 3 節）。

## 8. 要使用者取得的欄位清單（2026-11-27 開單）

**要使用者自己找的（9 項）**：歷年每股現金股利（含股票股利）、歷年 EPS、歷年每股淨值、歷年負債比、歷年 ROE、歷年毛利率／營業利益率、歷年每股現金流、股數與歷年分割／增資紀錄、公司基本欄位。

**最小可用集**：歷年現金股利 + EPS + 每股淨值。湊齊這三項即可算 U2 的歷年本益比與歷年殖利率，其餘是 U1 财務品質的加深。

**手填的量（按第 3 節定案的全史 ≈ 27 年計）**：最小可用集是 3 欄 × 27 年 = **81 個數字／檔**；九欄全填是 **243 個數字／檔**。三十檔追蹤清單對應 2,430 個數字（最小集）或 7,290 個（九欄全填）。

**已驗證可自動取得、不用使用者找的**：股價歷史（10 年）、現行估值快照、近 4 年營收與獲利、官方價量。

## 9. 資料源實測紀錄（2026-11-26，從本機、無 API key）

避免日後重複探測：

- Yahoo `v8/finance/chart/2330.TW?range=10y&interval=1mo` → 200，TWD，121 個月點（2016-11-30～2026-11-26）。
- Yahoo `v10/finance/quoteSummary` → 需先取 cookie（`fc.yahoo.com`）＋ `v1/test/getcrumb`，否則 401 `Invalid Crumb`。2330 實測 PE 22.0、殖利率 1.12%、trailing EPS 97.47、帳面值 269.85、ROE 41.9%、FCF 有值；2330/2002/2412/3090/6449 五檔全 200。
- Yahoo `earnings.financialsChart.yearly` → 近 4 年營收與獲利（2330 為 2022～2025）。
- **對 `.TW` 結構性拿不到**：`incomeStatementHistory`／`balanceSheetHistory`／`cashflowStatementHistory` 回 0 筆；歷年股利三條路徑全空（`chart?interval=1d&events=div` 5 年 0 事件、`dividendsPerShare.hist` 空、`calendarEvents` 只有下一次除息日）。
- TWSE `zh/exchangeReport/STOCK_DAY?response=json&date=YYYYMMDD&stockNo=2330` 與 `MI_INDEX?response=json&type=INDST` → 200 純 JSON 免鑰。
- Goodinfo → 403「Just a moment...」（Cloudflare JS 挑戰，加瀏覽器標頭照樣擋）。MOPS 全站（含 `/mops/web/` 根路徑）回同一段 65 bytes JS 轉址，curl 進不去。
- 網域本身不存在（DoH 查得 NXDOMAIN）：`twse.gov.tw`、`opendata.twse.org.tw`、`api.finfo.tw`、`web-api.usdpc.com.tw`。`ws/fundamentals-timeseries` 連 AAPL 都回 404，是端點形狀問題，非台股專屬。
- **2026-11-27 全史探測**（`period1=0&interval=1mo`）：2330／1101／2002／2618 四檔皆為 324 個月點、首筆 **1999-12-31**、`firstTradeDate` 2000-01-04、跨度 26.9 年；6449 首筆 2014-01-31（155 點）、3090 首筆 2007-11-30（229 點）→ 1999-12-31 是 Yahoo 對 `.TW` 的資料下限，不是各檔掛牌日。

## 10. 帳號系統（login system，2026-11-27 開規）

使用者 2026-11-27 要求：「在 stock analysis 專案下建立一個 login system，用於使用者注冊和登入的，使用者的數據存在數據庫裏」。

### 10.1 範圍（已定）

**只做註冊＋登入**。使用者 2026-11-27 明示選「只做註冊＋登入」，不要順帶掛追蹤清單。
→ 含義：v1 的帳號層不與 U1–U4 的股票資料建立外鍵關係；U4 追蹤清單屬不屬某個使用者，留給 U4 动工時再定。

v1 帳號層要做**五件事**：註冊（**email＋密碼＋顯示名稱**）、登入、確認自己是誰（已登入身分）、登出、**忘記密碼（寄重置信）**。
（第 10.1 節原本只列四件事，「忘記密碼」是 2026-11-27 使用者拍板納入 v1 的第五件。）

**註冊欄位（2026-11-27 定案）**：使用者拍「**要名字，多一欄**」→ 註冊表單三格（email、密碼、顯示名稱），登入後畫面要能顯示名字。
→ 連帶後果：`auth.users` 沒有現成欄位放暱稱，**必須自建 `public.profile` 表**（見第 10.4 節末），第 10.4 節原本那條「v1 不需要 profile 表」作废。

### 10.2 已決定的技術前提（2026-11-27）

| 項目 | 定案 | 連帶後果 |
|---|---|---|
| 託管 | **GitHub Pages** | 純靜態、**不跑後端**：註冊/登入的驗證只能發生在客戶端（瀏覽器 JS 與終端腳本），沒有伺服器端程式可藏秘密 |
| 資料庫 | **Supabase（PostgreSQL）** | 使用者資料在遠端 Postgres，不在本機檔案 |
| 登入實作 | **Supabase 內建 Auth（GoTrue）** | 密碼由 Supabase 端雜湊，我方不寫雜湊 |
| 介面 | **兩層都要**：網頁 ＋ 終端 | 網頁＝純 HTML/JS 上 GitHub Pages；終端＝python3 3.12 標準庫 |

**選 Supabase Auth 解決的問題**：「兩層都要」原本有個風險——若密碼雜湊自己寫，JS 端（`crypto.subtle`）與終端端（`hashlib`）的演算法、迭代數、編碼要逐字相同，否則網頁註冊的帳號在終端登不進去。改由 Supabase 端雜湊後，兩層都只打同一個端點，**此風險消失**。

**anon key 是公開的**：它會出現在前端 JS 與終端腳本的 CONFIG 裡，不是秘密。安全要靠 Postgres 的 RLS（row level security），不是靠藏 key。

### 10.3 與第 3 節 CSV 定案的關係（不是矛盾，是例外）

第 3 節定「純文字 CSV 檔群是唯一真相」，判準是使用者给的「要是你能讀取的」。該定案的對象是**股票資料**。

**帳號資料落在遠端 Postgres，是該判準的例外**，理由兩條：
- 資料在 Supabase，本機沒有檔案可讀。助手要讀它得經 REST（`curl` ＋ anon key），不能 `read_file`。
- 同一 email 註冊兩次要挡掉，靠的是 Postgres 的 unique 約束，不在本機文字檔裡。

→ 含義：以後看到「帳號資料不在 CSV」不算違反第 3 節；股票資料仍照第 3 節走 CSV。本機**沒有** `sqlite3` CLI 也沒有 `mysql` client，所以連本地 SQL 檔都不便直接開。

### 10.4 要打的端點（2026-11-27 全部實測通過，結果見 10.6.1／10.6.2）

全部打 `https://<專案代碼>.supabase.co`，每次請求都帶 `apikey: <anon key>`，涉及身分的再帶 `Authorization: Bearer <access_token>`：

| 動作 | 端點（暫定） |
|---|---|
| 註冊 | `POST /auth/v1/signup` |
| 登入 | `POST /auth/v1/token?grant_type=password` |
| 刷新 | `POST /auth/v1/token?grant_type=refresh_token` |
| 我是誰 | `GET /auth/v1/user` |
| 登出 | `POST /auth/v1/logout` |

登入成功回 `access_token`、`refresh_token`、`expires_in` 與 `user`。帳號主檔在 Supabase 管的 `auth.users`。
→ **v1 需要一張 `public.profile` 表**（2026-11-27 因使用者拍「要名字」定案；本節原本寫「v1 不需要 profile 表」，作废）：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `user_id` | `uuid`，主鍵，`references auth.users(id) on delete cascade` | 使用者 id，一筆帳號對一筆 |
| 顯示名稱 | `text not null` | 註冊表單的第三格 |
| 建立時間 | `timestamptz default now()` | |

**RLS 一定要補 policy**：專案開著「新表自動開 RLS」（第 10.2 節那條交互作用）→ 沒 policy 時 `anon` 查它回 **0 列**、寫入被直接擋。v1 只需要 `authenticated` 讀寫自己那一筆，`anon` 不給讀（名字不對路人公開）。

**建表由使用者在 dashboard 的 SQL Editor 貼 SQL 執行**：公開 key 連 `GET /rest/v1/` 都回 401「Secret API key required」（10.6.1 實測），DDL 更不在公開 key 的能力內，本機也沒有 psql client → 分工是**助手寫 SQL、使用者貼/run**。

**實測後的五條更正與補充**（2026-11-27，逐條測過）：
1. 五條端點路徑全對，**且每一条都要帶 `apikey`**——`/auth/v1/health`、`/auth/v1/settings` 不帶也回 401，沒有免鑰端點。
2. `logout` 回 **204 無 body**，且會**服务端撤銷 session**（舊 access token 立刻 403 `session_not_found`、refresh 一併失效）。
3. `signup` 在關掉 Confirm email 後**直接回完整 session**，等於註冊即登入，前端不必再打一次登入。
4. `token?grant_type=refresh_token` **每次回一支新的 refresh_token**（輪替），舊的只在短窗口內還可用 → 客戶端一定要存回新值。
5. `GET /rest/v1/`（列錶清單）**只接受秘密 key**（公開 key 回 401「Secret API key required」）；查**已知表名**用公開 key 可以。所以助手用公開 key 讀表要寫死表名，不能靠列舉。

### 10.5 本機實測紀錄（2026-11-27）

- `https://supabase.co/` → **HTTP 307**（跳 www），`https://api.supabase.com/` → **HTTP 404**（根路徑無資源，但可達）→ 本機對外 443 到 Supabase 正常，終端層可用 `python3` 直打。
- **`*.supabase.co` 沒有萬用 DNS 解析**：假專案名 `abcdefghijklmnopqrstuvwxyz.supabase.co` 回 **NXDOMAIN**（`curl: (6) Could not resolve host`）→ 沒有專案代碼就連不過去，**專案代碼是动工前提**。
- `https://zhufacheng.github.io/` → **HTTP 200**（user site 已存在）。本專案上線後的位置預計是 `zhufacheng.github.io/stock-analysis/`（未定，見 10.7）。
- 本機可用 runtime：`python3` 3.12.3、`node` v22.23.5、`php`（`~/.local/bin` 的 static binary）。**沒有** `sqlite3` CLI、`mysql` client、`docker`。
- 本機**沒有圖形瀏覽器** → 網頁層的實際渲染只能由使用者的瀏覽器驗證。

**使用者的專案（2026-11-27 實測）**：Project URL ＝ `https://dkhgksmcpvvxhelerkbo.supabase.co`。
- 該代碼 **DNS 解析正常**（`time_namelookup` 0.007–0.097s），比對本節上方假代碼的 NXDOMAIN → 專案確實存在且可達。
- `GET /rest/v1/` 不帶 key → **401** `{"message":"No API key found in request","hint":"No \`apikey\` request header or url param was found."}`
- `GET /rest/v1/` 帶假 key → **401** `Invalid API key. Double check your API key.` → 邊緣閘道會驗證 key 真偽，打錯 key 是 401 不是 200。
- **`/auth/v1/health` 與 `/auth/v1/settings` 不帶 key 也回 401**（同上訊息）→ **Auth 端點一樣要帶 `apikey`**，不能免 key 偷看設定。實作時所有請求（含註冊登入）都要帶 `apikey`，第 10.4 節的此前提已實測成立。
- `GET /` 帶 key → 404 `requested path is invalid` → 根路徑沒服務，REST 只掛在 `/rest/v1/`。
- 尚未測（缺公開 key）：第 10.6 節四項。

### 10.6 拿到專案後要先實測的點

Supabase 官方 guide 三頁（`/docs/guides/auth`、`/docs/guides/auth/passwords`）在 2026-11-27 查過，以下四項**文件未寫**，不寫進規格當事實，要在他的專案上實測。
（免鑰探測不可行：`/auth/v1/settings` 不帶 `apikey` 就回 401，見 10.5 → 四項都要用帶公開 key 的請求測。）

1. **註冊後能否立刻登入**——email 確認（dashboard 的 Email provider / Confirm email 開關）預設狀態為何。若確認是開的，註冊後要點信才能登入，v1 的註冊流程就要有一句話告訴使用者「還要看信」。
2. **密碼最短長度**（ dashboard 可調）。
3. **access token 生命期**——決定終端層要不要寫 refresh 逻辑，還是每次指令都重新登入就好。
4. **重複註冊同一 email** 時 `/auth/v1/signup` 回什麼（狀態碼與訊息），前端要顯示什麼。

實測順序：探端點可達 → 註冊一個測試帳號 → 登入 → `GET /auth/v1/user` → 登出 → 重複註冊同一 email。結果補寫進本節。

#### 10.6.1 第一輪實測結果（2026-11-27，本機 python3 3.12 `urllib` 直打，用公開 key）

| 探測 | 結果 |
|---|---|
| `GET /auth/v1/health` | **200**，`{"version":"v2.199.0","name":"GoTrue"}` |
| `GET /auth/v1/settings` | **200**：`external.email: true`、`disable_signup: false`、**`mailer_autoconfirm: false`** → **Confirm email 目前是開的**（註冊要點信）。`phone`、`github`、`google`、`anonymous_users` 全 false |
| `POST /auth/v1/signup`（強密碼） | **429** `over_email_send_rate_limit`「email rate limit exceeded」→ **帳號沒被建立**（事後登入該 email 回 `invalid_credentials` 可證） |
| `POST /auth/v1/signup`（密碼 `abc`） | **422** `weak_password`「Password should be at least 6 characters.」`weak_password.reasons:["length"]` → **最短長度＝6**（實測取得，非文件推斷） |
| `POST /auth/v1/token?grant_type=password`（沒這個帳號） | **400** `invalid_credentials`「Invalid login credentials」 |
| `GET /rest/v1/<未知表>?select=*` | **404** `PGRST205`「Could not find the table ... in the schema cache」→ 公開 key 查表可用；public schema **目前一張表都沒有** |
| `GET /rest/v1/`（OpenAPI 根） | **401**「Secret API key required. Only secret API keys can be used for this endpoint.」→ 要**列錶清單**得用秘密 key；公開 key 只能查已知表名 |

**還沒測到**（被 429 卡住，要能成功註冊才測得了）：`expires_in`（access token 生命期）、重複註冊同一 email 的回覆。

**內建 SMTP 限制**（文件 `https://supabase.com/docs/guides/auth/auth-smtp`，2026-11-27 原文）：
- 「This server imposes a few important restrictions and is **not meant for production use**.」
- 「**Currently this value is set to 2 messages per hour.**」
- 「**Unless you configure a custom SMTP server for your project, Supabase Auth will refuse to deliver messages to addresses that are not part of the project's team.**」

→ 三條合起來的含義：**Confirm email 開著 ＋ 內建 SMTP** 這個組合下，開放註冊會出事——每小時只發 2 封，而且**不是專案團隊成員的 email 收信會被拒**。路人註冊收不到確認信，就永遠登不進去。v1 要開放註冊，要嘛**關掉 Confirm email**，要嘛**接自架 SMTP**。

#### 10.6.2 第二輪實測結果（2026-11-27，使用者依 10.7 裁決**關掉 Confirm email** 並存檔，`mailer_autoconfirm` 實測翻為 `true`）

| 探測 | 結果 | 對實作的含義 |
|---|---|---|
| `POST /auth/v1/signup`（強密碼） | **200**，**直接回完整 session**：`access_token`、`refresh_token`、`expires_in: 3600`、`expires_at`（epoch 秒）、`token_type: "bearer"`、`user`（`email_confirmed_at` 立刻有值、`user_metadata.email_verified: true`） | **註冊即登入**，不用跳「請看你的信箱」。**不發信 → 不吃內建 SMTP 那 2 封/小時上限** |
| `POST /auth/v1/token?grant_type=password` | **200**，頂層 keys＝`access_token`、`expires_at`、`expires_in: 3600`、`refresh_token`、`token_type`、`user`、`weak_password` | **access token 生命期＝3600 秒（1 小時）**（實測值，非文件推斷） |
| `GET /auth/v1/user`（Bearer） | **200**，回 `id`、`aud: "authenticated"`、`role: "authenticated"`、`email`、`confirmed_at`、`last_sign_in_at` | 「我是誰」用這個，不需要另外查表 |
| `POST /auth/v1/logout`（Bearer） | **204**，**body 為空** | 登出成功判準是 204，不要去 parse JSON |
| 登出後拿**舊 access token** 問 `/user` | **403** `session_not_found`「Session from session_id claim in JWT does not exist」 | 登出是**服务端真撤銷**，舊 access token 立刻作廢（不是只剩 1 小時殘命）。前端順序要對：**先清本地再打 `/logout`**，打完舊 token 就不能再用 |
| 登出後用**舊 refresh_token** | **400** `refresh_token_not_found`「Invalid Refresh Token: Refresh Token Not Found」 | 登出把 refresh 一併作廢 → 終端層登出要連 refresh 一起清掉 |
| `POST /auth/v1/signup` 同一 email 第二次 | **422** `user_already_exists`「User already registered」 | 註冊防撞的判定式＝HTTP 422 ＋ `error_code == "user_already_exists"`。前端要顯示「這帳號已註冊」 |
| refresh 輪替（不登出連用三次） | 每次 refresh 都 **200**，且**每次都發一支新的 `refresh_token`**（`4uzocwkozstv` → `pgqv3462wryq` → `rbbkwr7f2zk3`）；**舊的那支在短窗口內仍回 200**，不是立刻失效 | refresh token 會輪替 → **客戶端必須把回傳的新 `refresh_token` 寫回儲存**，否則會一直用舊的（過 reuse 窗口就失效）。實測窗口內連用三次都成功，所以「舊的先別丟」比「先丢再說」安全 |

**CORS（GitHub Pages 前端要跨網域打這支 API，2026-11-27 實測，`Origin: https://zhufacheng.github.io`）**
- `OPTIONS` 預檢 `/auth/v1/token` → **200**，`Access-Control-Allow-Origin: *`、`access-control-allow-headers: apikey,authorization,content-type`、`access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT`、`access-control-max-age: 3600` → 預檢會過，`apikey`／`authorization`／`content-type` 三個標頭都在白名單內。
- 帶 Origin 的 `POST` 登入 → **200**，`Access-Control-Allow-Origin: https://zhufacheng.github.io`（回顯 Origin，非萬用）、`access-control-allow-credentials: true`、`access-control-expose-headers: X-Total-Count, Link, X-Supabase-Api-Version`。
- `/rest/v1/` 的 `OPTIONS` 預檢同样 200 → 之後查表也不會有 CORS 問題。
→ 結論：**純靜態前端可以直接打 Supabase，不需要中介後端**，第 10.2 節「GitHub Pages 不跑後端」这条路走得通。

**探測留下的東西**：`auth.users` 現有一筆 `probe+20261127a@example.com`（id `05ed357f-5e47-406a-86db-baaa96304f74`）。要刪要在 dashboard（Authentication → Users）刪，或用**秘密 key** 打 `DELETE /auth/v1/admin/users/{id}`——公開 key 不能刪（admin 端點要秘密 key）。

### 10.7 帳號系統拍板紀錄與未決點

**已定案（使用者 2026-11-27 逐項拍板）**

| 項目 | 定案 | 連帶要求 |
|---|---|---|
| 註冊欄位 | email＋密碼＋顯示名稱 | 要 `public.profile` 表＋RLS policy（見 10.1、10.4） |
| 欄位命名 | **中文欄名**（與第 7 節的 CSV 表一致） | Postgres 識別符**必須包雙引號且大小寫敏感**：`"顯示名稱"`。SQL、PostgREST 的 `select=` 參數、JS 端都要照樣帶引號，漏一個就查不到欄位 |
| email 確認 | **關掉**（dashboard 關並存檔，實測 `mailer_autoconfirm: true`） | 註冊即登入，无「要看信」狀態；代價是 email 未驗證，打錯不會被發現 |
| 忘記密碼 | **納入 v1**（第五件事） | → SMTP 需求回來，見下方未決點 |
| 終端身分檔 | **repo 內 gitignored 檔**（暫名 `auth-session.json`） | 要**可寫回**（refresh 每次輪替，見 10.6.2）；要進 `.gitignore` 免得 token 進 git；路徑走相對 repo，符合「clone 即用、不要機器專屬絕對路徑」的慣例 |
| 前端登出 | **真打 `/logout`** | 順序＝**先清本地 → 再打 `/logout`**（實測：打完舊 access token 立刻 403 `session_not_found`，refresh 一併作廢） |

**還未決**

| 項目 | 現況 | 為什麼重要 |
|---|---|---|
| **SMTP 服務**（因「忘記密碼入 v1」而變成必要） | **已接 Resend**：帳號開好、API key 已取得（`re_…`，**秘密，不寫進 repo**），本機 2026-11-27 實測 SMTP AUTH **通過**。不綁域名 → 用共享域 `onresend.com`，DNS 一條都不動 | 內建 SMTP 不能用於開放註冊（2 封/小時、只發團隊成員、文件自稱 not meant for production），且實測 `/auth/v1/recover` 對 `@example.com` 直接回「Email address is invalid」。**本專案技術路線是 GitHub Pages，沒有自己的域名**——域名是 sunflower 那條共享主機路線的前提。换 SMTP 只改 dashboard 設定，**不改程式碼** |
| Supabase 端 SMTP 設定 | **Port 要填 `587`，不是 465**（2026-11-27 實測：填 465 時 `recover` 回 500「Error sending recovery email」）。其餘：Host `smtp.resend.com`、Username `resend`、Password＝那把 key、Sender Email 用 `@onresend.com` 結尾的地址 | Sender Email 的域名必須是 Resend 認可的域名；填 gmail.com 這類會被擋。**Port 的由來見 11.1 的 port 實測表**：Supabase 走「明文連線＋STARTTLS」，465 是隱含 TLS 的 port |
| **Site URL** | 未設（要設成 `https://zhufacheng.github.io/stock-analysis/`；有 Redirect URLs 清單也加同一個） | 重置信裡的連結導向Site URL；不設則導向 Supabase 預設的 `http://localhost:3000` |
| 網頁部署位址 | 未定（預計 `zhufacheng.github.io/stock-analysis/`） | repo 名是連字號 `stock-analysis`，本機資料夾是底線 `stock_analysis`，Pages 的網址取 repo 名。CORS 已實測對 `zhufacheng.github.io` 通行（10.6.2） |
| profile 的 RLS policy 內容 | 未寫。方向已定：`authenticated` 讀寫自己那一筆，`anon` 不給讀 | 開著「新表自動開 RLS」→ 沒 policy 查回 0 列、寫入被擋（10.2） |
| 建表的 SQL | 分工已定（助手寫 SQL、使用者在 dashboard SQL Editor 貼/run），SQL 本身尚未寫 | 公開 key 不能做 DDL（10.6.1），本機也沒有 psql client |

## 11. 帳號層實作交付（2026-11-27，使用者說「全都做」）

三層一次寫入本機 repo，**尚未部署、尚未 commit**。

| 檔 | 角色 |
|---|---|
| `sql/profile.sql` | `public.profile`（`user_id` uuid PK＋`"顯示名稱"`＋`"建立時間"`）＋四條 RLS policy（本人讀/插/改）。冪等：`create table if not exists`、`drop policy if exists` |
| `config.js` | 前端設定（公開 key、表名、中文欄名、密碼最短 6、Site URL、localStorage key、刷新提前量 60 秒）。`config.local.js` 可覆寫且已 gitignore |
| `js/auth-api.js` | 呼叫層，零依賴零 build。`signup`／`login`／`refresh`／`whoami`／`logout`／`recover`／`updatePassword`／`insertProfile`／`fetchProfile`；錯誤判別一律讀 `error_code` |
| `index.html`＋`css/styles.css`＋`js/app.js` | 網頁層。分頁式三表單＋登入後狀態列；重置連結從 URL fragment 取 `type=recovery`＋`access_token` |
| `account.py` | 終端層，零安裝（標準庫）。`register`／`login`／`whoami`／`logout`／`reset`／`status`；頂端 CONFIG 區全部可用環境變數覆寫 |
| `auth-session.json` | 終端身分檔（gitignored，`chmod 600`） |
| `tests/auth-api.test.js`、`tests/account_test.py` | 兩層各一套邏輯測試，不打網路 |

**規格落地時照著的實測行為**：註冊即登入（不再打一次登入）；`logout` 判 204；先清本地再打 `/logout`；refresh 每次輪替 → 兩層都寫回新 `refresh_token`；`error_code` 是唯一穩定判別欄位；中文欄名在 PostgREST 的 `select=` 要 URL 編碼。

### 11.1 驗證結果（老實分清測到的與沒測到的）

- `node --test tests/*.test.js` → **13/13 通過**。
- `python3 tests/account_test.py` → **33/33 通過**。
- **對使用者的真實專案實跑終端層**：`status`、`register`、`login`、`whoami`、`logout` 全部照預期（帳號 `probe+20261127e@example.com`，id `c543229f-858c-4fab-b657-3dbbfb94b424`）。profile 相關都走「表不存在」那條分支，符合預期（SQL 還沒跑）。
- **對真實專案實跑網頁層的呼叫層**（`node` 載入 `js/auth-api.js` ＋ 真 `fetch`，就是瀏覽器會走的那條代碼路徑）：`login` 200 並拿到 session、`whoami` 200 回 email、`logout` **204**、登出後 `whoami` **403 `session_not_found`**（實測行為在代碼裡判對）、`fetchProfile`／`insertProfile` 都回 **404 `PGRST205`**（表還沒建）。
- `node --check` 與 `python3 -m py_compile` 全過。

**實跑抓到的三條新事實**（寫程式／接服務才浮出來的）：

1. **Python 端把中文欄名放進未編碼的 URL 會炸**：`http.client` 用 ASCII 編碼 request line → `UnicodeEncodeError: 'ascii' codec can't encode characters`。JS 端因為 `encodeURIComponent` 沒這問題。已修（`urllib.parse.quote`）並補兩條測試。**中文欄名的代價在兩層的表現不同**，這是 SPEC 10.7 那條定案的具體成本。
2. **`POST /auth/v1/recover` 對 `probe+…@example.com` 回「Email address … is invalid」**（非 200）→ 與文件「內建 SMTP 只送專案團隊成員地址」一致，**這是「忘記密碼必須接 Resend」的實測證據**，不是推論。接好 Resend 後這句消失，改回 500「Error sending recovery email」→ 證明地址限制已放開，剩下的是連線形態。
3. **Resend 的 SMTP port 形態（本機逐 port 實測，決定 Supabase 要填哪個 port）**：

| Port | 明文連線 EHLO | 明文＋STARTTLS 升級 | 隱含 TLS（TLS-on-connect） |
|---|---|---|---|
| 587 | 250，**不廣告** STARTTLS | **login 成功** | 失敗 `WRONG_VERSION_NUMBER` |
| 25 | 250，不廣告 STARTTLS | login 成功 | 失敗 |
| 2587 | 250，不廣告 STARTTLS | — | 失敗 |
| 465 | 明文連線**直接超時** | 不適用 | **login 成功** |
| 2465 | 明文連線超時 | 不適用 | login 成功 |

   → **結論修正**：填 587 在 SMTP 層可用（本機實測 STARTTLS 升級＋login 成功），465 是隱含 TLS 也通（login 成功）。**但 port 不是這次失敗的原因**——見下面第 4、5 條。
   → 實測過 STARTTLS 的四組端點（Resend 587／Resend 25、Brevo 587、Mailjet 587／25）**都有廣告 STARTTLS 且升級成功**。先前寫「Resend 不廣告 STARTTLS（違反慣例）」是本機測量 bug，見第 6 條。

4. **Resend 的 SMTP 要求「已驗證的域名」，共享域 `onresend.com` 不能直接寄**（2026-11-27 本機實測，逐行 SMTP 對話）：`AUTH PLAIN` → **235 Authentication successful**、`MAIL FROM:<noreply@onresend.com>` → **250 Accepted**、`RCPT TO` → **250 Accepted**、`DATA` → **550「The onresend.com domain is not verified. Please, add and verify your domain on https://resend.com/domains」**。
   → **連帶修正兩條先前結論**：(a)「用共享域就不用綁域名」對 Resend 的 **API 預設寄件人**成立，對 **SMTP 不成立**（助手先前建議錯誤，已收回）；(b) Supabase 那個 500「Error sending recovery email」是**通用訊息**，看不出真因（465 與 587 都回同樣的 500），要分清得自己發一封 SMTP 信看逐行回應。**教訓：Supabase 的 SMTP 錯誤訊息不足以診斷，別照它調 port。**
   → 待決：本專案技術路線是 GitHub Pages、**沒有自己的域名**，而 Resend 寄信要有域名。三條路：綁他買的那个域名（名字尚未提供）、換一家允許「寄件人信箱驗證」的 SMTP（Brevo／Mailjet 這類）、或把「忘記密碼」暫時從 v1 拿掉。

5. **Brevo 免費方案的 SMTP 有 IP 白名單**（2026-11-27 本機實測）：TLS 升級成功、帳密正確，四種機制（CRAM-MD5／PLAIN／LOGIN）逐一试過，**全部回 `525 5.7.1 Unauthorized IP address`** → 不是認證問題，是 IP 未登记。
   → 連帶：Supabase 那边的 `Error sending recovery email` 大概率同一條（Supabase 的出口 IP 也沒登记在 Brevo）。**用 Brevo 就要把 Supabase 的 egress IP 加進 Brevo 的 IP 清單**，而 Supabase 的 egress IP 是一組、專案重啟／升級可能換 → 這是一道會隨時間咬人的耦合。
   → 對照：**Resend 的 SMTP 沒有擋本機 IP**（未登记的 IP 直接 AUTH 成功，死在寄件域名）；Mailjet 免費 **200 封/日、6,000/月、含 SMTP Relay**（官網 pricing 頁原文），端點 `in-v3.mailjet.com` 587／25 本機實測有廣告 STARTTLS 且升級成功。

6. **本機測量 bug 記錄（影響上述結論的可信度）**：Python `smtplib` 的 `SMTP.esmtp_features` **鍵是小寫**（`'starttls'`、`'auth'`），用 `"STARTTLS" in s.esmtp_features`（大寫）查**恆為 False**，不會報錯。本專案的 SMTP 探測一度據此誤判「Resend 不廣告 STARTTLS」。修法：查小寫鍵，或直接看 `set_debuglevel(1)` 的原始 EHLO 行。

#### 11.1.1 第三輪：關掉自訂 SMTP、退回內建 SMTP（2026-11-27，本機 python3 `urllib` 直打）

使用者把 dashboard 的 **Enable SMTP 開關關掉**（存檔）後三步實測：

| 步驟 | 結果 |
|---|---|
| `GET /auth/v1/health` | **HTTP 200**（GoTrue `v2.199.0`）→ 存檔後 Auth 服務正常 |
| `POST /auth/v1/signup` `Zhufacheng@outlook.com` | **HTTP 200 且回 session** → 註冊即登入（與 10.6.2 一致） |
| `POST /auth/v1/recover` 同一地址 | **HTTP 200 → `{}`** |

- 對照組：先前對 `probe+…@example.com`（非團隊地址）recover 回「Email address … is invalid」→ 本條 200 證明 `Zhufacheng@outlook.com` 是內建 SMTP **接受**的團隊成員地址（他用 GitHub 登入 Supabase，團隊成員身分按 GitHub 已驗證的 primary email 計算）。
- **送達已確認**（2026-11-27 使用者回報：「收到了」）→ `Zhufacheng@outlook.com` 收件匣真的有那封重置信。**重置密碼的「寄」與「送達」雨段都驗過**，內建 SMTP 在 v1 够用。
- **邊界要说清**：HTTP 200 `{}` 本身只證明 GoTrue 接受了寄件請求；送達是靠使用者開收件匣確認的，不是靠狀態碼推論。
- **尚未驗的只剩連結那一段**：信裡的連結指向 dashboard 的 **Site URL**，而 Site URL **還沒設**（預設 `http://localhost:3000`），所以「點連結 → 設新密碼 → 登入成功」這一段要等 Site URL 設好、Pages 上線後由使用者的瀏覽器驗。
- 因此 v1 的「忘記密碼」可以**零新帳號**先跑通（內建 SMTP 的 2 封/小時、只發團隊成員兩條限制對 v1 開發階段可接受）；開放路人註冊前仍要接第三方 SMTP（見 11.1 第 4、5 條：有域名 → Resend；沒域名 → 選不卡 IP 白名單的）。

### 11.2 驗收狀態

**已驗收（2026-11-27，使用者在 dashboard 跑完 `sql/profile.sql` 後由助手實測）**：`profile` 表與 RLS policy 的真實行為三條全通。
- `GET /rest/v1/profile?select=user_id` 帶公開 key（＝`anon` 角色，無 Bearer）→ **HTTP 200 `[]`**，不是 404 → 表存在，且 RLS 讓匿名看不到任何列（第 10.2 節那條 fail-closed 行為在真表上確認）。
- `register` 一筆新帳號 → 顯示名稱寫入成功（`authenticated` + `auth.uid() = user_id` 的 insert policy 過得了）。
- `whoami` 讀回該筆的顯示名稱 → select policy 讓本人讀得到自己那一筆。

**已驗收（2026-11-27，退回內建 SMTP 後）**：重置密碼的**寄件與送達** —— recover 回 200，使用者回報 Outlook 收件匣「收到了」（細節見 11.1.1）。

**還不能宣稱驗過的兩件事**：

1. 網頁層的渲染與點擊 —— 本機沒有圖形瀏覽器，邏輯層全綠不等於畫面正常（sunflower 的 tab 失效就是這層漏掉的，CSS 已預先補 `[hidden]{display:none !important}`）。要等 push 上 Pages 由使用者開瀏覽器按過。
2. **重置密碼的「點連結設新密碼」那一段** —— 信裡的連結指向 dashboard 的 **Site URL，而它還沒設**（現為預設 `http://localhost:3000`），要等 Site URL 設成 Pages 位址、頁面部署後才算整條收掉。已排除的連線面：地址限制（團隊地址回 200、非團隊回 invalid，兩邊都實測過）、TLS／port（三家端點本機實測 STARTTLS 升級都成功）、認證（Brevo 帳密正確、Resend key 驗過）；自訂 SMTP 那兩家卡的是服務側政策（Resend 550 要已驗證域名、Brevo 525 要 IP 白名單，見 11.1 第 4、5 條）。

