"use strict";
/*
 * Dedicated bet page (NRB.views.bet). A betting option elsewhere (e.g. the
 * margin-of-victory / total odds bars) shows just the odds; tapping it opens
 * THIS page, which shows what you're backing and lets you pick an amount, place
 * the bet, or add it to a parlay. Reuses /api/quote + /api/bets + NRB.slip.
 * Owns: bet.js / bet.css.
 *
 * params: { ticker, side ('yes'|'no'), name, title, eventTicker, returnTicker, price }
 */
(function () {
  const NRB = window.NRB;
  const fmt = NRB.fmt, odds = NRB.odds;
  const QUICK = [5, 10, 25, 50, 100];
  let S = null;

  // current ask for the selected side (live market preferred, else passed price)
  function price() {
    const m = S.market;
    if (m) return S.side === "no" ? m.no_ask : m.yes_ask;
    return S.price;
  }
  function contracts() {
    const p = price(), w = Math.max(0, Number(S.wager) || 0);
    if (!p || p <= 0 || !w) return 0;
    return Math.max(1, Math.round(w / p));
  }

  NRB.views.bet = {
    async mount(container, params) {
      params = params || {};
      S = {
        ticker: params.ticker,
        side: params.side === "no" ? "no" : "yes",
        name: params.name || "",
        title: params.title || "",
        eventTicker: params.eventTicker || null,
        returnTicker: params.returnTicker || params.ticker,
        price: (params.price != null) ? params.price : null,
        market: null, wager: 10, quote: null, confirming: false,
        seq: 0, quoteTimer: null, destroyed: false,
      };
      if (!S.ticker) { NRB.go("browse"); return; }

      container.innerHTML = shell();
      wire(container);
      render();
      requestQuote();

      // fetch the live market for a fresh price + title
      try {
        const res = await NRB.api(`/api/market/${encodeURIComponent(S.ticker)}`);
        if (S.destroyed) return;
        if (res && res.market) {
          S.market = res.market;
          if (!S.title) S.title = res.market.title || "";
        }
        render();
        requestQuote();
      } catch (e) { /* keep the passed-in price */ }
    },

    unmount() {
      if (!S) return;
      S.destroyed = true;
      if (S.quoteTimer) clearTimeout(S.quoteTimer);
      S = null;
    },
  };

  function shell() {
    return `
      <div class="bet-page">
        <a class="detail-back" id="bet-back">← Back</a>
        <div class="card bet-card">
          <div class="bet-side-tag" id="bet-side"></div>
          <h1 class="bet-name" id="bet-name"></h1>
          <div class="bet-sub muted" id="bet-sub"></div>
          <div class="bet-odds" id="bet-odds"></div>

          <div class="bet-field">
            <span class="muted bet-field-lbl">Amount</span>
            <div class="detail-stepper bet-stepper">
              <button type="button" class="detail-step" data-step="-5">−</button>
              <input type="number" id="bet-wager" min="1" step="1" value="10" class="tnum">
              <button type="button" class="detail-step" data-step="5">+</button>
            </div>
            <div class="bet-chips" id="bet-chips">
              ${QUICK.map((q) => `<button class="bet-chip" data-amt="${q}">$${q}</button>`).join("")}
            </div>
          </div>

          <div class="bet-quote" id="bet-quote"></div>

          <button class="btn btn-primary btn-block bet-place" id="bet-place">Place bet</button>
          <button class="btn btn-ghost btn-block bet-add" id="bet-add">+ Add to parlay</button>
          <div class="detail-disclaimer muted">No real money. Fills walk the live order book incl. Kalshi's fee.</div>
        </div>
      </div>`;
  }

  function render() {
    const $ = (id) => document.getElementById(id);
    if (!$("bet-name")) return;
    const sideEl = $("bet-side");
    sideEl.textContent = S.side === "yes" ? "Backing — YES" : "Backing — NO";
    sideEl.className = "bet-side-tag " + S.side;
    $("bet-name").textContent = S.name || (S.market && S.market.title) || S.ticker;
    $("bet-sub").textContent = (S.title && S.title !== S.name) ? S.title : "";
    const p = price();
    const yesC = S.market ? NRB.odds.chance(S.market) : null;
    const chance = (S.side === "no" && yesC != null) ? 1 - yesC : yesC;
    $("bet-odds").innerHTML = (p != null && p > 0)
      ? `<span class="bet-mult tnum pos">${odds.multStr(p)}</span>
         <span class="muted tnum">${odds.prob(chance)} chance</span>`
      : `<span class="muted">No live price right now.</span>`;
    const wi = $("bet-wager");
    if (wi && document.activeElement !== wi) wi.value = S.wager;
  }

  function resetConfirm() {
    S.confirming = false;
    const btn = document.getElementById("bet-place");
    if (btn && !S.destroyed) { btn.classList.remove("detail-confirm"); btn.textContent = "Place bet"; }
  }

  function requestQuote() {
    S.quote = null;
    resetConfirm();
    if (S.quoteTimer) clearTimeout(S.quoteTimer);
    S.quoteTimer = setTimeout(runQuote, 250);
    renderQuote();
  }

  async function runQuote() {
    const n = contracts();
    if (!n) { renderQuote(); return; }
    const seq = ++S.seq;
    try {
      const q = await NRB.api(
        `/api/quote?ticker=${encodeURIComponent(S.ticker)}&side=${S.side}&contracts=${n}`);
      if (S.destroyed || seq !== S.seq) return;
      S.quote = (q && q.ok !== false) ? q : { error: (q && (q.reason || q.error)) || "No fillable depth." };
      renderQuote();
    } catch (e) {
      if (S.destroyed || seq !== S.seq) return;
      S.quote = { error: "Couldn't fetch a quote." };
      renderQuote();
    }
  }

  function renderQuote() {
    const host = document.getElementById("bet-quote");
    if (!host) return;
    const w = Math.max(0, Number(S.wager) || 0);
    if (!w) { host.innerHTML = `<div class="muted bet-quote-empty">Enter an amount to see your payout.</div>`; return; }
    const q = S.quote;
    if (q && q.error) { host.innerHTML = `<div class="neg bet-quote-empty">${fmt.esc(q.error)}</div>`; return; }
    const p = price();
    const mult = odds.mult(p);
    const payout = (q && q.max_payout != null) ? q.max_payout : (mult != null ? w * mult : null);
    const cost = (q && q.cost_basis != null) ? q.cost_basis : w;
    const profit = (q && q.max_profit != null) ? q.max_profit : (payout != null ? payout - w : null);
    const row = (l, v, cls) =>
      `<div class="bet-quote-row"><span class="muted">${l}</span><span class="tnum ${cls || ""}">${v}</span></div>`;
    host.innerHTML =
      row("Cost", cost != null ? fmt.usd(cost) : "—", "bet-strong") +
      row("Payout if win", payout != null ? fmt.usd(payout) : "—") +
      row("Profit", profit != null ? fmt.signed(profit) : "—", "pos bet-strong");
  }

  function placeBet() {
    const btn = document.getElementById("bet-place");
    const n = contracts();
    if (!n) { NRB.toast("Enter an amount."); return; }
    if (!S.confirming) {
      S.confirming = true;
      const mult = odds.mult(price());
      const win = mult != null ? ` → win ${fmt.usd(S.wager * mult)}` : "";
      btn.classList.add("detail-confirm");
      btn.textContent = `Confirm: ${fmt.usd(S.wager)} on ${S.name}${win}`;
      return;
    }
    doPlace(btn, n);
  }

  async function doPlace(btn, n) {
    const wager = Math.max(0, Number(S.wager) || 0);
    S.confirming = false;
    if (btn) { btn.disabled = true; btn.classList.remove("detail-confirm"); btn.textContent = "Placing…"; }
    try {
      const res = await NRB.api("/api/bets", { method: "POST", body: {
        ticker: S.ticker, side: S.side, contracts: n, outcome_name: S.name,
      } });
      if (res && res.error) {
        NRB.toast(res.error);
      } else if (res && res.ok) {
        const payout = (res.bet && res.bet.max_payout != null) ? res.bet.max_payout
          : (res.quote && res.quote.max_payout != null) ? res.quote.max_payout : null;
        const winTxt = payout != null ? ` to win ${fmt.usd(payout)}` : "";
        if (NRB.celebrate) NRB.celebrate(`${fmt.usd(wager)} on ${S.name}`);
        NRB.toast(`Bet placed: ${fmt.usd(wager)} on ${S.name}${winTxt}`);
        await NRB.refreshAccount();
        NRB.openMarket(S.returnTicker);   // back to the market we came from
        return;
      } else {
        NRB.toast("Bet failed.");
      }
    } catch (e) {
      NRB.toast("Network error placing bet.");
    } finally {
      if (btn && !S.destroyed) { btn.disabled = false; btn.classList.remove("detail-confirm"); btn.textContent = "Place bet"; }
    }
  }

  function addToParlay() {
    if (!NRB.slip || !NRB.slip.add) { NRB.toast("Parlay slip unavailable."); return; }
    NRB.slip.add({
      ticker: S.ticker, side: S.side, name: S.name,
      price: price(), logo: null, eventTitle: S.title || "",
    });
    NRB.toast("Added to parlay: " + S.name);
  }

  function wire(container) {
    container.querySelector("#bet-back").addEventListener("click", () => NRB.openMarket(S.returnTicker));

    const input = container.querySelector("#bet-wager");
    input.addEventListener("input", () => {
      const v = parseInt(input.value, 10);
      S.wager = isNaN(v) ? 0 : Math.max(0, v);
      requestQuote();
      render();
    });

    container.querySelectorAll(".bet-stepper .detail-step").forEach((b) => {
      b.addEventListener("click", () => {
        const d = parseInt(b.dataset.step, 10);
        S.wager = Math.max(1, (Math.floor(S.wager) || 0) + d);
        input.value = S.wager;
        requestQuote();
      });
    });

    container.querySelectorAll(".bet-chip").forEach((c) => {
      c.addEventListener("click", () => {
        S.wager = parseInt(c.dataset.amt, 10) || 0;
        input.value = S.wager;
        requestQuote();
      });
    });

    container.querySelector("#bet-place").addEventListener("click", placeBet);
    container.querySelector("#bet-add").addEventListener("click", addToParlay);
  }
})();
