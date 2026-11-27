/* tests/app-dom.test.js —— 測 js/app.js 的 DOM 接線（假 DOM，不連網路）

   為什麼要這一層：`node --test tests/auth-api.test.js` 測的是純邏輯，`app.js` 里的
   「誰該顯示、誰該藏起來」完全沒覆蓋，而 2026-11-27 使用者在瀏覽器裡抓到的三個問題
   （進頁面看不到登入表單、套用新密碼後設密碼面板還留著、最下面那行字）全部在这一層。

   假 DOM 的 id 清單是**從 index.html 掃出來的**：app.js 若引用了 HTML 裡不存在的 id
   （例如 footer 被刪掉卻還去取 #backend-note），會在這裡爆掉，而不是悄悄斷掉後面幾行。

   跑法：node --test tests/*.test.js
*/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(REPO, "index.html"), "utf-8");

function readScript(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf-8");
}

/** 掃 index.html 取得元素與分頁（順序＝文件順序，與真瀏覽器一致）。
    元素的初始 `hidden` 也從 HTML 讀——真瀏覽器開場就是照 HTML 的 hidden 屬性渲染。 */
function parseIndexHtml() {
  const ids = [];
  const hiddenInitial = {};
  const re = /<(\w+)([^>]*\bid="([^"]+)"[^>]*)>/g;
  let m;
  while ((m = re.exec(HTML))) {
    ids.push(m[3]);
    hiddenInitial[m[3]] = /(^|\s)hidden(\s|>|$)/.test(m[2]);
  }

  const tabs = [];
  const reTab = /<button[^>]*class="tab"[^>]*data-panel="([^"]+)"[^>]*>/g;
  while ((m = reTab.exec(HTML))) tabs.push(m[1]);

  const panels = [];
  const rePanel = /<section id="(panel-[^"]+)"/g;
  while ((m = rePanel.exec(HTML))) panels.push(m[1]);

  return { ids: ids, tabs: tabs, panels: panels, hiddenInitial: hiddenInitial };
}

function makeElement(id, hidden) {
  return {
    id: id,
    hidden: !!hidden,
    textContent: "",
    className: "",
    attrs: {},
    dataset: {},
    listeners: {},
    _fields: [], // 表單欄位 [name, value]，測試直接設值
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener: function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatch: function (type, ev) {
      const self = this;
      (this.listeners[type] || []).forEach(function (fn) {
        fn(ev || { preventDefault: function () {}, target: self });
      });
    }
  };
}

function makeLocalStorage(initial) {
  const store = Object.assign({}, initial);
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    _store: store
  };
}

/**
 * 依路由表造假 fetch。routes: [{method, includes, status, body}]，第一條比中的生效。
 */
function makeFetch(routes, calls) {
  return function (url, opts) {
    const method = (opts && opts.method) || "GET";
    const hit = routes.filter(function (r) {
      return r.method === method && url.indexOf(r.includes) >= 0;
    })[0];
    calls.push({ method: method, url: url });
    const status = hit ? hit.status : 404;
    const body = hit && hit.body !== undefined ? hit.body : "{}";
    return Promise.resolve({
      status: status,
      text: function () { return Promise.resolve(body); }
    });
  };
}

const DEFAULT_ROUTES = [
  { method: "GET", includes: "/auth/v1/user", status: 200, body: JSON.stringify({ id: "u1", email: "a@b.c" }) },
  { method: "PUT", includes: "/auth/v1/user", status: 200, body: JSON.stringify({ id: "u1", email: "a@b.c" }) },
  { method: "GET", includes: "/rest/v1/profile", status: 200, body: JSON.stringify([{ user_id: "u1", "顯示名稱": "小美" }]) },
  { method: "POST", includes: "/auth/v1/logout", status: 204, body: "" },
  { method: "POST", includes: "/auth/v1/token", status: 200, body: JSON.stringify({}) }
];

