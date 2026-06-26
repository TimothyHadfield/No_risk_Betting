# PROGRESS — No-Risk Betting (read this first to get caught up)

This file is the single catch-up document. If you're a future Claude session with
no prior context: read this top to bottom and you'll know the whole project.

## What this is
A **paper-trading / fake-betting web app** that shows **real, live prediction-market
odds (Kalshi)** and lets users bet **virtual money** ($1,000 to start). The point is
responsible, no-risk practice + measuring whether your forecasts are actually *right*
(not just lucky). Built to look/feel like a real betting app (dark, mobile-style).

**User context:** Timothy (GitHub: TimothyHadfield, email timhadfield7@gmail.com).
Non-technical-ish on Git/hosting — explain those steps simply. He wants this to become
a **free public website anyone can use**, and explicitly **does NOT want any Claude/AI
or other third-party tools integrated** into the product.

Working dir: `c:/Users/timha/OneDrive/Desktop/my-website/Code Projects/No_risk_Betting`

## How to run / operate
- **Run locally:** `python server.py` → http://localhost:8765  (Python 3 stdlib only,
  no pip installs). Env vars: `PORT` (default 8765), `HOST` (default 0.0.0.0),
  `NRB_DB` (default `data.db`).
- **IMPORTANT — the server must run as a PERSISTENT background process.** Earlier,
  starting it with `python server.py &` inside a one-off Bash call kept dying between
  turns (the user repeatedly saw "localhost failed to load"). Start it with the Bash
  tool's `run_in_background: true`. To restart: `taskkill //F //IM python.exe` then
  start again. If the user says the page won't load, the server is almost always just
  down — relaunch it.
- **Node is NOT installed** on this machine; **Python 3.14 is.** That's why the whole
  backend is Python stdlib (`http.server`). There is **no JS engine** (no node/deno),
  so the frontend JS cannot be linted/run here — verify JS by careful reading. A
  bracket-balance helper exists at the scratchpad path but it does NOT catch syntax
  errors like duplicate `const` (that bug shipped once — see History).
- Windows: use the **Bash** tool with Unix syntax for these workflows; `taskkill` etc.
  Browser-based visual verification isn't possible here — the USER does visual checks.

### Operational notes (things the user should know)
- The app is **local-only until deployed** — `localhost:8765` is reachable only on his
  machine. Public access requires the Render (or similar) deploy.
- The server binds `0.0.0.0`, so while running it's also reachable by **others on the
  same Wi-Fi** at `<his-ip>:8765`. For strictly-local use: `HOST=127.0.0.1 python server.py`.
- Bets/balance are in a local **`data.db`** (git-ignored, NOT on GitHub). Each browser is
  a separate anonymous user (id in localStorage). Burger menu → **Reset** wipes an account.
- Needs **internet** (Kalshi + ESPN). Offline → app shell loads, connection banner shows.
- The GitHub repo is **public** (no secrets in it, so fine). Push changes via VS Code
  Source Control → Commit → **Sync Changes**.
- If something looks broken, it's almost always **the server not running** — relaunch
  `python server.py`. After new code, do one hard refresh (Ctrl+Shift+R).

## Architecture
Tiny server + vanilla-JS single-page app. **No build step, no frameworks.**

### Backend (Python stdlib)
- `server.py` — HTTP server (ThreadingHTTPServer subclass `Server`), routes, JSON API,
  serves static files, two background threads: events cache refresher + settlement
  poller. Wraps request dispatch in `_safe()` so a bad request never crashes it.
  `/healthz` returns `{"ok":true}`.
- `kalshi.py` — Kalshi public market-data adapter (no auth/key/money; needs a browser
  User-Agent or Kalshi 403s). Fetches events/markets/orderbook/candlesticks with
  retry/backoff. Holds the in-memory **events cache** (refreshed every 90s) and a
  `FEATURED_SERIES` list (World Cup + major leagues) merged in because the default feed
  buries them. Attaches a `logo` to each sports market via espn.logo_for.
- `espn.py` — ESPN public adapter (unofficial endpoints) for **live scores/clock** and
  **team logos** (Kalshi has neither). Matches a Kalshi game to an ESPN game by team
  names (with normalization + alias map). `game_state()` and `logo_for()`.
- `fills.py` — order-book-walk fill simulation + Kalshi fee (0.07*C*P*(1-P)).
- `analytics.py` — Brier score, log-loss, calibration buckets, per-category skill
  (`by_category`), recent W/L streak, and **predict-then-bet** you-vs-market stats
  (`forecast_stats`).
