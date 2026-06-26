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

  const RANGES = ["1H", "6H", "1D", "1W", "1M", "ALL"];
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
      multi: false,    // mutually-exclusive multi-outcome event?
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
      S.outcomes = sibs.map((s) => ({
        name: s.yes_sub_title || s.title || s.ticker,
        ticker: s.ticker,
        price: (s.yes_ask != null) ? s.yes_ask : s.last_price,
        logo: s.logo || null,
      }));
    } else {
      S.multi = false;
      S.outcomes = [];
    }
    return S.multi;
  }

  // outcome objects sorted by current chance desc
  function outcomesByChance() {
    return S.outcomes.slice().sort((a, b) => (b.price || 0) - (a.price || 0));
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
  function yesSpot(m) {
    if (!m) return null;
    if (m.yes_ask != null && m.yes_bid != null) return (m.yes_ask + m.yes_bid) / 2;
    if (m.yes_ask != null) return m.yes_ask;
    if (m.last_price != null) return m.last_price;
    return null;
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

  // ============================================================ rendering
  function skeleton() {
    return `
      <div class="detail-wrap">
        <a class="detail-back" id="d-back">← Back to markets</a>
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
        <a class="detail-back" id="d-back">← Back to markets</a>

        <div class="detail-grid">
          <div class="detail-main">
            <!-- header -->
            <div class="detail-head">
              <div class="detail-head-text">
                <div class="detail-event muted" id="d-event"></div>
                <div class="detail-title-row">
                  <span class="detail-icon" id="d-icon"></span>
                  <h1 class="detail-title" id="d-title"></h1>
                  <button class="detail-fav" id="d-fav" aria-label="Favorite" title="Add to watchlist">☆</button>
                </div>
                <div class="detail-sub muted" id="d-subtitle"></div>
                <div class="detail-score hidden" id="d-score"></div>
              </div>
              <div class="detail-prob">
                <div class="detail-prob-num tnum" id="d-prob">—</div>
                <div class="detail-prob-chg tnum" id="d-change"></div>
                <div class="detail-prob-lbl muted">YES chance</div>
              </div>
            </div>

            <!-- hero chart -->
            <div class="card detail-chart-card">
              <div class="detail-chart-bar">
                <div class="detail-legend" id="d-legend"></div>
                <div class="detail-pills" id="d-pills"></div>
              </div>
              <div class="detail-chart-box">
                <canvas id="d-chart"></canvas>
                <div class="detail-chart-tip" id="d-tip"></div>
                <div class="detail-chart-empty muted hidden" id="d-chart-empty">No price history available.</div>
              </div>
            </div>

            <!-- stats / rules -->
            <div class="card detail-stats" id="d-stats"></div>
          </div>

          <!-- trade panel -->
          <div class="detail-side">
            <div class="card detail-trade">
              <div class="detail-card-title">Pick an outcome</div>
              <div class="detail-outcomes" id="d-side-toggle"></div>

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
              <div class="detail-disclaimer muted">
                No real money. Fills walk the live order book incl. Kalshi's fee.
              </div>
            </div>

            <!-- your positions on this market (empty -> renders nothing) -->
            <div class="detail-position" id="d-position"></div>
          </div>
        </div>
      </div>`;
  }

  // ---- header --------------------------------------------------------------
  function renderHead() {
    const m = S.market, meta = S.meta;
    const $ = (id) => document.getElementById(id);
    if (!$("d-title")) return;
    $("d-event").textContent = meta.event_title || meta.category || "";
    $("d-title").textContent = m ? (m.title || S.ticker) : S.ticker;
    const iconEl = $("d-icon");
    if (iconEl) iconEl.innerHTML = NRB.icon(headerIconName(), headerIconLogo());
    let sub;
    if (S.multi) {
      const o = selectedOutcome();
      sub = o ? ("Backing: " + o.name) : (m && m.yes_sub_title);
    } else {
      sub = m && (S.side === "no" ? m.no_sub_title : m.yes_sub_title);
    }
    $("d-subtitle").textContent = sub || "";
    const lbl = document.querySelector(".detail-prob-lbl");
    if (lbl) lbl.textContent = S.multi ? "Selected chance" : "YES chance";
    renderFav();
    renderProb();
  }

  function renderFav() {
    const btn = document.getElementById("d-fav");
    if (!btn) return;
    const on = NRB.fav.has(eventTicker());
    btn.classList.toggle("on", on);
    btn.textContent = on ? "★" : "☆";
  }

  function renderProb() {
    const probEl = document.getElementById("d-prob");
    const chgEl = document.getElementById("d-change");
    if (!probEl) return;
    const spot = yesSpot(S.market);
    probEl.textContent = fmt.pct(spot);

    // first point of the active chart series (selected outcome in multi mode)
    let series = S.points;
    if (S.multi) {
      const o = selectedOutcome();
      const found = o && S.series.find((s) => s.ticker === o.ticker);
      series = (found && found.points) || [];
    }

    // change vs first point of current chart range
    if (series.length && spot != null) {
      const first = series[0].p;
      const delta = spot - first;
      const pts = Math.round(delta * 100);
      if (pts === 0) {
        chgEl.textContent = "0%";
        chgEl.className = "detail-prob-chg tnum muted";
      } else {
        const up = pts > 0;
        chgEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(pts) + "%";
        chgEl.className = "detail-prob-chg tnum " + (up ? "pos" : "neg");
      }
    } else {
      chgEl.textContent = "";
      chgEl.className = "detail-prob-chg tnum";
    }
  }

  // ---- pills ---------------------------------------------------------------
  function renderPills() {
    const host = document.getElementById("d-pills");
    if (!host) return;
    host.innerHTML = "";
    // for matched games with a known start, append a "Game" timeline pill
    const ranges = S.startTs ? RANGES.concat(["Game"]) : RANGES.slice();
    ranges.forEach((r) => {
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
    const tFmt = tickFormatter(S.range);

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
        data: aligned(s),
        borderColor: s.color,
        borderWidth: 2,
        backgroundColor: "transparent",
        fill: false,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: s.color,
        pointHoverBorderColor: "#0b0e13",
        pointHoverBorderWidth: 2,
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
          data: yesData,
          borderColor: "#27d18b",
          borderWidth: 2,
          backgroundColor: grad,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: "#27d18b",
          pointHoverBorderColor: "#0b0e13",
          pointHoverBorderWidth: 2,
        },
        {
          label: "No",
          data: noData,
          borderColor: "#fb5a6a",
          borderWidth: 2,
          backgroundColor: "transparent",
          fill: false,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: "#fb5a6a",
          pointHoverBorderColor: "#0b0e13",
          pointHoverBorderWidth: 2,
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

    S.chart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: "index", intersect: false, axis: "x" },
        layout: { padding: { top: 6, right: 12, bottom: 0, left: 6 } },
        scales: {
          x: {
            type: "linear",
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: "#8b95a6", maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 11 },
              callback: (v) => tFmt(v),
            },
          },
          y: {
            min: 0, max: 100,
            grid: { color: "#232b38", drawTicks: false },
            border: { display: false },
            ticks: {
              color: "#8b95a6", stepSize: 25, font: { size: 11 },
              callback: (v) => v + "%", padding: 8,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,            // use an HTML external tooltip (never clipped)
            mode: "index",
            intersect: false,
            axis: "x",                 // pair all datasets at one timestamp (aligned x)
            position: "nearest",
            external: externalTooltip,
          },
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
      const priceByTicker = {};
      S.outcomes.forEach((o) => { priceByTicker[o.ticker] = o.price; });
      host.innerHTML = S.series.map((s) => {
        const p = priceByTicker[s.ticker];
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

  // ---- stats / rules -------------------------------------------------------
  function renderStats() {
    const host = document.getElementById("d-stats");
    if (!host) return;
    const m = S.market || {};
    const status = m.status ? String(m.status) : "—";
    const cell = (label, val, cls) =>
      `<div class="detail-stat"><div class="detail-stat-lbl muted">${label}</div>
        <div class="detail-stat-val tnum ${cls || ""}">${val}</div></div>`;
    host.innerHTML =
      cell("Volume", fmt.vol(m.volume)) +
      cell("Open interest", fmt.vol(m.open_interest)) +
      cell("Closes", fmt.dateShort(m.close_time)) +
      cell("Status", `<span class="detail-status">${fmt.esc(status)}</span>`);
  }

  // ---- trade panel ---------------------------------------------------------
  // current ask price of whatever is selected (for wager -> contracts)
  function selectedPrice() {
    const m = S.market || {};
    if (S.multi) {
      const o = selectedOutcome();
      if (o && o.price != null) return o.price;
      return (m.yes_ask != null) ? m.yes_ask : m.last_price;
    }
    if (S.side === "no") {
      return (m.no_ask != null) ? m.no_ask : (m.last_price != null ? 1 - m.last_price : null);
    }
    return (m.yes_ask != null) ? m.yes_ask : m.last_price;
  }

  // build the list of {key, name, price, logo, selected} entries for the bet boxes
  function outcomeEntries() {
    if (S.multi) {
      return outcomesByChance().map((o) => ({
        key: o.ticker, name: o.name, price: o.price, logo: o.logo || null,
        selected: o.ticker === S.ticker,
      }));
    }
    const m = S.market || {};
    const yesPrice = (m.yes_ask != null) ? m.yes_ask : m.last_price;
    const noPrice = (m.no_ask != null) ? m.no_ask : (m.last_price != null ? 1 - m.last_price : null);
    return [
      { key: "yes", name: yesOutcomeName(), price: yesPrice, logo: null, selected: S.side === "yes" },
      { key: "no", name: "No", price: noPrice, logo: null, selected: S.side === "no" },
    ];
  }

  function renderSideToggle() {
    const host = document.getElementById("d-side-toggle");
    if (!host) return;
    const entries = outcomeEntries();
    // >6 outcomes -> compact scrollable rows; otherwise big boxes
    const compact = S.multi && entries.length > 6;
    host.className = "detail-outcomes" + (compact ? " compact" : "");

    host.innerHTML = entries.map((e) => `
      <button class="detail-outcome ${e.selected ? "active is-yes" : ""}" data-key="${fmt.esc(e.key)}">
        <span class="detail-outcome-head">
          <span class="detail-outcome-ico">${NRB.icon(e.name, e.logo)}</span>
          <span class="detail-outcome-nm">${fmt.esc(e.name)}</span>
        </span>
        <span class="detail-outcome-mult tnum">${odds.multStr(e.price)}</span>
        <span class="detail-outcome-prob tnum muted">${odds.prob(e.price)} chance</span>
      </button>`).join("");

    host.querySelectorAll(".detail-outcome").forEach((b) => {
      b.addEventListener("click", () => selectOutcome(b.dataset.key));
    });
  }

  // select an outcome (multi: a sibling ticker; binary: "yes"/"no")
  function selectOutcome(key) {
    if (S.multi) {
      if (!key || key === S.ticker) return;
      S.ticker = key;
      S.side = "yes";
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
    if (S.multi) { const o = selectedOutcome(); return o ? o.name : ""; }
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
    const market = selectedPrice();             // 0–1 implied
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
    ingestSiblings(res);     // keeps S.multi + outcome prices fresh
    renderHead();
    renderSideToggle();
    renderStats();
    renderLegend();
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
    renderScore();
    // (re)show or hide the "Game" pill if availability changed
    if (!!S.startTs !== hadStart) {
      if (!S.startTs && S.range === "Game") { S.range = DEFAULT_RANGE; loadHistory(); }
      renderPills();
    }
  }

  function renderScore() {
    const host = document.getElementById("d-score");
    if (!host) return;
    const g = S.game;
    if (!g || !g.matched) { host.classList.add("hidden"); host.innerHTML = ""; return; }

    const state = g.state;
    const away = g.away || {}, home = g.home || {};
    // team logo image if provided, else fall back to flag/monogram
    const teamIcon = (t) => t.logo
      ? `<img class="icoflag-img logo" src="${fmt.esc(t.logo)}" alt="">`
      : NRB.icon(t.name || t.abbr || "");

    if (state === "in" || state === "post") {
      const live = state === "in";
      const statusCls = live ? "detail-score-status live" : "detail-score-status muted";
      const dot = live ? `<span class="detail-live-dot"></span>` : "";
      host.innerHTML =
        `<div class="detail-score-line">
           <span class="detail-score-team">
             ${teamIcon(away)}
             <span class="detail-score-nm">${fmt.esc(away.abbr || away.name || "")}</span>
             <span class="detail-score-num tnum">${fmt.esc(away.score != null ? away.score : "")}</span>
           </span>
           <span class="detail-score-sep">–</span>
           <span class="detail-score-team">
             <span class="detail-score-num tnum">${fmt.esc(home.score != null ? home.score : "")}</span>
             <span class="detail-score-nm">${fmt.esc(home.abbr || home.name || "")}</span>
             ${teamIcon(home)}
           </span>
         </div>
         <div class="${statusCls}">${dot}${fmt.esc(g.detail || (live ? "Live" : "Final"))}</div>`;
      host.classList.remove("hidden");
      return;
    }

    if (state === "pre" && g.detail) {
      host.innerHTML = `<div class="detail-score-status muted">${fmt.esc(g.detail)}</div>`;
      host.classList.remove("hidden");
      return;
    }

    host.classList.add("hidden");
    host.innerHTML = "";
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
      // chart up to the TOP 6 outcomes by current chance, one history each
      const top = outcomesByChance().slice(0, 6);
      const colorFor = (i) => LINE_COLORS[i % LINE_COLORS.length];
      let results;
      try {
        results = await Promise.all(top.map((o) =>
          NRB.api(historyUrl(o.ticker)).catch(() => null)));
      } catch (e) { results = []; }
      if (S.destroyed || seq !== S.histSeq) return;
      S.series = top.map((o, i) => ({
        name: o.name, ticker: o.ticker, color: colorFor(i),
        points: (results[i] && results[i].points) || [],
      }));
      buildChart();
      renderProb();
      return;
    }

    let res;
    try {
      res = await NRB.api(historyUrl(S.ticker));
    } catch (e) { res = null; }
    if (S.destroyed || seq !== S.histSeq) return;
    S.points = (res && res.points) || [];
    buildChart();
    renderProb(); // change is relative to the first point of the (new) range
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
    // slower poll: stream new 1-min candles for whatever range is selected
    S.histPollId = setInterval(() => {
      if (S.destroyed) return;
      loadHistory();         // redraws the two-line chart for the active range
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
      renderStats();
      renderToWin();   // instant payout readout before the first quote returns
      resetForecast(); // collapsed forecast affordance (only if predict enabled)

      // fetch live game score/clock first so the "Game" pill (and live default) is known
      await loadGame();
      if (S.destroyed) return;
      // for a matched, in-progress game default-select the in-game timeline
      if (S.startTs && S.game && S.game.state === "in") S.range = "Game";
      renderPills();

      await loadHistory();   // also (re)draws chart + change
      if (S.destroyed) return;
      await loadBets();      // "Your position" card + chart entry markers
      if (S.destroyed) return;
      runQuote();
      startPolling();

      // community discussion for this market — in the LEFT column under the chart
      if (NRB.social && NRB.social.mountThread) {
        try {
          const title = (S.event_title) || (S.market && S.market.title) || S.ticker;
          const leftCol = container.querySelector(".detail-main") || container;
          NRB.social.mountThread(leftCol, "mkt:" + eventTicker(),
            { ticker: S.ticker, title: title });
        } catch (e) {}
      }
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
