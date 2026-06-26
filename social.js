"use strict";
/*
 * Social layer — Community (leaderboard + live feed), public profiles, a profile
 * editor, and a reusable comments thread. Uses the shared NRB runtime.
 */
(function () {
  const NRB = window.NRB;
  const { fmt, odds, icon, el } = NRB;

  const pct = (v) => (v == null ? "—" : (v * 100).toFixed(0) + "%");
  const roiPct = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%");
  const handleLink = (h) =>
    h ? `<a class="so-handle" data-handle="${fmt.esc(h)}">${fmt.esc(h)}</a>` : `<span class="muted">anonymous</span>`;

  // ---- a public bet card (feed + profile) ---------------------------------
  function betCard(b) {
    const outcome = b.title || b.ticker;
    const sideTxt = b.side === "no" ? "No" : "Yes";
    let res = "";
    if (b.status === "settled") {
      const won = b.result === b.side;
      res = `<span class="so-res ${won ? "pos" : "neg"}">${won ? "Won" : "Lost"} ${fmt.signed(b.realized_pnl)}</span>`;
    } else if (b.status === "closed") {
      res = `<span class="so-res">Closed ${fmt.signed(b.realized_pnl)}</span>`;
    } else {
      res = `<span class="so-res open">Open</span>`;
    }
    const card = el(`<div class="so-bet card"></div>`);
    card.innerHTML = `
      <div class="so-bet-top">
        ${handleLink(b.handle)}
        <span class="muted so-ago">${fmt.timeAgo(b.placed_at)}</span>
      </div>
      <div class="so-bet-mid">
        <span class="badge ${b.side === "no" ? "no" : "yes"}">${sideTxt}</span>
        <a class="so-mkt" data-ticker="${fmt.esc(b.ticker)}">${fmt.esc(outcome)}</a>
      </div>
      <div class="so-bet-foot">
        <span class="tnum">${fmt.usd(b.stake)} @ ${odds.multStr(b.avg_price)}</span>
        ${res}
        <button class="so-like ${b.liked ? "on" : ""}" data-type="bet" data-id="${b.id}">
          ▲ <span class="so-like-n">${b.likes || 0}</span>
        </button>
      </div>`;
    card.querySelector(".so-mkt").addEventListener("click", () => NRB.openMarket(b.ticker));
    const hl = card.querySelector(".so-handle");
    if (hl) hl.addEventListener("click", () => NRB.go("user", { handle: b.handle }));
    wireLike(card.querySelector(".so-like"));
    return card;
  }

  // ---- like buttons -------------------------------------------------------
  function wireLike(btn) {
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!NRB.auth.isLoggedIn()) { NRB.authUI.open("login"); return; }
      const nEl = btn.querySelector(".so-like-n");
      const on = btn.classList.toggle("on");
      let n = parseInt(nEl.textContent, 10) || 0;
      nEl.textContent = on ? n + 1 : Math.max(0, n - 1);
      try {
        await NRB.api("/api/reactions", { method: "POST",
          body: { target_type: btn.dataset.type, target_id: btn.dataset.id } });
      } catch (e) { /* best-effort optimistic */ }
    });
  }

  // ---- reusable comments thread ------------------------------------------
  NRB.social = NRB.social || {};
  NRB.social.mountThread = function (host, thread) {
    const wrap = el(`<section class="so-thread card"></section>`);
    wrap.innerHTML = `
      <div class="so-thread-head">
        <h3>Discussion</h3><span class="so-count muted" id="so-c-count"></span>
      </div>
      <div class="so-composer" id="so-composer"></div>
      <div class="so-comments" id="so-comments">
        <div class="skeleton" style="height:60px"></div>
      </div>`;
    host.appendChild(wrap);
    renderComposer(wrap, thread);
    loadComments(wrap, thread);
  };

  function renderComposer(wrap, thread) {
    const box = wrap.querySelector("#so-composer");
    if (!NRB.auth.isLoggedIn()) {
      box.innerHTML = `<button class="btn btn-block" id="so-login">Log in to join the discussion</button>`;
      box.querySelector("#so-login").addEventListener("click", () => NRB.authUI.open("login"));
      return;
    }
    if (!NRB.auth.display()) {
      box.innerHTML = `<div class="so-need-handle muted">Set a display name to comment. <a id="so-go-comm">Set it up →</a></div>`;
      box.querySelector("#so-go-comm").addEventListener("click", () => NRB.go("community"));
      return;
    }
    box.innerHTML = `
      <textarea id="so-input" class="so-input" rows="2" maxlength="1000" placeholder="Share your read on this market…"></textarea>
      <div class="so-composer-foot">
        <span class="muted so-as">as ${fmt.esc(NRB.auth.display())}</span>
        <button class="btn btn-primary" id="so-post">Post</button>
      </div>`;
    const post = box.querySelector("#so-post");
    const input = box.querySelector("#so-input");
    post.addEventListener("click", async () => {
      const body = (input.value || "").trim();
      if (!body) return;
      post.disabled = true;
      try {
        const r = await NRB.api("/api/comments", { method: "POST", body: { thread, body } });
        if (r && r.ok) { input.value = ""; loadComments(wrap, thread); }
        else NRB.toast((r && r.error) || "Couldn't post.");
      } catch (e) { NRB.toast("Couldn't post."); }
      finally { post.disabled = false; }
    });
  }

  async function loadComments(wrap, thread) {
    const list = wrap.querySelector("#so-comments");
    let data;
    try { data = await NRB.api("/api/comments?thread=" + encodeURIComponent(thread)); }
    catch (e) { list.innerHTML = `<p class="muted">Couldn't load comments.</p>`; return; }
    const comments = (data && data.comments) || [];
    const cnt = wrap.querySelector("#so-c-count");
    if (cnt) cnt.textContent = comments.length ? comments.length : "";
    if (!comments.length) {
      list.innerHTML = `<p class="muted so-empty">No comments yet. Start the discussion.</p>`;
      return;
    }
    list.innerHTML = "";
    comments.forEach((c) => list.appendChild(commentRow(c, wrap, thread)));
  }

  function commentRow(c, wrap, thread) {
    const row = el(`<div class="so-comment"></div>`);
    row.innerHTML = `
      <div class="so-comment-head">
        ${handleLink(c.handle)}
        <span class="muted so-ago">${fmt.timeAgo(c.created_at)}</span>
      </div>
      <div class="so-comment-body">${fmt.esc(c.body)}</div>
      <div class="so-comment-foot">
        <button class="so-like ${c.liked ? "on" : ""}" data-type="comment" data-id="${c.id}">▲ <span class="so-like-n">${c.likes || 0}</span></button>
        ${c.can_delete ? `<button class="so-cbtn" data-act="del">Delete</button>` : ""}
        ${!c.mine ? `<button class="so-cbtn" data-act="report">Report</button>` : ""}
      </div>`;
    const hl = row.querySelector(".so-handle");
    if (hl) hl.addEventListener("click", () => NRB.go("user", { handle: c.handle }));
    wireLike(row.querySelector(".so-like"));
    const del = row.querySelector('[data-act="del"]');
    if (del) del.addEventListener("click", async () => {
      if (!confirm("Delete this comment?")) return;
      await NRB.api("/api/comments/" + c.id + "/delete", { method: "POST" });
      loadComments(wrap, thread);
    });
    const rep = row.querySelector('[data-act="report"]');
    if (rep) rep.addEventListener("click", async () => {
      const reason = prompt("Report this comment — reason (optional):");
      if (reason === null) return;
      await NRB.api("/api/comments/" + c.id + "/report", { method: "POST", body: { reason } });
      NRB.toast("Reported. Thanks — we'll review it.");
    });
    return row;
  }

  // ---- Community view (profile editor + leaderboard + feed) ---------------
  NRB.views.community = {
    tab: "leaderboard",
    async mount(container) {
      container.innerHTML = `
        <div class="so-page">
          <div class="so-pagehead">
            <h1>Community</h1>
            <p class="muted">See who's actually calling it right — and join the conversation.</p>
          </div>
          <div id="so-profile-card"></div>
          <div class="so-tabs">
            <button class="so-tab" data-tab="leaderboard">Leaderboard</button>
            <button class="so-tab" data-tab="feed">Live feed</button>
          </div>
          <div id="so-tabbody"></div>
        </div>`;
      container.querySelectorAll(".so-tab").forEach((t) =>
        t.addEventListener("click", () => { this.tab = t.dataset.tab; this.renderTabs(container); }));
      this.renderProfileCard(container);
      this.renderTabs(container);
    },

    renderTabs(container) {
      container.querySelectorAll(".so-tab").forEach((t) =>
        t.classList.toggle("active", t.dataset.tab === this.tab));
      const body = container.querySelector("#so-tabbody");
      if (this.tab === "feed") loadFeed(body);
      else loadLeaderboard(body);
    },

    async renderProfileCard(container) {
      const host = container.querySelector("#so-profile-card");
      if (!host) return;
      if (!NRB.auth.isLoggedIn()) {
        host.innerHTML = `<div class="card so-profile-cta">
          <p>Log in to claim a public handle and appear on the leaderboard.</p>
          <button class="btn btn-primary" id="so-cta-login">Log in / Sign up</button></div>`;
        host.querySelector("#so-cta-login").addEventListener("click", () => NRB.authUI.open("login"));
        return;
      }
      let p = {};
      try { p = await NRB.api("/api/me/profile"); } catch (e) {}
      const card = el(`<div class="card so-profile-edit"></div>`);
      card.innerHTML = `
        <div class="so-pe-head">
          <h3>Your community profile</h3>
          ${p.handle ? `<button class="btn btn-ghost so-view-me">View public page →</button>` : ""}
        </div>
        <label class="so-field"><span>Display name <em class="muted">(shown to others)</em></span>
          <input id="so-handle" maxlength="30" placeholder="e.g. Sharp Caller" value="${fmt.esc(p.handle || "")}"></label>
        <label class="so-field"><span>Bio <em class="muted">(optional)</em></span>
          <input id="so-bio" maxlength="200" placeholder="A line about your forecasting" value="${fmt.esc(p.bio || "")}"></label>
        <label class="so-check"><input type="checkbox" id="so-public" ${p.is_public ? "checked" : ""}>
          <span>Show me on the public leaderboard & feed</span></label>
        <div class="so-pe-err muted" id="so-pe-err"></div>
        <button class="btn btn-primary btn-block" id="so-save">Save profile</button>`;
      host.innerHTML = "";
      host.appendChild(card);
      const view = card.querySelector(".so-view-me");
      if (view) view.addEventListener("click", () => NRB.go("user", { handle: p.handle }));
      card.querySelector("#so-save").addEventListener("click", async () => {
        const handle = card.querySelector("#so-handle").value.trim();
        const bio = card.querySelector("#so-bio").value.trim();
        const is_public = card.querySelector("#so-public").checked;
        const errEl = card.querySelector("#so-pe-err"); errEl.textContent = "";
        const btn = card.querySelector("#so-save"); btn.disabled = true;
        try {
          const r = await NRB.api("/api/me/profile", { method: "POST", body: { handle, bio, is_public } });
          if (r && r.ok) {
            NRB.toast("Profile saved.");
            if (r.handle != null) NRB.auth.setDisplay(r.handle);  // update header button + drawer
            if (NRB.authUI && NRB.authUI.refreshDrawer) NRB.authUI.refreshDrawer();
            this.mount(document.getElementById("view"));  // refresh
          } else { errEl.textContent = (r && r.error) || "Couldn't save."; }
        } catch (e) { errEl.textContent = "Can't reach the server."; }
        finally { btn.disabled = false; }
      });
    },
  };

  async function loadLeaderboard(body) {
    body.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    let data;
    try { data = await NRB.api("/api/leaderboard"); }
    catch (e) { body.innerHTML = `<p class="muted">Couldn't load the leaderboard.</p>`; return; }
    const leaders = (data && data.leaders) || [];
    if (!leaders.length) {
      body.innerHTML = `<div class="card so-empty-card"><p class="muted">No ranked forecasters yet — be the first. Make your profile public and grade a few bets.</p></div>`;
      return;
    }
    let sort = "roi";
    const render = () => {
      const sorted = [...leaders].sort((a, b) => {
        if (sort === "acc") return (a.brier ?? 9) - (b.brier ?? 9);       // lower Brier better
        if (sort === "net") return (b.net || 0) - (a.net || 0);
        return (b.roi ?? -9) - (a.roi ?? -9);
      });
      body.innerHTML = `
        <div class="so-lb-sorts">
          <button data-s="roi">ROI</button><button data-s="acc">Accuracy</button><button data-s="net">Net P&amp;L</button>
        </div>
        <div class="card so-lb">
          <table class="so-lb-table">
            <thead><tr><th>#</th><th>Forecaster</th><th class="tnum">Record ${NRB.help("record")}</th>
              <th class="tnum">ROI ${NRB.help("roi")}</th><th class="tnum">Win% ${NRB.help("win_rate")}</th><th class="tnum">Brier ${NRB.help("brier")}</th><th class="tnum">Net ${NRB.help("net_pnl")}</th></tr></thead>
            <tbody>${sorted.map((l, i) => `
              <tr>
                <td class="so-rank">${i + 1}</td>
                <td>${handleLink(l.handle)}${l.bio ? `<div class="so-lb-bio muted">${fmt.esc(l.bio)}</div>` : ""}</td>
                <td class="tnum">${l.wins}-${l.losses}</td>
                <td class="tnum ${fmt.cls(l.roi)}">${roiPct(l.roi)}</td>
                <td class="tnum">${pct(l.win_rate)}</td>
                <td class="tnum">${l.brier == null ? "—" : l.brier.toFixed(3)}</td>
                <td class="tnum ${fmt.cls(l.net)}">${fmt.signed(l.net)}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>`;
      body.querySelectorAll(".so-lb-sorts button").forEach((b) => {
        b.classList.toggle("active", b.dataset.s === sort);
        b.addEventListener("click", () => { sort = b.dataset.s; render(); });
      });
      body.querySelectorAll(".so-handle").forEach((a) =>
        a.addEventListener("click", () => NRB.go("user", { handle: a.dataset.handle })));
    };
    render();
  }

  async function loadFeed(body) {
    body.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    let data;
    try { data = await NRB.api("/api/feed"); }
    catch (e) { body.innerHTML = `<p class="muted">Couldn't load the feed.</p>`; return; }
    const bets = (data && data.bets) || [];
    if (!bets.length) {
      body.innerHTML = `<div class="card so-empty-card"><p class="muted">No public bets yet. Share one of yours from Your Activity to kick it off.</p></div>`;
      return;
    }
    body.innerHTML = `<div class="so-feed"></div>`;
    const feed = body.querySelector(".so-feed");
    bets.forEach((b) => feed.appendChild(betCard(b)));
  }

  // ---- public profile view ------------------------------------------------
  NRB.views.user = {
    async mount(container, params) {
      const handle = params && params.handle;
      container.innerHTML = `<div class="so-page"><div class="skeleton" style="height:220px"></div></div>`;
      if (!handle) { container.innerHTML = `<div class="so-page"><p class="muted">No profile.</p></div>`; return; }
      let p;
      try { p = await NRB.api("/api/u/" + encodeURIComponent(handle)); }
      catch (e) { p = null; }
      if (!p || p.error) {
        container.innerHTML = `<div class="so-page"><div class="card"><p class="muted">That profile is private or doesn't exist.</p></div></div>`;
        return;
      }
      const s = p.stats || {};
      const streak = (s.recent_results || []).map((r) =>
        `<span class="so-pip ${r ? "win" : "loss"}">${r ? "W" : "L"}</span>`).join("");
      const page = el(`<div class="so-page"></div>`);
      page.innerHTML = `
        <div class="so-profile card">
          <div class="so-profile-id">
            <div class="so-avatar">${fmt.esc((p.handle || "?").slice(0, 2).toUpperCase())}</div>
            <div>
              <h1>${fmt.esc(p.handle)}</h1>
              ${p.bio ? `<p class="muted">${fmt.esc(p.bio)}</p>` : ""}
            </div>
          </div>
          <div class="so-stats">
            <div class="so-stat"><label>Record ${NRB.help("record")}</label><span class="tnum">${s.wins || 0}-${s.losses || 0}</span></div>
            <div class="so-stat"><label>ROI ${NRB.help("roi")}</label><span class="tnum ${fmt.cls(s.roi)}">${roiPct(s.roi)}</span></div>
            <div class="so-stat"><label>Win rate ${NRB.help("win_rate")}</label><span class="tnum">${pct(s.win_rate)}</span></div>
            <div class="so-stat"><label>Brier ${NRB.help("brier")}</label><span class="tnum">${s.brier == null ? "—" : s.brier.toFixed(3)}</span></div>
            <div class="so-stat"><label>Net P&amp;L ${NRB.help("net_pnl")}</label><span class="tnum ${fmt.cls(s.net)}">${fmt.signed(s.net)}</span></div>
          </div>
          ${streak ? `<div class="so-streak"><label class="muted">Recent</label>${streak}</div>` : ""}
        </div>
        <h2 class="section-title">Public bets</h2>
        <div class="so-feed" id="so-userbets"></div>`;
      container.innerHTML = "";
      container.appendChild(page);
      const ub = page.querySelector("#so-userbets");
      const bets = p.bets || [];
      if (!bets.length) ub.innerHTML = `<p class="muted">No public bets shared yet.</p>`;
      else bets.forEach((b) => ub.appendChild(betCard(b)));
    },
  };
})();
