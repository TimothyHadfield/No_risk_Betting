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

  // The top "Your favorites" section = the specific markets the user has starred.
  function buildFavorites(allEvents) {
    const byTicker = {};
    allEvents.forEach((e) => { byTicker[e.event_ticker] = e; });
    const out = [];
    const seen = new Set();
    NRB.fav.list().forEach((t) => {
      const e = byTicker[t];
      if (e && !seen.has(t)) { seen.add(t); out.push(e); }
    });
    return out;
  }

  // "You may like": favoriting a category surfaces related categories to add.
  // Keys are section keys: league tickers (e.g. KXWCGAME) and "cat:<group>".
  const RELATED = {
    "KXWCGAME": ["cat:World Cup Teams", "cat:World Cup Players", "cat:Ballon d'Or"],
    "cat:World Cup Teams": ["cat:World Cup Players", "cat:Ballon d'Or", "KXWCGAME"],
    "cat:World Cup Players": ["cat:World Cup Teams", "cat:Ballon d'Or", "KXWCGAME"],
    "cat:Ballon d'Or": ["cat:World Cup Players", "cat:World Cup Teams"],
    "KXNBAGAME": ["cat:NBA Futures", "cat:WNBA Title"],
    "cat:NBA Futures": ["cat:WNBA Title", "KXNBAGAME"],
    "KXWNBAGAME": ["cat:WNBA Title", "cat:NBA Futures"],
    "cat:WNBA Title": ["KXWNBAGAME", "cat:NBA Futures"],
    "KXNFLGAME": ["cat:NFL Futures"],
    "cat:NFL Futures": ["KXNFLGAME"],
  };

  // Sections to suggest: related to something favorited, present in the feed,
  // and not already favorited or hidden.
  function buildSuggestions(rows) {
    const favSet = new Set(NRB.favCat.list());
    const hidSet = new Set(NRB.hiddenCat.list());
    const byKey = {};
    rows.forEach((r) => { byKey[r.key] = r; });
    const keys = [];
    const seen = new Set();
    favSet.forEach((fk) => (RELATED[fk] || []).forEach((rk) => {
      if (!seen.has(rk) && !favSet.has(rk) && !hidSet.has(rk) && byKey[rk]) {
        seen.add(rk); keys.push(rk);
      }
    }));
    return keys.map((k) => byKey[k]);
  }

  // A row of suggested-category cards (each favoritable / scroll-to).
  function youMayLikeEl(sections) {
    const wrap = NRB.el(
      `<section class="yml"><div class="yml-head"><h3>You may like</h3></div><div class="yml-row"></div></section>`);
    const row = wrap.querySelector(".yml-row");
    sections.forEach((s) => {
      const card = NRB.el(`<div class="yml-card"></div>`);
      card.innerHTML =
        `<div class="yml-name">${NRB.fmt.esc(NRB.fmt.title(s.title))}</div>
         <div class="yml-meta muted">${(s.events || []).length} market${(s.events || []).length === 1 ? "" : "s"}</div>
         <button class="yml-fav" type="button">★ Favorite</button>`;
      card.querySelector(".yml-fav").addEventListener("click", (e) => {
        e.stopPropagation();
        NRB.favCat.toggle(s.key);   // onChange re-renders: it floats up + leaves this list
      });
      card.addEventListener("click", (e) => {
        if (!e.target.closest(".yml-fav")) scrollToCarousel("sec-" + s.key);
      });
      row.appendChild(card);
    });
    return wrap;
  }

  const sectionBarEl = () => document.querySelector(".sectionbar");
  function showSectionBar(show) {
    const el = sectionBarEl(); if (el) el.style.display = show ? "" : "none";
  }

  // Float favorited categories to the top (just under "Your favorites"),
  // preserving the original relative order within each group.
  function reorderRows(rows) {
    const favSet = new Set(NRB.favCat.list());
    const special = [], favd = [], rest = [];
    rows.forEach((r) => {
      if (r.key === "favorites") special.push(r);
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

      this._sections = sections;
      this._allEvents = allEvents;
      this._container = container;
      this._renderRows();
      this._wireCatAdd();

      // re-render the feed live when a market or category is (un)favorited/hidden
      if (!this._catSubbed) {
        this._catSubbed = true;
        const onChange = () => {
          if (NRB.current.name === "browse" && this._sections) { this._renderRows(); refreshCatPanel(); }
        };
        NRB.favCat.onChange(onChange);
        NRB.hiddenCat.onChange(onChange);
        NRB.fav.onChange(onChange);
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
      if (!container || !this._sections) return;
      // Rebuild rows fresh: starred markets up top, then category sections.
      const favs = buildFavorites(this._allEvents || []);
      const baseRows = [];
      if (favs.length) baseRows.push({ key: "favorites", title: "★ Your favorites", events: favs });
      this._sections.forEach((s) => baseRows.push(s));
      // favorited categories float up; hidden categories drop out entirely
      const rows = reorderRows(baseRows)
        .filter((r) => r.key === "favorites" || !NRB.hiddenCat.has(r.key));
      const suggestions = buildSuggestions(rows);

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
      const ymlEl = suggestions.length ? youMayLikeEl(suggestions) : null;
      let ymlPlaced = false;
      rows.forEach((r) => {
        feed.appendChild(NRB.carousel(r.title, r.events, {
          id: "sec-" + r.key, favKey: r.key === "favorites" ? null : r.key,
        }));
        // surface "You may like" right under the favorites section
        if (ymlEl && !ymlPlaced && r.key === "favorites") { feed.appendChild(ymlEl); ymlPlaced = true; }
      });
      if (ymlEl && !ymlPlaced) feed.insertBefore(ymlEl, feed.firstChild);

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