- `db.py` — **DUAL BACKEND (added 2026-06-26):** SQLite by default (local, zero
  install); **Postgres automatically when `DATABASE_URL` is set** (production). One
  set of SQL; a small helper layer (`_q`/`_query`/`_exec`/`_insert` + a
  `_with_retry` decorator that reconnects on Neon idle-disconnects) translates
  placeholders (`?`→`%s`), auto-ids (`RETURNING id`), and upserts. Postgres driver
  is `psycopg2-binary` (in requirements.txt, pip-installed in the Dockerfile;
  imported only when DATABASE_URL is set, so local stays stdlib-only). This is what
  enables free persistent storage on a host with an ephemeral disk (Render + Neon).
  **MULTI-USER**: every visitor is an anonymous user keyed by a
  browser-generated id sent in the `X-User-Id` header. Tables: accounts, bets,
  parlays, parlay_legs, equity_history — all scoped by user_id. Get-or-create accounts.
  **OPTIONAL ACCOUNTS (added 2026-06-26):** `users` (email, salted PBKDF2-SHA256
  pass_hash — stdlib only, no plaintext/3rd-party) + `sessions` (token→user_id)
  tables. Sign-up reuses the browser's current anon id as the account's user_id, so
  existing bets carry over; logging in elsewhere returns the same user_id → data
  syncs across devices. Functions: create_user/verify_login/get_user/create_session/
  user_id_for_token/delete_session.

### Frontend (vanilla JS, dark, mobile-first, PWA)
- `index.html` — app shell: top bar (burger, brand, Cash/Equity), sticky section bar,
  `#view`, burger drawer, onboarding overlay, connection banner, toast. Loads all
  CSS/JS, manifest, registers the service worker.
- `util.js` — the shared runtime `window.NRB` (STABLE CONTRACT). Provides: `api` (sends
  `X-User-Id`, shows connection banner on failure), `fmt`, `odds` (multiplier = 1/price),
  `icon(name, logo)` (real flag IMAGES via flagcdn since Windows can't render flag
  emoji; team logos; monogram fallback), `fav` + `history` (localStorage), `box` +
  `carousel` (shared market-box component), `slip` (parlay bet-slip state), router
  (`views`, `go`, `openMarket`), `drawer`, theme toggle, predict-then-bet toggle,
  onboarding, `refreshAccount` (uses light `/api/summary`). **`auth`** (signup/login/
  logout, stores session token in localStorage `nrb_token`, sends it as the
  `X-Session-Token` header on every `api` call) + the **log-in/sign-up modal**
  (`#auth-modal` in index.html, opened from burger → Account).
- `browse.js`/`browse.css` — Home "For You" feed of horizontal carousels + section bar
  + search + the **"My Bets" bar** + Watchlist view.
- `detail.js`/`detail.css` — the market detail view (the biggest file). Multi-line
  price chart (one line per outcome, **all resampled onto a shared timeline** so hover
  dots align), time-range pills + a "Game" in-game range, live score/clock, two/N
  **outcome bet boxes** (never shows "No" for multi-outcome events), **$ wager** input
  (not "contracts") with live "→ win $X" + two-step confirm, **predict-then-bet** slider
  (opt-in, blind-by-default), **"Your position" card** + **chart entry markers**,
  **"Add to slip"**, HTML tooltip (clamped, never clips), 5s live poll + 30s chart
  refresh.
- `portfolio.js` — open positions (live MTM, Sell, Settle▸ demo) + history + a
  **Parlays** section.
- `profile.js`/(uses) — "Forecasting Score" page: Brier hero, reality-check, W/L streak,
  calibration chart, skill-by-category, equity chart, **You-vs-Market** (predict) section.
- `analytics.js` — charts view (calibration + equity).
- `slip.js`/`slip.css` — floating bet-slip button + panel for **parlays**.
- `views.css` — portfolio + analytics styles.
- `styles.css` — design tokens (dark default + light theme via `:root[data-theme=light]`),
  shell, shared atoms, market box, carousel, drawer, onboarding, banner, icons.
- `sw.js` — service worker, **network-first** (always fresh online, cache fallback
  offline). Cache name bumped on shell changes (currently `nrb-shell-v3`).
- `manifest.json`, `icon.svg` — PWA install metadata.

### API (all JSON; money in dollars; prices dollars 0–1; user via `X-User-Id` header)
`GET /healthz` · `/api/categories` · `/api/markets?category=&q=&limit=` ·
`/api/home` (sections: Trending, leagues, categories) · `/api/market/{ticker}`
(returns market, orderbook, meta, **siblings** [all outcomes of a mutually-exclusive
event], event_title) · `/api/history?ticker=&range=1H|6H|1D|1W|1M|ALL` (also
`&start=` for the in-game window) · `/api/game?event_ticker=` (ESPN score/clock/logos) ·
`/api/quote?ticker=&side=&contracts=` · `GET/POST /api/bets` · `/api/bets/{id}/close` ·
`/api/bets/{id}/force_settle` · `/api/settle` · `/api/parlays` (GET list / POST create)
· `/api/parlays/{id}/force_settle` · `/api/account` · `/api/summary` (light: balance +
equity) · `/api/account/reset` · `/api/analytics` · **`POST /api/auth/signup`** ·
**`POST /api/auth/login`** (both → `{token, user_id, email}`) · **`POST /api/auth/logout`** ·
**`GET /api/auth/me`**. The server's `_uid()` prefers a valid `X-Session-Token`
(logged-in account) and falls back to the anonymous `X-User-Id`.

## Key product decisions (already settled with the user)
- Real Kalshi odds; demo apps that use sandbox/mock odds are useless — that's the whole
  origin of the project.
