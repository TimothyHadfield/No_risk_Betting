"use strict";
/*
 * Detail view (marquee) — Kalshi-style market detail page. DARK theme (v2).
 * Owns: detail.js + detail.css. Relies on window.NRB (see BUILD_SPEC.md).
 *
 * NRB.views.detail = { async mount(container, params), unmount() }
 *   params.ticker (required), params.side ('yes'|'no', default 'yes')
 */
(function () {
  const NRB = window.NRB;
  const fmt = NRB.fmt;
  const odds = NRB.odds;

  const RANGES = ["1D", "1W", "1M", "ALL"];
  const DEFAULT_RANGE = "1D";
  const POLL_MS = 5000;
  const HIST_REFRESH_MS = 30000;   // stream new 1-min candles for the active range
  const QUOTE_DEBOUNCE = 250;

  // mutable view state (reset every mount)
  let S = null;

  // distinct line colors for multi-outcome charts (top 6 by chance)
  const LINE_COLORS = ["#27d18b", "#4aa3ff", "#e7b850", "#b07cff", "#fb5a6a", "#2dd4bf"];

  function blankState() {
    return {
      ticker: null,    // currently SELECTED market ticker (sibling in multi mode)
      side: "yes",
      range: DEFAULT_RANGE,
      wager: 10,       // dollar wager (replaces raw contracts in the UI)
      market: null,
      meta: {},
      event_title: null, // broad event title (for multi header + thread/alert titles)
      multi: false,    // multi-market event? (outcome selector shown)
      exclusive: true, // multi: pick-ONE (true) vs independent Yes/No per outcome (false)
      outcomes: [],    // [{name, ticker, price}] (multi) — derived from siblings
      points: [],      // binary single-series history
      series: [],      // multi-outcome: [{name, ticker, color, points:[{t,p}]}]
      chart: null,
      pollId: null,
      histPollId: null,
      quoteTimer: null,
      quoteSeq: 0,     // guards out-of-order quote responses
      histSeq: 0,      // guards out-of-order history responses
      gameSeq: 0,      // guards out-of-order /api/game responses
      game: null,      // last /api/game payload (null = unknown / not matched)
      startTs: null,   // game start unix sec (for the "Game" timeline window)
      lastQuote: null, // latest /api/quote payload (for live payout numbers)
      confirming: false, // place button in two-step confirm state?
      predictEnabled: false, // global opt-in toggle, read once on mount
      fc: null,        // forecast widget state (see freshForecast); null until known
      bets: [],        // bets relevant to this market/event (from /api/bets)
      betsSeq: 0,      // guards out-of-order /api/bets responses
      lines: null,     // {spread, total} ladders for game events (null = none)
      linesSeq: 0,     // guards out-of-order /api/lines responses
      lineState: null, // per-block slider selection {spread:{...}, total:{...}}
      viewLogged: false,
      destroyed: false,
    };
  }

  // forecast widget state — per selected outcome; reset on outcome change
  function freshForecast() {
    return { open: false, value: 50, locked: false, revealed: false };
  }

  // build/update the outcomes list from siblings; returns true if multi-outcome
  function ingestSiblings(res) {
    const sibs = (res && res.siblings) || [];
    if (sibs.length >= 2) {
      S.multi = true;
      // exclusive = pick one (game outcomes); independent = Yes/No per outcome
      S.exclusive = (res.exclusive !== false);
      S.outcomes = sibs.map((s) => ({
        name: s.yes_sub_title || s.title || s.ticker,
        ticker: s.ticker,
        // price = real ask (for the wager→contracts trade math); chance = implied
        // probability (for display + sorting), robust to the $1.00-ask placeholder
        price: (s.yes_ask != null) ? s.yes_ask : s.last_price,
        chance: NRB.odds.chance(s),
        logo: s.logo || null,
        // eliminated = Kalshi has settled this outcome to "No" (definitively out,
        // e.g. knocked out of the tournament) -> show an X instead of odds/payout
        eliminated: isEliminated(s),
      }));
    } else {
      S.multi = false;
      S.exclusive = true;
      S.outcomes = [];
    }
    return S.multi;
  }

  // outcome objects sorted by current chance desc (eliminated ones sink to the bottom)
  function outcomesByChance() {
    return S.outcomes.slice().sort((a, b) => {
      if (!!a.eliminated !== !!b.eliminated) return a.eliminated ? 1 : -1;
      return (b.chance || 0) - (a.chance || 0);
    });
  }

  // A market/outcome is "eliminated" once Kalshi has SETTLED it to No — i.e. it's
  // definitively no longer possible (knocked out of the tournament, etc). We rely
  // on the settled result, not just low odds, so a genuine long-shot isn't flagged.
  function isEliminated(m) {
    if (!m) return false;
    const result = String(m.result || "").toLowerCase();
    const status = String(m.status || "").toLowerCase();
    const settled = status === "settled" || status === "finalized"
      || status === "determined" || status === "closed";
    return result === "no" || (settled && result !== "yes" && result !== "");
  }

  // tickers that belong to THIS market/event (market + siblings)
  function relevantTickers() {
    const set = new Set();
    if (S.market && S.market.ticker) set.add(S.market.ticker);
    if (S.ticker) set.add(S.ticker);
    S.outcomes.forEach((o) => { if (o.ticker) set.add(o.ticker); });
    return set;
  }

  // describe a bet's backed outcome: {name, logo}. For multi, match the sibling;
  // for binary, "Yes"/"No" off the bet side.
  function betOutcome(bet) {
    if (S.multi) {
      const o = S.outcomes.find((x) => x.ticker === bet.ticker);
      if (o) return { name: o.name, logo: o.logo || null };
    } else if (bet.side === "yes") {
      return { name: yesOutcomeName(), logo: (S.market && S.market.logo) || null };
    }
    if (bet.side === "no") return { name: "No", logo: null };
    return { name: bet.title || bet.ticker || "—", logo: null };
  }

  // chart line color for a bet (matches its outcome's series color; gold default)
  function betSeriesColor(bet) {
    if (S.multi) {
      const s = S.series.find((x) => x.ticker === bet.ticker);
      if (s) return s.color;
    }
    return bet.side === "no" ? "#fb5a6a" : "#27d18b";
  }

  // ---- price helpers -------------------------------------------------------
  // YES "spot" probability used for the big number
  // Implied "chance" for display (header %, change baseline). Uses the shared
  // robust estimator so illiquid long-shots don't read as 100%.
  function yesSpot(m) {
    if (!m) return null;
    return NRB.odds.chance(m);
  }

  // event ticker (preferred for fav + history)
  function eventTicker() {
    return (S.meta && S.meta.event_ticker) || (S.market && S.market.event_ticker) || S.ticker;
  }

  // the currently selected outcome object in multi mode (matches S.ticker)
  function selectedOutcome() {
    if (!S.multi) return null;
    return S.outcomes.find((o) => o.ticker === S.ticker) || S.outcomes[0] || null;
  }

  // a name to drive the header icon
  function headerIconName() {
    const m = S.market || {};
    if (S.multi) {
      const o = selectedOutcome();
      if (o) return o.name;
    }
    return m.yes_sub_title || m.title || (S.meta && S.meta.event_title) || S.ticker || "";
  }

  // logo URL for the header icon (selected sibling in multi mode, else market.logo)
  function headerIconLogo() {
    if (S.multi) {
      const o = selectedOutcome();
      if (o) return o.logo || null;
    }
    return (S.market && S.market.logo) || null;
  }

  // display name of the YES outcome (for chart line A + outcome box A in binary mode)
  function yesOutcomeName() {
    const m = S.market || {};
    return m.yes_sub_title || "Yes";
  }

  // returns fn(unixMs) -> short axis label appropriate to the range
  function tickFormatter(range) {
    const dayRanges = { "1W": 1, "1M": 1, "ALL": 1 };
    return (ms) => {
      const d = new Date(ms);
      if (dayRanges[range]) {
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    };
  }

  // tooltip title: ALWAYS a readable date + time (never the raw epoch number)
  function fmtTipTime(ms) {
    if (ms == null || isNaN(ms)) return "";
    try {
      return new Date(ms).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
    } catch (e) { return ""; }
  }

  // Smooth order-book noise out of a price series while preserving genuine moves.
  // Edge-preserving (median-anchored bilateral) filter: for each point, take the
  // local window's median as a robust "level", then average only the neighbours
  // on that level (within RANGE). Effects:
  //   * isolated spikes that snap back  -> ignored (minority in the window)
  //   * rapid back-and-forth bouncing   -> settles to the MIDDLE of both sides
  //   * steep sustained drops/spikes     -> kept sharp (the far level is excluded)
  // Keeps every timestamp (only values are adjusted), so hover/alignment are intact.
  function smoothSeries(points) {
    const n = points ? points.length : 0;
    if (n < 5) return points ? points.slice() : [];
    const W = 3;          // window radius (7-point window)
    const RANGE = 0.06;   // values within 6pp of the local median are one "level"
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W);
      const win = [];
      for (let j = lo; j <= hi; j++) win.push(points[j].p);
      win.sort((a, b) => a - b);
      const med = win[Math.floor(win.length / 2)];   // robust local center
      let sum = 0, wt = 0;
      for (let j = lo; j <= hi; j++) {
        if (Math.abs(points[j].p - med) <= RANGE) { sum += points[j].p; wt++; }
      }
      out[i] = { t: points[i].t, p: wt ? sum / wt : points[i].p };
    }
    return out;
  }

  // ============================================================ rendering
  // big, bold, text-less back chevron used at the top of the immersive view
  const BACK_SVG = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none"
      stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`;

  function skeleton() {
    return `
      <div class="detail-wrap">
        <button class="detail-back" id="d-back" aria-label="Back">${BACK_SVG}</button>
        <div class="detail-grid">
          <div class="detail-main">
            <div class="skeleton" style="height:120px;border-radius:var(--radius);margin-bottom:14px"></div>
            <div class="skeleton" style="height:300px;border-radius:var(--radius)"></div>
          </div>
          <div class="detail-side">
            <div class="skeleton" style="height:340px;border-radius:var(--radius)"></div>
          </div>
        </div>
      </div>`;
  }

  function shell() {
    return `
      <div class="detail-wrap">
        <button class="detail-back" id="d-back" aria-label="Back">${BACK_SVG}</button>

        <div class="detail-grid">
          <div class="detail-main">
            <!-- header: category, title, (games) matchup -->
            <div class="detail-head">
              <div class="detail-head-top">
                <div class="detail-head-text">
                  <div class="detail-event muted" id="d-event"></div>
                  <h1 class="detail-title" id="d-title"></h1>
                </div>
                <button class="detail-fav" id="d-fav" aria-label="Favorite" title="Add to watchlist">☆</button>
              </div>
              <div class="detail-matchup hidden" id="d-matchup"></div>
            </div>

            <!-- hero chart -->
            <div class="card detail-chart-card">
              <button class="detail-chat-btn" id="d-chat" type="button" aria-label="Open live chat">
                <svg class="ico-svg" viewBox="0 0 24 24" width="17" height="17"><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L4 21l1.9-5.1A8.4 8.4 0 1 1 21 11.5z"/></svg>
                <span>live chat</span>
              </button>
              <div class="detail-chart-box">
                <canvas id="d-chart"></canvas>
                <div class="detail-chart-tip" id="d-tip"></div>
                <div class="detail-chart-empty muted hidden" id="d-chart-empty">No price history available.</div>
              </div>
              <div class="detail-chart-foot">
                <div class="detail-vol muted tnum" id="d-vol"></div>
                <div class="detail-pills" id="d-pills"></div>
              </div>
            </div>

            <!-- spread / total betting lines (game events only) -->
            <div class="detail-lines" id="d-lines"></div>
          </div>

          <!-- trade panel -->
          <div class="detail-side">
            <div class="card detail-trade">
              <div class="detail-card-title" id="d-trade-title">Pick an outcome</div>
              <div class="detail-outcomes" id="d-side-toggle"></div>
              <div class="detail-yesno hidden" id="d-yesno"></div>

              <div class="detail-predict" id="d-predict"></div>

              <label class="detail-field">
                <span class="detail-field-lbl muted">Wager ($)</span>
                <div class="detail-stepper">
                  <button type="button" class="detail-step" data-step="-5">−</button>
                  <input type="number" id="d-wager" min="1" step="1" value="10" class="tnum">
                  <button type="button" class="detail-step" data-step="5">+</button>
                </div>
                <div class="detail-towin" id="d-towin"></div>
              </label>

              <div class="detail-quote" id="d-quote">
                <div class="muted detail-quote-loading">Enter a wager to see a quote…</div>
              </div>

              <button class="btn btn-primary btn-block detail-place" id="d-place">Place paper bet</button>
              <button class="btn btn-ghost btn-block detail-add-slip" id="d-add-slip">+ Add to slip</button>
              <button class="btn btn-ghost btn-block detail-alert" id="d-alert">🔔 Set a price alert</button>
              <div class="detail-disclaimer muted">
                No real money. Fills walk the live order book incl. Kalshi's fee.
              </div>
            </div>

            <!-- your positions on this market (empty -> renders nothing) -->
            <div class="detail-position" id="d-position"></div>
          </div>
        </div>

        <!-- slide-up live-chat sheet (discussion) -->
        <div class="chat-sheet" id="d-chat-sheet" aria-hidden="true">
          <div class="chat-sheet-backdrop" id="d-chat-backdrop"></div>
          <div class="chat-sheet-panel" role="dialog" aria-label="Live chat">
            <div class="chat-sheet-head">
              <span class="chat-sheet-title">Live chat</span>
              <button class="chat-sheet-close" id="d-chat-close" aria-label="Close">×</button>
            </div>
            <div class="chat-sheet-body" id="d-chat-body"></div>
          </div>
        </div>
      </div>`;
  }

  // ---- header --------------------------------------------------------------
  function renderHead() {
    const m = S.market, meta = S.meta;
    const $ = (id) => document.getElementById(id);
    if (!$("d-title")) return;
    // For multi-outcome markets keep the title BROAD (the event question, e.g.
    // "Golden Boot Winner") rather than one option ("Will Dembele lead in goals?").
    const broadTitle = meta.event_title || S.event_title || (m && m.title) || S.ticker;
    if (S.multi) {
      $("d-event").textContent = meta.category || "";
      $("d-title").textContent = broadTitle;
    } else {
      $("d-event").textContent = meta.event_title || meta.category || "";
      $("d-title").textContent = m ? (m.title || S.ticker) : S.ticker;
    }
    renderFav();
    renderMatchup();
    renderVol();
  }

  function renderFav() {
    const btn = document.getElementById("d-fav");
    if (!btn) return;
    const on = NRB.fav.has(eventTicker());
    btn.classList.toggle("on", on);
    btn.textContent = on ? "★" : "☆";
  }

  // small "$<vol> vol" tucked into the bottom-left of the chart
  function renderVol() {
    const host = document.getElementById("d-vol");
    if (!host) return;
    const v = S.market && S.market.volume;
    host.textContent = (v != null) ? ("$" + fmt.vol(v) + " vol") : "";
  }

  // ---- matchup (sports games only): two big team crests with the abbreviated
  // name below each, and the kickoff date/time (or live score+clock) centered
  // between them. Built from ESPN when matched, else from the Kalshi outcomes.
  function teamAbbrev(name, abbr) {
    if (abbr) return abbr;
    const n = String(name || "").trim();
    if (n.length <= 14) return n;               // national teams etc. are short
    const words = n.split(/\s+/);
    return words[words.length - 1];             // "Manchester City" -> "City"
  }
  function matchupTeams() {
    const g = S.game;
    if (g && g.matched && (g.away || g.home)) {
      const a = g.away || {}, h = g.home || {};
      return [
        { name: a.name || a.abbr || "", abbr: a.abbr, logo: a.logo },
        { name: h.name || h.abbr || "", abbr: h.abbr, logo: h.logo },
      ];
    }
    // fall back to the two team outcomes (drop a Tie/Draw option)
    const teams = (S.outcomes || []).filter((o) => !/\b(tie|draw)\b/i.test(o.name));
    if (teams.length >= 2) {
      return [
        { name: teams[0].name, logo: teams[0].logo },
        { name: teams[1].name, logo: teams[1].logo },
      ];
    }
    return null;
  }
  function renderMatchup() {
    const host = document.getElementById("d-matchup");
    if (!host) return;
    if (!isGameEvent()) { host.classList.add("hidden"); host.innerHTML = ""; return; }
    const teams = matchupTeams();
    if (!teams) { host.classList.add("hidden"); host.innerHTML = ""; return; }

    const g = S.game;
    const now = Date.now() / 1000;
    const occ = S.market && S.market.occurrence_ts;
    const crest = (t) => t.logo
      ? `<img class="icoflag-img logo" src="${fmt.esc(t.logo)}" alt="">`
      : NRB.icon(t.name || "");
    const teamHtml = (t) => `
      <div class="detail-mt-team">
        <span class="detail-mt-icon">${crest(t)}</span>
        <span class="detail-mt-nm">${fmt.esc(teamAbbrev(t.name, t.abbr))}</span>
      </div>`;

    // center: live/finished score, else scheduled kickoff date+time
    let center = "";
    if (g && g.matched && (g.state === "in" || g.state === "post")) {
      const live = g.state === "in";
      const a = g.away || {}, h = g.home || {};
      const score = `${a.score != null ? a.score : ""}–${h.score != null ? h.score : ""}`;
      const dot = live ? `<span class="detail-live-dot"></span>` : "";
      const statusCls = live ? "detail-mt-status live" : "detail-mt-status muted";
      center = `<div class="detail-mt-score tnum">${fmt.esc(score)}</div>
        <div class="${statusCls}">${dot}${fmt.esc(g.detail || (live ? "Live" : "Final"))}</div>`;
    } else if (occ) {
      const parts = fmtKickoffParts(occ);
      center = `<div class="detail-mt-date">${fmt.esc(parts.date)}</div>
        <div class="detail-mt-time">${fmt.esc(parts.time)}</div>`;
    } else if (g && g.matched && g.state === "pre" && g.detail) {
      center = `<div class="detail-mt-date muted">${fmt.esc(g.detail)}</div>`;
    } else {
      center = `<div class="detail-mt-vs muted">vs</div>`;
    }

    host.innerHTML = teamHtml(teams[0]) +
      `<div class="detail-mt-center">${center}</div>` + teamHtml(teams[1]);
    host.classList.remove("hidden");
  }

  // ---- pills (bottom-right of the chart: 1D / 1W / 1M / ALL) ----------------
  function renderPills() {
    const host = document.getElementById("d-pills");
    if (!host) return;
    host.innerHTML = "";
    RANGES.forEach((r) => {
      const b = NRB.el(`<button class="pill${r === S.range ? " active" : ""}">${r}</button>`);
      b.addEventListener("click", () => {
        if (S.range === r) return;
        S.range = r;
        renderPills();
        loadHistory();
      });
      host.appendChild(b);
    });
  }

  // ---- chart: HTML external tooltip (never clipped at chart edges) ---------
  function externalTooltip(context) {
    const tipEl = document.getElementById("d-tip");
    if (!tipEl) return;
    const tt = context.tooltip;
    if (!tt || tt.opacity === 0) { tipEl.classList.remove("show"); return; }

    // title (timestamp) + one row per dataset: color dot · name · %
    if (tt.body) {
      const items = tt.dataPoints || [];
      const titleTxt = (tt.title && tt.title[0]) || "";
      const rows = items.map((dp) => {
        // entry-marker points get a clear "You: N @ X% on Name" row
        if (dp.dataset && dp.dataset._isMarkers) {
          const raw = dp.raw || {};
          return `<div class="detail-tip-row">
              <span class="detail-tip-dot" style="background:${raw._color || "#e7b850"};border:1.5px solid #e7b850"></span>
              <span class="detail-tip-nm">${fmt.esc(raw._label || "Your entry")}</span>
            </div>`;
        }
        const color = dp.dataset.borderColor || "#27d18b";
        const name = dp.dataset.label || "";
        const pct = Math.round(dp.parsed.y);
        return `<div class="detail-tip-row">
            <span class="detail-tip-dot" style="background:${color}"></span>
            <span class="detail-tip-nm">${fmt.esc(name)}</span>
            <span class="detail-tip-pct tnum">${pct}%</span>
          </div>`;
      }).join("");
      tipEl.innerHTML = `<div class="detail-tip-title">${fmt.esc(titleTxt)}</div>${rows}`;
    }

    // position + clamp inside the chart wrapper so nothing overflows either edge
    const box = tipEl.parentElement;            // .detail-chart-box (position:relative)
    const boxW = box.clientWidth;
    const boxH = box.clientHeight;
    tipEl.classList.add("show");                // make measurable
    const tipW = tipEl.offsetWidth;
    const tipH = tipEl.offsetHeight;
    const caret = tt.caretX;
    const GAP = 12;
    // prefer right of caret; flip left if it would overflow the right edge
    let left = caret + GAP;
    if (left + tipW > boxW) left = caret - GAP - tipW;
    left = Math.max(4, Math.min(left, boxW - tipW - 4));   // clamp horizontally
    let top = (tt.caretY || boxH / 2) - tipH / 2;
    top = Math.max(4, Math.min(top, boxH - tipH - 4));     // clamp vertically
    tipEl.style.left = left + "px";
    tipEl.style.top = top + "px";
  }

  // ---- chart entry markers (user's bets) ----------------------------------
  // current x-range window (ms) of the displayed history
  function chartXWindow() {
    let pts;
    if (S.multi) {
      pts = [];
      S.series.forEach((s) => { (s.points || []).forEach((p) => pts.push(p.t)); });
    } else {
      pts = (S.points || []).map((p) => p.t);
    }
    if (!pts.length) return null;
    return { min: Math.min(...pts) * 1000, max: Math.max(...pts) * 1000 };
  }

  // scatter points for OPEN + settled bets whose entry falls in the window
  function buildMarkerData() {
    const win = chartXWindow();
    if (!win) return [];
    return (S.bets || [])
      .filter((b) => b.placed_at && b.avg_price != null)
      .map((b) => {
        const x = b.placed_at * 1000;
        if (x < win.min || x > win.max) return null;
        const oc = betOutcome(b);
        return {
          x, y: b.avg_price * 100,
          _color: betSeriesColor(b),
          _label: `You: ${fmt.vol(b.contracts)} @ ${fmt.pct(b.avg_price)} on ${oc.name}`,
        };
      })
      .filter(Boolean);
  }

  // update just the marker dataset live (no full chart rebuild)
  function refreshMarkers() {
    if (!S.chart) return;
    const ds = S.chart.data.datasets.find((d) => d._isMarkers);
    if (!ds) return;
    ds.data = buildMarkerData();
    S.chart.update("none");
  }

  // ---- chart ---------------------------------------------------------------
  // Pick a clean y-axis top at/just above the highest plotted value, so the
  // chart fills the height (a 30%-peak chart tops out at 30%, not 100%).
  function niceChartTop(peak) {
    if (!peak || peak <= 0) return 10;
    if (peak >= 90) return 100;
    for (const top of [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 90, 100]) {
      if (peak <= top) return top;
    }
    return 100;
  }

  const CHART_FONT = 'Inter, system-ui, "Segoe UI", sans-serif';
  const GUTTER_FRAC = 0.20;   // right 20% of the chart is reserved for end labels

  // short uppercase abbreviation for an outcome, for the end-of-line labels
  // e.g. "Argentina" -> "ARG", "Los Angeles Lakers" -> "LAL", "No" -> "NO"
  function outcomeAbbr(name) {
    const n = String(name || "").trim();
    if (!n) return "";
    if (n.length <= 4) return n.toUpperCase();
    const words = n.split(/\s+/).filter(Boolean);
    if (words.length > 1) return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
    return n.slice(0, 3).toUpperCase();
  }

  // nearest aligned-data index for a canvas-x pixel (for touch scrubbing)
  function indexForPixel(chart, px) {
    const ds = chart.data.datasets.find((d) => !d._isMarkers && (d.data || []).length);
    if (!ds) return -1;
    const xVal = chart.scales.x.getValueForPixel(px);
    let best = 0, bestD = Infinity;
    ds.data.forEach((pt, i) => {
      const d = Math.abs(pt.x - xVal);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // Custom overlay drawn on top of the lines:
  //  * ALWAYS: an end-of-line label per outcome (abbreviation over the %) in the
  //    right gutter, at the value of the active index.
  //  * WHILE TOUCHING (chart.$nrb.touching): a light dotted vertical scrub line at
  //    the touched point, a dot on each line, the date/time near the top, and the
  //    labels track the touched value. Default (not touching) = latest point ("now").
  const chartOverlay = {
    id: "nrbOverlay",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx, chartArea = chart.chartArea, scales = chart.scales;
      if (!chartArea) return;
      const lines = [];
      chart.data.datasets.forEach((ds, di) => {
        if (ds._isMarkers || !(ds.data || []).length) return;
        if (chart.getDatasetMeta(di).hidden) return;
        lines.push({ ds, di });
      });
      if (!lines.length) return;

      const len = lines[0].ds.data.length;
      const st = chart.$nrb || {};
      const touching = !!st.touching;
      let idx = (touching && st.idx != null) ? st.idx : (len - 1);
      idx = Math.max(0, Math.min(idx, len - 1));

      // one label per line at the active index
      const labels = [];
      lines.forEach(({ ds }) => {
        const pt = ds.data[idx];
        if (!pt || pt.y == null) return;
        labels.push({
          y: scales.y.getPixelForValue(pt.y),
          color: ds.borderColor || "#8b95a6",
          abbr: ds._abbr || "",
          pct: Math.round(pt.y) + "%",
        });
      });
      // de-collide vertically, then clamp inside the plot
      labels.sort((a, b) => a.y - b.y);
      const MINH = 30;
      for (let i = 1; i < labels.length; i++)
        if (labels[i].y - labels[i - 1].y < MINH) labels[i].y = labels[i - 1].y + MINH;
      const topLim = chartArea.top + 13, botLim = chartArea.bottom - 8;
      for (let i = labels.length - 1; i >= 0; i--) {
        if (labels[i].y > botLim) labels[i].y = botLim;
        if (i < labels.length - 1 && labels[i + 1].y - labels[i].y < MINH)
          labels[i].y = labels[i + 1].y - MINH;
        if (labels[i].y < topLim) labels[i].y = topLim;
      }

      const lx = chartArea.right + 8;
      ctx.save();
      ctx.textAlign = "left";
      labels.forEach((l) => {
        ctx.fillStyle = l.color;
        ctx.textBaseline = "alphabetic";
        ctx.font = "700 10px " + CHART_FONT;
        ctx.fillText(l.abbr, lx, l.y - 3);
        ctx.font = "800 13px " + CHART_FONT;
        ctx.fillText(l.pct, lx, l.y + 12);
      });
      ctx.restore();

      if (!touching) return;

      // scrub visuals: dotted line + dots + a date/time label near the top
      const refPt = lines[0].ds.data[idx];
      const px = scales.x.getPixelForValue(refPt.x);
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(139,149,166,0.75)";
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      lines.forEach(({ ds }) => {
        const pt = ds.data[idx];
        if (!pt || pt.y == null) return;
        ctx.beginPath();
        ctx.fillStyle = ds.borderColor || "#8b95a6";
        ctx.arc(px, scales.y.getPixelForValue(pt.y), 3.2, 0, Math.PI * 2);
        ctx.fill();
      });
      const t = fmtTipTime(refPt.x);
      if (t) {
        ctx.font = "600 11px " + CHART_FONT;
        const tw = ctx.measureText(t).width;
        let tx = Math.max(chartArea.left, Math.min(px - tw / 2, chartArea.right - tw));
        const ty = chartArea.top - 9;
        ctx.fillStyle = "rgba(20,24,31,0.9)";
        ctx.fillRect(tx - 5, ty - 1, tw + 10, 15);
        ctx.fillStyle = "#c7cfdb";
        ctx.textBaseline = "top";
        ctx.fillText(t, tx, ty + 1);
      }
      ctx.restore();
    },
  };

  // scrub handlers (attached once to the canvas in wire(); read the live S.chart)
  function scrubAt(clientX) {
    if (!S || !S.chart) return;
    const cv = document.getElementById("d-chart");
    if (!cv) return;
    const px = clientX - cv.getBoundingClientRect().left;
    const idx = indexForPixel(S.chart, px);
    if (idx < 0) return;
    S.chart.$nrb = { touching: true, idx };
    S.chart.render();
  }
  function scrubEnd() {
    if (!S || !S.chart) return;
    S.chart.$nrb = { touching: false, idx: -1 };
    S.chart.render();
  }

  function buildChart() {
    const canvas = document.getElementById("d-chart");
    const emptyEl = document.getElementById("d-chart-empty");
    if (!canvas) return;

    if (S.chart) { S.chart.destroy(); S.chart = null; }
    const tipEl = document.getElementById("d-tip");
    if (tipEl) tipEl.classList.remove("show");   // clear any stale tooltip on rebuild

    // does any series have data?
    const hasData = S.multi
      ? S.series.some((s) => s.points && s.points.length)
      : S.points.length > 0;
    if (!hasData) {
      canvas.classList.add("hidden");
      if (emptyEl) emptyEl.classList.remove("hidden");
      renderLegend();
      return;
    }
    canvas.classList.remove("hidden");
    if (emptyEl) emptyEl.classList.add("hidden");

    const ctx = canvas.getContext("2d");

    let datasets;
    if (S.multi) {
      // align every outcome onto a SHARED timeline so hover dots/tooltip line up.
      // T = sorted union of all timestamps; each series is step/forward-filled over T.
      const tset = new Set();
      S.series.forEach((s) => (s.points || []).forEach((p) => tset.add(p.t)));
      const T = Array.from(tset).sort((a, b) => a - b);

      const aligned = (s) => {
        const pts = s.points || [];
        const out = [];
        let i = 0, last = pts.length ? pts[0].p : null; // before first point -> first value
        for (const t of T) {
          while (i < pts.length && pts[i].t <= t) { last = pts[i].p; i++; }
          out.push({ x: t * 1000, y: last == null ? null : last * 100 });
        }
        return out;
      };

      datasets = S.series.map((s) => ({
        label: s.name,
        _abbr: outcomeAbbr(s.name),
        data: aligned(s),
        borderColor: s.color,
        borderWidth: 2,
        backgroundColor: "transparent",
        fill: false,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 0,
      }));
    } else {
      // vertical gradient fill under the YES line, mint -> transparent
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 300);
      grad.addColorStop(0, "rgba(39,209,139,0.28)");
      grad.addColorStop(1, "rgba(39,209,139,0.00)");
      const yesData = S.points.map((pt) => ({ x: pt.t * 1000, y: pt.p * 100 }));
      const noData = S.points.map((pt) => ({ x: pt.t * 1000, y: 100 - pt.p * 100 }));
      datasets = [
        {
          label: yesOutcomeName(),
          _abbr: outcomeAbbr(yesOutcomeName()),
          data: yesData,
          borderColor: "#27d18b",
          borderWidth: 2,
          backgroundColor: grad,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
        {
          label: "No",
          _abbr: "NO",
          data: noData,
          borderColor: "#fb5a6a",
          borderWidth: 2,
          backgroundColor: "transparent",
          fill: false,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
      ];
    }

    // gold entry markers (user's bets), drawn on top as a scatter dataset
    datasets.push({
      _isMarkers: true,
      label: "Your entries",
      type: "scatter",
      data: buildMarkerData(),
      showLine: false,
      pointStyle: "triangle",
      pointRadius: 6,
      pointHoverRadius: 8,
      pointBackgroundColor: "rgba(231,184,80,0.9)",
      pointBorderColor: "#0b0e13",
      pointBorderWidth: 1.5,
      order: -1,
    });

    // y-axis fills the space: bottom always 0%, top = clean ceiling at the peak
    // of everything drawn (the outcome lines + any bet-entry markers).
    let peak = 0;
    datasets.forEach((ds) => (ds.data || []).forEach((pt) => {
      const y = pt && pt.y;
      if (typeof y === "number" && isFinite(y) && y > peak) peak = y;
    }));
    const yMax = niceChartTop(peak);

    // reserve the right ~20% of the chart width for the end-of-line labels, and
    // no left padding so the lines start at the very left edge of the screen
    const boxW = (canvas.parentElement && canvas.parentElement.clientWidth) || 320;
    const gutterPx = Math.max(52, Math.round(boxW * GUTTER_FRAC));

    S.chart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      plugins: [chartOverlay],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        events: [],                // we drive scrubbing via our own touch handlers
        layout: { padding: { top: 12, right: gutterPx, bottom: 6, left: 0 } },
        // Clean, chrome-free chart: NO axes, NO gridlines, NO tick labels, NO box.
        // Per-outcome value labels live in the right gutter; touch to scrub.
        scales: {
          x: {
            type: "linear",
            display: false,
            grid: { display: false, drawTicks: false },
            border: { display: false },
            ticks: { display: false },
          },
          y: {
            min: 0, max: yMax,
            display: false,
            grid: { display: false, drawTicks: false },
            border: { display: false },
            ticks: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
    renderLegend();
  }

  // ---- chart legend (live current chances) --------------------------------
  function renderLegend() {
    const host = document.getElementById("d-legend");
    if (!host) return;
    const itemColor = (color, name, pct) =>
      `<span class="detail-legend-item">
        <span class="detail-legend-dot" style="background:${color}"></span>
        <span class="detail-legend-nm">${fmt.esc(name)}</span>
        <span class="detail-legend-pct tnum">${pct}%</span>
      </span>`;

    if (S.multi) {
      if (!S.series.length) { host.innerHTML = ""; return; }
      // current chance comes from the live outcomes list (kept fresh by poll)
      const chanceByTicker = {};
      S.outcomes.forEach((o) => { chanceByTicker[o.ticker] = o.chance; });
      host.innerHTML = S.series.map((s) => {
        const p = chanceByTicker[s.ticker];
        const pct = (p == null) ? "—" : Math.round(p * 100);
        return itemColor(s.color, s.name, pct);
      }).join("");
      return;
    }

    const spot = yesSpot(S.market);
    if (spot == null) { host.innerHTML = ""; return; }
    const yesPct = Math.round(spot * 100);
    const noPct = 100 - yesPct;
    host.innerHTML =
      itemColor("var(--accent)", yesOutcomeName(), yesPct) +
      itemColor("var(--no)", "No", noPct);
  }


  // ---- trade panel ---------------------------------------------------------
  // current ask price of whatever is selected (for wager -> contracts)
  function selectedPrice() {
    const m = S.market || {};
    // No side (independent multi or binary): the ask to buy "No"
    if (S.side === "no") {
      return (m.no_ask != null) ? m.no_ask : (m.last_price != null ? 1 - m.last_price : null);
    }
    // Yes side, exclusive multi: use the selected outcome's ask
    if (S.multi) {
      const o = selectedOutcome();
      if (o && o.price != null) return o.price;
    }
    return (m.yes_ask != null) ? m.yes_ask : m.last_price;
  }

  // build the list of {key, name, price, logo, selected} entries for the bet
  // boxes. `price` here is the DISPLAY chance (implied probability), not the ask.
  function outcomeEntries() {
    if (S.multi) {
      return outcomesByChance().map((o) => ({
        key: o.ticker, name: o.name, price: o.chance, logo: o.logo || null,
        selected: o.ticker === S.ticker, eliminated: !!o.eliminated,
      }));
    }
    const m = S.market || {};
    const c = NRB.odds.chance(m);
    return [
      { key: "yes", name: yesOutcomeName(), price: c, logo: null, selected: S.side === "yes" },
      { key: "no", name: "No", price: 1 - c, logo: null, selected: S.side === "no" },
    ];
  }

  function renderSideToggle() {
    const host = document.getElementById("d-side-toggle");
    if (!host) return;
    // card title hints at the interaction for this market type
    const titleEl = document.getElementById("d-trade-title");
    if (titleEl) titleEl.textContent = !S.multi ? "Take a side"
      : (S.exclusive ? "Pick an outcome" : "Pick one, then Yes or No");
    const entries = outcomeEntries();
    // >6 outcomes -> compact scrollable rows; otherwise big boxes
    const compact = S.multi && entries.length > 6;
    host.className = "detail-outcomes" + (compact ? " compact" : "");

    host.innerHTML = entries.map((e) => {
      // eliminated (settled-No) -> an X in place of odds/payout; not selectable
      if (e.eliminated) {
        return `
          <div class="detail-outcome eliminated" aria-disabled="true">
            <span class="detail-outcome-head">
              <span class="detail-outcome-ico">${NRB.icon(e.name, e.logo)}</span>
              <span class="detail-outcome-nm">${fmt.esc(e.name)}</span>
            </span>
            <span class="detail-outcome-x" aria-hidden="true">✕</span>
            <span class="detail-outcome-prob muted">Eliminated</span>
          </div>`;
      }
      return `
        <button class="detail-outcome ${e.selected ? "active is-yes" : ""}" data-key="${fmt.esc(e.key)}">
          <span class="detail-outcome-head">
            <span class="detail-outcome-ico">${NRB.icon(e.name, e.logo)}</span>
            <span class="detail-outcome-nm">${fmt.esc(e.name)}</span>
          </span>
          <span class="detail-outcome-mult tnum">${odds.multStr(e.price)}</span>
          <span class="detail-outcome-prob tnum muted">${odds.prob(e.price)} chance</span>
        </button>`;
    }).join("");

    host.querySelectorAll("button.detail-outcome").forEach((b) => {
      b.addEventListener("click", () => selectOutcome(b.dataset.key));
    });
    renderYesNo();
  }

  // independent multi (each outcome is its own Yes/No market): a Yes/No segment
  // for the currently-selected outcome. Hidden in exclusive/binary modes.
  function renderYesNo() {
    const host = document.getElementById("d-yesno");
    if (!host) return;
    if (!(S.multi && !S.exclusive)) { host.className = "detail-yesno hidden"; host.innerHTML = ""; return; }
    host.className = "detail-yesno";
    const m = S.market || {};
    const yesC = NRB.odds.chance(m);
    const noC = (yesC == null) ? null : 1 - yesC;
    const o = selectedOutcome();
    const nm = (o && o.name) || m.yes_sub_title || "this outcome";
    host.innerHTML = `
      <div class="detail-yesno-lbl muted">Bet on ${fmt.esc(nm)}</div>
      <div class="detail-yesno-seg">
        <button class="detail-yn ${S.side === "yes" ? "active is-yes" : ""}" data-side="yes">
          <span class="detail-yn-side">Yes</span><span class="detail-yn-pct tnum">${odds.prob(yesC)}</span></button>
        <button class="detail-yn ${S.side === "no" ? "active is-no" : ""}" data-side="no">
          <span class="detail-yn-side">No</span><span class="detail-yn-pct tnum">${odds.prob(noC)}</span></button>
      </div>`;
    host.querySelectorAll(".detail-yn").forEach((b) =>
      b.addEventListener("click", () => setSide(b.dataset.side)));
  }

  // change Yes/No for the currently-selected outcome (independent mode + binary)
  function setSide(side) {
    if ((side !== "yes" && side !== "no") || side === S.side) return;
    S.side = side;
    resetForecast();   // forecast is per-side
    renderYesNo();
    renderHead();
    requestQuote();
  }

  // select an outcome (multi: a sibling ticker; binary: "yes"/"no")
  function selectOutcome(key) {
    if (S.multi) {
      if (!key || key === S.ticker) return;
      S.ticker = key;
      if (S.exclusive) S.side = "yes";   // exclusive: always back the picked outcome
      resetForecast();   // forecast is per-outcome
      renderSideToggle();
      renderHead();
      // selected market changed -> refetch its market + history
      refreshMarket();
      loadHistory();
      requestQuote();
      return;
    }
    if (key === S.side) return;
    S.side = key;
    resetForecast();     // forecast is per-outcome
    renderSideToggle();
    renderHead();
    requestQuote();
  }

  function requestQuote() {
    // wager/outcome is changing -> any pending confirm is now stale
    resetConfirm();
    // instant "to win" feedback from price before the quote returns
    S.lastQuote = null;
    renderToWin();
    if (S.quoteTimer) clearTimeout(S.quoteTimer);
    S.quoteTimer = setTimeout(runQuote, QUOTE_DEBOUNCE);
  }

  // convert the dollar wager to a contract count using the selected ask price
  function wagerToContracts() {
    const w = Math.max(0, Number(S.wager) || 0);
    const price = selectedPrice();
    if (!w || !price || price <= 0) return 0;
    return Math.max(1, Math.round(w / price));
  }

  // display name of the currently selected outcome (for confirm + toast)
  function selectedName() {
    if (S.multi) {
      const o = selectedOutcome();
      const nm = o ? o.name : "";
      // independent: include the Yes/No side, e.g. "France — No"
      return (!S.exclusive && nm) ? (nm + " — " + (S.side === "no" ? "No" : "Yes")) : nm;
    }
    return S.side === "no" ? "No" : yesOutcomeName();
  }

  // live payout/profit: prefer the real quote, else estimate from price × multiplier
  function payoutEstimate() {
    const w = Math.max(0, Number(S.wager) || 0);
    const q = S.lastQuote;
    if (q && q.ok !== false && q.max_payout != null) {
      return { payout: q.max_payout, profit: (q.max_profit != null ? q.max_profit : q.max_payout - w) };
    }
    const mult = odds.mult(selectedPrice());
    if (!w || mult == null) return null;
    const payout = w * mult;
    return { payout, profit: payout - w };
  }

  // live "→ win $X" readout under the wager input
  function renderToWin() {
    const el = document.getElementById("d-towin");
    if (!el) return;
    const est = payoutEstimate();
    if (!est) { el.innerHTML = ""; return; }
    el.innerHTML = `<span class="muted">→ win</span> <span class="pos tnum">${fmt.usd(est.payout)}</span>`;
  }

  // ---- two-step confirm ----------------------------------------------------
  function resetConfirm() {
    S.confirming = false;
    const btn = document.getElementById("d-place");
    if (btn && !S.destroyed) {
      btn.classList.remove("detail-confirm");
      btn.textContent = "Place paper bet";
    }
  }

  function enterConfirm() {
    const n = wagerToContracts();
    if (!n) { NRB.toast("Enter a wager amount."); return; }
    const est = payoutEstimate();
    const btn = document.getElementById("d-place");
    if (!btn) return;
    S.confirming = true;
    btn.classList.add("detail-confirm");
    const payTxt = est ? (" → win " + fmt.usd(est.payout)) : "";
    btn.textContent = `Confirm: ${fmt.usd(S.wager)} on ${selectedName()}${payTxt}`;
  }

  function onPlaceClick() {
    if (S.confirming) { placeBet(); return; }
    enterConfirm();
  }

  // add the CURRENTLY SELECTED outcome as a parlay leg (global bet slip)
  function addToSlip() {
    if (!S.ticker) { NRB.toast("Pick an outcome first."); return; }
    if (!NRB.slip || !NRB.slip.add) return;
    const m = S.market || {};
    NRB.slip.add({
      ticker: S.ticker,
      side: S.multi ? "yes" : S.side,
      name: selectedName(),
      price: selectedPrice(),                 // current ask for the selected side, 0–1
      logo: headerIconLogo(),                 // selected outcome's logo (or null)
      eventTitle: (S.meta && S.meta.event_title) || m.title || "",
    });
  }

  // ---- forecast widget (opt-in, collapsed, blind-by-default) ---------------
  // reset whenever the selected outcome changes
  function resetForecast() {
    S.fc = S.predictEnabled ? freshForecast() : null;
    renderForecast();
  }

  // your locked probability for the selected side, as 0–1, or null if unset
  function userProb() {
    if (!S.fc || !S.fc.locked) return null;
    return Math.max(0, Math.min(100, Number(S.fc.value) || 0)) / 100;
  }

  function renderForecast() {
    const host = document.getElementById("d-predict");
    if (!host) return;
    if (!S.predictEnabled || !S.fc) { host.innerHTML = ""; host.className = "detail-predict"; return; }
    const fc = S.fc;

    // collapsed: a tiny ignorable one-liner
    if (!fc.open) {
      host.className = "detail-predict";
      host.innerHTML = `<button type="button" class="detail-predict-toggle" id="d-fc-open">🔮 Predict first <span class="muted">(optional)</span></button>`;
      const t = document.getElementById("d-fc-open");
      if (t) t.addEventListener("click", () => { fc.open = true; renderForecast(); });
      return;
    }

    // expanded
    host.className = "detail-predict open";
    // implied chance of the SELECTED side (robust; "No" = 1 - yes chance)
    const yesChance = yesSpot(S.market);
    const market = (S.side === "no" && yesChance != null)
      ? (1 - yesChance) : yesChance;
    const marketPct = (market == null) ? null : Math.round(market * 100);
    const youPct = Math.round(fc.value);
    const showCompare = fc.locked || fc.revealed;

    let compare = "";
    if (showCompare) {
      const edge = (marketPct == null) ? null : youPct - marketPct;
      const edgeCls = edge == null ? "muted" : (edge >= 0 ? "pos" : "neg");
      const edgeTxt = edge == null ? "—" : (edge >= 0 ? "+" : "−") + Math.abs(edge) + "%";
      compare = `<div class="detail-predict-compare">
          <span class="muted">Market</span> <span class="tnum">${marketPct == null ? "—" : marketPct + "%"}</span>
          <span class="detail-predict-sep">·</span>
          <span class="muted">You</span> <span class="tnum">${youPct}%</span>
          <span class="detail-predict-sep">·</span>
          <span class="muted">edge</span> <span class="tnum ${edgeCls}">${edgeTxt}</span>
        </div>`;
    }

    host.innerHTML = `
      <div class="detail-predict-head">
        <span class="detail-predict-q">Your chance ${fmt.esc(selectedName())} wins?</span>
        <button type="button" class="detail-predict-reveal ${fc.revealed ? "on" : ""}" id="d-fc-reveal" title="Peek at the market price">👁</button>
      </div>
      <div class="detail-predict-ctl">
        <input type="range" id="d-fc-range" min="0" max="100" step="1" value="${youPct}" class="detail-predict-range" ${fc.locked ? "disabled" : ""}>
        <div class="detail-predict-num">
          <input type="number" id="d-fc-num" min="0" max="100" step="1" value="${youPct}" class="tnum" ${fc.locked ? "disabled" : ""}>
          <span class="muted">%</span>
        </div>
        ${fc.locked
          ? `<button type="button" class="btn btn-ghost detail-predict-edit" id="d-fc-edit">Edit</button>`
          : `<button type="button" class="btn detail-predict-lock" id="d-fc-lock">Lock</button>`}
      </div>
      ${compare}`;

    const range = document.getElementById("d-fc-range");
    const num = document.getElementById("d-fc-num");
    const sync = (v) => {
      const n = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
      fc.value = n;
      if (range && range.value != n) range.value = n;
      if (num && num.value != n) num.value = n;
      // live-update the comparison if it's already visible (revealed)
      if (fc.revealed && !fc.locked) renderForecast();
    };
    if (range && !fc.locked) range.addEventListener("input", (e) => sync(e.target.value));
    if (num && !fc.locked) num.addEventListener("input", (e) => sync(e.target.value));

    const lock = document.getElementById("d-fc-lock");
    if (lock) lock.addEventListener("click", () => { fc.locked = true; renderForecast(); });
    const edit = document.getElementById("d-fc-edit");
    if (edit) edit.addEventListener("click", () => { fc.locked = false; renderForecast(); });
    const reveal = document.getElementById("d-fc-reveal");
    if (reveal) reveal.addEventListener("click", () => { fc.revealed = !fc.revealed; renderForecast(); });
  }

  async function runQuote() {
    const host = document.getElementById("d-quote");
    if (!host) return;
    const w = Math.max(0, Number(S.wager) || 0);
    if (!w) {
      S.lastQuote = null; renderToWin();
      host.innerHTML = `<div class="muted detail-quote-loading">Enter a wager.</div>`;
      return;
    }
    const n = wagerToContracts();
    if (!n) {
      S.lastQuote = null; renderToWin();
      host.innerHTML = `<div class="muted detail-quote-loading">No price yet for this outcome.</div>`;
      return;
    }
    const seq = ++S.quoteSeq;
    try {
      const q = await NRB.api(
        `/api/quote?ticker=${encodeURIComponent(S.ticker)}&side=${S.side}&contracts=${n}`
      );
      if (S.destroyed || seq !== S.quoteSeq) return; // stale
      S.lastQuote = (q && q.ok !== false) ? q : null;
      renderToWin();
      renderQuote(q);
    } catch (e) {
      if (S.destroyed || seq !== S.quoteSeq) return;
      S.lastQuote = null; renderToWin();
      host.innerHTML = `<div class="neg detail-quote-loading">Couldn't fetch a quote.</div>`;
    }
  }

  function renderQuote(q) {
    const host = document.getElementById("d-quote");
    if (!host) return;
    if (!q || q.ok === false) {
      const reason = (q && (q.reason || q.error)) || "No fillable depth right now.";
      host.innerHTML = `<div class="neg detail-quote-loading">${fmt.esc(reason)}</div>`;
      return;
    }
    const row = (lbl, val, cls) =>
      `<div class="detail-quote-row"><span class="muted">${lbl}</span>
        <span class="tnum ${cls || ""}">${val}</span></div>`;

    let flags = "";
    if (q.partial) {
      flags += `<div class="detail-quote-flag">⚠ Partial fill — only part of your wager could be filled.</div>`;
    } else if (q.estimated_fill && q.estimated_fill !== q.requested) {
      flags += `<div class="detail-quote-flag">⚠ Estimated partial fill at this wager.</div>`;
    }

    host.innerHTML =
      row("Multiplier", odds.multStr(q.avg_price), "pos detail-quote-strong") +
      `<div class="detail-quote-divider"></div>` +
      row("Cost", fmt.usd(q.cost_basis), "detail-quote-strong") +
      row("Payout if win", fmt.usd(q.max_payout)) +
      row("Profit", fmt.signed(q.max_profit), "pos detail-quote-strong") +
      flags;
  }

  async function placeBet() {
    const btn = document.getElementById("d-place");
    const n = wagerToContracts();
    if (!n) { NRB.toast("Enter a wager amount."); resetConfirm(); return; }
    // capture wager/outcome/payout BEFORE the placing state mutates anything
    const wager = Math.max(0, Number(S.wager) || 0);
    const label = selectedName();
    const est = payoutEstimate();
    S.confirming = false;
    if (btn) { btn.disabled = true; btn.classList.remove("detail-confirm"); btn.textContent = "Placing…"; }
    // optional: include the user's locked forecast (0–1 for the backed side)
    const body = { ticker: S.ticker, side: S.side, contracts: n };
    const up = userProb();
    if (up != null) body.user_prob = up;
    try {
      const res = await NRB.api("/api/bets", {
        method: "POST",
        body,
      });
      if (res && res.error) {
        NRB.toast(res.error);
      } else if (res && res.ok) {
        const payout = (res.bet && res.bet.max_payout != null) ? res.bet.max_payout
          : (res.quote && res.quote.max_payout != null) ? res.quote.max_payout
          : (est ? est.payout : null);
        const winTxt = payout != null ? ` to win ${fmt.usd(payout)}` : "";
        NRB.toast(`Bet placed: ${fmt.usd(wager)} on ${label}${winTxt}`);
        await NRB.refreshAccount();
        await refreshMarket();   // refresh prices / spot after the fill
        await loadBets();        // refresh "Your position" + chart markers
        runQuote();
      } else {
        NRB.toast("Bet failed.");
      }
    } catch (e) {
      NRB.toast("Network error placing bet.");
    } finally {
      if (btn && !S.destroyed) { btn.disabled = false; btn.classList.remove("detail-confirm"); btn.textContent = "Place paper bet"; }
    }
  }

  // ---- your positions on this market --------------------------------------
  async function loadBets() {
    const seq = ++S.betsSeq;
    let res;
    try {
      res = await NRB.api("/api/bets");
    } catch (e) { return; } // keep prior bets on error
    if (S.destroyed || seq !== S.betsSeq) return;
    const all = (res && res.bets) || [];
    const tickers = relevantTickers();
    S.bets = all.filter((b) => tickers.has(b.ticker));
    renderPosition();
    // chart markers depend on bets -> rebuild the chart's marker dataset
    refreshMarkers();
  }

  function renderPosition() {
    const host = document.getElementById("d-position");
    if (!host) return;
    const bets = S.bets || [];
    if (!bets.length) { host.innerHTML = ""; return; }   // unobtrusive: nothing

    const open = bets.filter((b) => b.status === "open");
    const done = bets.filter((b) => b.status !== "open");

    const stat = (label, valueHtml, help, cls) =>
      `<div class="dpos-stat">
         <label>${label}${help ? NRB.help(help) : ""}</label>
         <span class="dpos-val tnum ${cls || ""}">${valueHtml}</span>
       </div>`;

    const openCard = (b) => {
      const oc = betOutcome(b);
      const upnl = b.unrealized_pnl;
      const cls = upnl == null ? "" : (upnl >= 0 ? "pos" : "neg");
      const entry = `${odds.multStr(b.avg_price)} <span class="muted">${odds.prob(b.avg_price)}</span>`;
      return `<div class="dpos">
          <div class="dpos-head">
            <span class="dpos-oc">${NRB.icon(oc.name, oc.logo)}<span class="dpos-nm">${fmt.esc(oc.name)}</span></span>
            <span class="dpos-tag open">Open</span>
          </div>
          <div class="dpos-stats">
            ${stat("Bet", fmt.usd(b.cost_basis), "stake")}
            ${stat("Entry odds", entry, "entry")}
            ${stat("Now worth", fmt.usd(b.current_value), "value")}
            ${stat("Profit / loss", fmt.signed(upnl), "unrealized_pnl", cls)}
          </div>
          <button class="btn dpos-sell" data-id="${fmt.esc(b.id)}">Sell position</button>
        </div>`;
    };

    const doneCard = (b) => {
      const oc = betOutcome(b);
      let verdict, vcls;
      if (b.status === "closed") { verdict = "Sold"; vcls = "sold"; }
      else { const won = b.result === b.side; verdict = won ? "Won" : "Lost"; vcls = won ? "won" : "lost"; }
      const pnl = b.realized_pnl;
      const cls = pnl == null ? "" : (pnl >= 0 ? "pos" : "neg");
      return `<div class="dpos done">
          <div class="dpos-head">
            <span class="dpos-oc">${NRB.icon(oc.name, oc.logo)}<span class="dpos-nm">${fmt.esc(oc.name)}</span></span>
            <span class="dpos-tag ${vcls}">${verdict}</span>
          </div>
          <div class="dpos-stats">
            ${stat("Bet", fmt.usd(b.cost_basis), "stake")}
            ${stat("Payout", fmt.usd(b.payout), "payout")}
            ${stat("Profit / loss", fmt.signed(pnl), "realized_pnl", cls)}
          </div>
        </div>`;
    };

    host.innerHTML = `
      <div class="card detail-pos-card">
        <div class="detail-card-title">Your bets on this market</div>
        ${open.map(openCard).join("")}
        ${done.length ? `<div class="dpos-sep">Settled &amp; sold</div>${done.map(doneCard).join("")}` : ""}
      </div>`;

    host.querySelectorAll(".dpos-sell").forEach((b) => {
      b.addEventListener("click", () => sellBet(b.dataset.id, b));
    });
  }

  async function sellBet(id, btn) {
    if (!id) return;
    if (btn) { btn.disabled = true; btn.textContent = "Selling…"; }
    try {
      const res = await NRB.api(`/api/bets/${encodeURIComponent(id)}/close`, { method: "POST" });
      if (res && res.error) {
        NRB.toast(res.error);
      } else {
        const proceeds = (res && (res.proceeds != null ? res.proceeds
          : (res.bet && res.bet.current_value))) ;
        const realized = (res && (res.realized_pnl != null ? res.realized_pnl
          : (res.bet && res.bet.realized_pnl)));
        let msg = "Position sold";
        if (proceeds != null) msg += ` · ${fmt.usd(proceeds)}`;
        if (realized != null) msg += ` (${fmt.signed(realized)})`;
        NRB.toast(msg);
        await NRB.refreshAccount();
        await loadBets();
        runQuote();
      }
    } catch (e) {
      NRB.toast("Couldn't sell position.");
    } finally {
      if (btn && !S.destroyed) { btn.disabled = false; btn.textContent = "Sell"; }
    }
  }

  // ---- margin of victory (spread) + total (over/under) lines ---------------
  // Game events expose sibling spread/total ladders (each rung a real Yes/No
  // market). We show each as a plain statement + a center-locked number slider
  // + Yes/No odds bars; tapping a bar opens the dedicated bet page.

  // is the open market a sports GAME event? (only those have spread/total)
  function isGameEvent() {
    const et = eventTicker() || "";
    return /GAME$/.test(et.split("-")[0]);
  }

  function midRung(rungs) { return Math.floor(((rungs ? rungs.length : 1) - 1) / 2); }

  async function loadLines() {
    if (!isGameEvent()) { S.lines = null; renderLines(); return; }
    const et = eventTicker();
    if (!et) return;
    const seq = ++S.linesSeq;
    let res;
    try { res = await NRB.api(`/api/lines?event=${encodeURIComponent(et)}`); }
    catch (e) { return; }                 // keep prior lines on error
    if (S.destroyed || seq !== S.linesSeq) return;
    const spread = (res && res.spread) || null;
    const total = (res && res.total) || null;
    if (!spread && !total) { S.lines = null; renderLines(); return; }
    const hadCard = !!document.querySelector("#d-lines .mov-card");
    S.lines = { spread, total };
    if (!S.lineState) S.lineState = {};
    if (spread && !S.lineState.spread)
      S.lineState.spread = { team: 0, rung: midRung(spread.sides[0].rungs) };
    if (total && !S.lineState.total)
      S.lineState.total = { rung: midRung(total.rungs) };
    // first build vs. a live price refresh (preserve the user's slider position)
    if (hadCard) refreshLinesPrices(); else renderLines();
  }

  // rungs for the selected team (spread) or the ladder (total)
  function rungsFor(kind) {
    if (kind === "spread") {
      const sp = S.lines.spread, st = S.lineState.spread;
      st.team = Math.min(st.team, sp.sides.length - 1);
      return sp.sides[st.team].rungs;
    }
    return S.lines.total.rungs;
  }

  // the selected rung's market for a block (clamps the rung in range)
  function rungMarket(kind) {
    const st = S.lineState[kind];
    const rungs = rungsFor(kind);
    st.rung = Math.max(0, Math.min(st.rung, rungs.length - 1));
    return rungs[st.rung];
  }

  // human label for a side (used as the bet's outcome name)
  function sideName(kind, side) {
    const m = rungMarket(kind);
    if (kind === "spread") {
      const team = S.lines.spread.sides[S.lineState.spread.team].team;
      return side === "yes" ? `${team} to win by ${m.line}+`
                            : `${team} not to win by ${m.line}+`;
    }
    const unit = S.lines.total.unit ? " " + S.lines.total.unit : "";
    return side === "yes" ? `Over ${m.line}${unit}` : `Under ${m.line}${unit}`;
  }

  // statement: "<Team> wins by more than <line>"  /  "Combined <unit> more than <line>"
  function statementHtml(kind) {
    const m = rungMarket(kind);
    if (kind === "spread") {
      const sp = S.lines.spread, st = S.lineState.spread;
      const team = sp.sides[st.team].team;
      const swap = sp.sides.length > 1
        ? `<svg class="mov-swap" viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>` : "";
      return `<div class="mov-statement">
          <button class="mov-team" data-k="spread">${fmt.esc(team)}${swap}</button>
          <span class="mov-said">wins by more than</span>
          <b class="mov-line" id="mov-line-spread">${m.line}</b>
        </div>`;
    }
    const unit = S.lines.total.unit || "points";
    return `<div class="mov-statement">
        <span class="mov-said">Combined ${fmt.esc(unit)} more than</span>
        <b class="mov-line" id="mov-line-total">${m.line}</b>
      </div>`;
  }

  // center-locked number picker: numbers scroll under a fixed center highlight
  function sliderHtml(kind) {
    const rungs = rungsFor(kind), idx = S.lineState[kind].rung;
    const nums = rungs.map((r, i) =>
      `<span class="mov-num${i === idx ? " on" : ""}" data-i="${i}">${r.line}</span>`).join("");
    return `<div class="mov-slider-wrap">
        <div class="mov-center"></div>
        <div class="mov-slider" data-k="${kind}"><div class="mov-pad"></div>${nums}<div class="mov-pad"></div></div>
      </div>`;
  }

  // a Yes/No odds bar whose fill width tracks the implied chance
  function barHtml(kind, side) {
    const m = rungMarket(kind);
    const yesC = NRB.odds.chance(m);
    const chance = side === "yes" ? yesC : (yesC == null ? null : 1 - yesC);
    const price = side === "yes" ? m.yes_ask : m.no_ask;
    const pct = chance == null ? 0 : Math.round(chance * 100);
    const mult = (price != null && price > 0) ? odds.multStr(price) : "—";
    return `<button class="mov-bar ${side}" data-k="${kind}" data-side="${side}">
        <span class="mov-bar-fill" style="width:${Math.max(7, pct)}%"></span>
        <span class="mov-bar-lbl">${side === "yes" ? "Yes" : "No"}</span>
        <span class="mov-bar-pct muted tnum">${chance == null ? "" : pct + "%"}</span>
        <span class="mov-bar-odds tnum">${mult}</span>
      </button>`;
  }

  function blockHtml(kind, title, sub) {
    return `<div class="mov-block" data-block="${kind}">
        <div class="mov-h">${title}<span class="muted"> — ${sub}</span></div>
        ${statementHtml(kind)}
        ${sliderHtml(kind)}
        <div class="mov-bars" data-k="${kind}">${barHtml(kind, "yes")}${barHtml(kind, "no")}</div>
      </div>`;
  }

  function renderLines() {
    const host = document.getElementById("d-lines");
    if (!host) return;
    if (!S.lines) { host.innerHTML = ""; return; }
    let html = `<div class="card mov-card"><div class="detail-card-title">More ways to bet</div>`;
    if (S.lines.spread) html += blockHtml("spread", "Margin of victory", "who wins by how much");
    if (S.lines.total) html += blockHtml("total", "Total", "combined score over / under");
    html += `</div>`;
    host.innerHTML = html;
    wireLines();
    if (S.lines.spread) initSlider("spread");
    if (S.lines.total) initSlider("total");
  }

  // live price refresh that keeps the slider DOM + scroll position intact
  function refreshLinesPrices() {
    ["spread", "total"].forEach((kind) => {
      if (S.lines && S.lines[kind]) { updateStatement(kind); updateBars(kind); }
    });
  }

  function updateStatement(kind) {
    const el = document.getElementById("mov-line-" + kind);
    if (el) el.textContent = rungMarket(kind).line;
  }

  // refresh the Yes/No bars (widths + odds) for a block, in place
  function updateBars(kind) {
    const wrap = document.querySelector(`.mov-bars[data-k="${kind}"]`);
    if (!wrap) return;
    const m = rungMarket(kind);
    const yesC = NRB.odds.chance(m);
    ["yes", "no"].forEach((side) => {
      const bar = wrap.querySelector(`.mov-bar[data-side="${side}"]`);
      if (!bar) return;
      const chance = side === "yes" ? yesC : (yesC == null ? null : 1 - yesC);
      const price = side === "yes" ? m.yes_ask : m.no_ask;
      const pct = chance == null ? 0 : Math.round(chance * 100);
      const fill = bar.querySelector(".mov-bar-fill");
      if (fill) fill.style.width = Math.max(7, pct) + "%";
      const pe = bar.querySelector(".mov-bar-pct");
      if (pe) pe.textContent = chance == null ? "" : pct + "%";
      const oe = bar.querySelector(".mov-bar-odds");
      if (oe) oe.textContent = (price != null && price > 0) ? odds.multStr(price) : "—";
    });
  }

  function highlightCenter(slider, idx) {
    slider.querySelectorAll(".mov-num").forEach((n) =>
      n.classList.toggle("on", (parseInt(n.dataset.i, 10) || 0) === idx));
  }

  // size the end-pads so any number can sit dead-center, then jump to the rung
  function initSlider(kind) {
    requestAnimationFrame(() => {
      const slider = document.querySelector(`.mov-slider[data-k="${kind}"]`);
      if (!slider) return;
      const nums = slider.querySelectorAll(".mov-num");
      if (!nums.length) return;
      const itemW = nums[0].offsetWidth || 72;
      const pad = Math.max(0, (slider.clientWidth - itemW) / 2);
      slider.querySelectorAll(".mov-pad").forEach((p) => { p.style.flex = "0 0 " + pad + "px"; });
      const idx = S.lineState[kind].rung;
      slider.scrollLeft = idx * itemW;
      highlightCenter(slider, idx);
    });
  }

  function wireLines() {
    const host = document.getElementById("d-lines");
    if (!host) return;

    // team toggle (spread): cycle to the next team and rebuild that block
    host.querySelectorAll(".mov-team").forEach((b) => {
      b.addEventListener("click", () => {
        const sp = S.lines.spread, st = S.lineState.spread;
        st.team = (st.team + 1) % sp.sides.length;
        st.rung = Math.min(st.rung, sp.sides[st.team].rungs.length - 1);
        renderLines();
      });
    });

    // center-locked number slider: the centered number IS the selection
    host.querySelectorAll(".mov-slider").forEach((slider) => {
      const kind = slider.dataset.k;
      let raf = null;
      slider.addEventListener("scroll", () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          const nums = slider.querySelectorAll(".mov-num");
          if (!nums.length) return;
          const itemW = nums[0].offsetWidth || 72;
          let idx = Math.round(slider.scrollLeft / itemW);
          idx = Math.max(0, Math.min(nums.length - 1, idx));
          if (idx !== S.lineState[kind].rung) {
            S.lineState[kind].rung = idx;
            highlightCenter(slider, idx);
            updateStatement(kind);
            updateBars(kind);
          }
        });
      });
      slider.querySelectorAll(".mov-num").forEach((n) => {
        n.addEventListener("click", () => {
          const itemW = n.offsetWidth || 72;
          slider.scrollTo({ left: (parseInt(n.dataset.i, 10) || 0) * itemW, behavior: "smooth" });
        });
      });
    });

    // tap a Yes/No bar -> open the dedicated bet page for that side
    host.querySelectorAll(".mov-bar").forEach((bar) => {
      bar.addEventListener("click", () => goToBet(bar.dataset.k, bar.dataset.side));
    });
  }

  function goToBet(kind, side) {
    const m = rungMarket(kind);
    const price = side === "yes" ? m.yes_ask : m.no_ask;
    if (price == null || price <= 0) { NRB.toast("No price for this line right now."); return; }
    NRB.go("bet", {
      ticker: m.ticker, side, price,
      name: sideName(kind, side),
      title: (S.meta && S.meta.event_title) || (S.market && S.market.title) || S.ticker,
      eventTicker: eventTicker(),
      returnTicker: S.ticker,
    });
  }

  // ---- data fetching -------------------------------------------------------
  function logViewOnce() {
    if (S.viewLogged) return;
    const et = eventTicker();
    if (!et) return;
    S.viewLogged = true;
    NRB.history.addView(et, (S.meta && S.meta.category) || "");
  }

  async function refreshMarket() {
    let res;
    try {
      res = await NRB.api(`/api/market/${encodeURIComponent(S.ticker)}`);
    } catch (e) { return; }
    if (S.destroyed || !res) return;
    if (res.market) S.market = res.market;
    if (res.meta) S.meta = res.meta;
    if (res.event_title) S.event_title = res.event_title;
    ingestSiblings(res);     // keeps S.multi + outcome prices fresh
    renderHead();
    renderSideToggle();
  }

  // ---- live game score / clock (ESPN via /api/game) ------------------------
  async function loadGame() {
    const et = eventTicker();
    if (!et) return;
    const seq = ++S.gameSeq;
    let res;
    try {
      res = await NRB.api(`/api/game?event_ticker=${encodeURIComponent(et)}`);
    } catch (e) { return; } // leave prior state untouched on error
    if (S.destroyed || seq !== S.gameSeq) return;
    const matched = res && res.matched;
    const hadStart = !!S.startTs;
    S.game = matched ? res : null;
    S.startTs = (matched && res.start_ts) ? res.start_ts : null;
    renderMatchup();
    // (re)show or hide the "Game" pill if availability changed
    if (!!S.startTs !== hadStart) {
      if (!S.startTs && S.range === "Game") { S.range = DEFAULT_RANGE; loadHistory(); }
      renderPills();
    }
  }

  // Compact live score/clock label, captured when a user posts a comment so the
  // discussion can show what the game looked like at that moment. Null unless a
  // matched game is actually in progress with a known score.
  function gameTag() {
    const g = S && S.game;
    if (!g || !g.matched || g.state !== "in") return null;
    const a = g.away || {}, h = g.home || {};
    if (a.score == null || h.score == null) return null;
    const an = a.abbr || a.name || "", hn = h.abbr || h.name || "";
    const score = `${an} ${a.score}–${h.score} ${hn}`.trim();
    const clock = (g.detail || "").trim();
    return clock ? `${score} · ${clock}` : score;
  }

  // A scheduled kickoff split into a date line + a time line, both in the
  // viewer's own timezone, e.g. {date:"Sat, Jul 4", time:"7:00 PM MDT"}.
  function fmtKickoffParts(ts) {
    try {
      const d = new Date(ts * 1000);
      return {
        date: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
      };
    } catch (e) { return { date: "", time: "" }; }
  }

  // build the /api/history URL for a given ticker honoring the active range/Game window
  function historyUrl(ticker) {
    return (S.range === "Game" && S.startTs)
      ? `/api/history?ticker=${encodeURIComponent(ticker)}&start=${encodeURIComponent(S.startTs)}`
      : `/api/history?ticker=${encodeURIComponent(ticker)}&range=${S.range}`;
  }

  async function loadHistory() {
    const seq = ++S.histSeq;

    if (S.multi) {
      // chart only the TOP 3 outcomes by current chance, one history each, plus
      // the selected outcome (so your pick stays visible even if it's a long-shot)
      const top = outcomesByChance().slice(0, 3);
      const sel = selectedOutcome();
      if (sel && !top.some((o) => o.ticker === sel.ticker)) top.push(sel);
      const colorFor = (i) => LINE_COLORS[i % LINE_COLORS.length];
      let results;
      try {
        results = await Promise.all(top.map((o) =>
          NRB.api(historyUrl(o.ticker)).catch(() => null)));
      } catch (e) { results = []; }
      if (S.destroyed || seq !== S.histSeq) return;
      S.series = top.map((o, i) => ({
        name: o.name, ticker: o.ticker, color: colorFor(i),
        points: smoothSeries((results[i] && results[i].points) || []),
      }));
      buildChart();
      return;
    }

    let res;
    try {
      res = await NRB.api(historyUrl(S.ticker));
    } catch (e) { res = null; }
    if (S.destroyed || seq !== S.histSeq) return;
    S.points = smoothSeries((res && res.points) || []);
    buildChart();
  }

  // ---- live polling --------------------------------------------------------
  function startPolling() {
    stopPolling();
    // fast poll: price / score / outcome boxes / order book
    S.pollId = setInterval(async () => {
      if (S.destroyed) return;
      await refreshMarket();
      if (S.destroyed) return;
      runQuote();
      loadGame();            // keep score line / clock live
      loadBets();            // keep "Your position" P&L + markers live
    }, POLL_MS);
    // slower poll: stream new 1-min candles for whatever range is selected,
    // and refresh spread/total line prices if this game has them
    S.histPollId = setInterval(() => {
      if (S.destroyed) return;
      loadHistory();         // redraws the two-line chart for the active range
      if (S.lines) loadLines();   // keep slider prices fresh (cheap: 20s server cache)
    }, HIST_REFRESH_MS);
  }
  function stopPolling() {
    if (S.pollId) { clearInterval(S.pollId); S.pollId = null; }
    if (S.histPollId) { clearInterval(S.histPollId); S.histPollId = null; }
  }

  // ---- wiring --------------------------------------------------------------
  function wire() {
    document.getElementById("d-back").addEventListener("click", () => NRB.go("browse"));

    const favBtn = document.getElementById("d-fav");
    if (favBtn) {
      favBtn.addEventListener("click", () => {
        NRB.fav.toggle(eventTicker());
        renderFav();
      });
    }

    // outcome box click handlers are wired inside renderSideToggle()

    const input = document.getElementById("d-wager");
    input.addEventListener("input", () => {
      const v = parseInt(input.value, 10);
      S.wager = isNaN(v) ? 0 : Math.max(0, v);
      requestQuote();
    });

    document.querySelectorAll(".detail-step").forEach((b) => {
      b.addEventListener("click", () => {
        const d = parseInt(b.dataset.step, 10);
        S.wager = Math.max(1, (Math.floor(S.wager) || 0) + d);
        input.value = S.wager;
        requestQuote();
      });
    });

    document.getElementById("d-place").addEventListener("click", onPlaceClick);
    const addSlipBtn = document.getElementById("d-add-slip");
    if (addSlipBtn) addSlipBtn.addEventListener("click", addToSlip);
    const alertBtn = document.getElementById("d-alert");
    if (alertBtn) alertBtn.addEventListener("click", setAlert);

    // touch/drag to scrub the chart (drives the dotted line + value labels).
    // Attached once here; the handlers read the live S.chart on each rebuild.
    const cv = document.getElementById("d-chart");
    if (cv) {
      cv.addEventListener("touchstart", (e) => { if (e.touches[0]) scrubAt(e.touches[0].clientX); }, { passive: true });
      cv.addEventListener("touchmove", (e) => { if (e.touches[0]) scrubAt(e.touches[0].clientX); }, { passive: true });
      cv.addEventListener("touchend", scrubEnd);
      cv.addEventListener("touchcancel", scrubEnd);
      cv.addEventListener("mousemove", (e) => scrubAt(e.clientX));
      cv.addEventListener("mouseleave", scrubEnd);
    }

    // live-chat slide-up sheet
    const chatBtn = document.getElementById("d-chat");
    if (chatBtn) chatBtn.addEventListener("click", openChat);
    const chatClose = document.getElementById("d-chat-close");
    if (chatClose) chatClose.addEventListener("click", closeChat);
    const chatBack = document.getElementById("d-chat-backdrop");
    if (chatBack) chatBack.addEventListener("click", closeChat);
  }

  // ---- live-chat sheet -----------------------------------------------------
  // Mount the discussion thread lazily the first time the sheet is opened.
  function mountChatThread() {
    if (S.chatMounted) return;
    const body = document.getElementById("d-chat-body");
    if (!body || !(NRB.social && NRB.social.mountThread)) return;
    try {
      const title = (S.event_title) || (S.market && S.market.title) || S.ticker;
      NRB.social.mountThread(body, "mkt:" + eventTicker(),
        { ticker: S.ticker, title: title, gameState: gameTag });
      S.chatMounted = true;
    } catch (e) {}
  }
  function openChat() {
    const sheet = document.getElementById("d-chat-sheet");
    if (!sheet) return;
    mountChatThread();
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
  }
  function closeChat() {
    const sheet = document.getElementById("d-chat-sheet");
    if (!sheet) return;
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
  }

  // create a one-shot price alert for the selected outcome at a target chance
  async function setAlert() {
    const name = selectedName() || (S.market && S.market.title) || S.ticker;
    const raw = prompt('Notify me when "' + name + '" reaches what chance? (1–99%)');
    if (raw == null) return;
    const pct = parseFloat(String(raw).replace("%", "").trim());
    if (isNaN(pct) || pct <= 0 || pct >= 100) {
      NRB.toast("Enter a percentage between 1 and 99."); return;
    }
    try {
      const r = await NRB.api("/api/alerts", { method: "POST", body: {
        ticker: S.ticker, side: S.side, outcome_name: name,
        title: (S.market && S.market.title) || S.event_title || S.ticker,
        event_ticker: eventTicker(), target: pct / 100,
      } });
      if (r && r.ok) {
        const dir = r.op === "below" ? "falls to" : "rises to";
        NRB.toast("Alert set — we'll notify you when " + name + " " + dir + " " + Math.round(pct) + "%.");
        if (NRB.refreshBadge) NRB.refreshBadge();
      } else NRB.toast((r && r.error) || "Couldn't set the alert.");
    } catch (e) { NRB.toast("Couldn't set the alert."); }
  }

  // ============================================================ view module
  NRB.views.detail = {
    async mount(container, params) {
      S = blankState();
      S.ticker = params && params.ticker;
      S.side = (params && params.side === "no") ? "no" : "yes";
      // read the global opt-in toggle once per mount
      S.predictEnabled = !!(NRB.predict && NRB.predict.enabled && NRB.predict.enabled());

      if (!S.ticker) {
        container.innerHTML = `<div class="card" style="padding:24px">No market selected. <a id="d-back2" style="color:var(--accent);cursor:pointer">Back to markets</a></div>`;
        const b = document.getElementById("d-back2");
        if (b) b.addEventListener("click", () => NRB.go("browse"));
        return;
      }

      container.innerHTML = skeleton();

      // initial market fetch, then render full shell
      let res = null;
      try {
        res = await NRB.api(`/api/market/${encodeURIComponent(S.ticker)}`);
      } catch (e) { /* render shell anyway */ }
      if (S.destroyed) return;
      if (res) {
        if (res.market) S.market = res.market;
        if (res.meta) S.meta = res.meta;
        if (res.event_title) S.event_title = res.event_title;
        ingestSiblings(res);
      }

      // MULTI-OUTCOME: pick the selected outcome (params.ticker, else top by chance).
      // The selected ticker becomes S.ticker (siblings are real market tickers).
      if (S.multi) {
        S.side = "yes";
        const match = S.outcomes.find((o) => o.ticker === S.ticker);
        if (!match) {
          const top = outcomesByChance()[0];
          if (top) S.ticker = top.ticker;
        }
        // if we changed which market we're on, fetch that market for the header/spot
        if (S.market && S.market.ticker !== S.ticker) {
          try {
            const r2 = await NRB.api(`/api/market/${encodeURIComponent(S.ticker)}`);
            if (S.destroyed) return;
            if (r2) {
              if (r2.market) S.market = r2.market;
              if (r2.meta) S.meta = r2.meta;
              if (r2.event_title) S.event_title = r2.event_title;
              ingestSiblings(r2);
            }
          } catch (e) { /* keep what we have */ }
        }
      }

      // feed the "For You" feed
      logViewOnce();

      container.innerHTML = shell();
      // set wager input default
      const input = document.getElementById("d-wager");
      if (input) input.value = S.wager;

      wire();
      renderSideToggle();
      renderHead();
      renderToWin();   // instant payout readout before the first quote returns
      resetForecast(); // collapsed forecast affordance (only if predict enabled)

      // fetch live game score/clock first (for the matchup block)
      await loadGame();
      if (S.destroyed) return;
      renderPills();

      await loadHistory();   // also (re)draws chart
      if (S.destroyed) return;
      await loadBets();      // "Your position" card + chart entry markers
      if (S.destroyed) return;
      runQuote();
      startPolling();
      loadLines();           // spread / total slider bets (game events only)
      // discussion is mounted lazily into the slide-up chat sheet on first open
    },

    unmount() {
      if (!S) return;
      S.destroyed = true;
      stopPolling();
      if (S.quoteTimer) { clearTimeout(S.quoteTimer); S.quoteTimer = null; }
      if (S.chart) { try { S.chart.destroy(); } catch (e) {} S.chart = null; }
      S = null;
    },
  };
})();
