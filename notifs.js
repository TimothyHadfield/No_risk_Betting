"use strict";
/*
 * Notifications + price-alerts view. Lists fired notifications (and lets the user
 * manage their active price alerts). Reachable from the burger menu's bell.
 * Uses the shared NRB runtime. Owns: notifs.js / notifs.css.
 */
(function () {
  const NRB = window.NRB;
  const { fmt, el } = NRB;

  const pctOf = (v) => Math.round((Number(v) || 0) * 100) + "%";

  NRB.views.notifications = {
    async mount(container) {
      container.innerHTML = `
        <div class="nf-page">
          <div class="nf-head">
            <h1>Notifications</h1>
            <button class="btn btn-ghost nf-readall" id="nf-readall">Mark all read</button>
          </div>
          <div id="nf-list"><div class="skeleton" style="height:140px"></div></div>

          <h2 class="section-title nf-sec">Your price alerts</h2>
          <p class="muted nf-hint">Open any market and tap “Set a price alert” to add one.
            We’ll notify you here when the chance crosses your target.</p>
          <div id="nf-alerts"><div class="skeleton" style="height:80px"></div></div>
        </div>`;
      container.querySelector("#nf-readall").addEventListener("click", () => this.markAll(container));
      await this.loadNotifs(container);
      await this.loadAlerts(container);
      // opening the page clears the unread badge
      this.markAll(container, /*silent*/ true);
    },

    async loadNotifs(container) {
      const host = container.querySelector("#nf-list");
      if (!host) return;
      let data;
      try { data = await NRB.api("/api/notifications"); }
      catch (e) { host.innerHTML = `<p class="muted">Couldn't load notifications.</p>`; return; }
      const items = (data && data.notifications) || [];
      if (!items.length) {
        host.innerHTML = `<div class="card nf-empty"><p class="muted">No notifications yet.
          Set a price alert on a market and we'll ping you here when it triggers.</p></div>`;
        return;
      }
      host.innerHTML = "";
      items.forEach((n) => host.appendChild(notifRow(n, container, this)));
    },

    async loadAlerts(container) {
      const host = container.querySelector("#nf-alerts");
      if (!host) return;
      let data;
      try { data = await NRB.api("/api/alerts"); }
      catch (e) { host.innerHTML = `<p class="muted">Couldn't load alerts.</p>`; return; }
      const alerts = ((data && data.alerts) || []).filter((a) => a.active);
      if (!alerts.length) {
        host.innerHTML = `<div class="card nf-empty"><p class="muted">No active price alerts.</p></div>`;
        return;
      }
      host.innerHTML = "";
      alerts.forEach((a) => host.appendChild(alertRow(a, container, this)));
    },

    async markAll(container, silent) {
      try { await NRB.api("/api/notifications/read", { method: "POST", body: {} }); }
      catch (e) { /* best effort */ }
      if (NRB.refreshBadge) NRB.refreshBadge();
      if (!silent) {
        container.querySelectorAll(".nf-item.unread").forEach((x) => x.classList.remove("unread"));
      }
    },
  };

  function notifRow(n, container, view) {
    const row = el(`<div class="card nf-item ${n.read ? "" : "unread"}"></div>`);
    const linkable = !!n.ref_ticker;
    row.innerHTML = `
      <div class="nf-item-main">
        <div class="nf-item-title">${fmt.esc(n.title)}</div>
        ${n.body ? `<div class="nf-item-body muted">${fmt.esc(n.body)}</div>` : ""}
        <div class="nf-item-meta muted">${fmt.timeAgo(n.created_at)}${linkable ? " · View market" : ""}</div>
      </div>
      <button class="nf-x" title="Dismiss" aria-label="Dismiss">✕</button>`;
    if (linkable) {
      row.querySelector(".nf-item-main").style.cursor = "pointer";
      row.querySelector(".nf-item-main").addEventListener("click", () => NRB.openMarket(n.ref_ticker));
    }
    row.querySelector(".nf-x").addEventListener("click", async (e) => {
      e.stopPropagation();
      try { await NRB.api("/api/notifications/" + n.id + "/delete", { method: "POST" }); } catch (e2) {}
      row.remove();
      if (NRB.refreshBadge) NRB.refreshBadge();
    });
    return row;
  }

  function alertRow(a, container, view) {
    const row = el(`<div class="card nf-alert"></div>`);
    const name = a.outcome_name || a.title || a.ticker;
    const dir = a.op === "below" ? "falls to" : "rises to";
    row.innerHTML = `
      <div class="nf-alert-main">
        <a class="nf-alert-name">${fmt.esc(name)}</a>
        <span class="muted nf-alert-cond">when it ${dir} ${pctOf(a.threshold)}</span>
      </div>
      <button class="nf-x" title="Remove alert" aria-label="Remove alert">✕</button>`;
    if (a.ticker) {
      const nm = row.querySelector(".nf-alert-name");
      nm.style.cursor = "pointer";
      nm.addEventListener("click", () => NRB.openMarket(a.ticker));
    }
    row.querySelector(".nf-x").addEventListener("click", async () => {
      try { await NRB.api("/api/alerts/" + a.id + "/delete", { method: "POST" }); } catch (e) {}
      row.remove();
    });
    return row;
  }
})();
