# Kalshi vs No-Risk Betting — design & feature comparison notes

Working notes comparing our paper-trading app to Kalshi's real-money app, to decide
what to borrow. Sourced from a 3-agent web-research pass (2025–2026) + our own deep
knowledge of Kalshi's data model (we integrate their public API) + our app internals.

**Prime directive that overrides every "Kalshi does X better":** our app exists for
the *opposite* reason Kalshi does — real odds, **fake money**, harm reduction (see
memory `app-mission-harm-reduction`). "Better for us" = clearer / more useful / more
native-feeling. It never means "more addictive." Anything that's only "better" because
it moves real money or maximizes engagement is deliberately **not** copied.

Legend: ✅ = we're already good / ahead · 🟡 = worth borrowing · ⛔ = Kalshi pattern to avoid

---

## 1. Navigation & app structure
- **Kalshi:** bottom tab bar (Markets / Portfolio / Social / Account, per reviews — exact
  labels unconfirmed); hamburger for Notifications/Watchlist/Settings/Support; category
  strip under the top bar; search-first home.
- **Ours:** bottom tab bar (Markets / My Bets / Community / Score) ✅ *(just added)*; burger
  drawer for secondary items; sticky category chip bar; search on the browse view.
- **Verdict:** ✅ At parity now. Our tab bar + drawer split mirrors theirs. Their "Social"
  as a primary tab ≈ our "Community" tab.
- **Action:** none needed; structure is sound.

## 2. Home / discovery feed
- **Kalshi:** category thumbnails; market **cards show a mini sparkline chart**, current Yes
  price, red/green change indicator, volume/open-interest, time-to-close, a "hot" flag.
- **Ours:** horizontal carousels by category, favorites row, "you may like"; cards show
  odds/multiplier + implied %, team/flag icon, live-game red highlight. **No sparkline, no
  volume, no time-to-close, no "hot" cue on the card.**
- **Verdict:** 🟡 Kalshi's cards are more *scannable at a glance* — the sparkline especially
  makes "odds are moving" tangible, and the change indicator adds momentum.
- **Action (borrow):**
  1. **Per-card sparkline** (last ~24h price line) — highest-value visual borrow. Needs a
     cheap history source per card (feasibility check: the events cache; may need a light
     `/api/spark` or reuse cached candles). ← flagged by 2 of 3 researchers.
  2. **A subtle "🔥 hot / high-volume" or "📈 moving" chip** on cards with big volume or a
     big recent % move (we already compute volume; live-game highlight is a precedent).
  3. Optional: small **volume** line on the card ("$12k vol") — we show it on the detail now.

## 3. Market detail & trading UX  *(confirmed by research)*
- **Kalshi:** market page = scrubable price-history line chart, order book / mirrored Yes/No
  **depth ladder** (price levels in ¢ + qty + depth bars), Yes/No order-entry with **two order
  types (Quick/market + Limit, IOC/EOD lifetimes)**, quantity entered as **# of contracts**,
  cost + payout + fee preview, **"Rules summary / Important Information" with a named
  authoritative resolution source per market**, binary $1/$0 settlement, comments/Ideas.
  Maker (resting limit) orders are **fee-free** — an incentive to trade more.
- **Ours:** boxless full-bleed scrubable chart (1D/1W/1M/ALL) with always-on end labels;
  minimal header (category, title, matchup for games); outcome boxes showing **multiplier +
  % chance** (not cents); **$ wager** entry (not contracts); dedicated bet page + sticky bet
  bar; spread/total slider bets; live chat sheet; predict-then-bet; "your position" card;
  price alerts. **No market rules / resolution-source shown.**
- **Verdict:**
  - ✅ Our chart is cleaner/more modern (no axis clutter, touch-to-reveal) — Kalshi is trending
    *more* dense and getting complaints for it. Keep ours.
  - ✅ **$ wager entry** beats their # -of-contracts entry for our audience. Keep.
  - ✅ We correctly **omit** the depth ladder, limit orders, IOC/EOD, and maker-fee incentives
    (all reward frequent trading / trader complexity). Don't add them.
  - 🟡 **Borrow: a "How this market resolves" + named data source** disclosure. Kalshi naming an
    authoritative source per market is a real trust pattern, and it's *educational* (on-mission).
    Feasible: Kalshi market objects carry `rules_primary`/`rules_secondary`; surface them.
  - 🟡 Their multi-outcome list is a clean ranked "candidate + % + tap" — we already do this
    (outcome boxes sorted by chance) ✅; their weakness (the %s don't sum to 100 and mislead
    beginners) is something we can *improve on* with a one-line note on independent multi-markets.
- **Action:** add the **resolution-rules + source disclosure** on detail (server: expose
  `rules_primary`/source; frontend: a collapsible "How this resolves" card).

