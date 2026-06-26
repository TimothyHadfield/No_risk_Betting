# No-Risk Betting

A **local, personal** paper-trading tool for prediction markets. It shows the
**real, live odds from Kalshi** and lets you place **fake** bets with a virtual
balance — so you can follow markets and test your forecasting *without risking a
cent*.

Because your bets live only in this app's local database and are never sent to
Kalshi, they can't move the real order book. For small bets on liquid markets,
the outcome is **theoretically identical to betting real money** — which is the
whole point.

## Why this is better than typical "demo" betting apps

- **Real odds, not a sandbox.** Kalshi's own demo uses a separate order book with
  divergent prices; many "fake betting" apps use mock or no-vig odds. This reads
  Kalshi's *production* market data.
- **Honest fills.** Bets walk the real live order book (consuming price levels)
  and apply Kalshi's trading fee — not an unrealistic instant fill at the best
  price. Thin books give partial fills, flagged clearly.
- **Forecasting-skill analytics.** The headline feature: **Brier score, log-loss,
  and a calibration curve** — these measure whether you're actually *right*, not
  just lucky. Almost no competitor offers this.

## Requirements

- **Python 3** (uses only the standard library — nothing to `pip install`).
- An internet connection (to read Kalshi's public market data).

## Run

```sh
python server.py
```

Then open <http://localhost:8765>. The first few seconds load live markets in the
background.

- **Browse** — categories + search over live Kalshi markets; click YES/NO to bet.
- **Portfolio** — open positions with live mark-to-market P&L; "Sell" to close,
  "Settle▸" is a demo helper to settle a market immediately at a chosen outcome.
- **Analytics** — P&L/ROI plus Brier, log-loss, and your calibration curve.

Data persists in `data.db` (SQLite). Use **Reset** in the header to wipe bets and
restore the $1,000 virtual balance.

## ⚠️ Important: data terms & scope

Kalshi's **Data Terms of Use** restrict publicly displaying / redistributing /
scraping their market data without written consent. **This tool is for private,
personal use on your own machine.** Do **not** deploy it publicly or share its
data feed without first obtaining permission / a data license from Kalshi.

This is a personal tool for responsible, no-money market-watching — not betting
advice, and not affiliated with Kalshi.

## Files

| File | Role |
|------|------|
| `server.py` | HTTP server: serves the UI, JSON API, background polling/settlement |
| `kalshi.py` | Kalshi market-data adapter (the swap point for adding Polymarket) |
| `fills.py` | Order-book-walk fill simulation + Kalshi fee model |
| `analytics.py` | Brier / log-loss / calibration |
| `db.py` | SQLite persistence (virtual balance, bets, equity history) |
| `index.html` / `app.js` / `styles.css` | Single-page frontend |