function loadApp(opts) {
  const o = opts || {};
  const html = parseIndexHtml();
  const els = {};
  html.ids.forEach(function (id) { els[id] = makeElement(id, html.hiddenInitial[id]); });
  const tabEls = html.tabs.map(function (panelId) {
    const e = els[panelId.replace(/^panel-/, "tab-")] || makeElement("tab-" + panelId);
    e.dataset.panel = panelId;
    return e;
  });
  // index.html 的分頁按鈕本身也是元素：id 由 tab 順序補（app.js 只用 querySelectorAll(".tab")）
  const document = {
    getElementById: function (id) { return Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null; },
    querySelectorAll: function (sel) { return sel === ".tab" ? tabEls : []; }
  };

  const calls = [];
  const sandbox = {
    console: console,
    document: document,
    location: { hash: o.hash || "", search: "" },
    localStorage: makeLocalStorage(o.session ? { "stock.session.v1": JSON.stringify(o.session) } : {}),
    fetch: makeFetch(o.routes || DEFAULT_ROUTES, calls),
    URLSearchParams: URLSearchParams,
    FormData: function FormData(form) { this._f = (form && form._fields) || []; },
    Promise: Promise,
    Math: Math,
    Date: Date,
    JSON: JSON,
    setTimeout: setTimeout,
    setImmediate: setImmediate
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.FormData.prototype.forEach = function (cb) {
    this._f.forEach(function (pair) { cb(pair[1], pair[0]); });
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(readScript("config.js"), ctx);
  vm.runInContext(readScript("js/auth-api.js"), ctx);
  vm.runInContext(readScript("js/app.js"), ctx);

  return {
    els: els,
    tabEls: tabEls,
    calls: calls,
    sandbox: sandbox,
    visiblePanels: function () {
      return html.panels.filter(function (id) { return els[id] && els[id].hidden === false; });
    },
    flush: function () {
      // app.js 全是 Promise 鏈，多輪巨集任務才跑得完（whoami → fetchProfile 兩段）
      return new Promise(function (resolve) {
        let n = 0;
        (function tick() {
          if (n++ >= 8) return resolve();
          setTimeout(tick, 0);
        })();
      });
    }
  };
}

test("進頁面就顯示登入表單（不需要點分頁）", async function () {
  const app = loadApp({});
  await app.flush();
  assert.deepStrictEqual(app.visiblePanels(), ["panel-login"]);
  assert.strictEqual(app.els["tabs"].hidden, false, "未登入時分頁列要可見");
  assert.strictEqual(app.els["whoami"].hidden, true, "未登入時狀態列要隱藏");
  assert.strictEqual(app.tabEls[0].dataset.panel, "panel-login", "登入分頁要排第一");
  assert.strictEqual(app.tabEls[0].getAttribute("aria-selected"), "true");
});

test("分頁切換：點註冊只显示註冊", async function () {
  const app = loadApp({});
  await app.flush();
  app.tabEls[1].dispatch("click");
  assert.deepStrictEqual(app.visiblePanels(), ["panel-signup"]);
  app.tabEls[0].dispatch("click");
  assert.deepStrictEqual(app.visiblePanels(), ["panel-login"]);
});

test("登出後要有東西可看（回到選中的分頁，不能整頁空白）", async function () {
  const app = loadApp({ session: { access_token: "A", refresh_token: "R", expires_at: Math.floor(Date.now() / 1000) + 3600 } });
  await app.flush();
  assert.strictEqual(app.els["whoami"].hidden, false, "有 session 時顯示狀態列");
  assert.strictEqual(app.els["tabs"].hidden, true, "已登入時藏起分頁");
  app.els["btn-logout"].dispatch("click");
  await app.flush();
  assert.strictEqual(app.els["whoami"].hidden, true);
  assert.deepStrictEqual(app.visiblePanels(), ["panel-login"]);
  assert.strictEqual(app.sandbox.localStorage.getItem("stock.session.v1"), null, "登出要清掉 localStorage 身分");
});

test("點信回來：只顯示設密碼面板；套用後收掉", async function () {
  const app = loadApp({ hash: "#access_token=TOK&refresh_token=R1&expires_in=3600&type=recovery" });
  await app.flush();
  assert.strictEqual(app.els["panel-reset"].hidden, false, "type=recovery 要出現設密碼面板");
  assert.deepStrictEqual(app.visiblePanels(), ["panel-reset"], " recovery 時不顯示註冊/登入/忘記密碼");
  assert.strictEqual(app.els["tabs"].hidden, true);

  app.els["form-reset"]._fields = [["password", "Newpass!2026"]];
  app.els["form-reset"].dispatch("submit");
  await app.flush();

  assert.strictEqual(app.els["panel-reset"].hidden, true, "套用成功後設密碼面板要收掉（2026-11-27 使用者回報）");
  assert.strictEqual(app.els["whoami"].hidden, false, "套用後顯示登入狀態");
  assert.match(app.els["who-text"].textContent, /小美/);
  const put = app.calls.filter(function (c) { return c.method === "PUT" && c.url.indexOf("/auth/v1/user") >= 0; });
  assert.strictEqual(put.length, 1, "改密碼打 PUT /auth/v1/user");
});

test("页面底部不再有 backend-note（那行字已删）", async function () {
  assert.doesNotMatch(HTML, /backend-note/, "index.html 裡不該再有 #backend-note");
  assert.doesNotMatch(readScript("js/app.js"), /backend-note/, "app.js 裡不該再取 #backend-note");
  const app = loadApp({});
  await app.flush();
  assert.ok(app.calls.length >= 0); // 載入過程沒炸（引用不存在的 id 會在這裡噴出來）
});