- Multiplier display = decimal odds (1/price); show probability alongside.
- Sports = show ALL outcomes (Team A / Team B / Tie), **never "No"** — gated on Kalshi's
  `mutually_exclusive` flag (true for games & candidate races; false for threshold
  ladders, which keep Yes/No).
- Icons: flag IMAGES (flagcdn) for countries, ESPN logos for teams, monogram fallback.
- Predict-then-bet is **opt-in, ignorable, blind-by-default**, with a global toggle.
- Featured leagues (auto-appear when in season): World Cup, NFL, NBA, MLB, NHL, WNBA,
  EPL, UCL, MLS, La Liga, Serie A, Bundesliga, Ligue 1, ATP, WTA, NCAA FB/BB.

## How work has been done (orchestration)
The user opted into **multi-agent orchestration**. Pattern used repeatedly: the main
session writes a shared contract + foundation, then spawns specialist sub-agents
(`general-purpose`, often `run_in_background: true`) that each own non-overlapping files
(e.g. detail.js, portfolio.js). A persistent "detail agent" was reused via SendMessage.
Permissions: the user granted full Bash/PowerShell access (settings allow rules added;
PowerShell was missing from the user-settings allowlist — that's fixed).

## Current status (as of 2026-06-26)
**Built & verified (headless/API):** the full app — live markets, market detail with
multi-line chart + live score + in-game timeline, betting with honest fills, parlays,
predict-then-bet, bet tracking (My Bets bar + position card + chart markers), Forecasting
Score profile, search, light/dark, multi-user, onboarding, connection banner, reliability
hardening, `/api/summary`, PWA.

**Deployment:** code is deploy-ready (`Dockerfile`, `Procfile`, `runtime.txt`,
`requirements.txt` [empty], `.gitignore`, `DEPLOY.md`, env config, `/healthz`).
- ✅ Code pushed to GitHub: **github.com/TimothyHadfield/No_risk_Betting** (branch `main`).
  Going forward the user uses VS Code Source Control → Commit → **Sync Changes**.
- ✅ **Optional accounts built & tested (2026-06-26)** — email+password login that
  syncs bets/balance across devices (see db.py / util.js notes above). Verified
  end-to-end against a live server (signup claims anon data, cross-device login
  returns same account, dup-email 409, wrong-password 401, logout invalidates token).
- 🔑 **The user CANNOT spend any money** (told us 2026-06-26). So the recommended
  deploy is **Render (free web service, NO card) + Neon (free Postgres, NO card)** —
  data lives in Neon so Render's ephemeral disk doesn't matter. Fly.io was ruled out
  because it requires a card on file (usage-billed → surprise-charge risk). `flyctl`
  IS installed (`C:\Users\timha\.fly\bin\flyctl.exe`, v0.4.61) and `fly.toml` exists
  if he ever changes his mind, but **don't push him to Fly**.
- 🔜 NEXT STEP — finish the **Render + Neon** deploy (full walkthrough in `DEPLOY.md`
  Option A). **What only the user can do:** create a free Neon project → copy its
  `DATABASE_URL`; create a free Render web service from the GitHub repo (auto-detects
  the Dockerfile) → set `DATABASE_URL` env var + Health Check Path `/healthz`. When
  he returns, walk him through those and verify the live URL + that login syncs
  across two browsers.
- ⚠️ The Postgres code path is implemented but was **only tested locally via SQLite**
  (no local PG). Once the user has a Neon `DATABASE_URL`, TEST THE PG PATH (can
  connect to Neon from this machine with `DATABASE_URL=… python server.py` after
  `pip install psycopg2-binary`, or just verify on the live Render URL).

## ⚠️ The one real blocker to a PUBLIC launch (legal, not code)
**Kalshi's Data Terms** restrict publicly displaying/redistributing their market data
without written consent; **ESPN endpoints are unofficial.** Fine for private/personal/
educational use; before promoting publicly the user should get Kalshi permission/a data
license and review ESPN terms. Keep reminding him of this — it's the gating item, not
any code.

## Backlog / ideas the user liked but hasn't built (NO AI/3rd-party tools allowed)
- Notification center + price alerts (make the 🔔 real).
- "Live now" section (games currently in-play via ESPN state).
- Global leaderboard with opt-in nickname (ranked by forecasting accuracy/ROI) + daily
  forecast challenge / streaks / badges.
- Edge / Kelly bet sizing (uses predict-then-bet edge).
- Market resolution rules + related markets on detail; share score-card image; sounds.
He often says "do all of the above" or "pick the next N and do them autonomously."

## Gotchas / lessons
- Restart the server after backend edits; it serves frontend files fresh from disk
  (no restart needed for JS/CSS changes, but a hard refresh / the network-first SW
  ensures the browser gets them).
- Background `python server.py &` in a normal Bash call does NOT persist — use
  `run_in_background: true`.
- The bracket-balance check gives a false "IMBALANCE" on `util.js` (its regex literals);
  that's expected, not a bug.
- A duplicate `const` once broke only the markets page (browse.js) — symptom was "can't
  reach browsing page" while other views worked. Watch for same-scope duplicate
  declarations; the balance checker won't catch them.
