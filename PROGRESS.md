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
  a separate anonymous user (id in localStorage). Burger menu → **Reset balance** starts a
  new period (back to $1,000) but keeps past bets viewable in stats (it no longer wipes data).
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
  - **SPORTS FUTURES/AWARDS (added 2026-06-27):** `FEATURED_FUTURES` — a curated, tight
    allowlist of marquee non-game markets (WC Winner `KXMENWORLDCUP`, Golden Boot
    `KXWCGOALLEADER`, WC awards `KXWCAWARD`, Ballon d'Or `KXBALLONDOR`, NBA/WNBA/NFL
    titles & MVPs, etc.) each tagged with a custom `group` that `_normalize_events(...,
    category_override=group)` writes as the event's `category`, so each group becomes its
    own browsable/favoritable home section (key `cat:<group>`). Deliberately EXCLUDES the
    niche stuff (per-group/per-region qualifiers, "first song", host-nation trivia, 45
    per-team goal totals) — Kalshi only offers qualifiers in those niche forms, so they're
    omitted by design. ~24 futures events across 6 groups; ~18 extra API calls/refresh.
  - **SPREAD / TOTAL LINES (added 2026-06-27):** game events expose sibling
    "margin of victory" (spread) and "over/under" (total) ladders under the SAME
    event suffix and a sibling series (`KX{LG}GAME-{suf}` → `KX{LG}SPREAD-{suf}` /
    `KX{LG}TOTAL-{suf}`). Each rung is an independent Yes/No market keyed by a
    `floor_strike` line (1.5, 2.5, 3.5…). `fetch_game_lines(game_event, series)`
    fetches both sibling events (`fetch_event` = single-event GET) and returns a
    tidy shape: spread = per-team ascending rungs (`_normalize_spread`, team parsed
    from the subtitle via `_spread_team`); total = one ascending ladder + a `unit`
    word (`_normalize_total`). `normalize_market` now also surfaces
    `floor_strike`/`strike_type`. Betting reuses the normal quote/bet path (each
    rung is a real market); only ~15% of games have these ladders (major/liquid
    games), and non-GAME series return `{}`.
  - **GAME TIMING (added 2026-06-27):** `normalize_market` parses Kalshi's
    `occurrence_datetime` → `occurrence_ts` (epoch, the kickoff). `_normalize_events` adds
    `start_ts` (kickoff) and `is_game` (series ends in `GAME`) per event. Powers the feed's
    "live now" red highlight and the detail's scheduled-time display. (~5% of WC fixtures
    have no kickoff set in Kalshi yet → they degrade gracefully.)
- `mailer.py` — **stdlib-only email sender** (added 2026-06-26) for the optional
  **email-based password reset**. Two transports, no third-party SDK:
  - **Brevo HTTP API (LIVE in production)** — `urllib` HTTPS POST. Used because
    **⚠️ Render BLOCKS outbound SMTP ports** (Gmail SMTP failed with `OSError 101
    Network is unreachable`); HTTPS works. Env: `BREVO_API_KEY` + `BREVO_SENDER`
    (a Brevo-validated sender email — no domain needed). **Configured in Render**
    with the project's `noriskbetting4@gmail.com` Brevo account; **email reset is
    confirmed working end-to-end (2026-06-26).** Brevo free = 300 emails/day, no card.
  - **SMTP via smtplib (fallback)** for hosts that allow it (local/Fly): `SMTP_USER`
    + `SMTP_PASS` (app password), `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM`. Don't use on
    Render — it's blocked.
  `is_configured()` False when neither set → app just doesn't offer email reset
  (recovery code still works). Reset emails come from "No-Risk Betting
  <noriskbetting4@gmail.com>"; brand-new sender → may land in spam at first.
- `espn.py` — ESPN public adapter (unofficial endpoints) for **live scores/clock** and
  **team logos** (Kalshi has neither). Matches a Kalshi game to an ESPN game by team
  names (with normalization + alias map). `game_state()` and `logo_for()`.
