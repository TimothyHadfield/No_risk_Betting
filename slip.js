"use strict";
/* Floating bet slip for parlays. Builds legs from the "+" on market boxes and
   the detail view; places a combined parlay via POST /api/parlays.
   Uses the shared NRB.slip state (util.js). */
(function () {
  const fmt = () => NRB.fmt, odds = () => NRB.odds;
  let stake = 10;

  function ensureRoot() {
    if (document.getElementById("slip-root")) return;
    const root = NRB.el(`
      <div id="slip-root">
        <button class="slip-fab" id="slip-fab" hidden>
          <span class="slip-fab-ic">🧾</span>
          <span class="slip-fab-txt">Bet slip</span>
          <span class="slip-fab-count" id="slip-count">0</span>
        </button>
        <div class="slip-overlay" id="slip-overlay"></div>
        <div class="slip-panel" id="slip-panel">
          <div class="slip-head">
            <strong>Bet slip · Parlay</strong>
            <button class="slip-x" id="slip-x">×</button>
          </div>
          <div class="slip-legs" id="slip-legs"></div>
          <div class="slip-foot" id="slip-foot"></div>
        </div>
      </div>`);
    document.body.appendChild(root);
    document.getElementById("slip-fab").addEventListener("click", open);
    document.getElementById("slip-x").addEventListener("click", close);
    document.getElementById("slip-overlay").addEventListener("click", close);
  }

  const open = () => { document.getElementById("slip-panel").classList.add("open");
    document.getElementById("slip-overlay").classList.add("open"); render(); };
  const close = () => { document.getElementById("slip-panel").classList.remove("open");
    document.getElementById("slip-overlay").classList.remove("open"); };

  function renderFab() {
    const fab = document.getElementById("slip-fab");
    const n = NRB.slip.count();
    fab.hidden = n === 0;
    document.getElementById("slip-count").textContent = n;
  }

  function render() {
    const legs = NRB.slip.legs();
    const wrap = document.getElementById("slip-legs");
    const foot = document.getElementById("slip-foot");
    if (!legs.length) {
      wrap.innerHTML = `<div class="slip-empty">Your slip is empty.<br>
        Tap “+” on any market outcome to add a leg.</div>`;
      foot.innerHTML = "";
      return;
    }
    wrap.innerHTML = legs.map((l) => `
      <div class="slip-leg">
        ${NRB.icon(l.name, l.logo)}
        <div class="slip-leg-main">
          <div class="slip-leg-nm">${fmt().esc(l.name)}</div>
          <div class="slip-leg-sub">${fmt().esc(l.eventTitle || "")}</div>
        </div>
        <span class="slip-leg-mult tnum">${odds().multStr(l.price)}</span>
        <button class="slip-leg-x" data-t="${fmt().esc(l.ticker)}">×</button>
      </div>`).join("");
    const mult = NRB.slip.combinedMult();
    const payout = stake * mult;
    foot.innerHTML = `
      <div class="slip-row"><span>${legs.length}-leg parlay</span>
        <span class="slip-mult tnum">${mult.toFixed(2)}x</span></div>
      <label class="slip-stake">Stake ($)
        <input id="slip-stake" type="number" min="1" step="1" value="${stake}"></label>
      <div class="slip-row big"><span>Payout if all hit</span>
        <span class="tnum">${fmt().usd(payout)}</span></div>
      <button class="btn btn-primary btn-block" id="slip-place">Place parlay · win ${fmt().usd(payout)}</button>
      <button class="slip-clear" id="slip-clear">Clear slip</button>
      <div class="slip-note">All legs must win. No real money.</div>`;
    wrap.querySelectorAll(".slip-leg-x").forEach((b) =>
      b.addEventListener("click", () => NRB.slip.remove(b.dataset.t)));
    const si = foot.querySelector("#slip-stake");
    si.addEventListener("input", () => { stake = Math.max(0, Number(si.value) || 0); render(); });
    foot.querySelector("#slip-clear").addEventListener("click", () => { NRB.slip.clear(); });
    foot.querySelector("#slip-place").addEventListener("click", place);
  }

  async function place() {
    const legs = NRB.slip.legs();
    if (legs.length < 2) { NRB.toast("Add at least 2 legs for a parlay."); return; }
    if (!stake || stake <= 0) { NRB.toast("Enter a stake."); return; }
    const res = await NRB.api("/api/parlays", {
      method: "POST",
      body: { stake, legs: legs.map((l) => ({ ticker: l.ticker, side: l.side })) },
    });
    if (res.error) { NRB.toast(res.error); return; }
    NRB.toast(`Parlay placed: ${legs.length} legs · win ${NRB.fmt.usd(res.potential_payout)}`);
    NRB.slip.clear();
    close();
    NRB.refreshAccount();
  }

  window.addEventListener("DOMContentLoaded", () => {
    ensureRoot();
    renderFab();
    NRB.slip.onChange(() => { renderFab(); if (document.getElementById("slip-panel").classList.contains("open")) render(); });
  });
})();
