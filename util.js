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
    // strip a leading emoji/symbol from a section title for a cleaner, non-juvenile look
    title: (s) => {
      const str = String(s == null ? "" : s);
      try { return str.replace(/^(?:\p{Extended_Pictographic}|️|‍|⃣|\s)+/u, "").trim() || str; }
      catch (e) { return str.replace(/^[^\w(]+/, "").trim() || str; }
    },
  };

  // ---- odds ----------------------------------------------------------------
  NRB.odds = {
    mult: (p) => (p && p > 0 ? 1 / p : null),
    multStr: (p) => (p && p > 0 ? (1 / p).toFixed(2) + "x" : "—"),
    prob: (p) => (p == null ? "—" : Math.round(p * 100) + "%"),
    // Implied probability (0–1) for DISPLAY. Robust to illiquid outcomes whose
    // only "ask" is the $1.00 max placeholder (which would otherwise read 100%).
    // Prefers the current bid/ask mid, then a real bid, then last trade, then a
    // real (sub-$1) ask; returns 0 when there's no real market.
    chance: (m) => {
      if (!m) return 0;
      const last = m.last_price, bid = m.yes_bid, ask = m.yes_ask;
      const goodBid = bid != null && bid > 0 && bid < 1;
      const goodAsk = ask != null && ask > 0 && ask < 1;
      if (goodBid && goodAsk) return (bid + ask) / 2;
      if (goodBid) return bid;
      if (last != null && last > 0 && last < 1) return last;
      if (goodAsk) return ask;
      return 0;
    },
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
  const LS = { favs: "nrb_favs", views: "nrb_views", favCats: "nrb_fav_cats",
               hiddenCats: "nrb_hidden_cats" };
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

  // Favorite whole categories/sections (by section key). Favorited categories
  // float to the top of the home feed. Stored separately from market favorites.
  const favCatSubs = [];
  NRB.favCat = {
    list: () => readJSON(LS.favCats, []),
    has: (key) => readJSON(LS.favCats, []).includes(key),
    toggle: (key) => {
      let f = readJSON(LS.favCats, []);
      const on = f.includes(key);
      f = on ? f.filter((x) => x !== key) : [key, ...f];
      writeJSON(LS.favCats, f);
      favCatSubs.forEach((cb) => { try { cb(); } catch (e) {} });
      return !on;
    },
    onChange: (cb) => favCatSubs.push(cb),
  };

  // Hide whole categories/sections (by section key) from the home feed. Hidden
  // categories are still searchable and can be re-added from the "+" button.
  const hiddenCatSubs = [];
  const fireHidden = () => hiddenCatSubs.forEach((cb) => { try { cb(); } catch (e) {} });
  NRB.hiddenCat = {
    list: () => readJSON(LS.hiddenCats, []),
    has: (key) => readJSON(LS.hiddenCats, []).includes(key),
    add: (key) => {
      let f = readJSON(LS.hiddenCats, []);
      if (!f.includes(key)) { writeJSON(LS.hiddenCats, [key, ...f]); fireHidden(); }
    },
    remove: (key) => {
      let f = readJSON(LS.hiddenCats, []);
      if (f.includes(key)) { writeJSON(LS.hiddenCats, f.filter((x) => x !== key)); fireHidden(); }
    },
    onChange: (cb) => hiddenCatSubs.push(cb),
  };

  // ---- season (reset-period) picker for the stats views --------------------
  // Renders a <select> letting the user view the current period (default), any
  // previous period, or "Overall". Hidden until there's been at least one reset
  // (i.e. >1 season) since there's nothing to compare yet. onChange receives the
  // query value to use: "" (current), a season number as string, or "all".
  NRB.seasonPicker = async function (host, onChange) {
    if (!host) return;
    let data;
    try { data = await NRB.api("/api/seasons"); } catch (e) { host.innerHTML = ""; return; }
    const seasons = (data && data.seasons) || [];
    const cur = data && data.current;
    if (seasons.length <= 1) { host.innerHTML = ""; return; }  // nothing to switch between yet
    const shortDate = (ts) => ts
      ? new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "";
    const prev = seasons.filter((s) => s.season !== cur).sort((a, b) => b.season - a.season);
    const opt = (val, label) => `<option value="${val}">${esc(label)}</option>`;
    const prevOpts = prev.map((s) => {
      const span = s.started_at ? ` (${shortDate(s.started_at)}–${shortDate(s.ended_at)})` : "";
      return opt(String(s.season), `Period ${s.season}${span}`);
    }).join("");
    host.innerHTML =
      `<label class="season-pick">
         <span class="season-pick-lbl">Showing</span>
         <select class="season-pick-sel">
           ${opt("", "Current period")}
           ${prevOpts}
           ${opt("all", "Overall (all periods)")}
         </select>
       </label>`;
    const sel = host.querySelector(".season-pick-sel");
    sel.addEventListener("change", () => { try { onChange(sel.value); } catch (e) {} });
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
    // price here = implied chance (for the box's % + payout display), robust to
    // illiquid "ask = $1.00" outcomes that would otherwise read 100% / 1.00x.
    if (ms.length === 1) {
      const m = ms[0];
      const c = NRB.odds.chance(m);
      return [
        { name: "Yes", price: c, ticker: m.ticker, side: "yes" },
        { name: "No", price: 1 - c, ticker: m.ticker, side: "no" },
      ];
    }
    return [...ms]
      .sort((a, b) => NRB.odds.chance(b) - NRB.odds.chance(a))
      .map((m) => ({ name: m.yes_sub_title || m.title, price: NRB.odds.chance(m),
                     ticker: m.ticker, side: "yes", logo: m.logo }));
  }

  // Rough end-of-game windows (seconds) so a started game shows as "live" only
  // while it's plausibly still on. ESPN isn't called here -- kickoff + window.
  function liveWindow(series) {
    const s = series || "";
    if (/NFL|NCAAF/.test(s)) return 3.7 * 3600;
    if (/MLB/.test(s)) return 3.6 * 3600;
    if (/NBA|WNBA|NCAAMB|NCAAW/.test(s)) return 2.9 * 3600;
    if (/NHL/.test(s)) return 3.0 * 3600;
    if (/ATP|WTA/.test(s)) return 3.5 * 3600;
    return 2.5 * 3600; // soccer + default
  }
  // A scheduled sports game that is plausibly in progress right now.
  NRB.isLiveGame = function (event) {
    if (!event || !event.is_game || !event.start_ts) return false;
    const now = Date.now() / 1000;
    return now >= event.start_ts && now < event.start_ts + liveWindow(event.series_ticker);
  };

  NRB.box = function (event) {
    const opts = optionsFor(event);
    const shown = opts.slice(0, 3);
    const more = opts.length - shown.length;
    const firstTicker = (event.markets && event.markets[0] && event.markets[0].ticker) || "";
    const favOn = NRB.fav.has(event.event_ticker);
    const live = NRB.isLiveGame(event);
    const box = NRB.el(`<div class="box${live ? " box-live" : ""}"></div>`);
    box.innerHTML =
      `<div class="box-top">
         <div class="box-title">${live ? `<span class="box-livedot" title="Live now"></span>` : ""}${esc(event.title)}</div>
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
    const favable = !!opts.favKey;
    const favOn = favable && NRB.favCat.has(opts.favKey);
    wrap.innerHTML =
      `<div class="carousel-head"><h3></h3>${favable
        ? `<div class="carousel-acts">
             <button class="cat-fav ${favOn ? "on" : ""}" aria-pressed="${favOn}"
               title="Favorite this category">${favOn ? "★" : "☆"}</button>
             <button class="cat-hide" title="Hide this category"
               aria-label="Hide this category">✕</button>
           </div>`
        : ""}</div><div class="carousel-track"></div>`;
    wrap.querySelector("h3").textContent = NRB.fmt.title(title);
    const track = wrap.querySelector(".carousel-track");
    (events || []).forEach((e) => track.appendChild(NRB.box(e)));
    const fb = wrap.querySelector(".cat-fav");
    if (fb) fb.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = NRB.favCat.toggle(opts.favKey);
      fb.classList.toggle("on", on);
      fb.textContent = on ? "★" : "☆";
      fb.setAttribute("aria-pressed", on);
    });
    const hb = wrap.querySelector(".cat-hide");
    if (hb) hb.addEventListener("click", (e) => {
      e.stopPropagation();
      NRB.hiddenCat.add(opts.favKey);   // removes it from the feed (re-add via "+")
    });
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

  // ---- help glossary + clickable "?" popovers -------------------------------
  // Plain-language definitions for an audience new to betting/forecasting terms.
  NRB.glossary = {
    cash: { t: "Cash", b: "Your spendable virtual balance — money that isn't currently tied up in open bets." },
    equity: { t: "Equity", b: "Your total account value: cash plus what all your open bets are worth right now. It's what you'd have if you sold everything this instant." },
    unrealized_pnl: { t: "Unrealized P&L", b: "P&L means Profit & Loss. This is how much you're up or down on bets you still hold but haven't closed. It's 'unrealized' because it isn't locked in — it keeps moving with the market until you sell or the bet settles." },
    realized_pnl: { t: "Realized P&L", b: "Profit or loss that's locked in from bets you've already sold or that have settled. This is your actual result, not a paper estimate." },
    open_positions: { t: "Open positions", b: "Bets you currently hold that haven't settled or been sold yet." },
    entry: { t: "Entry", b: "The price (and implied odds) you got when you placed the bet." },
    now_price: { t: "Now", b: "The latest market price for this outcome." },
    value: { t: "Value", b: "What your position is worth right now if you sold it at the current market price." },
    payout: { t: "Payout", b: "The cash you received when the bet settled or you sold it." },
    stake: { t: "Stake", b: "The amount of virtual money you put on a bet." },
    multiplier: { t: "Multiplier (odds)", b: "How much each $1 returns if the bet wins. 2.0× means a winning $10 bet pays back $20. It's simply 1 ÷ the price." },
    probability: { t: "Probability", b: "The market's implied chance of this outcome happening, taken from the price — a 40¢ price means roughly a 40% chance." },
    roi: { t: "ROI", b: "Return on Investment: your total profit divided by the total you've invested, shown as a %. +20% means you've made 20% on the money you put at risk." },
    win_rate: { t: "Win rate", b: "The share of your settled bets that won." },
    brier: { t: "Brier score", b: "A measure of how accurate your probability forecasts are. 0 is perfect and lower is better; always guessing 50/50 scores about 0.25. It rewards being both confident and correct." },
    net_pnl: { t: "Net P&L", b: "Your total realized profit or loss across all settled bets." },
    record: { t: "Record", b: "Your wins and losses on settled bets, shown as W–L." },
    recent: { t: "Recent form", b: "Your latest settled results, newest first. W = win, L = loss." },
    scored: { t: "Graded forecasts", b: "How many of your bets had a probability you can be scored on (used for the Brier score)." },
  };
  // returns the markup for an inline help button; pair with a label
  NRB.help = function (key) {
    if (!NRB.glossary[key]) return "";
    return `<button class="help-dot" type="button" data-help="${key}" aria-label="What does this mean?">?</button>`;
  };
  let _helpAnchor = null;
  function closeHelp() { const p = document.getElementById("help-pop"); if (p) p.remove(); _helpAnchor = null; }
  function showHelp(key, anchor) {
    const g = NRB.glossary[key]; if (!g) return;
    closeHelp();
    const pop = document.createElement("div");
    pop.className = "help-pop"; pop.id = "help-pop";
    pop.innerHTML = `<div class="help-pop-title">${esc(g.t)}</div><div class="help-pop-body">${esc(g.b)}</div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = document.documentElement.clientWidth;
    let left = r.left + window.scrollX + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.scrollX + vw - pw - 8));
    let top = r.bottom + window.scrollY + 8;
    if (r.bottom + ph + 16 > window.innerHeight) top = r.top + window.scrollY - ph - 8;
    pop.style.left = left + "px"; pop.style.top = Math.max(8, top) + "px";
    _helpAnchor = anchor;
  }
  document.addEventListener("click", (e) => {
    const dot = e.target.closest && e.target.closest(".help-dot");
    if (dot) {
      e.preventDefault(); e.stopPropagation();
      if (_helpAnchor === dot) { closeHelp(); return; }
      showHelp(dot.dataset.help, dot);
      return;
    }
    if (!e.target.closest || !e.target.closest(".help-pop")) closeHelp();
  });
  window.addEventListener("scroll", closeHelp, true);
  window.addEventListener("resize", closeHelp);

  // ---- account state -------------------------------------------------------
  NRB.state = { account: null };
  const acctSubs = [];
  NRB.onAccount = (cb) => { acctSubs.push(cb); if (NRB.state.account) cb(NRB.state.account); };
  // unread-notification dot on the burger menu icon
  function setNavBadge(n) {
    const b = document.getElementById("burger-badge");
    if (!b) return;
    n = Number(n) || 0;
    b.hidden = n <= 0;
    b.textContent = n > 9 ? "9+" : String(n);
  }

  NRB.refreshAccount = async function () {
    try {
      const s = await NRB.api("/api/summary");      // light: balance + live equity
      NRB.state.account = { balance: s.balance, starting: s.starting };
      const bal = document.getElementById("hdr-balance");
      if (bal) bal.textContent = NRB.fmt.usd(s.balance);
      const eqEl = document.getElementById("hdr-equity");
      if (eqEl) eqEl.textContent = NRB.fmt.usd(s.equity != null ? s.equity : s.balance);
      setNavBadge(s.unread);
      acctSubs.forEach((cb) => { try { cb(NRB.state.account); } catch (e) {} });
    } catch (e) { /* connection banner already shown by NRB.api */ }
    return NRB.state.account;
  };
  // let views nudge the unread badge after reading/creating notifications
  NRB.refreshBadge = function () { return NRB.refreshAccount(); };

  // ---- auth (optional cross-device accounts) -------------------------------
  // Login id is a username OR email; recovery is via a one-time code (no email).
  function applyLogin(r) {
    setToken(r.token);
    try { localStorage.setItem("nrb_login", r.login || ""); } catch (e) {}
    if (r.handle != null) { try { localStorage.setItem("nrb_display", r.handle || ""); } catch (e) {} }
    // Align the anonymous fallback id with the account so views that read the
    // raw uid stay consistent while logged in.
    if (r.user_id) { try { localStorage.setItem("nrb_uid", r.user_id); } catch (e) {} }
  }
  function clearLogin() {
    setToken("");
    // Drop the account identity and start a fresh anonymous session so the next
    // visitor on this browser doesn't see the account's data.
    try { localStorage.removeItem("nrb_login"); localStorage.removeItem("nrb_display"); localStorage.removeItem("nrb_uid"); } catch (e) {}
    getUid();  // regenerate a new anonymous id
  }
  NRB.auth = {
    isLoggedIn: () => !!getToken(),
    // username (private login id) — never shown to other users
    name: () => { try { return localStorage.getItem("nrb_login") || ""; } catch (e) { return ""; } },
    // public display name (shown to others); falls back to username if unset
    display: () => { try { return localStorage.getItem("nrb_display") || ""; } catch (e) { return ""; } },
    setDisplay: (d) => { try { localStorage.setItem("nrb_display", d || ""); } catch (e) {} },
    signup: async (login, password, display) => {
      const r = await NRB.api("/api/auth/signup", { method: "POST", body: { login, password, display } });
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
    updateTopnav();
    Promise.resolve(view.mount(container, params || {}))
      .catch((e) => console.error("view mount error", name, e));
  };
  // highlight the active primary nav tab
  function updateTopnav() {
    const map = { browse: "browse", watchlist: "browse",
                  community: "community", user: "community" };
    const active = map[NRB.current.name] || "";
    document.querySelectorAll(".topnav-tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.go === active));
  }
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
    if (action === "community") return NRB.go("community");
    if (action === "activity") return NRB.go("portfolio");
    if (action === "profile") return NRB.go("profile");
    if (action === "analytics") return NRB.go("analytics");
    if (action === "notifications") return NRB.go("notifications");
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
  const PANELS = ["form", "code", "account", "profile", "changepw", "delete"];

  function refreshAuthModal() {
    setErr("auth-error", ""); setErr("auth-cp-error", ""); setErr("auth-del-error", ""); setErr("auth-pf-error", "");
    const loggedIn = NRB.auth.isLoggedIn();
    if (loggedIn && (authMode === "login" || authMode === "signup" || authMode === "recovery")) {
      authMode = "account";
    }
    // which panel is visible
    const panelFor = { login: "form", signup: "form", recovery: "form",
      showcode: "code", account: "account", profile: "profile", changepw: "changepw", delete: "delete" };
    const active = panelFor[authMode] || "form";
    PANELS.forEach((p) => show("auth-panel-" + p, p === active));

    const titles = { login: "Log in", signup: "Create account", recovery: "Reset password",
      showcode: "Save your recovery code", account: "Account",
      profile: "Profile & privacy", changepw: "Change password", delete: "Delete account" };
    $("auth-title").textContent = titles[authMode] || "Account";
    if (active === "profile") loadAuthProfile();

    const subs = {
      login: "Log in to sync your bets across devices.",
      signup: "Username is your private login (never shown to others). Display name is what other people see.",
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
      show("auth-display", isSignup);                 // display name (signup only)
      $("auth-login").placeholder = isSignup ? "Username (your private login)" : "Username or email";
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
      $("auth-login-label").textContent = NRB.auth.display() || NRB.auth.name() || "your account";
    }
  }
  function authOpen(mode) {
    if (NRB.auth.isLoggedIn()) {
      authMode = ["account", "profile", "changepw", "delete"].includes(mode) ? mode : "account";
    } else {
      authMode = mode || "login";
    }
    const m = $("auth-modal"); if (!m) return;
    refreshAuthModal(); m.classList.remove("hidden");
    if (authMode === "login" || authMode === "signup" || authMode === "recovery") {
      const f = $("auth-login"); if (f) setTimeout(() => f.focus(), 40);
    }
  }
  function authClose() { const m = $("auth-modal"); if (m) m.classList.add("hidden"); }
  function goMode(mode) { authMode = mode; refreshAuthModal(); }
  function updateDrawerAuth() {
    const loggedIn = NRB.auth.isLoggedIn();
    const name = NRB.auth.display() || NRB.auth.name();
    const l = $("drawer-account-label");
    if (l) l.textContent = loggedIn ? (name || "Account") : "Log in / Sign up";
    const h = $("hdr-account");
    if (h) {
      h.classList.toggle("signed-out", !loggedIn);
      if (loggedIn) {
        const dn = name || "Account";
        const initials = dn.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || dn.slice(0, 2).toUpperCase();
        h.innerHTML = `<span class="hdr-acct-dot">${esc(initials)}</span><span class="hdr-acct-name">${esc(dn)}</span>`;
      } else {
        h.textContent = "Create account / Sign in";
      }
    }
  }
  // refresh display name / login from the server (keeps the header button correct
  // across devices and after a handle change)
  NRB.auth.sync = async function () {
    try {
      const r = await NRB.api("/api/auth/me");
      if (r && r.logged_in) {
        try { localStorage.setItem("nrb_login", r.login || ""); localStorage.setItem("nrb_display", r.handle || ""); } catch (e) {}
      }
      updateDrawerAuth();
      return r;
    } catch (e) { return null; }
  };
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
    const display = ($("auth-display").value || "").trim();
    if (!login || !pass || (authMode === "recovery" && !code)) {
      return setErr("auth-error", "Please fill in every field.");
    }
    if (authMode === "signup" && !display) {
      return setErr("auth-error", "Choose a display name (this is what other people see).");
    }
    const btn = $("auth-submit"); btn.disabled = true;
    try {
      let r;
      if (authMode === "signup") r = await NRB.auth.signup(login, pass, display);
      else if (authMode === "recovery") r = await NRB.auth.recover(login, code, pass);
      else r = await NRB.auth.login(login, pass);
      if (r && r.ok) {
        $("auth-pass").value = ""; $("auth-code").value = ""; $("auth-display").value = "";
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

  // ---- profile & privacy (in the account modal) ----
  async function loadAuthProfile() {
    try {
      const p = await NRB.api("/api/me/profile");
      if (!p) return;
      if ($("auth-pf-display")) $("auth-pf-display").value = p.handle || "";
      if ($("auth-pf-bio")) $("auth-pf-bio").value = p.bio || "";
      if ($("auth-pf-public")) $("auth-pf-public").checked = !!p.is_public;
      if ($("auth-pf-private")) $("auth-pf-private").checked = !!p.bets_private;
    } catch (e) { /* leave fields */ }
  }
  async function profileSave() {
    const handle = ($("auth-pf-display").value || "").trim();
    const bio = ($("auth-pf-bio").value || "").trim();
    const is_public = $("auth-pf-public").checked;
    const bets_private = $("auth-pf-private").checked;
    if (!handle) return setErr("auth-pf-error", "Enter a display name.");
    const btn = $("auth-pf-save"); btn.disabled = true;
    try {
      const r = await NRB.api("/api/me/profile", { method: "POST", body: { handle, bio, is_public, bets_private } });
      if (r && r.ok) {
        if (r.handle != null) NRB.auth.setDisplay(r.handle);
        updateDrawerAuth();
        NRB.toast("Profile saved.");
        goMode("account");
        if (NRB.current && NRB.current.name === "community") NRB.go("community");
      } else setErr("auth-pf-error", (r && r.error) || "Couldn't save.");
    } catch (e) { setErr("auth-pf-error", "Can't reach the server."); }
    finally { btn.disabled = false; }
  }

  async function resetFlow() {
    if (!confirm("Start a new period? Your balance goes back to $1,000 and any " +
                 "open positions are closed out. Your past bets stay saved — you " +
                 "can still review them in your stats by switching periods.")) return;
    await NRB.api("/api/account/reset", { method: "POST", body: { starting: 1000 } });
    NRB.toast("New period started — balance reset to $1,000.");
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
    document.querySelectorAll(".topnav-tab").forEach((t) =>
      t.addEventListener("click", () => NRB.go(t.dataset.go)));

    // auth modal wiring
    updateDrawerAuth();
    NRB.auth.sync();   // refresh display name / login from the server
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("hdr-account", "click", () => authOpen(NRB.auth.isLoggedIn() ? "account" : "login"));
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
    on("auth-go-profile", "click", () => goMode("profile"));
    on("auth-go-changepw", "click", () => goMode("changepw"));
    on("auth-go-delete", "click", () => goMode("delete"));
    // profile & privacy panel
    on("auth-pf-save", "click", profileSave);
    on("auth-pf-back", "click", (e) => { e.preventDefault(); goMode("account"); });
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
