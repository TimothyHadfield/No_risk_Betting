# No-Risk Betting — progress (handoff for Claude)

## START HERE
_Last updated 2026-09-21. For Claude only; Tim doesn't read this. Catch-up authorizes nothing: only "Authorized next steps" below is approved work._
1. Read this file (it's short on purpose). No `direction.md` exists; the project memories (`~/.claude/projects/c--Users-timha-OneDrive-Desktop-my-website-Code-Projects-No-risk-Betting/memory/`) and Standing instructions below carry Tim's intent.
2. Skim the last 3 entries of `chat.md`.
3. Need old detail (per-file essays, how each 2026-06 feature works, full API notes)? `docs/archive/progress-2026-09-21.md` is the full pre-migration PROGRESS.md, byte-identical. Kalshi-vs-us analysis: `KALSHI_COMPARISON.md`. Deploy steps: `DEPLOY.md`.

## Goal right now
A free, public, fake-money betting site on real Kalshi odds, as a harm-reduction/forecasting-skill tool. The app works and is live. Public promotion waits on a legal step only Tim can take (see Status).

## Status
_Measured 2026-09-21: branch `main` clean and even with `origin/main`. Last code commit `15239cc` 2026-07-19. Live `/healthz` → 200 `{"ok": true}`. Live `sw.js` serves `nrb-shell-v41`, which matches the repo, so the live build is current._

| Area | State | Notes |
|---|---|---|
| **Public launch / promotion** | **BLOCKED on Tim** | Kalshi's Data Terms restrict public display/redistribution of their market data without written consent. Tim has to ask Kalshi for permission or a data license and review ESPN's terms (ESPN endpoints are unofficial). Claude can't do this. Personal/educational use is fine meanwhile. |
| Core app (markets, detail, betting w/ honest fills, parlays, predict-then-bet, Forecasting Score, search, light/dark, PWA) | live | Built 2026-06; verified headless/API then (see archive). |
| Hosting | live | https://no-risk-betting.onrender.com · Render free web service (Dockerfile) + Neon free Postgres. Pushing `main` auto-deploys. |
| Optional accounts (username/email + password, recovery code, email reset via Brevo, change/delete, rate limiting) | live | Verified end-to-end on live Postgres 2026-06-26 (signup claims anon id, cross-device login, 401/409 paths). |
| Social layer (public-by-default bets, display names, leaderboard, feeds, per-market chat, likes, moderation) | live | 2026-06-26/27. |
| Seasons (reset = new period, past stats kept, period picker) | live | 2026-06-27. |
| Price alerts + notifications center | live | 2026-06-27. |
| Sports futures/awards, spread/total ladders, live-game red highlight, kickoff times | live | 2026-06-27. |
| "Our Purpose" page (cited research, 24 refs) | live | Creator note is generic first-person. Tim may want to personalize it (his wording call, so don't rewrite it uninvited). |
| Mobile-native pass (bottom tab bar, sheets replacing prompt/confirm, sticky bet bar, success animation, iOS safe-area/zoom fixes, immersive detail, boxless chart) | live | 2026-07-17, SW v34→v40. No device verification recorded (see NOT verified). |
| Betting-flow overhaul (every bet option shows odds only, then routes to `bet.js` page) | half-built | Margin/total bars and the mobile sticky bet bar route to the bet page. Other entry points (outcome boxes on desktop, etc.) not yet confirmed. Tim flagged this as "major betting changes". |
| Kalshi borrow list (`KALSHI_COMPARISON.md`) | half-built | Done 2026-07-19: #3 "How this market resolves" (rules_primary) and #2 subtle motion (`NRB.animateCount`). Not done: #1 per-card sparklines (+hot/moving chip), #4 portfolio clarity audit, #5 consistency audit (ordering, button % = chart %), #6 maybe a "recent activity" strip. None of these are recorded as OK'd. |
| Backlog Tim liked (not started) | parked | Daily forecast challenge/streaks/badges · Edge/Kelly sizing · share score-card image · sounds · design pass 2 (per-view density) · related markets on detail. |

## Authorized next steps
- None recorded as explicitly OK'd for a new chat. Tim's general rule (2026-07-17) is "from now on all suggestions should default to the recommended option", so once he asks for work, pick and do the recommended item. Catch-up alone still authorizes nothing.

## Standing instructions (Tim's words)
- "if you recommend an option, just do it; don't ask me anything." (2026-06-26)
- "from now on all suggestions should default to the recommended option." (2026-07-17). This covers taste calls too (colors, fonts, logo). Pick, do, and say what you chose.
- "always push the code to the site yourself" (2026-06-26). Commit and `git push origin main` after each verified change. Push straight to `main` (Render watches it) and don't branch. Stage by explicit path, never `-A` (global rule).
- Can't spend any money (2026-06-26): free tiers only, **no card on file** (usage billing risks surprise charges). Lead with the no-card path and flag any spend risk.
- **No AI/third-party tools integrated into the product.** No Claude/AI or other third-party tools inside the app. (Brevo email via stdlib HTTP was accepted for password reset. See D9.)
- Wants this to become a **free public website anyone can use**.
- Mission: real-money sports betting is "actually really bad and doesn't make sense". The app gives the thrill "without ruining their life financially" and should educate users on the negative side effects and the predatory nature of the industry. Never add real money or anything that profits from user losses. Measure accuracy, not amount wagered.
- **Don't push him to Fly** (needs a card). `fly.toml` stays in case he changes his mind.
- Neon password was shared during setup. Tim **explicitly decided not to rotate it** ("will delete the chat; not concerned"). **Do NOT keep flagging this.**
- Kalshi data-license blocker: the old notes said "Keep reminding him of this — it's the gating item, not any code." Tim has NOT accepted this risk, so raise it when public launch or promotion comes up, not in every reply.
- Explain Git/hosting steps simply when Tim has to do them himself.
- "Always test new endpoints live after deploy."
- Bump `CACHE` in `sw.js` on every shell change, and add any new JS/CSS file to its `SHELL` list. (Currently `nrb-shell-v41`.)
- Vocabulary: he often says "do all of the above" or "pick the next N and do them autonomously".

## Traps / rules that bite
- **Old env notes are stale (measured 2026-09-21):** Node IS now installed (`C:\Program Files\nodejs\node.exe`), and `python` is 3.11.9 (the notes said no Node, Python 3.14). Use `node --check file.js` to syntax-check the frontend. There's still no browser-run of the JS here, so use `~/.claude/tools/phone-view.mjs` for visuals.
- The project folder moved to `Code Projects/Sports & Predictions/No_risk_Betting`, but the project memory folder is still keyed to the old path (`...Code-Projects-No-risk-Betting`). Read memories from there.
- The server must be a persistent background process: `python server.py` with the tool's background option, never a trailing `&` (it died between turns). Restart: `taskkill //F //IM python.exe`, then relaunch. "localhost failed to load" almost always means the server is down.
- Restart the server after backend edits. Frontend files are served fresh from disk. Hard refresh (Ctrl+Shift+R), and the network-first SW handles the rest.
- A duplicate same-scope `const` once broke only the markets page (browse.js: "can't reach browsing page", other views fine). `node --check` catches this now. The old bracket-balance helper did not.
- The old bracket-balance helper gives a false "IMBALANCE" on `util.js` (regex literals). That's expected. The helper lived in a scratchpad and is probably gone.
- Kalshi 403s without a browser User-Agent (handled in `kalshi.py`).
- **Render blocks outbound SMTP** (`OSError 101`). Use the Brevo HTTPS API there, and SMTP only on hosts that allow it.
- Pasting Neon's whole `psql 'postgresql://…'` snippet into `DATABASE_URL` crashed psycopg2 (twice). Fixed by `db._clean_db_url()`, which strips `psql `/`export `/`DATABASE_URL=` and quotes.
- Render free tier sleeps after ~15 min idle, so the first request takes ~30–60 s.
- The server binds `0.0.0.0`, so it's reachable by others on the same Wi-Fi. For local-only use: `HOST=127.0.0.1 python server.py`.
- `data.db` (SQLite) is git-ignored and local-only. Locally no env vars are set, so it runs SQLite with no email.
- Windows can't render flag emoji, so use flag images (flagcdn).
- iOS Safari ignores `user-scalable=no`. Zoom is blocked with JS gesture `preventDefault` + `touch-action: manipulation`.
- Horizontal lock uses `overflow-x: clip` (not `hidden`) so the sticky top bar and inner carousels keep working.
- Illiquid long-shots whose only ask is the $1.00 placeholder showed 100% / 1.00x. Use `NRB.odds.chance(m)` for every displayed %/odds. The buy math still uses the real ask.
- `util.js` `drawerAction` home/community/account branches are dead but harmless (drawer slimmed 2026-06-27).
- The memory `always-push-to-site` says "stage everything". Global rule wins: stage by explicit path.

## Decisions
- D1 · 2026-06 · Real Kalshi odds, not sandbox/mock. Mock-odds demo apps are useless, and that's the origin of the project.
- D2 · 2026-06 · Multiplier = decimal odds (1/price), shown with implied %. The $-wager framing ("bet $X → win $Y") beats Kalshi's cents/contracts for this audience.
- D3 · 2026-06 · Sports show ALL outcomes (A/B/Tie), never "No", gated on Kalshi `mutually_exclusive`. Threshold ladders keep Yes/No.
- D4 · 2026-06 · Icons: flagcdn images for countries, ESPN logos for teams, monogram fallback.
- D5 · 2026-06 · Predict-then-bet is opt-in, ignorable, blind-by-default, with a global toggle.
- D6 · 2026-06 · Featured leagues auto-appear in season: WC, NFL, NBA, MLB, NHL, WNBA, EPL, UCL, MLS, La Liga, Serie A, Bundesliga, Ligue 1, ATP, WTA, NCAA FB/BB.
- D7 · 2026-06 · Backend is Python stdlib only (`http.server`), vanilla-JS SPA, no build step or frameworks. At the time there was no Node on the machine.
- D8 · 2026-06-26 · Render free + Neon free over Fly.io, because Fly needs a card. Data lives in Neon, so Render's ephemeral disk doesn't matter.
- D9 · 2026-06-26 · Email reset via the Brevo HTTPS API (stdlib `urllib`, no SDK) over Gmail SMTP, because Render blocks SMTP. The permanent recovery code still works when email isn't configured.
- D10 · 2026-06-26 · Dual DB: SQLite by default, Postgres when `DATABASE_URL` is set. One SQL set plus a translation layer and `_with_retry` for Neon idle-disconnects. `psycopg2-binary` is imported only in prod.
- D11 · 2026-06-26 · Anonymous-first multi-user (browser id in `X-User-Id`). Signup reuses the anon id so bets carry over. `_uid()` prefers `X-Session-Token`.
- D12 · 2026-06-26 · The username (login) is PRIVATE and the display name is PUBLIC. Only display name and bio are ever exposed, never login or user_id.
- D13 · 2026-06-26 · Bets are public by default. They're hidden per bet (`bets.hidden`) or all at once (`bets_private`). Anonymous bets show as "anonymous".
- D14 · 2026-06-26 · The leaderboard ranks by skill (ROI/Brier/win-rate), opt-in (`is_public`), never by profit $.
- D15 · 2026-06-26 · Community shows one combined "Live" feed while public activity ≤ 25 (`LIVE_THRESHOLD`), and splits into Leaderboard / All bets / All comments past that.
- D16 · 2026-06-26 · Profile and privacy editing lives in Account settings, not on the Community page.
- D17 · 2026-06-27 · Reset = new season. Open bets are voided, the balance goes back to $1,000, and past data is kept. The top-up never counts as profit. The portfolio shows the current season only, and the social feed spans all seasons.
- D18 · 2026-06-27 · Futures are a tight curated allowlist (`FEATURED_FUTURES`, ~24 events / 6 groups). Niche qualifiers and trivia are excluded by design.
- D19 · 2026-06-27 · Live games get a red highlight in the feed (`NRB.isLiveGame`, from kickoff + a per-sport window, no ESPN call) instead of a separate "Live now" section.
- D20 · 2026-06-27 · The drawer went from 13 items to 9 in two groups (items already in the top bar were dropped).
- D21 · 2026-06-27 · The Purpose page keeps only sourced claims, with direct verified URLs. Paywalled ones are flagged and working papers labeled.
- D22 · 2026-06-27 · Spread/total are real Kalshi ladder markets, so they reuse the normal quote/bet path.
- D23 · 2026-07-17 · Detail page is immersive and minimal: category + title, a matchup block for games, chat in a slide-up sheet, and a chrome-free chart with end labels and a touch scrubber. Range pills are 1D/1W/1M/ALL. This supersedes the 06-27 top-3 header, left-column discussion, tooltip box and y-axis.
- D24 · 2026-07-17 · All `window.prompt/confirm` calls were replaced by `NRB.sheet` slide-up sheets.
- D25 · 2026-07-17 · Visual identity: emerald `#10b981`, red `#f0475b`, Space Grotesk headings, Inter body, and a refined chart-square mark. It's kept distinct from Kalshi's mint on purpose.
- D26 · 2026-07-19 · Borrow from Kalshi only harm-aware, on-mission patterns (clarity, trust, education). "Better" never means "more addictive". Keep P&L framing calm and put accuracy/skill in the foreground.
- D27 · 2026-07-19 · The bottom nav is hidden on the immersive detail/bet views on purpose. It's not a bug.

## NOT verified
- The 2026-07-17 mobile pass and the 2026-07-19 borrows on a real iPhone at 390px. The commits record no device or screenshot check · needs phone or `phone-view.mjs`.
- Consistency: matchup order == outcome-box order == chart-line order, and button % == chart % (KALSHI_COMPARISON §11) · needs a live market check.
- Brevo reset email deliverability. It's a new sender, so it may land in spam · needs a real inbox.
- Coverage figures from 2026-06-27 (~15% of games have spread/total ladders, ~5% of WC fixtures lack a kickoff time) · needs current Kalshi data.
- Neon schema migrations were "verified against live Neon" 2026-06-26/27 only. The 07-17/19 commits appear to add no DB columns (siblings status/result and rules_primary are API/normalize fields). That's reasoned, not measured.
- Kalshi research items marked "inferred" (e.g. Kalshi's exact tab labels) · needs a hands-on screenshot pass.
- Legal status of Kalshi/ESPN data use for a public site · needs Tim (see Status).
- Tests: there is **no test suite**. Only syntax checks have been measured (see Map).

## Rejected / parked
- ~~Separate "Live now" section~~ · 2026-06-27 · Tim didn't want it. Live games are highlighted red instead.
- ~~Fly.io hosting~~ · 2026-06-26 · needs a card on file. Don't push it.
- ~~Gmail SMTP on Render~~ · 2026-06-26 · Render blocks SMTP. Brevo HTTP is used instead.
- ~~Rotating the Neon password~~ · 2026-06-26 · Tim declined. Don't re-raise.
- ~~Niche futures (per-group/region qualifiers, "first song", host trivia, 45 per-team goal totals)~~ · 2026-06-27 · clutter. Kalshi only offers qualifiers in those niche forms.
- ~~Weak stats on the Purpose page ("only 3% of bettors profit", "700% more notifications")~~ · 2026-06-27 · no primary source.
- ~~"Qty"/contracts column~~ · 2026-06-26 · meaningless in a $-framed app.
- ~~Top-3 contenders header, 1H/6H/Game range pills, stats card, y-axis/gridlines~~ · 2026-07-17 · de-cluttered away (D23).
- ~~KYC / deposits / cash sign-up bonuses~~ · 2026-07-19 · anti-mission.
- ~~Profit-$ leaderboards, "top trader" alerts, copy-trading circles~~ · 2026-07-19 · FOMO/loss-chasing amplifiers.
- ~~Default-on marketing/re-engagement pushes~~ · 2026-07-19 · anti-mission. Alerts stay user-set only.
- ~~Order-book depth ladders, limit orders (IOC/EOD), maker-fee incentives, candlesticks~~ · 2026-07-19 · they reward frequent trading and add trader complexity.
- ~~Big pulsing live-$ P&L framing~~ · 2026-07-19 · keep P&L calm.
- ~~GIFs/reaction candy in chat~~ · 2026-07-19 · engagement candy, mostly skip.

## Map
- `server.py` · ThreadingHTTPServer, routes, JSON API, static files, `_safe()` dispatch. Background threads: events-cache refresher, settlement poller, `check_price_alerts()`. `/healthz`.
- `kalshi.py` · Kalshi public data adapter (no key): events cache (90 s), `FEATURED_SERIES`, `FEATURED_FUTURES`, `fetch_game_lines` (spread/total), `normalize_market` (`occurrence_ts`, `floor_strike`, `rules_primary`).
- `espn.py` · unofficial ESPN adapter for live score/clock (`game_state`) and team logos (`logo_for`).
- `db.py` · dual SQLite/Postgres layer. Tables: accounts, bets, parlays, parlay_legs, equity_history, seasons, users, sessions, profiles, comments, reactions, reports, alerts, notifications. `_migrate()` is idempotent. `_clean_db_url()`.
- `fills.py` · order-book-walk fill simulation plus the Kalshi fee (0.07·C·P·(1−P)). `analytics.py` · Brier, log-loss, calibration, by-category, streaks, `forecast_stats`. `mailer.py` · Brevo HTTP or SMTP, with `is_configured()`.
- `index.html` · app shell: top bar, nav tabs, bottom tab bar, drawer, auth modal (login/signup/recovery/account/profile & privacy/change-pw/delete).
- `util.js` · shared `window.NRB` runtime (a stable contract): api, fmt, odds (`chance`), icon, fav/favCat/hiddenCat, box/carousel, slip, router, auth, help/glossary, seasonPicker, isLiveGame, sheet, celebrate, animateCount.
- `browse.js/.css` home carousels, favorites, "You may like", hide/re-add categories · `detail.js/.css` market detail (largest) · `bet.js/.css` dedicated bet page · `portfolio.js` positions/history/parlays · `profile.js/.css` Forecasting Score · `analytics.js` charts · `social.js/.css` Community + profiles + threads · `notifs.js/.css` alerts/notifications · `purpose.js/.css` Our Purpose · `slip.js/.css` parlay slip · `views.css`, `styles.css` (tokens, light/dark) · `sw.js` network-first SW · `manifest.json`, `icon.svg`.
- `Dockerfile`, `Procfile`, `runtime.txt`, `requirements.txt` (only `psycopg2-binary`), `fly.toml` (unused), `DEPLOY.md` · deploy. `BUILD_SPEC.md` · original spec. `README.md`. `KALSHI_COMPARISON.md` · Kalshi comparison + borrow list.
- API (full notes in archive): `/healthz`, `/api/categories`, `/api/markets`, `/api/home`, `/api/market/{ticker}` (siblings, exclusive, status/result), `/api/history`, `/api/lines`, `/api/game`, `/api/quote`, `/api/bets` (+`/{id}/close`, `/force_settle`, `/public`), `/api/settle`, `/api/parlays`, `/api/account`, `/api/summary` (+unread), `/api/account/reset`, `/api/analytics?season=`, `/api/seasons`, `/api/auth/{signup,login,request-reset,recover,password,delete,logout,me}`, `/api/me/profile`, `/api/u/{handle}`, `/api/leaderboard`, `/api/feed`, `/api/comments` (+`/all`, `/{id}/delete`, `/{id}/report`), `/api/reactions`, `/api/alerts` (+`/{id}/delete`), `/api/notifications` (+`/read`, `/{id}/delete`).
- Env (set in Render): `DATABASE_URL`, `BREVO_API_KEY`, `BREVO_SENDER`, optional `ADMIN_HANDLES`. Local: `PORT` (8765), `HOST` (0.0.0.0), `NRB_DB` (data.db).
- Run: `python server.py` → http://localhost:8765 (background option).
- Tests: **no test suite exists.** Last run 2026-09-21: `node --check` on all 12 `*.js` passed 12/0, and `ast.parse` on all 7 `*.py` passed 7/0. Syntax only, no behavior tested.
- Live: https://no-risk-betting.onrender.com · hosting: Render free + Neon free Postgres · repo: github.com/TimothyHadfield/No_risk_Betting (public).
