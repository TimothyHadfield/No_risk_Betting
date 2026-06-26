"use strict";
/* Home "For You" feed of carousels + section bar, and the Watchlist view.
   Owns: browse.js, browse.css. Uses the shared NRB runtime (box, carousel, fav,
   history, odds, icon). */
(function () {
  const $bar = () => document.getElementById("sectionbar");
  const TOP_OFFSET = 116; // topbar + section bar + a little breathing room

  function clearBar() { const b = $bar(); if (b) b.innerHTML = ""; }

  function scrollToCarousel(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - TOP_OFFSET;
    window.scrollTo({ top: y, behavior: "smooth" });
  }

  // Build the "For You" event list from favorites + recently-viewed categories.
  function buildForYou(allEvents) {
    const byTicker = {};
    allEvents.forEach((e) => { byTicker[e.event_ticker] = e; });
    const picked = [];
    const seen = new Set();
    const add = (e) => { if (e && !seen.has(e.event_ticker)) { seen.add(e.event_ticker); picked.push(e); } };
    NRB.fav.list().forEach((t) => add(byTicker[t]));            // 1) favorites
    NRB.history.recent(20).forEach((t) => add(byTicker[t]));    // 2) recently viewed
    const topCats = NRB.history.topCategories(4);               // 3) favorite categories
    if (topCats.length) {
      allEvents.forEach((e) => { if (picked.length < 16 && topCats.includes(e.category)) add(e); });
    }
    return picked.slice(0, 16);
  }

  const sectionBarEl = () => document.querySelector(".sectionbar");
  function showSectionBar(show) {
    const el = sectionBarEl(); if (el) el.style.display = show ? "" : "none";
  }

  // Float favorited categories to the top (just under "For You"), preserving the
  // original relative order within each group.
  function reorderRows(rows) {
    const favSet = new Set(NRB.favCat.list());
    const special = [], favd = [], rest = [];
    rows.forEach((r) => {
      if (r.key === "foryou") special.push(r);
      else if (favSet.has(r.key)) favd.push(r);
      else rest.push(r);
    });
    return [...special, ...favd, ...rest];
  }

  const browse = {
    _io: null,
    _searchTimer: null,
    _seq: 0,
    async mount(container) {
      container.innerHTML =
        `<button class="mybets-bar" id="mybets">
           <span class="mybets-l"><span class="mybets-ic">📊</span> My Bets</span>
           <span class="mybets-r" id="mybets-sum">—</span>
         </button>
         <div class="browse-search">
           <input id="b-search" type="search" placeholder="Search markets, teams, players…">
         </div>
         <div id="results" class="browse-grid" hidden></div>
         <div class="browse-feed" id="feed">${skeletonCarousels(3)}</div>`;

      // "My Bets" bar -> the bets screen, with a quick open/unrealized summary
      const bar = container.querySelector("#mybets");
      bar.addEventListener("click", () => NRB.go("portfolio"));
      NRB.api("/api/bets").then((d) => {
        const sum = container.querySelector("#mybets-sum");
        if (!sum) return;
        const bets = d.bets || [];
        const open = bets.filter((b) => b.status === "open");
        if (!bets.length) { sum.textContent = "No bets yet ›"; return; }
        const unreal = open.reduce((s, b) => s + (b.unrealized_pnl || 0), 0);
        sum.innerHTML = open.length
          ? `${open.length} open · <span class="${NRB.fmt.cls(unreal)}">${NRB.fmt.signed(unreal)}</span> ›`
          : `${bets.length} settled ›`;
      }).catch(() => {});

      // search wiring
      const input = container.querySelector("#b-search");
      const results = container.querySelector("#results");
      const runSearch = async () => {
        const q = input.value.trim();
        const feed = container.querySelector("#feed");
        if (!q) { results.hidden = true; results.innerHTML = ""; feed.hidden = false; showSectionBar(true); return; }
        const my = ++this._seq;
        feed.hidden = true; showSectionBar(false);
        results.hidden = false; results.innerHTML = skeletonBoxes(6);
        const data = await NRB.api("/api/markets?limit=40&q=" + encodeURIComponent(q));
        if (my !== this._seq || NRB.current.name !== "browse") return;
        const evs = data.events || [];
        results.innerHTML = "";
        if (!evs.length) {
          results.innerHTML = `<div class="browse-empty">No markets match “${NRB.fmt.esc(q)}”.</div>`;
          return;
        }
        evs.forEach((e) => results.appendChild(NRB.box(e)));
      };
      input.addEventListener("input", () => {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(runSearch, 250);
      });

      const data = await NRB.api("/api/home");
      if (data.loading) {
        setTimeout(() => { if (NRB.current.name === "browse") browse.mount(container); }, 1500);
        return;
      }
      const sections = data.sections || [];
      const allEvents = [];
      sections.forEach((s) => (s.events || []).forEach((e) => allEvents.push(e)));

      const forYou = buildForYou(allEvents);
      const rows = [];
      if (forYou.length) rows.push({ key: "foryou", title: "⭐ For You", events: forYou });
      sections.forEach((s) => rows.push(s));

      this._rows = rows;
      this._container = container;
      this._renderRows();
      this._wireCatAdd();

      // re-render the feed live when a category is (un)favorited or (un)hidden
      if (!this._catSubbed) {
        this._catSubbed = true;
        const onCatChange = () => {
          if (NRB.current.name === "browse" && this._rows) { this._renderRows(); refreshCatPanel(); }
        };
        NRB.favCat.onChange(onCatChange);
        NRB.hiddenCat.onChange(onCatChange);
      }
    },

    // Show + wire the "+" (re-add categories) button in the section bar.
    _wireCatAdd() {
      const btn = document.getElementById("cat-add");
      if (!btn) return;
      btn.hidden = false;
      if (!btn._wired) {
        btn._wired = true;
        btn.addEventListener("click", (e) => { e.stopPropagation(); toggleCatPanel(btn); });
      }
    },

    // Render the section bar + carousel feed from this._rows, with favorited
    // categories floated to the top. Re-runnable (used on favorite toggle).
    _renderRows() {
      const container = this._container;
      if (!container) return;
      // favorites float up; hidden categories drop out of the feed entirely
      const rows = reorderRows(this._rows)
        .filter((r) => r.key === "foryou" || !NRB.hiddenCat.has(r.key));

      const secbar = $bar();
      if (secbar) {
        secbar.innerHTML = rows.map((r, i) =>
          `<button class="chip ${i === 0 ? "active" : ""}" data-target="sec-${r.key}">${NRB.fmt.esc(NRB.fmt.title(r.title))}</button>`
        ).join("");
        secbar.querySelectorAll(".chip").forEach((c) =>
          c.addEventListener("click", () => {
            secbar.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
            c.classList.add("active");
            c.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
            scrollToCarousel(c.dataset.target);
          }));
      }

      const feed = container.querySelector("#feed") || container;
      feed.innerHTML = "";
      rows.forEach((r) => feed.appendChild(NRB.carousel(r.title, r.events, {
        id: "sec-" + r.key, favKey: r.key === "foryou" ? null : r.key,
      })));

      // scroll-spy: highlight the chip for the carousel nearest the top
      if (this._io) this._io.disconnect();
      this._io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            const id = en.target.id;
            if (secbar) secbar.querySelectorAll(".chip").forEach((x) =>
              x.classList.toggle("active", x.dataset.target === id));
          }
        });
      }, { rootMargin: `-${TOP_OFFSET}px 0px -70% 0px`, threshold: 0 });
      feed.querySelectorAll(".carousel").forEach((c) => this._io.observe(c));
    },
    unmount() {
      if (this._io) { this._io.disconnect(); this._io = null; }
      closeCatPanel();
      const btn = document.getElementById("cat-add");
      if (btn) btn.hidden = true;
      clearBar();
    },
  };
  NRB.views.browse = browse;

  // ---- "+" re-add hidden categories popover --------------------------------
  function titleForKey(key) {
    const r = (browse._rows || []).find((x) => x.key === key);
    return r ? NRB.fmt.title(r.title) : key.replace(/^cat:/, "");
  }

  function renderCatPanel(panel) {
    const hidden = NRB.hiddenCat.list();
    panel.innerHTML =
      `<div class="cat-panel-h">Hidden categories</div>` +
      (hidden.length
        ? `<div class="cat-panel-list">${hidden.map((k) =>
            `<button class="cat-panel-item" data-key="${NRB.fmt.esc(k)}">
               <span>${NRB.fmt.esc(titleForKey(k))}</span><span class="cat-panel-add">+ Add</span>
             </button>`).join("")}</div>`
        : `<div class="cat-panel-empty">No hidden categories.<br>Tap ✕ on any category header to hide it.</div>`);
    panel.querySelectorAll(".cat-panel-item").forEach((it) =>
      it.addEventListener("click", (e) => {
        e.stopPropagation();
        NRB.hiddenCat.remove(it.dataset.key);   // onChange re-renders feed + this panel
      }));
  }

  function refreshCatPanel() {
    const panel = document.getElementById("cat-panel");
    if (panel) renderCatPanel(panel);
  }

  function onCatPanelDocClick(e) {
    if (e.target.closest("#cat-panel") || e.target.closest("#cat-add")) return;
    closeCatPanel();
  }

  function closeCatPanel() {
    const panel = document.getElementById("cat-panel");
    if (panel) panel.remove();
    document.removeEventListener("click", onCatPanelDocClick);
    window.removeEventListener("scroll", closeCatPanel, true);
  }

  function toggleCatPanel(btn) {
    if (document.getElementById("cat-panel")) { closeCatPanel(); return; }
    const row = document.querySelector(".sectionbar-row");
    if (!row) return;
    const panel = NRB.el(`<div class="cat-panel" id="cat-panel"></div>`);
    renderCatPanel(panel);
    row.appendChild(panel);
    setTimeout(() => {
      document.addEventListener("click", onCatPanelDocClick);
      window.addEventListener("scroll", closeCatPanel, true);
    }, 0);
  }

  // ---- Watchlist view ------------------------------------------------------
  NRB.views.watchlist = {
    async mount(container) {
      clearBar();
      const favs = NRB.fav.list();
      container.innerHTML = `<div class="browse-page">
        <h2 class="browse-h">⭐ Watchlist</h2>
        <div id="wl" class="browse-grid">${favs.length ? skeletonBoxes(4) : ""}</div></div>`;
      if (!favs.length) {
        container.querySelector("#wl").innerHTML =
          `<div class="browse-empty">No favorites yet.<br>
             Tap the ☆ on any market to add it here.
             <div style="margin-top:14px"><button class="btn btn-primary" id="wl-go">Browse markets</button></div></div>`;
        container.querySelector("#wl-go").addEventListener("click", () => NRB.go("browse"));
        return;
      }
      const data = await NRB.api("/api/home");
      const map = {};
      (data.sections || []).forEach((s) => (s.events || []).forEach((e) => { map[e.event_ticker] = e; }));
      const grid = container.querySelector("#wl");
      grid.innerHTML = "";
      let found = 0;
      favs.forEach((t) => { if (map[t]) { grid.appendChild(NRB.box(map[t])); found++; } });
      if (!found) grid.innerHTML = `<div class="browse-empty">Your favorited markets aren't in the
        current live feed right now (they may have closed or aren't trending).</div>`;
    },
    unmount() {},
  };

  // ---- skeletons -----------------------------------------------------------
  function skeletonBoxes(n) {
    return Array.from({ length: n }, () => `<div class="skeleton" style="height:150px;border-radius:14px"></div>`).join("");
  }
  function skeletonCarousels(n) {
    return Array.from({ length: n }, () => `
      <section class="carousel">
        <div class="carousel-head"><div class="skeleton" style="height:18px;width:140px"></div></div>
        <div class="carousel-track">
          ${Array.from({ length: 4 }, () => `<div class="skeleton box" style="height:150px"></div>`).join("")}
        </div>
      </section>`).join("");
  }
})();
