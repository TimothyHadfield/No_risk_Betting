# BUILD SPEC / CONTRACT — v2 Dark redesign (read this first)

Single source of truth for the team. Don't edit files you don't own; don't change
this contract. The app shows REAL live Kalshi odds and places FAKE bets.

## This round's goal
Redesign into a polished **dark, mobile-style, responsive** app:
- **Default dark mode**, dim/muted palette.
- Home = a **"For You" feed of horizontal carousels** (Netflix-style), with a
  **one-line horizontally-scrollable section bar** pinned under the top bar.
- **Market boxes** (the core unit): title on top, then 2–3 option **rows**; each row
  is `icon · name · multiplier · probability` (in that column order).
- **Flags (emoji) for countries + monogram badges** otherwise (offline, no deps).
- **Burger menu** (top-left) opens a left **drawer**: Settings, Account, Your
  Activity, Watchlist, Notifications (placeholders OK; Your Activity → Portfolio,
  Watchlist → favorites list, Analytics reachable from drawer).
- **Multiplier** = decimal odds (total return): `mult = 1 / price` → e.g. 0.52 → 1.92x.
  Show probability alongside (price as %).
- Keep the existing **detail view** (chart + order book + trade panel) — restyled dark,
  plus a **favorite ☆ star**.

## File ownership (STRICT)
| Owner | Files |
|-------|-------|
| Overseer | `index.html`, `styles.css`, `util.js`, `browse.js`, `browse.css`, `server.py`, `kalshi.py`, `BUILD_SPEC.md` |
| Detail agent | `detail.js`, `detail.css` |
| Portfolio/Analytics agent | `portfolio.js`, `analytics.js`, `views.css` |

## Dark design tokens (in styles.css `:root`) — USE THESE
```
--bg:#0b0e13  --bg-elev:#141a23  --bg-elev2:#1c232f  --border:#232b38
--text:#e8edf4  --muted:#8b95a6  --faint:#5b6575
--accent:#27d18b (mint)  --accent-dim:#1b8f63
--yes:#27d18b  --yes-soft:#11past… use rgba(39,209,139,.14)
--no:#fb5a6a   --no-soft: rgba(251,90,106,.14)
--up:#27d18b  --down:#fb5a6a  --gold:#e7b850
--radius:14px --radius-sm:10px --radius-pill:999px
--shadow:0 2px 10px rgba(0,0,0,.35)
font: Inter, system-ui, "Segoe UI", Roboto, Arial, sans-serif
```
Shared atoms in styles.css: `.card .btn .btn-primary .btn-ghost .btn-yes .btn-no
.pill .pill.active .chip .chip.active .badge .badge.yes .badge.no .tnum .muted
.pos .neg .skeleton .section-title`. Dark by default. Prefix any extra component
CSS with your view name (`.detail-*`, `.pf-*`, `.an-*`).

## Shared runtime `window.NRB` (util.js — STABLE)
Existing (unchanged): `api, fmt.{usd,cents,pct,signed,vol,cls,esc,timeAgo,dateShort},
state.account, refreshAccount, onAccount, toast, el, views, go, openMarket, current`.

NEW this round (rely on these):
```
// odds
NRB.odds.mult(price)        // 0.52 -> 1.9230…  (1/price; null if price<=0)
NRB.odds.multStr(price)     // 0.52 -> "1.92x"   (— if no price)
NRB.odds.prob(price)        // 0.52 -> "52%"
// icons (returns an HTML string: emoji flag for a country, else a colored monogram badge)
NRB.icon(name)              // "Portugal"->🇵🇹 ; "Los Angeles Lakers"->LAL badge ; "Tie"->handshake ; "Yes"/"No"->check/x
// favorites (localStorage) — powers Watchlist + For You
NRB.fav.has(ticker) -> bool ; NRB.fav.toggle(ticker) -> bool ; NRB.fav.list() -> [ticker]
NRB.fav.onChange(cb)        // cb() whenever favorites change
// view history (localStorage) — powers For You
NRB.history.addView(eventTicker, category) ; NRB.history.recent(n) -> [eventTicker]
NRB.history.topCategories(n) -> [category]
// shared components
NRB.box(event, opts?) -> HTMLElement     // the market box (see layout below). opts.compact
NRB.carousel(title, events, opts?) -> HTMLElement  // labeled horizontal scroll row of NRB.box
// drawer (burger) — overseer-owned; just exists
NRB.drawer.toggle()/open()/close()
```

### NRB.box(event) layout (the core unit)
- Title row on top: event.title (3–5 words ideal). A ☆/★ favorite toggle in the
  corner (NRB.fav). Clicking the box body → `NRB.openMarket(firstMarket.ticker)`.
- Then up to 3 option ROWS. For an event with:
  - 1 market (binary): two rows — **Yes** (price=yes_ask) and **No** (price=no_ask).
  - 2–3 markets: one row per market, name = `market.yes_sub_title`, price = `yes_ask`.
  - >3 markets: top 3 by yes price, then a "+N more" affordance.
- Each row, left→right: **icon** (NRB.icon(name)) · **name** · **multiplier**
  (NRB.odds.multStr, accent color, bold) · **probability** (NRB.odds.prob, muted).
- Row click → `NRB.openMarket(market.ticker, side)` (side 'yes' for candidates/Yes,
  'no' for the No row).

## API contract (unchanged endpoints still valid; NEW one added)
Existing: `/api/categories, /api/markets?category=&q=&limit=, /api/market/{ticker},
/api/history?ticker=&range=, /api/quote, POST /api/bets, /api/bets,
/api/bets/{id}/close, /api/bets/{id}/force_settle, /api/settle, /api/account,
/api/account/reset, /api/analytics`. Shapes per prior contract (MARKET has
ticker,title,yes_sub_title,no_sub_title,yes_bid,yes_ask,no_bid,no_ask,last_price,
volume,volume_24h,open_interest,close_time,status,result; prices dollars 0–1).

NEW:
- `GET /api/home` → `{sections:[{key, title, events:[EVENT…]}], loading}`
  EVENT = `{event_ticker, series_ticker, category, title, volume_24h, markets:[MARKET…]}`.
  Sections are ordered: Trending, then live sports leagues (World Cup, NBA, …), then
  big categories (Politics, Economics, …). The frontend builds the "For You" row
  itself from NRB.fav + NRB.history over this data.

## Agent tasks this round
**Detail agent** (`detail.js`,`detail.css`): restyle the existing detail view to the
dark tokens; ADD a favorite ☆ star (NRB.fav.toggle) in the header; show **multiplier
(NRB.odds.multStr) and probability** on the Yes/No trade toggle and order book; put a
flag/monogram (NRB.icon) next to the market/option names and in the header. Keep the
price chart, time-range pills, order book, live 5s polling, and trade/quote/bet flow
fully working. Chart on dark bg: mint line `#27d18b`, gridlines `#232b38`, muted ticks.

**Portfolio/Analytics agent** (`portfolio.js`,`analytics.js`,`views.css`): restyle to
dark tokens. Portfolio: positions + history; show entry/now as **multiplier +
probability** (NRB.odds) in addition to P&L; clickable titles → NRB.openMarket; Sell +
Settle▸ actions (unchanged endpoints). Use NRB.icon next to names. Analytics: dark
metric cards (Realized P&L, ROI, Win rate, Brier, Log loss, #scored) + calibration
scatter (diagonal ref) + equity line; charts styled for dark bg.

Keep it pretty: rounded cards, dim surfaces, mint accents, tabular numerals, generous
spacing, smooth touch scrolling. Use NRB.fmt/odds/icon and NRB.fmt.esc() for injected text.
