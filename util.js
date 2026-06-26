"use strict";
/*
 * Shared runtime — window.NRB. STABLE CONTRACT (see BUILD_SPEC.md).
 * v2 adds: odds, icon (flag/monogram), fav, history, box, carousel, drawer.
 */
(function () {
  const NRB = (window.NRB = window.NRB || {});

  // ---- anonymous per-browser user id (no login; isolates each visitor) -----
  function getUid() {
    let u = null;
    try { u = localStorage.getItem("nrb_uid"); } catch (e) {}
    if (!u) {
      u = (window.crypto && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, "")
        : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
      ).slice(0, 32);
      try { localStorage.setItem("nrb_uid", u); } catch (e) {}
    }
    return u;
  }
  NRB.uid = getUid;

  // ---- optional account session token (cross-device login) -----------------
  function getToken() { try { return localStorage.getItem("nrb_token") || ""; } catch (e) { return ""; } }
  function setToken(t) {
    try { t ? localStorage.setItem("nrb_token", t) : localStorage.removeItem("nrb_token"); } catch (e) {}
  }

  // ---- HTTP ----------------------------------------------------------------
  function netBanner(show) {
    const b = document.getElementById("net-banner");
    if (b) b.classList.toggle("hidden", !show);
  }
  NRB.api = async function (path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "X-User-Id": getUid() }, opts.headers || {});
    const tok = getToken();
    if (tok) opts.headers["X-Session-Token"] = tok;
    if (opts.body && typeof opts.body !== "string") {
      opts.body = JSON.stringify(opts.body);
      opts.headers["Content-Type"] = "application/json";
    }
    try {
      const r = await fetch(path, opts);
      const data = await r.json();
      netBanner(false);
      return data;
    } catch (e) {
      netBanner(true);          // network/server unreachable -> show banner
      throw e;
    }
  };

  // ---- formatting ----------------------------------------------------------
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  NRB.fmt = {
    usd: (n) => (n == null ? "—" : "$" + Number(n).toFixed(2)),
    cents: (p) => (p == null ? "—" : Math.round(p * 100) + "¢"),
    pct: (p, dp = 0) => (p == null ? "—" : (p * 100).toFixed(dp) + "%"),
    signed: (n) => (n == null ? "—" : (n >= 0 ? "+" : "-") + "$" + Math.abs(Number(n)).toFixed(2)),
    vol: (n) => { n = Number(n || 0);
      if (n >= 1e6) return (n / 1e6).toFixed(1) + "m";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
      return String(Math.round(n)); },
    cls: (n) => (n == null ? "" : n >= 0 ? "pos" : "neg"),
    esc,
    timeAgo: (ts) => { if (!ts) return "";
      const s = Math.max(0, Date.now() / 1000 - ts);
      if (s < 60) return Math.floor(s) + "s ago";
      if (s < 3600) return Math.floor(s / 60) + "m ago";
      if (s < 86400) return Math.floor(s / 3600) + "h ago";
      return Math.floor(s / 86400) + "d ago"; },
    dateShort: (iso) => { if (!iso) return "—";
      const d = new Date(iso); if (isNaN(d)) return "—";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); },
  };

  // ---- odds ----------------------------------------------------------------
  NRB.odds = {
    mult: (p) => (p && p > 0 ? 1 / p : null),
    multStr: (p) => (p && p > 0 ? (1 / p).toFixed(2) + "x" : "—"),
    prob: (p) => (p == null ? "—" : Math.round(p * 100) + "%"),
  };

  // ---- icons: flag emoji + monogram badge ----------------------------------
  const CC = { // display name -> ISO2 (World Cup + common nations)
    "argentina":"ar","australia":"au","austria":"at","belgium":"be","bolivia":"bo",
    "bosnia and herzegovina":"ba","brazil":"br","canada":"ca","cape verde":"cv",
    "chile":"cl","colombia":"co","congo dr":"cd","croatia":"hr","czechia":"cz",
    "denmark":"dk","ecuador":"ec","egypt":"eg","england":"gb-eng","france":"fr",
    "germany":"de","ghana":"gh","greece":"gr","haiti":"ht","iceland":"is",
    "ir iran":"ir","iran":"ir","iraq":"iq","ireland":"ie","italy":"it",
    "ivory coast":"ci","jamaica":"jm","japan":"jp","jordan":"jo","korea republic":"kr",
    "south korea":"kr","mexico":"mx","morocco":"ma","netherlands":"nl","new zealand":"nz",
    "nigeria":"ng","norway":"no","panama":"pa","paraguay":"py","peru":"pe",
    "poland":"pl","portugal":"pt","qatar":"qa","russia":"ru","saudi arabia":"sa",
    "scotland":"gb-sct","senegal":"sn","serbia":"rs","slovakia":"sk","south africa":"za",
    "spain":"es","sweden":"se","switzerland":"ch","tunisia":"tn","turkey":"tr",
    "ukraine":"ua","uruguay":"uy","usa":"us","united states":"us","uzbekistan":"uz",
    "wales":"gb-wls","algeria":"dz","cameroon":"cm",
  };
  const flagEmoji = (cc) => cc.toUpperCase().replace(/./g,
    (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  const monogram = (name) => {
    const w = String(name).replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    if (w.length >= 2) return w.slice(0, 3).map((x) => x[0]).join("").toUpperCase();
    return (String(name).replace(/[^A-Za-z0-9]/g, "").slice(0, 3) || "•").toUpperCase();
  };
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

  // name -> visual. Optional `logo` (a team-logo URL from the backend) wins;
  // else a country flag IMAGE (Windows browsers don't render flag emoji);
  // else a deterministic colored monogram badge. Everything resolves to *some*
  // image/representation. Images fall back to the monogram if they fail to load.
  NRB.icon = function (name, logo) {
    const t = String(name || "").trim().toLowerCase();
    if (!t) return `<span class="icobadge" style="background:#39424f">•</span>`;
    if (t === "tie" || t === "draw") return `<span class="icoflag">🤝</span>`;
    if (t === "yes") return `<span class="icobadge" style="background:var(--accent-dim)">✓</span>`;
    if (t === "no") return `<span class="icobadge" style="background:#9a3640">✕</span>`;
    const fb = `<span class=\\'icobadge\\' style=\\'background:hsl(${hue(name)},42%,40%)\\'>${esc(monogram(name))}</span>`;
    if (logo) {
      return `<img class="icoflag-img logo" src="${esc(logo)}" width="22" height="22" ` +
             `alt="" loading="lazy" onerror="this.outerHTML='${fb}'">`;
    }
    const cc = CC[t];
    if (cc) {
      return `<img class="icoflag-img" src="https://flagcdn.com/40x30/${cc}.png" ` +
             `srcset="https://flagcdn.com/80x60/${cc}.png 2x" width="22" height="16" ` +
             `alt="" loading="lazy" onerror="this.outerHTML='${fb}'">`;
    }
    return `<span class="icobadge" style="background:hsl(${hue(name)},42%,40%)">${esc(monogram(name))}</span>`;
  };

  // ---- favorites (localStorage) -------------------------------------------
  const LS = { favs: "nrb_favs", views: "nrb_views" };
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const favSubs = [];
  NRB.fav = {
    list: () => readJSON(LS.favs, []),
    has: (id) => readJSON(LS.favs, []).includes(id),
    toggle: (id) => {
      let f = readJSON(LS.favs, []);
      const on = f.includes(id);
      f = on ? f.filter((x) => x !== id) : [id, ...f];
      writeJSON(LS.favs, f);
      favSubs.forEach((cb) => { try { cb(); } catch (e) {} });
      return !on;
    },
    onChange: (cb) => favSubs.push(cb),
  };

  // ---- view history (localStorage) ----------------------------------------
  NRB.history = {
    addView: (eventTicker, category) => {
      if (!eventTicker) return;
      let v = readJSON(LS.views, []);
      v = v.filter((x) => x.e !== eventTicker);
      v.unshift({ e: eventTicker, c: category || "", t: Math.floor(Date.now() / 1000) });
      writeJSON(LS.views, v.slice(0, 60));
    },
    recent: (n) => readJSON(LS.views, []).map((x) => x.e).slice(0, n || 40),
    topCategories: (n) => {
      const counts = {};
      readJSON(LS.views, []).forEach((x) => { if (x.c) counts[x.c] = (counts[x.c] || 0) + 1; });
      return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, n || 5);
    },
  };

  // ---- shared components: market box + carousel ----------------------------
  function optionsFor(event) {
    const ms = (event.markets || []).filter(Boolean);
    if (ms.length === 1) {
      const m = ms[0];
      return [
        { name: "Yes", price: m.yes_ask || m.last_price, ticker: m.ticker, side: "yes" },
        { name: "No", price: m.no_ask, ticker: m.ticker, side: "no" },
      ];
    }
    return [...ms]
      .sort((a, b) => (b.yes_ask || 0) - (a.yes_ask || 0))
      .map((m) => ({ name: m.yes_sub_title || m.title, price: m.yes_ask || m.last_price,
                     ticker: m.ticker, side: "yes", logo: m.logo }));
  }

  NRB.box = function (event) {
    const opts = optionsFor(event);
    const shown = opts.slice(0, 3);
    const more = opts.length - shown.length;
    const firstTicker = (event.markets && event.markets[0] && event.markets[0].ticker) || "";
    const favOn = NRB.fav.has(event.event_ticker);
    const box = NRB.el(`<div class="box"></div>`);
    box.innerHTML =
      `<div class="box-top">
         <div class="box-title">${esc(event.title)}</div>
         <button class="box-fav ${favOn ? "on" : ""}" aria-label="Favorite">${favOn ? "★" : "☆"}</button>
       </div>
       <div class="box-opts">
         ${shown.map((o, i) => `
           <div class="box-opt" data-ticker="${esc(o.ticker)}" data-side="${o.side}">
             ${NRB.icon(o.name, o.logo)}
             <span class="nm">${esc(o.name)}</span>
             <span class="mult tnum">${NRB.odds.multStr(o.price)}</span>
             <span class="prob tnum">${NRB.odds.prob(o.price)}</span>
             <button class="box-add" title="Add to bet slip" data-add="${i}">+</button>
           </div>`).join("")}
         ${more > 0 ? `<div class="box-more">+${more} more</div>` : ""}
       </div>`;
    // interactions
    box.querySelector(".box-fav").addEventListener("click", (e) => {
      e.stopPropagation();
      const on = NRB.fav.toggle(event.event_ticker);
      const b = e.currentTarget; b.classList.toggle("on", on); b.textContent = on ? "★" : "☆";
    });
    box.querySelectorAll(".box-opt").forEach((row) =>
      row.addEventListener("click", (e) => {
        if (e.target.closest(".box-add")) return;   // handled below
        e.stopPropagation();
        NRB.openMarket(row.dataset.ticker, row.dataset.side);
      }));
    box.querySelectorAll(".box-add").forEach((btn) => {
      const o = shown[+btn.dataset.add];
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        NRB.slip.add({ ticker: o.ticker, name: o.name, side: o.side,
                       price: o.price, logo: o.logo, eventTitle: event.title });
      });
    });
    box.addEventListener("click", () => { if (firstTicker) NRB.openMarket(firstTicker); });
    return box;
  };

  NRB.carousel = function (title, events, opts) {
    opts = opts || {};
    const wrap = NRB.el(`<section class="carousel"></section>`);
    if (opts.id) wrap.id = opts.id;
    wrap.innerHTML = `<div class="carousel-head"><h3></h3></div><div class="carousel-track"></div>`;
    wrap.querySelector("h3").textContent = title;
    const track = wrap.querySelector(".carousel-track");
    (events || []).forEach((e) => track.appendChild(NRB.box(e)));
    return wrap;
  };

  // ---- bet slip (parlays) --------------------------------------------------
  const slipLegs = [];
  const slipSubs = [];
  const slipChanged = () => slipSubs.forEach((cb) => { try { cb(); } catch (e) {} });
  NRB.slip = {
    legs: () => slipLegs.slice(),
    has: (t) => slipLegs.some((l) => l.ticker === t),
    count: () => slipLegs.length,
    add: (leg) => {
      if (!leg || !leg.ticker) return false;
      if (slipLegs.some((l) => l.ticker === leg.ticker)) { NRB.toast("Already in your slip"); return false; }
      slipLegs.push(leg); slipChanged();
      NRB.toast("Added to slip: " + (leg.name || leg.ticker));
      return true;
    },
    remove: (t) => { const i = slipLegs.findIndex((l) => l.ticker === t); if (i >= 0) { slipLegs.splice(i, 1); slipChanged(); } },
    clear: () => { slipLegs.length = 0; slipChanged(); },
    combinedMult: () => slipLegs.reduce((m, l) => m * (l.price > 0 ? 1 / l.price : 1), 1),
    onChange: (cb) => slipSubs.push(cb),
  };

  // ---- tiny DOM helper -----------------------------------------------------
  NRB.el = function (html) {
    const t = document.createElement("template");
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  };

  // ---- account state -------------------------------------------------------
  NRB.state = { account: null };
  const acctSubs = [];
  NRB.onAccount = (cb) => { acctSubs.push(cb); if (NRB.state.account) cb(NRB.state.account); };
  NRB.refreshAccount = async function () {
    try {
      const s = await NRB.api("/api/summary");      // light: balance + live equity
      NRB.state.account = { balance: s.balance, starting: s.starting };
      const bal = document.getElementById("hdr-balance");
      if (bal) bal.textContent = NRB.fmt.usd(s.balance);
      const eqEl = document.getElementById("hdr-equity");
      if (eqEl) eqEl.textContent = NRB.fmt.usd(s.equity != null ? s.equity : s.balance);
      acctSubs.forEach((cb) => { try { cb(NRB.state.account); } catch (e) {} });
    } catch (e) { /* connection banner already shown by NRB.api */ }
    return NRB.state.account;
  };

  // ---- auth (optional cross-device accounts) -------------------------------
  // Login id is a username OR email; recovery is via a one-time code (no email).
  function applyLogin(r) {
    setToken(r.token);
    try { localStorage.setItem("nrb_login", r.login || ""); } catch (e) {}
    // Align the anonymous fallback id with the account so views that read the
    // raw uid stay consistent while logged in.
    if (r.user_id) { try { localStorage.setItem("nrb_uid", r.user_id); } catch (e) {} }
  }
  function clearLogin() {
    setToken("");
    // Drop the account identity and start a fresh anonymous session so the next
    // visitor on this browser doesn't see the account's data.
    try { localStorage.removeItem("nrb_login"); localStorage.removeItem("nrb_uid"); } catch (e) {}
    getUid();  // regenerate a new anonymous id
  }
  NRB.auth = {
    isLoggedIn: () => !!getToken(),
    name: () => { try { return localStorage.getItem("nrb_login") || ""; } catch (e) { return ""; } },
    signup: async (login, password) => {
      const r = await NRB.api("/api/auth/signup", { method: "POST", body: { login, password } });
      if (r && r.ok) applyLogin(r);   // r also carries recovery_code (shown once)
      return r;
    },
    login: async (login, password) => {
      const r = await NRB.api("/api/auth/login", { method: "POST", body: { login, password } });
      if (r && r.ok) applyLogin(r);
      return r;
    },
    requestReset: async (login) =>
      NRB.api("/api/auth/request-reset", { method: "POST", body: { login } }),
    recover: async (login, code, password) => {
      const r = await NRB.api("/api/auth/recover", { method: "POST", body: { login, code, password } });
      if (r && r.ok) applyLogin(r);
      return r;
    },
    changePassword: async (current, password) => {
      const r = await NRB.api("/api/auth/password", { method: "POST", body: { current, password } });
      if (r && r.ok && r.token) setToken(r.token);  // keep this device logged in
      return r;
    },
    deleteAccount: async (password) => {
      const r = await NRB.api("/api/auth/delete", { method: "POST", body: { password } });
      if (r && r.ok) { clearLogin(); await NRB.refreshAccount(); }
      return r;
    },
    logout: async () => {
      try { await NRB.api("/api/auth/logout", { method: "POST" }); } catch (e) {}
      clearLogin();
      await NRB.refreshAccount();
    },
  };

  // ---- toast ---------------------------------------------------------------
  let toastTimer;
  NRB.toast = function (msg, ms = 2800) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  };

  // ---- views / router ------------------------------------------------------
  NRB.views = NRB.views || {};
  NRB.current = { name: null, params: null };
  let mounted = null;
  NRB.go = function (name, params) {
    const view = NRB.views[name];
    if (!view) { console.warn("no view:", name); return; }
    if (mounted && mounted.unmount) { try { mounted.unmount(); } catch (e) {} }
    const container = document.getElementById("view");
    container.innerHTML = ""; window.scrollTo(0, 0);
    mounted = view; NRB.current = { name, params: params || {} };
    Promise.resolve(view.mount(container, params || {}))
      .catch((e) => console.error("view mount error", name, e));
  };
  NRB.openMarket = function (ticker, side) { NRB.go("detail", { ticker, side: side || "yes" }); };

  // ---- burger drawer -------------------------------------------------------
  NRB.drawer = {
    open: () => { document.getElementById("drawer").classList.add("open");
      document.getElementById("drawer-overlay").classList.add("open"); },
    close: () => { document.getElementById("drawer").classList.remove("open");
      document.getElementById("drawer-overlay").classList.remove("open"); },
    toggle: () => { document.getElementById("drawer").classList.contains("open")
      ? NRB.drawer.close() : NRB.drawer.open(); },
  };

  // ---- theme ---------------------------------------------------------------
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    const lbl = document.getElementById("theme-label");
    if (lbl) lbl.textContent = t === "light" ? "Light" : "Dark";
    try { localStorage.setItem("nrb_theme", t); } catch (e) {}
  }
  NRB.toggleTheme = function () {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(cur === "dark" ? "light" : "dark");
  };

  // ---- predict-then-bet toggle (opt-in fun feature; default on, ignorable) --
  function updatePredictLabel() {
    const l = document.getElementById("predict-label");
    if (l) l.textContent = NRB.predict.enabled() ? "On" : "Off";
  }
  NRB.predict = {
    enabled: () => { try { return localStorage.getItem("nrb_predict") !== "0"; } catch (e) { return true; } },
    toggle: () => {
      const on = NRB.predict.enabled();
      try { localStorage.setItem("nrb_predict", on ? "0" : "1"); } catch (e) {}
      updatePredictLabel();
      NRB.toast("Predict-then-bet " + (on ? "off" : "on"));
      return !on;
    },
  };
  try { updatePredictLabel(); } catch (e) {}
  (function () {
    let t = "dark";
    try { t = localStorage.getItem("nrb_theme") || "dark"; } catch (e) {}
    applyTheme(t);
  })();

  function drawerAction(action) {
    if (action === "theme") { NRB.toggleTheme(); return; }  // keep drawer open
    if (action === "predict") { NRB.predict.toggle(); return; }  // keep drawer open
    NRB.drawer.close();
    if (action === "account") return authOpen("login");
    if (action === "home") return NRB.go("browse");
    if (action === "watchlist") return NRB.go("watchlist");
    if (action === "activity") return NRB.go("portfolio");
    if (action === "profile") return NRB.go("profile");
    if (action === "analytics") return NRB.go("analytics");
    if (action === "reset") return resetFlow();
    NRB.toast(action.charAt(0).toUpperCase() + action.slice(1) + " — coming soon");
  }
  // ---- auth modal (login / signup / recovery / account) --------------------
  // mode: "login" | "signup" | "recovery" | "showcode" | "account" |
  //       "changepw" | "delete"
  let authMode = "login";
  function $(id) { return document.getElementById(id); }
  function show(id, on) { const el = $(id); if (el) el.classList.toggle("hidden", !on); }
  function setErr(id, msg) {
    const e = $(id); if (!e) return;
    e.textContent = msg || ""; e.classList.toggle("hidden", !msg);
  }
  const PANELS = ["form", "code", "account", "changepw", "delete"];

  function refreshAuthModal() {
    setErr("auth-error", ""); setErr("auth-cp-error", ""); setErr("auth-del-error", "");
    const loggedIn = NRB.auth.isLoggedIn();
    if (loggedIn && (authMode === "login" || authMode === "signup" || authMode === "recovery")) {
      authMode = "account";
    }
    // which panel is visible
    const panelFor = { login: "form", signup: "form", recovery: "form",
      showcode: "code", account: "account", changepw: "changepw", delete: "delete" };
    const active = panelFor[authMode] || "form";
    PANELS.forEach((p) => show("auth-panel-" + p, p === active));

    const titles = { login: "Log in", signup: "Create account", recovery: "Reset password",
      showcode: "Save your recovery code", account: "Account",
      changepw: "Change password", delete: "Delete account" };
    $("auth-title").textContent = titles[authMode] || "Account";

    const subs = {
      login: "Log in to sync your bets across devices.",
      signup: "Pick a username (or use an email) — it's just a login, we never email you.",
      recovery: "Enter your saved recovery code — or, if you used an email, request a reset code by email below.",
      account: "Your bets and balance sync to this account on any device you log in from.",
    };
    const sub = $("auth-sub");
    if (sub) { sub.textContent = subs[authMode] || ""; sub.classList.toggle("hidden", !subs[authMode]); }

    if (active === "form") {
      const isLogin = authMode === "login", isSignup = authMode === "signup",
        isRec = authMode === "recovery";
      show("auth-code", isRec);                       // recovery/reset code field
      show("auth-email-reset", isRec);                // "email me a reset code"
      $("auth-login").placeholder = "Username or email";
      $("auth-code").placeholder = "Recovery code or emailed reset code";
      $("auth-pass").placeholder = isRec ? "New password (6+ characters)" : "Password (6+ characters)";
      $("auth-pass").autocomplete = isLogin ? "current-password" : "new-password";
      $("auth-submit").textContent = isSignup ? "Create account" : isRec ? "Reset password" : "Log in";
      // links
      const p = $("auth-link-primary"), s = $("auth-link-secondary");
      if (isLogin) { p.textContent = "Create an account"; p.dataset.go = "signup";
        s.textContent = "Forgot password?"; s.dataset.go = "recovery"; show("auth-link-secondary", true); }
      else if (isSignup) { p.textContent = "I already have an account"; p.dataset.go = "login";
        show("auth-link-secondary", false); }
      else { p.textContent = "Back to log in"; p.dataset.go = "login";
        show("auth-link-secondary", false); }
    }
    if (active === "account") {
      $("auth-login-label").textContent = NRB.auth.name() || "your account";
    }
  }
  function authOpen(mode) {
    authMode = NRB.auth.isLoggedIn() ? "account" : (mode || "login");
    const m = $("auth-modal"); if (!m) return;
    refreshAuthModal(); m.classList.remove("hidden");
    if (authMode === "login" || authMode === "signup" || authMode === "recovery") {
      const f = $("auth-login"); if (f) setTimeout(() => f.focus(), 40);
    }
  }
  function authClose() { const m = $("auth-modal"); if (m) m.classList.add("hidden"); }
  function goMode(mode) { authMode = mode; refreshAuthModal(); }
  function updateDrawerAuth() {
    const l = $("drawer-account-label");
    if (l) l.textContent = NRB.auth.isLoggedIn() ? (NRB.auth.name() || "Account") : "Log in / Sign up";
  }
  NRB.authUI = { open: authOpen, close: authClose, refreshDrawer: updateDrawerAuth };

  async function afterAuthChange(msg) {
    authClose();
    updateDrawerAuth();
    await NRB.refreshAccount();
    NRB.toast(msg);
    NRB.go(NRB.current.name || "browse", NRB.current.params);
  }

  async function authSubmit() {
    const login = ($("auth-login").value || "").trim();
    const pass = $("auth-pass").value || "";
    const code = ($("auth-code").value || "").trim();
    if (!login || !pass || (authMode === "recovery" && !code)) {
      return setErr("auth-error", "Please fill in every field.");
    }
    const btn = $("auth-submit"); btn.disabled = true;
    try {
      let r;
      if (authMode === "signup") r = await NRB.auth.signup(login, pass);
      else if (authMode === "recovery") r = await NRB.auth.recover(login, code, pass);
      else r = await NRB.auth.login(login, pass);
      if (r && r.ok) {
        $("auth-pass").value = ""; $("auth-code").value = "";
        updateDrawerAuth();
        if (authMode === "signup" && r.recovery_code) {
          // show the one-time recovery code before letting them continue
          $("auth-code-value").textContent = r.recovery_code;
          $("auth-code-ack").checked = false; $("auth-code-done").disabled = true;
          goMode("showcode");
        } else {
          await afterAuthChange(authMode === "recovery" ? "Password reset — you're logged in." : "Logged in.");
        }
      } else {
        setErr("auth-error", (r && r.error) || "Something went wrong. Try again.");
      }
    } catch (e) {
      setErr("auth-error", "Can't reach the server. Try again.");
    } finally { btn.disabled = false; }
  }

  async function changePwSubmit() {
    const current = $("auth-cp-current").value || "", next = $("auth-cp-new").value || "";
    if (!current || !next) return setErr("auth-cp-error", "Fill in both fields.");
    const btn = $("auth-cp-submit"); btn.disabled = true;
    try {
      const r = await NRB.auth.changePassword(current, next);
      if (r && r.ok) { $("auth-cp-current").value = ""; $("auth-cp-new").value = "";
        authClose(); NRB.toast("Password updated."); }
      else setErr("auth-cp-error", (r && r.error) || "Couldn't update password.");
    } catch (e) { setErr("auth-cp-error", "Can't reach the server."); }
    finally { btn.disabled = false; }
  }

  async function deleteSubmit() {
    const pass = $("auth-del-pass").value || "";
    if (!pass) return setErr("auth-del-error", "Enter your password to confirm.");
    const btn = $("auth-del-submit"); btn.disabled = true;
    try {
      const r = await NRB.auth.deleteAccount(pass);
      if (r && r.ok) { $("auth-del-pass").value = "";
        await afterAuthChange("Account deleted."); }
      else setErr("auth-del-error", (r && r.error) || "Couldn't delete account.");
    } catch (e) { setErr("auth-del-error", "Can't reach the server."); }
    finally { btn.disabled = false; }
  }

  async function resetFlow() {
    if (!confirm("Reset virtual balance to $1,000 and delete all bets?")) return;
    await NRB.api("/api/account/reset", { method: "POST", body: { starting: 1000 } });
    NRB.toast("Account reset.");
    await NRB.refreshAccount();
    NRB.go(NRB.current.name || "browse", NRB.current.params);
  }

  window.addEventListener("DOMContentLoaded", () => {
    const burger = document.getElementById("burger");
    if (burger) burger.addEventListener("click", NRB.drawer.toggle);
    const ov = document.getElementById("drawer-overlay");
    if (ov) ov.addEventListener("click", NRB.drawer.close);
    document.querySelectorAll(".drawer-item").forEach((it) =>
      it.addEventListener("click", () => drawerAction(it.dataset.action)));
    const brand = document.getElementById("brand");
    if (brand) brand.addEventListener("click", () => NRB.go("browse"));

    // auth modal wiring
    updateDrawerAuth();
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("auth-close", "click", authClose);
    const aOv = $("auth-modal");
    if (aOv) aOv.addEventListener("click", (e) => { if (e.target === aOv) authClose(); });
    // credentials form (login / signup / recovery)
    on("auth-submit", "click", authSubmit);
    ["auth-login", "auth-pass", "auth-code"].forEach((id) =>
      on(id, "keydown", (e) => { if (e.key === "Enter") authSubmit(); }));
    const linkGo = (e) => { e.preventDefault(); goMode(e.currentTarget.dataset.go || "login"); };
    on("auth-link-primary", "click", linkGo);
    on("auth-link-secondary", "click", linkGo);
    on("auth-send-code", "click", async () => {
      const login = ($("auth-login").value || "").trim();
      if (!login) return setErr("auth-error", "Enter your email above first.");
      const btn = $("auth-send-code"); btn.disabled = true;
      try {
        const r = await NRB.auth.requestReset(login);
        if (r && r.ok) { setErr("auth-error", "");
          NRB.toast("If that email has an account, a reset code is on its way."); }
        else setErr("auth-error", (r && r.error) || "Couldn't send the email.");
      } catch (e) { setErr("auth-error", "Can't reach the server."); }
      finally { btn.disabled = false; }
    });
    // recovery-code panel
    on("auth-code-ack", "change", (e) => { $("auth-code-done").disabled = !e.currentTarget.checked; });
    on("auth-code-copy", "click", async () => {
      const code = $("auth-code-value").textContent;
      try { await navigator.clipboard.writeText(code); NRB.toast("Recovery code copied."); }
      catch (e) { NRB.toast("Copy failed — write it down: " + code); }
    });
    on("auth-code-done", "click", () => afterAuthChange("Account created — your bets are saved."));
    // account panel
    on("auth-go-changepw", "click", () => goMode("changepw"));
    on("auth-go-delete", "click", () => goMode("delete"));
    on("auth-logout", "click", async () => {
      await NRB.auth.logout(); updateDrawerAuth(); authClose();
      NRB.toast("Logged out."); NRB.go("browse");
    });
    // change-password panel
    on("auth-cp-submit", "click", changePwSubmit);
    on("auth-cp-new", "keydown", (e) => { if (e.key === "Enter") changePwSubmit(); });
    on("auth-cp-back", "click", (e) => { e.preventDefault(); goMode("account"); });
    // delete panel
    on("auth-del-submit", "click", deleteSubmit);
    on("auth-del-pass", "keydown", (e) => { if (e.key === "Enter") deleteSubmit(); });
    on("auth-del-back", "click", (e) => { e.preventDefault(); goMode("account"); });

    // first-run onboarding (once per browser)
    let onboarded = false;
    try { onboarded = localStorage.getItem("nrb_onboarded") === "1"; } catch (e) {}
    const ob = document.getElementById("onboard");
    if (ob && !onboarded) ob.classList.remove("hidden");
    const obGo = document.getElementById("onboard-go");
    if (obGo) obGo.addEventListener("click", () => {
      try { localStorage.setItem("nrb_onboarded", "1"); } catch (e) {}
      if (ob) ob.classList.add("hidden");
    });
  });
})();
