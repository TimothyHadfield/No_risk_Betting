"use strict";
/*
 * Forecasting Score / Profile view.
 * The point of this app: it measures forecasting SKILL (are your probability
 * calls RIGHT?), not gambling luck — and quietly reminds you that betting real
 * money is financially irresponsible. Owns ONLY: profile.js + profile.css.
 * Register: NRB.views.profile = { mount, unmount }.
 */
(function () {
  const NRB = window.NRB;
  const { fmt } = NRB;

  // dark chart constants (mirror styles.css tokens / analytics.js)
  const C_MINT = "#27d18b"; // --accent / --up
  const C_GRID = "#232b38"; // --border
  const C_TICK = "#8b95a6"; // --muted
  const FONT = '"Inter", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const fmt3 = (n) => (n == null || isNaN(n) ? "—" : Number(n).toFixed(3));
  const pct1 = (n) => (n == null || isNaN(n) ? "—" : (Number(n) * 100).toFixed(1) + "%");

  // qualitative skill label from a Brier score (lower = sharper)
  function brierLabel(b) {
    if (b == null || isNaN(b)) return { text: "—", cls: "" };
    if (b < 0.18) return { text: "Sharp", cls: "prof-tag-sharp" };
    if (b < 0.25) return { text: "Decent", cls: "prof-tag-decent" };
    return { text: "Needs work", cls: "prof-tag-weak" };
  }

  function metric(label, value, cls, hint, helpKey) {
    return `
      <div class="card prof-metric">
        <div class="prof-metric-label">${fmt.esc(label)}${helpKey ? NRB.help(helpKey) : ""}</div>
        <div class="prof-metric-value tnum ${cls || ""}">${value}</div>
        ${hint ? `<div class="prof-metric-hint muted">${fmt.esc(hint)}</div>` : ""}
      </div>`;
  }

  NRB.views.profile = {
    _calChart: null,
    _fcalChart: null,
    _eqChart: null,

    async mount(container) {
      container.innerHTML = `
        <div class="prof">
          <header class="prof-head">
            <h1 class="prof-title">Forecasting Score</h1>
            <p class="prof-sub muted">
              This measures whether your probability calls are actually
              <strong>right</strong> — your forecasting skill — not whether you
              got lucky on a bet.
            </p>
          </header>

          <div id="prof-season" class="prof-season"></div>

          <div id="prof-hero">
            <div class="card prof-hero prof-hero-loading">
              <div class="skeleton" style="height:120px"></div>
            </div>
          </div>

          <div id="prof-body" class="hidden">
            <!-- Reality check -->
            <h2 class="section-title prof-sec">If this were real money…</h2>
            <div class="card prof-reality" id="prof-reality"></div>
            <p class="prof-note muted">
              No real money is ever at stake here — that's the point. Sports
              betting is a fast way to lose money; treat this as a skill gym, not
              a sportsbook.
            </p>

            <!-- Recent form -->
            <h2 class="section-title prof-sec">Recent form</h2>
            <div class="card prof-form" id="prof-form"></div>

            <!-- Calibration -->
            <h2 class="section-title prof-sec">Calibration</h2>
            <div class="card prof-chartcard">
              <div class="prof-chartwrap"><canvas id="prof-cal"></canvas></div>
              <p class="prof-explain muted">
                When you said something had an X% chance, did it happen about X%
                of the time? Points hugging the dashed diagonal mean your
                probabilities are honest. Bigger dots = more bets.
              </p>
            </div>

            <!-- Skill by category -->
            <h2 class="section-title prof-sec">Skill by category</h2>
            <div id="prof-cats"></div>

            <!-- You vs the Market (predict-then-bet) -->
            <div id="prof-vs"></div>

            <!-- Equity -->
            <h2 class="section-title prof-sec">Virtual equity over time</h2>
            <div class="card prof-chartcard">
              <div class="prof-chartwrap prof-chartwrap-sm"><canvas id="prof-eq"></canvas></div>
            </div>
          </div>
        </div>`;

      this._season = "";
      const seasonHost = container.querySelector("#prof-season");
      NRB.seasonPicker(seasonHost, (val) => { this._season = val; this.load(); });
      await this.load();
    },

    async load() {
      let a;
      try {
        const url = "/api/analytics" +
          (this._season ? "?season=" + encodeURIComponent(this._season) : "");
        a = await NRB.api(url);
      } catch (e) {
        const hero = document.getElementById("prof-hero");
        if (hero) {
          hero.innerHTML = `<div class="card prof-hero"><div class="prof-hero-read muted">Couldn't load your score. Try again later.</div></div>`;
        }
        return;
      }
      if (!document.getElementById("prof-hero")) return; // unmounted mid-flight

      this.renderHero(a);

      // Empty state: nothing scored yet → hero shows the CTA, hide the rest.
      if (!a.n_scored) return;

      const body = document.getElementById("prof-body");
      if (body) body.classList.remove("hidden");

      this.renderReality(a);
      this.renderForm(a.recent_results || []);
      this.renderCategories(a.by_category || []);
      this.renderCalibration(a.calibration || []);
      this.renderVsMarket(a.forecast);
      this.renderEquity(a.equity_history || []);
    },

    renderVsMarket(f) {
      const wrap = document.getElementById("prof-vs");
      if (!wrap) return;

      // Unobtrusive: nothing logged yet → small muted nudge, no empty charts.
      if (!f || !f.n) {
        wrap.innerHTML = `
          <p class="prof-vs-hint muted">
            Try Predict-then-bet: log your own odds before betting to see if you
            beat the market.
          </p>`;
        return;
      }

      const beating = f.your_brier != null && f.market_brier != null && f.your_brier < f.market_brier;
      const verdict = beating ? "You're beating the market" : "The market's been sharper";
      const verdictCls = beating ? "pos" : "neg";
      const beatPct = f.beat_rate == null ? "—" : Math.round(Number(f.beat_rate) * 100) + "%";

      const valueRow = (label, roi, count, hint) => `
        <div class="prof-value-row">
          <div class="prof-value-lbl">${fmt.esc(label)}</div>
          <div class="prof-value-roi tnum ${fmt.cls(roi)}">${pct1(roi)}</div>
          <div class="prof-value-meta muted tnum">${count == null ? "" : "n=" + fmt.esc(String(count))}</div>
        </div>`;

      const hasCal = (f.calibration || []).some((b) => b && b.n > 0 && b.predicted != null && b.actual != null);

      wrap.innerHTML = `
        <h2 class="section-title prof-sec">You vs the Market</h2>
        <div class="card prof-vs">
          <div class="prof-vs-briers">
            <div class="prof-vs-brier">
              <div class="prof-vs-brier-lbl muted">Your Brier</div>
              <div class="prof-vs-brier-val tnum ${beating ? "pos" : ""}">${fmt3(f.your_brier)}</div>
            </div>
            <div class="prof-vs-sep muted">vs</div>
            <div class="prof-vs-brier">
              <div class="prof-vs-brier-lbl muted">Market Brier</div>
              <div class="prof-vs-brier-val tnum ${beating ? "" : "pos"}">${fmt3(f.market_brier)}</div>
            </div>
          </div>
          <div class="prof-vs-verdict ${verdictCls}">${verdict}</div>
          <div class="prof-vs-beat muted">
            Beat the market on <strong class="${beating ? "pos" : ""}">${beatPct}</strong>
            of calls (n=${fmt.esc(String(f.n))})
          </div>

          <div class="prof-value">
            <div class="prof-value-head section-title">Value bets vs the rest</div>
            ${valueRow("Saw value (your prob > market)", f.value_roi, f.value_n)}
            ${valueRow("No edge (your prob ≤ market)", f.novalue_roi, f.novalue_n)}
          </div>
        </div>

        ${hasCal ? `
          <h2 class="section-title prof-sec">Your forecast calibration</h2>
          <div class="card prof-chartcard">
            <div class="prof-chartwrap"><canvas id="prof-fcal"></canvas></div>
            <p class="prof-explain muted">
              Built from the probabilities YOU logged before betting. Points on the
              dashed diagonal mean your own forecasts are well-calibrated.
            </p>
          </div>` : ""}`;

      if (hasCal) this.renderForecastCalibration(f.calibration || []);
    },

    renderForecastCalibration(buckets) {
      const cv = document.getElementById("prof-fcal");
      if (!cv || !window.Chart) return;
      this._fcalChart = buildCalibrationChart(cv, buckets);
    },

    renderHero(a) {
      const hero = document.getElementById("prof-hero");
      if (!hero) return;

      if (!a.n_scored) {
        hero.innerHTML = `
          <div class="card prof-hero prof-hero-empty">
            <div class="prof-hero-emoji">🎯</div>
            <div class="prof-hero-big">No score yet</div>
            <div class="prof-hero-read muted">
              Place &amp; settle some bets to build your score — then we'll grade
              how sharp your probability calls really are.
            </div>
            <button class="btn btn-primary" id="prof-browse">Browse markets</button>
          </div>`;
        const b = document.getElementById("prof-browse");
        if (b) b.addEventListener("click", () => NRB.go("browse"));
        return;
      }

      const lab = brierLabel(a.brier);
      hero.innerHTML = `
        <div class="card prof-hero">
          <div class="prof-hero-cap section-title">Your Brier score ${NRB.help("brier")}</div>
          <div class="prof-hero-row">
            <div class="prof-hero-big tnum">${fmt3(a.brier)}</div>
            <span class="prof-tag ${lab.cls}">${lab.text}</span>
          </div>
          <div class="prof-hero-read muted">
            lower = sharper · 0.25 = a coin flip · 0 = perfect
          </div>
          <div class="prof-hero-scale">
            <div class="prof-hero-scalebar"></div>
            <div class="prof-hero-marker" style="left:${heroMarker(a.brier)}%"></div>
          </div>
          <div class="prof-hero-meta muted tnum">
            Based on ${fmt.esc(String(a.n_scored))} settled call${a.n_scored === 1 ? "" : "s"}
            · log loss ${fmt3(a.log_loss)}
          </div>
        </div>`;
    },

    renderReality(a) {
      const wrap = document.getElementById("prof-reality");
      if (!wrap) return;
      const acct = a.account || {};
      const eqArr = a.equity_history || [];
      const equity = eqArr.length ? eqArr[eqArr.length - 1].equity : acct.balance;
      const start = acct.starting;
      const eqDelta = equity != null && start != null ? equity - start : null;

      wrap.innerHTML = `
        <div class="prof-metrics">
          ${metric("Realized P&L", fmt.signed(a.realized_pnl), fmt.cls(a.realized_pnl), "if these bets were real", "realized_pnl")}
          ${metric("ROI", pct1(a.roi), fmt.cls(a.roi), "return on what you wagered", "roi")}
          ${metric("Total wagered", fmt.usd(a.invested), "", "money you'd have put at risk", "stake")}
          ${metric(
            "Equity vs start",
            (eqDelta == null ? "—" : fmt.signed(eqDelta)),
            fmt.cls(eqDelta),
            (equity == null ? "" : fmt.usd(equity) + " from " + fmt.usd(start))
          )}
        </div>`;
    },

    renderForm(results) {
      const wrap = document.getElementById("prof-form");
      if (!wrap) return;

      if (!results.length) {
        wrap.innerHTML = `<div class="prof-form-empty muted">No settled results yet.</div>`;
        return;
      }

      // results: most-recent first. Streak = run of equal values from the front.
      const head = results[0];
      let streak = 0;
      for (const r of results) { if (r === head) streak++; else break; }
      const streakWord = head ? "win" : "loss";

      const chips = results
        .slice(0, 40)
        .map((r) =>
          r
            ? `<span class="prof-chip prof-chip-w" title="Won">W</span>`
            : `<span class="prof-chip prof-chip-l" title="Lost">L</span>`
        )
        .join("");

      wrap.innerHTML = `
        <div class="prof-streak">
          <span class="prof-streak-num tnum ${head ? "pos" : "neg"}">${streak}</span>
          <span class="prof-streak-lbl muted">${streakWord}${streak === 1 ? "" : "s"} in a row</span>
        </div>
        <div class="prof-chips">${chips}</div>`;
    },

    renderCategories(cats) {
      const wrap = document.getElementById("prof-cats");
      if (!wrap) return;

      const scored = cats.filter((c) => c && (c.n_scored || c.n));
      if (!scored.length) {
        wrap.innerHTML = `<div class="card prof-cats-empty muted">Not enough category history yet.</div>`;
        return;
      }

      // Sharpest = lowest Brier among categories that have a Brier.
      let best = null;
      for (const c of scored) {
        if (c.brier == null || isNaN(c.brier)) continue;
        if (!best || c.brier < best.brier) best = c;
      }

      const rows = cats
        .map((c) => {
          const lab = brierLabel(c.brier);
          const isBest = best && c.category === best.category;
          return `
            <div class="prof-cat-row ${isBest ? "prof-cat-best" : ""}">
              <div class="prof-cat-name">
                ${isBest ? `<span class="prof-cat-star" title="Sharpest">★</span>` : ""}
                ${fmt.esc(c.category)}
              </div>
              <div class="prof-cat-n tnum muted">${fmt.esc(String(c.n || 0))}</div>
              <div class="prof-cat-win tnum">${pct1(c.win_rate)}</div>
              <div class="prof-cat-brier tnum">${fmt3(c.brier)}</div>
              <div class="prof-cat-pnl tnum ${fmt.cls(c.realized_pnl)}">${fmt.signed(c.realized_pnl)}</div>
              <div class="prof-cat-tag"><span class="prof-tag ${lab.cls}">${lab.text}</span></div>
            </div>`;
        })
        .join("");

      wrap.innerHTML = `
        ${best ? `<div class="prof-best-banner">Sharpest: <strong>${fmt.esc(best.category)}</strong> · Brier ${fmt3(best.brier)}</div>` : ""}
        <div class="card prof-cats">
          <div class="prof-cat-row prof-cat-headrow">
            <div class="prof-cat-name">Category</div>
            <div class="prof-cat-n">Bets</div>
            <div class="prof-cat-win">Win&nbsp;%</div>
            <div class="prof-cat-brier">Brier</div>
            <div class="prof-cat-pnl">P&amp;L</div>
            <div class="prof-cat-tag">Skill</div>
          </div>
          ${rows}
        </div>`;
    },

    renderCalibration(buckets) {
      const cv = document.getElementById("prof-cal");
      if (!cv || !window.Chart) return;
      this._calChart = buildCalibrationChart(cv, buckets);
    },

    renderEquity(history) {
      const cv = document.getElementById("prof-eq");
      if (!cv || !window.Chart) return;

      const labels = history.map((p) => new Date(p.ts * 1000).toLocaleTimeString());
      const values = history.map((p) => p.equity);

      const ctx = cv.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 230);
      grad.addColorStop(0, "rgba(39,209,139,.22)");
      grad.addColorStop(1, "rgba(39,209,139,0)");

      this._eqChart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Equity",
              data: values,
              borderColor: C_MINT,
              backgroundColor: grad,
              borderWidth: 2,
              fill: true,
              tension: 0.25,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: C_MINT,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => " " + fmt.usd(ctx.parsed.y) } },
          },
          scales: {
            x: {
              grid: { color: C_GRID },
              ticks: { color: C_TICK, font: { family: FONT }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            },
            y: {
              grid: { color: C_GRID },
              ticks: { color: C_TICK, font: { family: FONT }, callback: (v) => fmt.usd(v) },
            },
          },
        },
      });
    },

    unmount() {
      if (this._calChart) { this._calChart.destroy(); this._calChart = null; }
      if (this._fcalChart) { this._fcalChart.destroy(); this._fcalChart = null; }
      if (this._eqChart) { this._eqChart.destroy(); this._eqChart = null; }
    },
  };

  // Shared calibration scatter: predicted% vs actual%, dashed diagonal ref,
  // point size ∝ bucket n. Dark styling. Returns the Chart instance.
  function buildCalibrationChart(cv, buckets) {
    const pts = (buckets || [])
      .filter((b) => b && b.n > 0 && b.predicted != null && b.actual != null)
      .map((b) => ({
        x: b.predicted * 100,
        y: b.actual * 100,
        n: b.n,
        r: Math.max(4, Math.min(20, 4 + Math.sqrt(b.n) * 2.5)),
      }));

    return new Chart(cv.getContext("2d"), {
      type: "scatter",
      data: {
        datasets: [
          {
            type: "line",
            label: "Perfect",
            data: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
            borderColor: C_TICK,
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            order: 2,
          },
          {
            label: "Your buckets",
            data: pts,
            backgroundColor: "rgba(39,209,139,.55)",
            borderColor: C_MINT,
            borderWidth: 1.5,
            pointRadius: (ctx) => (ctx.raw && ctx.raw.r) || 5,
            pointHoverRadius: (ctx) => ((ctx.raw && ctx.raw.r) || 5) + 2,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === 1,
            callbacks: {
              label: (ctx) => {
                const d = ctx.raw;
                return `predicted ${Math.round(d.x)}% → actually ${Math.round(d.y)}% (n=${d.n})`;
              },
            },
          },
        },
        scales: {
          x: {
            min: 0, max: 100,
            title: { display: true, text: "You predicted (%)", color: C_TICK, font: { family: FONT } },
            grid: { color: C_GRID },
            ticks: { color: C_TICK, font: { family: FONT } },
          },
          y: {
            min: 0, max: 100,
            title: { display: true, text: "Actually happened (%)", color: C_TICK, font: { family: FONT } },
            grid: { color: C_GRID },
            ticks: { color: C_TICK, font: { family: FONT } },
          },
        },
      },
    });
  }

  // Map a Brier score onto a 0–100% position on the hero scale bar.
  // 0 (perfect) = far right (100%), 0.5+ (worse than a coin flip) = far left.
  function heroMarker(b) {
    if (b == null || isNaN(b)) return 0;
    const clamped = Math.max(0, Math.min(0.5, b));
    return Math.round((1 - clamped / 0.5) * 100);
  }
})();
