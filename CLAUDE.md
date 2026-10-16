# No-Risk Betting

A free, fake-money betting site on real Kalshi odds, built as a harm-reduction and
forecasting-skill tool. Live: https://no-risk-betting.onrender.com

Read `PROGRESS.md` first (START HERE, Standing instructions, Traps, Rejected). It is the
handoff file and wins over this one. Session log: `chat.md`. Old detail: `docs/archive/`.

## Stack (verified from code)
- Backend: `server.py`, Python standard library only (`ThreadingHTTPServer`), no framework.
  `fills.py` = order-book walk + Kalshi fee, `analytics.py` = Brier / log-loss / calibration,
  `kalshi.py` = Kalshi public API (no key), `espn.py` = ESPN scoreboard, `mailer.py` = reset email.
- Database: `db.py`. SQLite file (`NRB_DB`, default `data.db`, git-ignored) unless
  `DATABASE_URL` is set, then Postgres via `psycopg2-binary` (the only dependency).
  One SQL set; `_q()` translates `?` placeholders; `_with_retry` reconnects on idle drops.
- Frontend: vanilla-JS single-page app, no build step. `index.html` loads one JS + CSS file
  per view; all share the `window.NRB` runtime in `util.js`. Chart.js 4.4.1 from jsDelivr.
- `sw.js` is a network-first service worker. **Bump `CACHE` on every shell change** and add
  any new JS/CSS file to `SHELL`.
- Hosting: Render free web service (`Dockerfile` / `Procfile`), auto-deploys on push to `main`.
  Sleeps after ~15 min idle; the first request then takes 30-60 s.

## Run locally
- `PORT=8118 HOST=127.0.0.1 python server.py` with the background option (never a trailing `&`).
  Default port is 8765. Restart after any `.py` edit; static files are served fresh from disk.
- Use a scratch database for experiments: `NRB_DB=<scratch>/test.db`. Never point local runs at
  the production `DATABASE_URL`.
- Users are anonymous by default: the browser id in `localStorage.nrb_uid` is sent as
  `X-User-Id`. phone-view can impersonate a local test user with `--local nrb_uid=<id>
  --local nrb_onboarded=1`.

## Checks (there is no test suite)
- Syntax: `node --check <file>.js` for each JS file; `python -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" server.py`.
- Visual: `node ~/.claude/tools/phone-view.mjs http://127.0.0.1:8118/ --out shot.png` (+ `--desktop`).
  Drive views with `--eval` (e.g. `NRB.go("profile")`), since most screens are reached by JS.
- Money math lives server-side: fees in `fills.kalshi_fee`, fills in `fills.walk_book`/`quote`,
  settlement in `server.settle_if_resolved` / `settle_parlays_if_resolved`.

## Rules that bite
- Settling or selling must go through `db.resolve_bet` / `db.resolve_parlay` with
  `credit_uid` + `credit`. They only close a bet that is still `open` and credit the balance in
  the same transaction, so the 25 s poller and a user request can't pay the same bet twice.
  Never call `db.adjust_balance` for a payout.
- Displayed %/odds use `NRB.odds.chance(m)` (handles the $1.00 placeholder ask); buying uses
  the real ask.
- Kalshi returns 403 without a browser User-Agent (handled in `kalshi.py`).
- Render blocks outbound SMTP; email goes through the Brevo HTTPS API there.
- Commit by explicit path and push to `main` (Render deploys it). Never commit `data.db`,
  `.claude/test/` or any credential; the repo is public.
- No real money, no AI or third-party tools inside the product, $0 hosting only.