## 4. Odds / price presentation
- **Kalshi:** **cents = %chance, 1:1** (65¢ ⇒ ~65%); UI shows **both** — percent "chance" on
  cards/headers, **cents on the Buy Yes / Buy No buttons**, paired to sum ~100. Their own
  content *does* use "risk 25¢ to win 75¢ / 3-to-1 / profit per contract" payout framing.
- **Ours:** implied **% chance** + a **decimal multiplier** (1/price) + a "→ win $X" readout;
  green/red. Deliberate divergence — our audience thinks in "bet $X → win $Y."
- **Verdict:** ✅ Ours is better *for our framing*. The "cents ⇒ %chance" equivalence is a nice
  teaching device but our %+multiplier is friendlier. Note: their "risk-to-win" framing is a
  gambling cue Kalshi arguably *shouldn't* use for a real-money product — but for **our
  fake-money, thrill-without-harm** product, the "→ win $X" framing is intentional and fine
  (it *is* the harmless thrill). Keep it.
- **Action:** none. (Honor the §11 rule: the % on a bet button must equal the % on the chart.)

## 4. Odds / price presentation
- **Kalshi:** cents per contract (62¢), doubling as the % chance; green Yes / red No.
- **Ours:** implied **% chance** + a **decimal multiplier** (1/price), green/red. This is a
  deliberate, correct divergence — our audience thinks in "bet $X → win $Y," not contracts.
- **Verdict:** ✅ Ours is better *for our framing*. Keep. (One consistency rule to honor,
  see §11: the number on a bet button must match the number on the chart.)

## 5. Portfolio / positions
- **Kalshi:** separates **cash balance vs portfolio (position) value**; per position shows
  # contracts, **cost basis (avg price), current mark-to-market value, unrealized P&L, max
  payout**; a "Cash Out" quick-sell; realized P&L/history under a Documents tab (buried).
- **Ours:** header Cash + Equity; portfolio view with open positions (live MTM, Sell,
  Settle), history, parlays. We removed the "# contracts" column (meaningless in $ framing).
- **Verdict:** 🟡 Kalshi's *per-position clarity* (cost basis → current value → unrealized
  P&L in one row) is a good model. ✅ We're right to drop contract counts and to not bury
  history as badly.
- **Action (borrow, harm-aware):** make each open position read cleanly as **Bet → Now worth
  → P&L** (we largely do on the detail "your position" card; audit the portfolio list for the
  same clarity). Keep P&L framing calm (see ⛔ below) — avoid big pulsing live-$ dopamine.

## 6. Onboarding / first-run
- **Kalshi:** email → verify → **KYC ID + selfie → deposit money → trade**; ~5 min; a **$10
  cash sign-up bonus** hook. No demo/paper mode.
- **Ours:** instant anonymous $1,000 fake balance, optional account later, onboarding modal
  explaining real-odds/fake-money + Forecasting Score. ✅
- **Verdict:** ✅ We are the deliberate anti-pattern to their deposit-first funnel — this is
  our whole reason to exist. Keep the fast, satisfying first-trade feel *without* money.
- **Action:** none — but make sure onboarding *sells the mission* (thrill without the harm).
  ⛔ Never add KYC, deposits, or cash bonuses.

## 7. Notifications & alerts
- **Kalshi:** user-set **price alerts**, **settlement** notifications, order-fill pushes,
  custom event alerts — but **marketing/re-engagement pushes ON by default** (reviewers warn
  of alert fatigue).
- **Ours:** price alerts + a notifications center; unread badge. No marketing pushes. ✅
- **Verdict:** ✅ At parity on the useful alerts, ahead on restraint.
- **Action:** ⛔ never add default-on marketing/re-engagement pushes. Keep alerts user-set only.

## 8. Social / community
- **Kalshi:** full "Kalshi Social" — feed, comments, reactions, GIFs, following, per-market
  live chat, editable profiles; **leaderboard ranked by NET PROFIT ($)** (day/week/month/all),
  opt-out by default; newer "inner circle" groups + "alerts from top traders" (copy-trading).
- **Ours:** Community page (leaderboard, all-bets/all-comments feeds), per-market discussion,
  public profiles, likes; **leaderboard ranked by ACCURACY/ROI/Brier**, opt-in.
- **Verdict:**
  - ✅✅ Our **skill-based leaderboard (Brier/accuracy)**, opt-in, is *fundamentally healthier*
    than their profit-dollar ranking. This is a core differentiator — lean into it.
  - 🟡 Their per-market **live chat** is richer than our thread (we have a live-chat sheet now);
    GIFs/reactions are engagement candy we can mostly skip.
  - ⛔ **Profit leaderboards, "top trader is betting X" alerts, copy-trading "inner circles"** —
    textbook FOMO/loss-chasing amplifiers. Never copy.
