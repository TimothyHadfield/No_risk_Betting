"use strict";
/*
 * Analytics view — metric cards + calibration scatter + equity line chart.
 * Owned by Portfolio/Analytics agent. See BUILD_SPEC.md.
 */
(function () {
  const NRB = window.NRB;
  const { fmt } = NRB;

  // dark theme constants (mirrors styles.css tokens)
  const C_MINT = "#27d18b"; // --accent
  const C_UP = "#27d18b";   // --up
  const C_DOWN = "#fb5a6a"; // --down
  const C_GRID = "#232b38"; // --border
  const C_TICK = "#8b95a6"; // --muted
  const FONT = '"Inter", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  function fmt3(n) {
    return n == null || isNaN(n) ? "—" : Number(n).toFixed(3);
  }

  function metricCard(label, value, cls, hint) {
    return `
      <div class="card an-metric">
        <div class="an-metric-label">${fmt.esc(label)}</div>
        <div class="an-metric-value tnum ${cls || ""}">${value}</div>
        ${hint ? `<div class="an-metric-hint muted">${fmt.esc(hint)}</div>` : ""}
      </div>`;
  }

  NRB.views.analytics = {
    _calChart: null,
    _eqChart: null,

    async mount(container, params) {
      container.innerHTML = `
        <div class="an">
          <div id="an-season" class="prof-season"></div>
          <h2 class="section-title">Performance</h2>
          <div class="an-metrics" id="an-metrics">
            <div class="skeleton" style="height:96px"></div>
            <div class="skeleton" style="height:96px"></div>
            <div class="skeleton" style="height:96px"></div>
            <div class="skeleton" style="height:96px"></div>
            <div class="skeleton" style="height:96px"></div>
            <div class="skeleton" style="height:96px"></div>
          </div>

          <h2 class="section-title">Calibration</h2>
          <div class="card an-chartcard">
            <p class="an-explain muted">
              When you bet at a given probability, how often did it actually happen?
              Points on the dashed diagonal mean you're well-calibrated.
            </p>
            <div class="an-chartwrap"><canvas id="an-cal"></canvas></div>
          </div>

          <h2 class="section-title">Equity over time</h2>
          <div class="card an-chartcard">
            <div class="an-chartwrap"><canvas id="an-eq"></canvas></div>
          </div>
        </div>`;

      this._season = "";
      const seasonHost = container.querySelector("#an-season");
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
        const m = document.getElementById("an-metrics");
        if (m) m.innerHTML = `<div class="card an-metric"><div class="an-metric-label muted">Couldn't load analytics.</div></div>`;
        return;
      }
      if (!document.getElementById("an-metrics")) return; // unmounted

      this.renderMetrics(a);
      this.renderCalibration(a.calibration || []);
      this.renderEquity(a.equity_history || []);
    },

    renderMetrics(a) {
      const wrap = document.getElementById("an-metrics");
      if (!wrap) return;
      const roi = a.roi == null ? "—" : (Number(a.roi) * 100).toFixed(1) + "%";
      const win = a.win_rate == null ? "—" : (Number(a.win_rate) * 100).toFixed(1) + "%";
      wrap.innerHTML =
        metricCard("Realized P&L", fmt.signed(a.realized_pnl), fmt.cls(a.realized_pnl)) +
        metricCard("ROI", roi, fmt.cls(a.roi)) +
        metricCard("Win rate", win) +
        metricCard("Brier score", fmt3(a.brier), "", "lower = sharper · 0.25 = coin flip") +
        metricCard("Log loss", fmt3(a.log_loss), "", "punishes confident misses") +
        metricCard("Bets scored", a.n_scored == null ? "—" : String(a.n_scored), "", "resolved by real outcome");
    },

    renderCalibration(buckets) {
      const cv = document.getElementById("an-cal");
      if (!cv || !window.Chart) return;

      const pts = buckets
        .filter((b) => b && b.n > 0 && b.predicted != null && b.actual != null)
        .map((b) => ({
          x: b.predicted * 100,
          y: b.actual * 100,
          n: b.n,
          r: Math.max(4, Math.min(20, 4 + Math.sqrt(b.n) * 2.5)),
        }));

      this._calChart = new Chart(cv.getContext("2d"), {
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
    },

    renderEquity(history) {
      const cv = document.getElementById("an-eq");
      if (!cv || !window.Chart) return;

      const labels = history.map((p) => new Date(p.ts * 1000).toLocaleTimeString());
      const values = history.map((p) => p.equity);

      const ctx = cv.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 260);
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
              borderColor: C_UP,
              backgroundColor: grad,
              borderWidth: 2,
              fill: true,
              tension: 0.25,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: C_UP,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: { label: (ctx) => " " + fmt.usd(ctx.parsed.y) },
            },
          },
          scales: {
            x: {
              grid: { color: C_GRID },
              ticks: { color: C_TICK, font: { family: FONT }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            },
            y: {
              grid: { color: C_GRID },
              ticks: {
                color: C_TICK,
                font: { family: FONT },
                callback: (v) => fmt.usd(v),
              },
            },
          },
        },
      });
    },

    unmount() {
      if (this._calChart) { this._calChart.destroy(); this._calChart = null; }
      if (this._eqChart) { this._eqChart.destroy(); this._eqChart = null; }
    },
  };
})();
