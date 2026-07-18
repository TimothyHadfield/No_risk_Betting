"use strict";
/*
 * Portfolio view — open positions (live MTM P&L) + history. Dark v2.
 * Owned by Portfolio/Analytics agent. See BUILD_SPEC.md.
 */
(function () {
  const NRB = window.NRB;
  const { fmt, odds, icon } = NRB;

  // helper: render the side badge
  function sideBadge(side) {
    const s = String(side || "").toLowerCase() === "no" ? "no" : "yes";
    return `<span class="badge ${s}">${s}</span>`;
  }

  // helper: amber flags for partial / estimated fill
  function flags(b) {
    let out = "";
    if (b.partial) out += `<span class="pf-flag">partial</span>`;
    if (b.estimated_fill) out += `<span class="pf-flag">est. fill</span>`;
    return out;
  }

  // helper: signed value with pos/neg coloring
  function signedCell(n) {
    return `<span class="tnum ${fmt.cls(n)}">${fmt.signed(n)}</span>`;
  }

  // helper: a price cell showing BOTH multiplier (accent) and probability (muted)
  function oddsCell(price) {
    return `<div class="pf-odds tnum">
      <span class="pf-mult">${odds.multStr(price)}</span>
      <span class="pf-prob muted">${odds.prob(price)}</span>
    </div>`;
  }

  // helper: per-bet visibility toggle (bets are PUBLIC by default)
  function shareBtn(b) {
    const pub = !b.hidden;
    return `<button class="btn btn-ghost pf-share ${pub ? "on" : ""}" data-id="${fmt.esc(b.id)}" data-pub="${pub ? 1 : 0}" title="Toggle whether this bet shows on the public feed">${pub ? "Public" : "Hidden"}</button>`;
  }

  // helper: a clickable title cell with icon + flags
  function titleCell(b) {
    const label = b.title || b.ticker;
    return `<td class="pf-title-cell">
      <div class="pf-title-row">
        ${icon(b.title || b.side)}
        <a class="pf-link" data-ticker="${fmt.esc(b.ticker)}">${fmt.esc(label)}</a>
        ${flags(b)}
      </div>
    </td>`;
  }

  NRB.views.portfolio = {
    _alive: false,

    async mount(container, params) {
      container.innerHTML = `
        <div class="pf">
          <div class="pf-summary card" id="pf-summary">
            <div class="pf-sum-item">
              <label>Cash ${NRB.help("cash")}</label>
              <span class="tnum" id="pf-cash">—</span>
            </div>
            <div class="pf-sum-item">
              <label>Open positions ${NRB.help("open_positions")}</label>
              <span class="tnum" id="pf-open-count">—</span>
            </div>
            <div class="pf-sum-item">
              <label>Unrealized P&amp;L ${NRB.help("unrealized_pnl")}</label>
              <span class="tnum" id="pf-unrealized">—</span>
            </div>
          </div>

          <div id="pf-parlays"></div>

          <h2 class="section-title pf-section">Open positions</h2>
          <div id="pf-open"></div>

          <h2 class="section-title pf-section">History</h2>
          <div id="pf-history"></div>
        </div>`;

      // keep the cash figure live with header refreshes.
      // NRB.onAccount has no unsubscribe, so guard via _alive flag (cleared in unmount).
      this._alive = true;
      const self = this;
      NRB.onAccount(function (a) {
        if (!self._alive) return;
        const c = document.getElementById("pf-cash");
        if (c && a) c.textContent = fmt.usd(a.balance);
      });

      await this.load();
    },

    async load() {
      const openWrap = document.getElementById("pf-open");
      const histWrap = document.getElementById("pf-history");
      if (!openWrap) return; // unmounted mid-flight
      openWrap.innerHTML = `<div class="skeleton" style="height:96px"></div>`;
      histWrap.innerHTML = `<div class="skeleton" style="height:72px"></div>`;

      let data;
      try {
        data = await NRB.api("/api/bets");
      } catch (e) {
        if (document.getElementById("pf-open")) {
          openWrap.innerHTML = `<div class="card pf-empty"><p class="muted">Couldn't load your positions.</p></div>`;
          histWrap.innerHTML = "";
        }
        return;
      }
      if (!document.getElementById("pf-open")) return; // unmounted

      const bets = (data && data.bets) || [];
      const open = bets.filter((b) => b.status === "open");
      const history = bets.filter((b) => b.status && b.status !== "open");

      // ---- summary strip ----
      const acct = NRB.state.account;
      const cash = acct ? acct.balance : null;
      const totalUnreal = open.reduce((s, b) => s + (Number(b.unrealized_pnl) || 0), 0);
      const cashEl = document.getElementById("pf-cash");
      const cntEl = document.getElementById("pf-open-count");
      const unrealEl = document.getElementById("pf-unrealized");
      if (cashEl) cashEl.textContent = cash == null ? "—" : fmt.usd(cash);
      if (cntEl) cntEl.textContent = String(open.length);
      if (unrealEl) {
        unrealEl.textContent = open.length ? fmt.signed(totalUnreal) : "—";
        unrealEl.className = "tnum " + (open.length ? fmt.cls(totalUnreal) : "");
      }

      this.renderOpen(open);
      this.renderHistory(history);
      this.loadParlays();
    },

    async loadParlays() {
      const wrap = document.getElementById("pf-parlays");
      if (!wrap) return;
      let pdata;
      try {
        pdata = await NRB.api("/api/parlays");
      } catch (e) {
        return; // parlays are additive; stay silent on failure
      }
      if (!document.getElementById("pf-parlays")) return; // unmounted
      this.renderParlays((pdata && pdata.parlays) || []);
    },

    renderParlays(parlays) {
      const wrap = document.getElementById("pf-parlays");
      if (!wrap) return;

      // No parlays -> render nothing for this section.
      if (!parlays.length) { wrap.innerHTML = ""; return; }

      const open = parlays.filter((p) => p.status === "open");
      const settled = parlays.filter((p) => p.status && p.status !== "open");

      // ---- a single leg row ----
      const legRow = (leg) => {
        const st = String(leg.status || "open").toLowerCase();
        let chip;
        if (st === "won") chip = `<span class="pf-leg-chip pos">✓ Won</span>`;
        else if (st === "lost") chip = `<span class="pf-leg-chip neg">✗ Lost</span>`;
        else chip = `<span class="pf-leg-chip muted">•</span>`;
        const multStr = leg.entry_price != null
          ? odds.multStr(leg.entry_price)
          : (leg.mult != null ? Number(leg.mult).toFixed(2) + "x" : "—");
        const name = leg.outcome_name || leg.title || leg.ticker;
        const sub = leg.title && leg.outcome_name ? `<span class="pf-leg-sub muted">${fmt.esc(leg.title)}</span>` : "";
        return `
          <div class="pf-leg pf-leg-${st}">
            <div class="pf-leg-main">
              ${icon(leg.outcome_name || leg.side)}
              <a class="pf-link pf-leg-name" data-ticker="${fmt.esc(leg.ticker)}">${fmt.esc(name)}</a>
              ${sub}
            </div>
            <span class="pf-leg-mult tnum">${multStr}</span>
            ${chip}
          </div>`;
      };

      // ---- one parlay card ----
      const card = (p, isOpen) => {
        const legs = p.legs || [];
        const n = legs.length;
        const mult = Number(p.combined_mult) || 0;
        const legsHtml = legs.map(legRow).join("");

        let head, foot;
        if (isOpen) {
          const win = (Number(p.stake) || 0) * mult;
          const lostCount = legs.filter((l) => String(l.status).toLowerCase() === "lost").length;
          const inCount = legs.filter((l) => String(l.status).toLowerCase() === "won").length;
          head = `
            <div class="pf-parlay-head">
              <div class="pf-parlay-title">
                ${n}-leg parlay
                <span class="pf-parlay-mult tnum">${mult.toFixed(2)}x</span>
              </div>
              <div class="pf-parlay-meta tnum muted">
                stake ${fmt.usd(p.stake)} · win ${fmt.usd(win)}
              </div>
            </div>`;
          const state = lostCount
            ? `<span class="pf-parlay-state neg">Busted</span>`
            : `<span class="pf-parlay-state pos">Still alive (${inCount}/${n} legs in)</span>`;
          foot = `
            <div class="pf-parlay-foot">
              ${state}
              <button class="btn btn-ghost pf-parlay-settle" data-id="${fmt.esc(p.id)}" title="Demo: force-settle now">Settle&#9656;</button>
            </div>`;
        } else {
          const won = Number(p.payout) > 0;
          const pnl = Number(p.realized_pnl);
          head = `
            <div class="pf-parlay-head">
              <div class="pf-parlay-title">
                ${n}-leg parlay
                <span class="pf-parlay-mult tnum">${mult.toFixed(2)}x</span>
                <span class="pf-parlay-result ${won ? "pos" : "neg"}">${won ? "Won" : "Lost"}</span>
              </div>
              <div class="pf-parlay-meta tnum muted">
                payout ${fmt.usd(p.payout)} · <span class="${fmt.cls(pnl)}">${fmt.signed(pnl)}</span>
              </div>
            </div>`;
          foot = "";
        }

        return `
          <div class="card pf-parlay ${isOpen ? "open" : "settled"}">
            ${head}
            <div class="pf-legs">${legsHtml}</div>
            ${foot}
          </div>`;
      };

      let html = "";
      if (open.length) {
        html += `<h2 class="section-title pf-section">Parlays</h2>`;
        html += `<div class="pf-parlay-list">${open.map((p) => card(p, true)).join("")}</div>`;
      }
      if (settled.length) {
        html += `<h2 class="section-title pf-section">Parlay history</h2>`;
        html += `<div class="pf-parlay-list">${settled.map((p) => card(p, false)).join("")}</div>`;
      }
      wrap.innerHTML = html;

      wrap.querySelectorAll(".pf-leg-name").forEach((a) =>
        a.addEventListener("click", () => NRB.openMarket(a.dataset.ticker)));
      wrap.querySelectorAll(".pf-parlay-settle").forEach((btn) =>
        btn.addEventListener("click", () => this.settleParlay(btn.dataset.id, btn)));
    },

    async settleParlay(id, btn) {
      const result = await NRB.sheet.choice({
        title: "Settle parlay", message: "Record the real outcome for this parlay.",
        options: [
          { label: "Won", value: "win", style: "primary" },
          { label: "Lost", value: "lose", style: "danger" },
        ],
      });
      if (result == null) return;
      if (btn) { btn.disabled = true; btn.textContent = "Settling…"; }
      try {
        const res = await NRB.api("/api/parlays/" + encodeURIComponent(id) + "/force_settle", {
          method: "POST",
          body: { result },
        });
        if (!res || res.ok === false) {
          NRB.toast((res && res.error) || "Couldn't settle that parlay.");
          if (btn) { btn.disabled = false; btn.innerHTML = "Settle&#9656;"; }
          return;
        }
        const p = res.parlay || {};
        const pnl = p.realized_pnl != null ? ` · ${fmt.signed(p.realized_pnl)}` : "";
        NRB.toast(`Parlay ${result === "win" ? "WON" : "LOST"}${pnl}`);
        await NRB.refreshAccount();
        await this.load();
      } catch (e) {
        NRB.toast("Couldn't settle that parlay.");
        if (btn) { btn.disabled = false; btn.innerHTML = "Settle&#9656;"; }
      }
    },

    renderOpen(open) {
      const wrap = document.getElementById("pf-open");
      if (!wrap) return;

      if (!open.length) {
        wrap.innerHTML = `
          <div class="card pf-empty">
            <p class="muted">No open positions yet.</p>
            <button class="btn btn-primary" id="pf-go-markets">Browse markets</button>
          </div>`;
        const b = document.getElementById("pf-go-markets");
        if (b) b.addEventListener("click", () => NRB.go("browse"));
        return;
      }

      const rows = open.map((b) => {
        const pnl = Number(b.unrealized_pnl);
        return `
          <tr data-id="${fmt.esc(b.id)}">
            ${titleCell(b)}
            <td>${sideBadge(b.side)}</td>
            <td class="tnum">${oddsCell(b.avg_price)}</td>
            <td class="tnum">${oddsCell(b.current_price)}</td>
            <td class="tnum">${fmt.usd(b.current_value)}</td>
            <td class="tnum">${signedCell(pnl)}</td>
            <td class="pf-actions">
              <button class="btn pf-sell" data-id="${fmt.esc(b.id)}">Sell</button>
              <button class="btn btn-ghost pf-settle" data-id="${fmt.esc(b.id)}" title="Demo: force-settle now">Settle&#9656;</button>
              ${shareBtn(b)}
            </td>
          </tr>`;
      }).join("");

      wrap.innerHTML = `
        <div class="card pf-tablecard">
          <table class="pf-table">
            <thead>
              <tr>
                <th>Market</th><th>Side</th>
                <th class="tnum">Entry ${NRB.help("entry")}</th><th class="tnum">Now ${NRB.help("now_price")}</th>
                <th class="tnum">Value ${NRB.help("value")}</th><th class="tnum">Unreal. P&amp;L ${NRB.help("unrealized_pnl")}</th><th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

      wrap.querySelectorAll(".pf-link").forEach((a) =>
        a.addEventListener("click", () => NRB.openMarket(a.dataset.ticker)));
      wrap.querySelectorAll(".pf-sell").forEach((btn) =>
        btn.addEventListener("click", () => this.sell(btn.dataset.id, btn)));
      wrap.querySelectorAll(".pf-settle").forEach((btn) =>
        btn.addEventListener("click", () => this.settle(btn.dataset.id, btn)));
      wrap.querySelectorAll(".pf-share").forEach((btn) =>
        btn.addEventListener("click", () => this.share(btn)));
    },

    async share(btn) {
      if (!NRB.auth || !NRB.auth.isLoggedIn()) {
        NRB.toast("Log in to share bets to the community.");
        if (NRB.authUI) NRB.authUI.open("login");
        return;
      }
      const id = btn.dataset.id;
      const makePublic = btn.dataset.pub !== "1";
      btn.disabled = true;
      try {
        const r = await NRB.api("/api/bets/" + encodeURIComponent(id) + "/public",
          { method: "POST", body: { public: makePublic } });
        if (r && r.ok) {
          btn.dataset.pub = makePublic ? "1" : "0";
          btn.classList.toggle("on", makePublic);
          btn.textContent = makePublic ? "Public" : "Hidden";
          NRB.toast(makePublic ? "Bet is now public." : "Bet hidden from the feed.");
        } else { NRB.toast((r && r.error) || "Couldn't update visibility."); }
      } catch (e) { NRB.toast("Couldn't update sharing."); }
      finally { btn.disabled = false; }
    },

    renderHistory(history) {
      const wrap = document.getElementById("pf-history");
      if (!wrap) return;

      if (!history.length) {
        wrap.innerHTML = `
          <div class="card pf-empty">
            <p class="muted">No settled or closed bets yet.</p>
            <button class="btn btn-primary" id="pf-hist-markets">Browse markets</button>
          </div>`;
        const b = document.getElementById("pf-hist-markets");
        if (b) b.addEventListener("click", () => NRB.go("browse"));
        return;
      }

      const rows = history.map((b) => {
        let outcome, oc;
        if (b.status === "settled") { outcome = b.result ? String(b.result).toUpperCase() : "SETTLED"; oc = "settled"; }
        else if (b.status === "closed") { outcome = "sold"; oc = "sold"; }
        else { outcome = fmt.esc(b.status); oc = ""; }
        const pnl = Number(b.realized_pnl);
        return `
          <tr>
            ${titleCell(b)}
            <td>${sideBadge(b.side)}</td>
            <td class="tnum">${oddsCell(b.avg_price)}</td>
            <td><span class="pf-outcome ${oc}">${outcome}</span></td>
            <td class="tnum">${fmt.usd(b.payout)}</td>
            <td class="tnum">${signedCell(pnl)}</td>
            <td class="pf-actions">${shareBtn(b)}</td>
          </tr>`;
      }).join("");

      wrap.innerHTML = `
        <div class="card pf-tablecard">
          <table class="pf-table">
            <thead>
              <tr>
                <th>Market</th><th>Side</th>
                <th class="tnum">Entry ${NRB.help("entry")}</th><th>Outcome</th>
                <th class="tnum">Payout ${NRB.help("payout")}</th><th class="tnum">Realized P&amp;L ${NRB.help("realized_pnl")}</th><th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

      wrap.querySelectorAll(".pf-link").forEach((a) =>
        a.addEventListener("click", () => NRB.openMarket(a.dataset.ticker)));
      wrap.querySelectorAll(".pf-share").forEach((btn) =>
        btn.addEventListener("click", () => this.share(btn)));
    },

    async sell(id, btn) {
      if (btn) { btn.disabled = true; btn.textContent = "Selling…"; }
      try {
        const res = await NRB.api("/api/bets/" + encodeURIComponent(id) + "/close", { method: "POST" });
        if (!res || res.ok === false) {
          NRB.toast((res && res.error) || "Couldn't sell that position.");
          if (btn) { btn.disabled = false; btn.textContent = "Sell"; }
          return;
        }
        const proceeds = fmt.usd(res.proceeds);
        const realized = fmt.signed(res.realized_pnl);
        NRB.toast(`Sold for ${proceeds} · realized ${realized}`);
        await NRB.refreshAccount();
        await this.load();
      } catch (e) {
        NRB.toast("Couldn't sell that position.");
        if (btn) { btn.disabled = false; btn.textContent = "Sell"; }
      }
    },

    async settle(id, btn) {
      const result = await NRB.sheet.choice({
        title: "Settle now", message: "Record the real outcome for this market.",
        options: [
          { label: "Yes", value: "yes", style: "primary" },
          { label: "No", value: "no", style: "danger" },
        ],
      });
      if (result == null) return;
      if (btn) { btn.disabled = true; btn.textContent = "Settling…"; }
      try {
        const res = await NRB.api("/api/bets/" + encodeURIComponent(id) + "/force_settle", {
          method: "POST",
          body: { result },
        });
        if (!res || res.ok === false) {
          NRB.toast((res && res.error) || "Couldn't settle that position.");
          if (btn) { btn.disabled = false; btn.innerHTML = "Settle&#9656;"; }
          return;
        }
        const b = res.bet || {};
        const pnl = b.realized_pnl != null ? ` · realized ${fmt.signed(b.realized_pnl)}` : "";
        NRB.toast(`Settled ${result.toUpperCase()}${pnl}`);
        await NRB.refreshAccount();
        await this.load();
      } catch (e) {
        NRB.toast("Couldn't settle that position.");
        if (btn) { btn.disabled = false; btn.innerHTML = "Settle&#9656;"; }
      }
    },

    unmount() {
      this._alive = false; // disarm the persistent onAccount callback
    },
  };
})();