- **Action:** keep ranking on skill; consider surfacing **accuracy/streaks/badges** more
  prominently as the "status game" instead of money.

## 9. Visual design — color
- **Kalshi:** signature **mint/turquoise `#4DE4B2`** accent on a neutral black/white canvas;
  green=Yes/red=No; light+dark, follows OS. Restrained, "fintech not casino."
- **Ours:** refined **emerald `#10b981`** accent, deep neutrals, green/red, light+dark. ✅
- **Verdict:** ✅ Similar family, and **being distinct from Kalshi is good** (we show their
  odds — looking like a clone would be bad). Our emerald reads a touch more "money," theirs
  more "aqua/tech." Both valid. No change needed.
- **Action:** none. (Optionally soften our red slightly so loss/No feels less punitive — we
  already moved to a cleaner red.)

## 10. Visual design — type, icons, logo, density, charts
- **Type:** Kalshi = generic geometric grotesque + bold tabular numerals (font unconfirmed).
  Ours = **Space Grotesk headings + Inter body + tabular numerals** ✅ (arguably more
  characterful than theirs).
- **Icons/imagery:** Kalshi = photo/logo thumbnails per market for scannability. Ours = flag
  images / team logos / monograms ✅ (parity).
- **Logo:** Kalshi = lowercase wordmark, minimal, generic. Ours = wordmark + a distinctive
  chart-square mark ✅ (a real mark differentiates — slight edge to us).
- **Density:** Kalshi trending **too dense** ("every update fits less on screen," desktop-first
  hierarchy) — a top user complaint. Ours = deliberately minimal. ✅ Stay lighter than them.
- **Charts:** Kalshi = scrubable probability line + optional candlesticks. Ours = scrubable
  line, no candlesticks ✅ (candlesticks are too trader-y for our audience).
- **Micro-interactions:** **the frontier both Kalshi & Polymarket miss** — Robinhood leads with
  animated probability counters, smooth transitions, haptics on trade confirm. We have a
  bet-placed celebrate animation ✅; 🟡 room to add tasteful motion (animated % count-ups,
  smoother transitions).
- **Action (borrow):** 🟡 add **subtle motion** — animated count-up on the big % / balance
  numbers, smoother view/section transitions — the one place the whole category is weak and
  it fits a "thrill, safely" product.

## 11. Correctness lessons from Kalshi's failures (free wins — just don't repeat them)
Kalshi's own 2025–26 App Store complaints are a gift; audit ours against them:
- **Keep related data on ONE screen** — they split live %, score, P&L, and chart across
  screens; users lost confidence. → Our detail keeps chart + matchup + outcomes together;
  verify the sticky bet bar / bet page don't fragment the numbers.
- **Consistent option ordering** — their title says "Jets @ Bears" but buttons list Bears
  first → misclicks. → Ensure our matchup order == outcome-box order == chart line order.
- **Button % must equal chart %** — they show 37/63 on the chart but 56/56 on buttons. →
  Verify our `odds.chance()` feeds both the chart and the outcome boxes identically.
- **Don't hide the bottom nav** on deep screens unexpectedly (we intentionally hide it on the
  immersive detail/bet views — that's a deliberate, explained choice, not a bug).

---

## Prioritized action list (harm-aware borrows only)
1. **Per-card sparklines** on home market cards (+ optional "hot/moving" chip). *(biggest visual borrow)*
2. **Subtle motion**: animated count-up on big %/balance numbers; smoother transitions.
3. **"How this market resolves" + data-source** disclosure on the detail page.
4. **Portfolio per-position clarity** audit (Bet → Now worth → P&L), calm framing.
5. **Consistency audit** (§11): option ordering + button-%-matches-chart-% across matchup/boxes/chart.
6. *(maybe)* soft **"recent activity"** strip on a market — low-harm, adds life.

### Explicitly NOT doing (anti-mission)
- KYC / deposits / cash sign-up bonuses.
- Profit-$ leaderboards, "top trader" alerts, copy-trading circles.
- Default-on marketing/re-engagement pushes.
- Order-book depth ladders, limit orders, candlesticks (needless trader complexity).
- Big pulsing live-$ P&L dopamine framing — keep P&L calm; foreground accuracy/skill.

*All three research streams (nav/account, visual design, trading UX) complete. Sources in
the research transcripts; key ones: help.kalshi.com, news.kalshi.com, si.com prediction-market
reviews, thelines.com, sportsgambler.com, avark.agency (design patterns), portorocha.com
(Robinhood). Items marked "inferred" in research would benefit from a hands-on screenshot pass.*