- **SOCIAL LAYER (added & live 2026-06-26):** `db.py` tables `profiles`
  (user_id, unique `handle`/`handle_lc` = **public DISPLAY NAME**, `bio`, `is_public`
  [leaderboard opt-in], `bets_private` [hide all my bets]), `comments` (thread, body,
  status, `ref_ticker`/`ref_title` = market context for the global feed), `reactions`
  (unique per user/target/kind), `reports`; plus `bets.hidden` (per-bet visibility;
  default 0 = public). **PRIVACY MODEL: bets are PUBLIC BY DEFAULT.** A bet shows in
  the feed unless it's individually hidden (`bets.hidden=1`, the per-bet Public/Hidden
  toggle in Your Activity) OR the user set `bets_private`. Anonymous (no account / no
  display name) bets DO show, rendered as **"anonymous"**. Privacy rule for identity:
  **only the display name / bio are ever exposed** — never username(login)/user_id.
  - **username (login) is PRIVATE, display name is PUBLIC.** Sign-up now collects a
    display name (stored as profile.handle, unique, 2-30 chars incl spaces; validated
    by `_DISPLAY_RE`). `verify_login`/`/api/auth/me` return the handle so the UI shows it.
  - `server.py` endpoints: `GET/POST /api/me/profile` (handle/bio/is_public/bets_private),
    `GET /api/u/{handle}` (public profile), `GET /api/leaderboard` (30s cache; ranks
    `is_public` profiles by ROI/Brier/win-rate), `GET /api/feed` (ALL public bets, incl
    anonymous), `GET /api/comments?thread=` + `GET /api/comments/all` (**site-wide feed
    of every comment** w/ market link), `POST /api/comments` (+`/{id}/delete`,
    `/{id}/report`), `POST /api/reactions`, `POST /api/bets/{id}/public` (toggle hidden).
  - Moderation: per-user/admin delete, reports, tiny slur blocklist, all rate-limited;
    `ADMIN_HANDLES` env lists moderators. `delete_user` cascades to social rows.
  - Frontend `social.js`/`social.css`: **Community** page. **ADAPTIVE TABS (2026-06-26):**
    while total public activity (bets + comments) is **≤ 25** the page shows ONE combined
    chronological **"Live"** feed (bets and comments mixed, newest first; tabs =
    Live / Leaderboard) — only past that threshold (`LIVE_THRESHOLD`) does it split into
    the three firehose tabs **Leaderboard / All bets / All comments**. `mount()` fetches
    `/api/feed` + `/api/comments/all` once to size the UI and feed the combined view;
    `renderLive()` merges by timestamp (`placed_at`/`created_at`). Public profile view
    (`NRB.views.user`). A reusable comments thread mounted in the market-detail **left
    column** under the chart (thread = `mkt:<event_ticker>`, passes ticker/title for the
    global feed). Like buttons.
  - **Bet cards show the OUTCOME the user backed (2026-06-26)** — not just the market +
    amount. Bets store `bets.outcome_name` (the team/candidate for a "yes" bet =
    `yes_sub_title or title`, or the `no_sub_title or "No"` for a "no"), set at insert and
    returned in `_bet_card`/`_FEED_COLS`. The feed badge now reads the actual pick
    (e.g. "Lakers") with the market title as the link.
  - **Comments capture the live score+clock at post time (2026-06-26)** — `comments.game_state`
    (a short label like "LAL 88–90 BOS · 4:21 - 4th"). detail.js passes a `gameState()`
    callback into the thread ctx (`gameTag()` builds it from the live `/api/game` state,
    only while a matched game is in progress); the composer sends it as `game` on
    `POST /api/comments`; it renders as a small `.so-gtag` pill under the comment body in
    both the per-market thread and the global All-comments / Live feeds.
  - **Profile/privacy editing lives in Account settings** (auth modal → "Profile &
    privacy" panel: display name, bio, leaderboard, bets-private). The Community page
    only shows a one-line "Set display name" prompt if you have none yet — no editor box
    once it's set. Commenting requires a display name.
- **DESIGN OVERHAUL pass 1 (2026-06-26):** refined dark tokens (deeper neutrals, one
  emerald accent `--accent`, `--accent-ink`/`--accent-soft`/`--ring`, layered
  shadows), tighter heading typography, polished chrome (translucent top/section bars
  via color-mix, buttons, cards, inputs/textarea, market-box hover). Replaced **all
  emoji chrome** with an inline-SVG icon set (`.ico-svg`): new chart-on-square brand
  mark in top bar/drawer/onboarding/auth modal, line icons for every drawer item.
  `NRB.fmt.title()` strips leading emoji from dynamic Kalshi section titles so
  carousel headers/chips read clean. NOTE: this was pass 1 (chrome + tokens + icons);
  per-view polish (portfolio/profile/analytics density) is a good next pass.
- **UX additions (2026-06-26, all live):**
  - **Top-level nav tabs** "Markets" / "Community" in the top bar (`.topnav` in
    index.html, `updateTopnav()` in util.js) — Community is no longer only in the burger.
  - **Header account button** (`#hdr-account`): shows "Create account / Sign in" when
    logged out (opens the Sign-in screen by default), or the user's **display name** +
    initials avatar when logged in (opens the account panel).
  - **Clickable "?" help system**: `NRB.glossary` + `NRB.help(key)` render a small "?"
    dot beside jargon labels; clicking shows a plain-language popover (closes on
    outside-click/scroll). Wired into header (Cash/Equity), portfolio summary + table
    headers, leaderboard + public-profile stats, and the Forecasting Score metrics.
  - Portfolio: removed the **"Qty" (contracts) column** (meaningless in a $-framed app).
  - Detail page **"Your bets on this market"** rewritten as clean labeled cards
    (`.dpos`): status tag (Open/Won/Lost/Sold) + dollar stats (Bet / Entry odds / Now
    worth / Profit-loss), each with a help dot. Lives in the right column; the
    **discussion** now sits in the LEFT column under the chart (two-column layout).
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
  **SEASONS / RESET PERIODS (added 2026-06-26):** resetting no longer deletes data — it
  starts a new "season". `accounts.season` is the current period counter; `bets`, `parlays`,
  `equity_history` each carry a `season` column (default 1, set to the account's current
  season at insert). A `seasons` table (user_id, season, started_at, ended_at,
  starting_balance) records each period for labeling; `_ensure_season_row()` back-fills
  season 1 for pre-existing accounts. `reset_account()` now: voids still-open bets/parlays
  (status `'void'` = excluded from stats, so nothing leaks into the new balance), stamps
  the old season's `ended_at`, bumps `accounts.season`, sets balance/starting back to
  $1,000, and inserts the new season row. `list_bets`/`list_parlays`/`equity_history` take
  an optional `season=` filter (None = all periods); `current_season()` and `list_seasons()`
  added. **The reset top-up is NOT profit** — P&L is summed from bet/parlay `realized_pnl`,
  and the $1,000 reset is not a bet, so it never counts. Portfolio (`/api/bets`,
  `/api/parlays`) shows the current season only (voids hidden); the social feed stays
  cross-season (public record). `_migrate()` adds the `season` columns to old DBs; the
  `seasons` table is created by the idempotent startup DDL.
  **OPTIONAL ACCOUNTS (added 2026-06-26, upgraded same day):** `users`
  (`login` = username OR email [unverified — we never send email], salted
  PBKDF2-SHA256 `pass_hash` + `recovery_hash`, stdlib only) + `sessions`
  (token→user_id). Sign-up reuses the browser's anon id as the account's user_id so
  existing bets carry over; logging in elsewhere returns the same user_id → syncs
  across devices. **Recovery code** (one-time, shown once at signup, only its hash
  stored) is how a forgotten password is reset — NO email infra (deliberate: keeps
  the no-3rd-party rule). Login is case-insensitive. Functions: login_taken,
  create_user (→ `(uid, code)`), verify_login, verify_recovery, set_password
  (clears sessions), get_user, delete_user, create_session, user_id_for_token,
  delete_session, gen_recovery_code. Sign-up ALSO collects a **display name** (public;
  see Social layer). `init()` runs `_migrate()` which idempotently renames the old
  `email` column → `login`, adds recovery/reset columns, and adds the social columns
  (`bets.hidden`, `bets.outcome_name`, `profiles.bets_private`,
  `comments.ref_ticker/ref_title`, `comments.game_state`, and the `season` columns on
  `accounts`/`bets`/`parlays`/`equity_history`) — all verified against live Neon.

### Frontend (vanilla JS, dark, mobile-first, PWA)
- `index.html` — app shell: top bar (burger, SVG brand mark, **Markets/Community nav
  tabs**, Cash/Equity w/ help dots, **account button**), sticky section bar, `#view`,
  burger drawer (SVG icons), onboarding, connection banner, toast, **multi-panel auth
  modal** (login/signup/recovery/show-code/account/**profile&privacy**/change-pw/delete).
  **DRAWER SLIMMED (2026-06-27):** trimmed from 13 flat items to 9 in two groups —
  dropped **Home/Community/Account** (already in the top bar: brand+Markets tab, Community
  tab, header account button) and the dead **Settings** placeholder; remaining items are a
  nav group (Watchlist, Your Activity, Forecasting Score, Analytics, Notifications, Our
  Purpose) + a **"Settings"** labeled group (`.drawer-label`: Predict-then-bet, Theme,
  Reset balance [red on hover]). `drawerAction` home/community/account branches in util.js
  are now dead-but-harmless; `#drawer-account-label` removal is null-guarded.
  Loads all CSS/JS (incl `social.css`/`social.js`), manifest, registers the SW.
- `social.js`/`social.css` — Community (leaderboard / all-bets / all-comments), public
  profile view, reusable comments thread (mounted on detail's left column), like
  buttons. See SOCIAL LAYER above.
- `util.js` — the shared runtime `window.NRB` (STABLE CONTRACT). Provides: `api` (sends
  `X-User-Id`, shows connection banner on failure), `fmt`, `odds` (multiplier = 1/price),
  **`odds.chance(m)` (added 2026-06-27)** — robust implied probability (0–1) for DISPLAY:
  prefers the bid/ask mid, then a real bid, then last trade, then a sub-$1 ask, else 0. Fixes
  illiquid long-shots whose only "ask" is the $1.00 max placeholder (used to render 100% /
  1.00x; now 0%/— or e.g. 1%/100x). Used for ALL displayed %/odds + outcome sorting;
  the actual buy math (`selectedPrice`/wager→contracts) still uses the real ask. (Also:
  detail chart now plots only the **top 3 outcomes by chance** + your selected one.)
  `icon(name, logo)` (real flag IMAGES via flagcdn since Windows can't render flag
  emoji; team logos; monogram fallback), `fav` + **`favCat`** + **`hiddenCat`** + `history`
  (localStorage), `box` + `carousel` (shared market-box component), `slip` (parlay bet-slip),
  router
  (`views`, `go`, `openMarket`), `drawer`, theme toggle, predict-then-bet toggle,
  onboarding, `refreshAccount` (uses light `/api/summary`). **`auth`** (signup/login/
  logout/recover/changePassword/deleteAccount; stores session token in localStorage
  `nrb_token` + `nrb_login` [username] + `nrb_display` [public display name]; sends
  `X-Session-Token` on every `api` call; `auth.sync()` refreshes from `/api/auth/me`).
  Also: **`help`/`glossary`** (the "?" popovers), **`fmt.title`** (strip emoji),
  `updateTopnav` (active nav tab). The auth modal + header account button are wired here.
  **`NRB.isLiveGame(event)` (2026-06-27):** true when a sports game's kickoff (`start_ts`)
  has passed but it's plausibly still on (per-sport `liveWindow`); `NRB.box` adds the
  `.box-live` red highlight + pulsing `.box-livedot` when so. No ESPN call — pure
  kickoff+window from the cached `occurrence_ts`.
- `browse.js`/`browse.css` — Home feed of horizontal carousels + section bar + search +
  the **"My Bets" bar** + Watchlist view. **TOP SECTION = FAVORITED MARKETS (2026-06-27):**
  the old mixed "For You" is replaced by **"★ Your favorites"** — only the specific events
  the user has starred (`buildFavorites`); rebuilt live on `NRB.fav.onChange`. Omitted when
  empty. **"YOU MAY LIKE" (2026-06-27):** a row of suggested-category cards (`youMayLikeEl`)
  shown under the favorites section. A `RELATED` map (league key / `cat:<group>` →
  related keys) surfaces categories related to what you've favorited and aren't already
  favorited/hidden; each card favorites the category (→ floats up as a section) or scrolls
  to it. **FAVORITE CATEGORIES (2026-06-26):**
  every carousel header (leagues + categories, not "For You") has a ☆/★ star; starring a
  category floats it (and its section-bar chip) to the **top of the feed**, just under
  "For You". Stored client-side in localStorage (`nrb_fav_cats`) via **`NRB.favCat`** (mirrors
  `NRB.fav`); `NRB.carousel(title, events, {favKey})` renders/wires the star. browse.js
  `reorderRows()` does the float and `_renderRows()` re-runs live on `favCat.onChange` (no
  refetch) so the order updates the instant you toggle a star.
  **HIDE CATEGORIES (2026-06-26):** each carousel header also has a ✕ that **removes that
  category from the home feed** (still searchable, still re-addable). Stored in localStorage
  (`nrb_hidden_cats`) via **`NRB.hiddenCat`** (`list/has/add/remove/onChange`); `_renderRows()`
  filters hidden keys out (and re-runs on `hiddenCat.onChange`). A **"+" button pinned to the
  far right of the section bar** (`#cat-add` in index.html, inside the new `.sectionbar-row`
  flex wrapper; shown only on the browse view) opens a **popover (`.cat-panel`) listing hidden
  categories**, each clicking to re-add. "For You" has no star/✕ (favKey null). Hidden wins
  over favorited (a hidden+favorited category stays out until re-added, then floats back up).
- `detail.js`/`detail.css` — the market detail view (the biggest file). Multi-line
  price chart (one line per outcome, **all resampled onto a shared timeline** so hover
  dots align). **CHART CLEANUP (2026-06-27):** `smoothSeries()` edge-preserving
  (median-anchored bilateral) filter removes order-book noise — isolated/reverting spikes
  vanish, rapid back-and-forth settles to the MIDDLE of both sides, but steep *sustained*
  moves stay sharp; y-axis auto-scales to the data peak (bottom 0%); tooltip title always
  renders the date/time (`fmtTipTime`) instead of the raw epoch number. **BROAD TITLE
  (2026-06-27):** multi-outcome markets show the broad event question as the `<h1>` (e.g.
  "Golden Boot Winner") not one option ("Will Dembele lead in goals?") — `renderHead` uses
  `meta.event_title` for multi; and the header's single "Selected chance" is replaced by the
  **top-3 contenders' live chances** (`renderProb` → `.detail-prob-multi`). Time-range pills +
  a "Game" in-game range, live score/clock, two/N
  **outcome bet boxes**. **THREE market shapes (independent type added 2026-06-27):**
  (1) binary Yes/No; (2) *exclusive* multi (game A/B/Tie, WC winner — pick ONE, bet Yes);
  (3) *independent* multi (e.g. "Teams to Win All 3 Group Matches" — each team is its own
  Yes/No market). `api_market` returns `siblings` for ANY multi-market event plus an
  `exclusive` flag (= Kalshi `mutually_exclusive`). For independent (`S.exclusive=false`)
  the detail shows the full (scrollable) outcome list AND a **Yes/No segment** (`#d-yesno`,
  `renderYesNo`/`setSide`) for the selected outcome, so you can bet Yes or No on each; the
  chart still plots the top-3 outcomes by Yes chance (+ your selection). **$ wager** input
  (not "contracts") with live "→ win $X" + two-step confirm. **SCHEDULED TIME (2026-06-27):**
  when a game hasn't started, the score area shows "Scheduled · &lt;kickoff in the viewer's
  local timezone&gt;" (e.g. "Sat, Jul 4, 7:00 PM MDT") from `S.market.occurrence_ts` via
  `fmtKickoff` + `Intl` — works even when ESPN doesn't match. **SPREAD / TOTAL
  SLIDER (2026-06-27):** a "More ways to bet" card in the LEFT column (under the
  chart) on game events. `loadLines()` fetches `/api/lines` (only when
  `isGameEvent()`); if the game has ladders it renders a **Margin of victory** block
  (team segment + a discrete `<input type=range>` slider across 1.5/2.5/3.5… with a
  live odds readout — back the team to cover) and a **Total** block (Over/Under
  segment + slider across the O/U lines). Each block has its own wager stepper +
  two-step-confirm Place + Add-to-slip; selection lives in `S.lineState` (survives
  the 30s price re-poll; a focus guard skips the rebuild while you're typing a
  wager). Bets POST the line ticker with an explicit `outcome_name` (e.g.
  "Under 5.5 runs", "A's by 2.5+") and show in Portfolio. **predict-then-bet** slider
  (opt-in, blind-by-default), **"Your position" card** + **chart entry markers**,
  **"Add to slip"**, HTML tooltip (clamped, never clips), 5s live poll + 30s chart
  refresh.
- `portfolio.js` — open positions (live MTM, Sell, Settle▸ demo) + history + a
  **Parlays** section.
- `profile.js`/(uses) — "Forecasting Score" page: Brier hero, reality-check, W/L streak,
  calibration chart, skill-by-category, equity chart, **You-vs-Market** (predict) section.
  Has a **season picker** at the top (`NRB.seasonPicker`) — default shows the current reset
  period; can switch to a previous period or "Overall".
- `analytics.js` — charts view (calibration + equity), also with the season picker.
  **`NRB.seasonPicker(host, onChange)`** (util.js) fetches `/api/seasons`, renders a
  `<select>` (Current / each previous period / Overall), and is hidden until there's been
  ≥1 reset. Both stats views pass the chosen value as `/api/analytics?season=`.
- `notifs.js`/`notifs.css` — **Notifications + price alerts view (added 2026-06-27).**
  Reached from the burger → Notifications. Lists fired notifications (unread highlight,
  click to open the market, dismiss; "Mark all read") + a "Your price alerts" section to
  manage/remove active alerts. Opening the page marks all read and clears the burger badge.
  **Set an alert** from the market detail page: the trade card's "🔔 Set a price alert"
  button (`#d-alert` in detail.js, `setAlert()`) prompts for a target % for the selected
  outcome; the server derives the direction (above/below) from the current chance. A
  background pass in `positions_poller` (`check_price_alerts()` in server.py) compares
  active alerts to the **cached** events feed (no extra Kalshi calls), fires a notification,
  and one-shots the alert. Unread count rides on `/api/summary` (`unread`) → red
  `.burger-badge` dot, refreshed by `NRB.refreshAccount`/`NRB.refreshBadge`.
- `purpose.js`/`purpose.css` — **"Our Purpose" view (added 2026-06-27).** Burger →
  **Our Purpose** (`data-action="purpose"` → `NRB.go("purpose")`). The app's mission page:
  a hero ("the thrill of betting, without the part that ruins lives"), a first-person
  **creator note**, a **summarized version** (3 stat callouts + key-takeaway bullets), then a
  **"Learn more" toggle** (`#pp-more`) that reveals the **full cited research paper** on the
  harms of real-money sports betting + the predatory industry. Built from a **deep-research
  pass** (multi-agent web search + adversarial fact-checking) plus two targeted follow-up
  agents for the vig/parlay math and predatory-practice sourcing. **All claims are footnoted**:
  a `REFS` array (id/cite/url) drives auto-numbered inline `[n]` superscripts (`cite(...ids)`)
  AND the **Works Cited** list; clicking an `[n]` opens the paper (if collapsed) and
  smooth-scrolls+flashes the matching reference. Every source has a **direct, verified URL**
  (swapped SSRN→open UCLA PDF so it doesn't 403; paywalled ones — WaPo/WSJ/NYT/Guardian —
  flagged as such). Deliberately EXCLUDES weak/uncited stats (e.g. the "only 3% of bettors
  profit" and "700% more notifications" claims that circulate but lack a primary source);
  working-paper / associational findings are labeled as such. Closes with the 1-800-GAMBLER
  helpline. Static content (no API calls). NOTE: the creator note is written in a generic
  first-person voice — the user may want to personalize it.
- `slip.js`/`slip.css` — floating bet-slip button + panel for **parlays**.
- `views.css` — portfolio + analytics styles.
- `styles.css` — design tokens (dark default + light theme via `:root[data-theme=light]`),
  shell, shared atoms, market box, carousel, drawer, onboarding, banner, icons.
- `sw.js` — service worker, **network-first** (always fresh online, cache fallback
  offline). **Bump `CACHE` (e.g. `nrb-shell-v16`) on every shell change** and add any
  new JS/CSS file to the `SHELL` list. (Currently `nrb-shell-v28`.)
- `manifest.json`, `icon.svg` — PWA install metadata.

### API (all JSON; money in dollars; prices dollars 0–1; user via `X-User-Id` header)
`GET /healthz` · `/api/categories` · `/api/markets?category=&q=&limit=` ·
`/api/home` (sections: Trending, leagues, categories) · `/api/market/{ticker}`
(returns market, orderbook, meta, **siblings** [all outcomes of a mutually-exclusive
event], event_title) · `/api/history?ticker=&range=1H|6H|1D|1W|1M|ALL` (also
`&start=` for the in-game window) · **`/api/lines?event=<game_event_ticker>`**
(spread + total ladders for a game; `{spread, total}` or nulls; 20s server cache) ·
`/api/game?event_ticker=` (ESPN score/clock/logos) ·
`/api/quote?ticker=&side=&contracts=` · `GET/POST /api/bets` · `/api/bets/{id}/close` ·
`/api/bets/{id}/force_settle` · `/api/settle` · `/api/parlays` (GET list / POST create)
· `/api/parlays/{id}/force_settle` · `/api/account` · `/api/summary` (light: balance +
equity) · `/api/account/reset` (starts a new season; keeps past data) ·
`/api/analytics?season=` (default current period; `season=N` for a past period;
`season=all` for overall — returns `season`/`current_season` too) ·
**`GET /api/seasons`** (`{current, seasons:[{season, started_at, ended_at, is_current,
n_bets, net}]}`) · **`POST /api/auth/signup`**
(→ `{token, user_id, login, recovery_code}`) · **`POST /api/auth/login`** ·
**`POST /api/auth/request-reset`** (email a time-limited reset code; needs SMTP env
configured, else 503) · **`POST /api/auth/recover`** (login+code+new password —
accepts the permanent recovery code OR the emailed reset code) · **`POST /api/auth/password`**
(change pw, token) · **`POST /api/auth/delete`** (token+password) ·
**`POST /api/auth/logout`** · **`GET /api/auth/me`**. Signup/login accept a `login`
field (username or email). The server's `_uid()` prefers a valid `X-Session-Token`
(logged-in account) and falls back to the anonymous `X-User-Id`. Frontend: a
multi-panel auth modal (login/signup/recovery/show-code/account/profile&privacy/
change-pw/delete) in index.html + `NRB.auth` in util.js; the header account button
or burger → Account opens it. Signup also takes a `display` (display name).

**Social API:** `GET/POST /api/me/profile` · `GET /api/u/{handle}` ·
`GET /api/leaderboard` · `GET /api/feed` · `GET /api/comments?thread=` ·
`GET /api/comments/all` · `POST /api/comments` (+ `/{id}/delete`, `/{id}/report`) ·
`POST /api/reactions` · `POST /api/bets/{id}/public`.

**Alerts/notifications API (2026-06-27):** `GET/POST /api/alerts` (create takes
`{ticker, side, outcome_name, title, event_ticker, target}` where target is 0–1; server
derives `op` above/below from the live chance) · `POST /api/alerts/{id}/delete` ·
`GET /api/notifications` (`{notifications, unread}`) · `POST /api/notifications/read`
(body `{}` = all, or `{ids:[...]}`) · `POST /api/notifications/{id}/delete`. `/api/summary`
now also returns `unread`. Tables `alerts` + `notifications` in db.py.

Feed/profile bet cards include
`outcome_name` (the backed team/candidate). `POST /api/comments` also accepts a `game`
field (short live-score label, ≤80 chars) stored as `comments.game_state` and returned by
the comment list endpoints.

**Env vars (set in Render):** `DATABASE_URL` (Neon Postgres), `BREVO_API_KEY` +
`BREVO_SENDER` (email reset), optional `ADMIN_HANDLES` (comma list of moderator
display names). Locally none are set → SQLite + no email.

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

## Current status (as of 2026-06-27)
**Built & verified (headless/API):** the full app — live markets, market detail with
multi-line chart + live score + in-game timeline, betting with honest fills, parlays,
predict-then-bet, bet tracking (My Bets bar + position card + chart markers), Forecasting
Score profile, search, light/dark, multi-user, onboarding, connection banner, reliability
hardening, `/api/summary`, PWA.

**Deployment:** code is deploy-ready (`Dockerfile`, `Procfile`, `runtime.txt`,
`requirements.txt` [only `psycopg2-binary`, prod/Postgres-only], `fly.toml`,
`.gitignore`, `DEPLOY.md`, env config, `/healthz`).
- ✅ Code pushed to GitHub: **github.com/TimothyHadfield/No_risk_Betting** (branch `main`).
  Going forward the user uses VS Code Source Control → Commit → **Sync Changes**.
- ✅ **Optional accounts built & tested (2026-06-26)** — email+password login that
  syncs bets/balance across devices (see db.py / util.js notes above). Verified
  end-to-end against a live server (signup claims anon data, cross-device login
  returns same account, dup-email 409, wrong-password 401, logout invalidates token).
- 🔑 **The user CANNOT spend any money** (told us 2026-06-26). Deploy uses
  **Render (free web service, NO card) + Neon (free Postgres, NO card)** — data lives
  in Neon so Render's ephemeral disk doesn't matter. Fly.io was ruled out because it
  requires a card on file (usage-billed → surprise-charge risk). `flyctl` IS installed
  (`C:\Users\timha\.fly\bin\flyctl.exe`, v0.4.61) and `fly.toml` exists if he ever
  changes his mind, but **don't push him to Fly**.
- ✅ **DEPLOYED & LIVE (2026-06-26):** **https://no-risk-betting.onrender.com** —
  Render web service (free) building from the Dockerfile, backed by a free **Neon**
  Postgres DB via the `DATABASE_URL` env var. Accounts verified end-to-end on the LIVE
  Postgres backend: signup (claims anon id), cross-device login returns the same
  account + balance, wrong-password 401, dup-email 409, `/api/auth/me`. Render free
  tier sleeps after ~15 min idle (first request then takes ~30–60s to wake).
  - Deploy gotcha that bit us twice: pasting Neon's `psql 'postgresql://...'` connect
    snippet whole into `DATABASE_URL` crashed psycopg2 (`invalid dsn: missing "="
    after "psql"`). Fixed in code: `db._clean_db_url()` strips a leading
    `psql `/`export `/`DATABASE_URL=` and surrounding quotes, so any snippet form works.
  - psycopg2-binary installed locally too (for testing PG against Neon); irrelevant to
    local runs since no `DATABASE_URL` locally → SQLite.
- Neon password: was shared during setup but the user has **explicitly decided not to
  rotate it** (will delete the chat; not concerned). **Do NOT keep flagging this.**
- ✅ **SHIPPED & LIVE this session (2026-06-26)** — all verified on the live site:
  optional accounts (username/email + password, recovery code, **email reset via
  Brevo**, change/delete), **separate private username vs public display name**,
  **rate limiting** on auth, the full **social layer** (public-by-default bets,
  bets-private setting, anonymous names, leaderboard, all-bets + all-comments global
  feeds, per-market discussion in the detail left column, likes, moderation),
  **design overhaul pass 1** (SVG icons replacing emoji, refined tokens, wordmark),
  **top-nav Markets/Community tabs**, **header account button**, **"?" help glossary**,
  and assorted cleanups (no Qty column, tidy "Your bets on this market" cards).
  Working tree is clean; every change committed + pushed to `origin/main` (Render
  auto-deploys). SW cache at `nrb-shell-v16`.
- ✅ **"Our Purpose" page (2026-06-27, SW `nrb-shell-v30`)** — a mission/about section in
  the burger menu making the case for *why* this app uses fake money. A creator note + a
  summarized version (stat callouts + bullets) sit on top; a **"Learn more"** toggle reveals a
  full, **cited research paper** on the harms of real-money sports betting (the rigged math/vig,
  post-PASPA financial damage, loss concentration on a vulnerable few, problem-gambling/mental-
  health/suicide data, and predatory industry practices — VIP grooming, banning winners, push-
  notification dark patterns). Sourced via a multi-agent **deep-research** pass + adversarial
  fact-checking; **24 references, each with a direct working URL** and auto-numbered inline
  citations. New files `purpose.js`/`purpose.css`; drawer item + route added. (Backlog idea the
  user wanted: educate users on the negatives & the app's purpose — done.)
- ✅ **SPREAD / TOTAL betting lines (2026-06-27, SW `nrb-shell-v29`)** — game detail
  pages now show a **"More ways to bet"** card with slider-style **margin-of-victory
  (spread)** and **over/under (total)** bets, exactly like mainstream sportsbooks
  (slide to 1.5 / 2.5 / 3.5…). Pulled from Kalshi's sibling SPREAD/TOTAL ladder
  series (same event suffix); each rung is a real market so betting reuses the
  normal fill/quote path. New `/api/lines` endpoint + `kalshi.fetch_game_lines`;
  detail.js `loadLines()`/`renderLines()` + the slider UI; verified end-to-end on a
  live server (lines fetched, quote + Under/Over bets placed with correct labels).
  Only ~15% of games (the major/liquid ones) carry these ladders; non-game markets
  and games without them simply don't show the card.
- ✅ **SHIPPED & LIVE 2026-06-27 (earlier this session)** — all pushed to `origin/main`,
  SW cache **`nrb-shell-v28`**. Each item is detailed in the per-file
  sections above; summary:
  1. **Community polish** — bet cards show the OUTCOME backed (not just market+amount);
     comments capture the live score/clock at post time (`comments.game_state`); a combined
     **"Live"** feed when total activity ≤ 25 (else the 3 firehose tabs).
  2. **Favorite & hide categories** — ☆ star floats a category to the top; ✕ hides it
     (still searchable); a **"+"** popover re-adds hidden ones; **"You may like"** suggests
     related categories when you favorite one. (`NRB.favCat`/`hiddenCat`, `RELATED` map.)
  3. **Reset = new "season/period"** (no longer wipes data) — balance back to $1,000, past
     bets kept and viewable via a **stats period picker** (current / previous / overall);
     the reset top-up never counts as profit. (db `season` columns + `seasons` table,
     `/api/seasons`, `/api/analytics?season=`.)
  4. **Burger drawer scrolls** — the bottom items (incl. **Reset balance**) are reachable.
  5. **Price alerts + real notifications center** (the 🔔 works now) — set a target % from a
     market; a poller fires a notification when crossed; **unread badge** on the burger.
     (`alerts`/`notifications` tables, `/api/alerts`, `/api/notifications`, notifs.js/css.)
  6. **Sports futures/awards markets** — curated marquee non-game markets (WC Winner, Golden
     Boot, WC awards, Ballon d'Or, NBA/WNBA/NFL titles & MVPs) grouped into 6 favoritable
     sections (`FEATURED_FUTURES`). Top feed section is now **"★ Your favorites"** (starred
     markets). **Live games highlighted red** in the feed; scheduled games show **kickoff in
     the viewer's local timezone** on the detail (`occurrence_ts`).
  7. **Detail chart fixes** — `NRB.odds.chance()` fixes illiquid long-shots that showed
     **100% / 1.00x** (now real implied %); chart plots only the **top 3 outcomes** (+ your
     selection); **y-axis auto-scales** to the data peak (bottom 0%); noise **smoothing**
     (edge-preserving — spikes/oscillation flattened to the middle, sustained moves kept
     sharp); tooltip always shows the **date/time** (was a raw epoch number).
  8. **Independent multi-markets** — events like "Teams to Win All 3 Group Matches" (each
     option its own Yes/No) now show the full outcome list + a **Yes/No segment** so you
     bet Yes or No on each (`exclusive` flag on `/api/market`, `S.exclusive`).
  9. **Broad titles** — multi-outcome detail header shows the broad event question (e.g.
     "Golden Boot Winner") not one option; header shows the **top-3 contenders'** chances.
  - **Standing instruction (memory `always-push-to-site`):** commit + push to `main`
    yourself after changes — don't wait to be asked. (User confirmed 2026-06-27.)

### How accounts/social were tested (no JS engine locally)
Backend verified two ways: (1) data-layer scripts against a temp SQLite db and against
the **live Neon** DB (psycopg2-binary is pip-installed locally for this), (2) curl
against a locally-run `python server.py` AND against the live Render URL. Frontend JS
is verified by careful reading + a backtick-parity check (`grep -o '\`' file | wc -l`
must be even) since there's no JS engine. **Always test new endpoints live after deploy.**

## ⚠️ The one real blocker to a PUBLIC launch (legal, not code)
**Kalshi's Data Terms** restrict publicly displaying/redistributing their market data
without written consent; **ESPN endpoints are unofficial.** Fine for private/personal/
educational use; before promoting publicly the user should get Kalshi permission/a data
license and review ESPN terms. Keep reminding him of this — it's the gating item, not
any code.

## Backlog / ideas the user liked but hasn't built (NO AI/3rd-party tools allowed)
- ✅ DONE: global leaderboard (ranked by accuracy/ROI) + public profiles + social feed.
- ✅ DONE (2026-06-27): Notification center + price alerts (the 🔔 is now real — see
  notifs.js + alerts/notifications API above).
- ~~"Live now" section~~ — user did NOT want a separate section; instead live games are
  **highlighted red** in the feed (done 2026-06-27, `NRB.isLiveGame`).
- Daily forecast challenge / streaks / badges (the leaderboard exists to build on).
- Edge / Kelly bet sizing (uses predict-then-bet edge).
- Market resolution rules + related markets on detail; share score-card image; sounds.
- Design overhaul **pass 2**: per-view density/layout polish (portfolio, profile,
  analytics, detail) on top of the new tokens/icons.
He often says "do all of the above" or "pick the next N and do them autonomously."
He has told us: **when you recommend an option, just do it — don't ask** (see the
project memory `just-do-it-no-asking`), and he **can't spend any money** (`budget-no-spend`).

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
