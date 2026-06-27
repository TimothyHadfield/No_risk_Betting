"""
Kalshi market-data adapter.

Read-only client for Kalshi's PUBLIC market-data API. No account, no API key,
no money is ever involved -- we only READ prices/order books. Paper bets live
in our own local database and never touch the real order book.

This module is the single abstraction point for the data source. To add
Polymarket later, implement the same normalized shapes (normalize_market /
fetch_orderbook) against its API and swap behind the same functions.

NOTE on data terms: Kalshi's Data Terms of Use restrict public display /
redistribution of their data without written consent. This tool is intended for
PRIVATE, personal use on your own machine. Do not deploy it publicly without
seeking Kalshi's permission.
"""

import json
import time
import threading
import urllib.request
import urllib.parse
import urllib.error

import espn  # team-logo lookup for sports options

# Either host works; both serve all markets (not just elections).
BASE = "https://api.elections.kalshi.com/trade-api/v2"

# Kalshi 403s the default urllib user-agent; a browser UA is required.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


def _get(path, params=None, retries=2):
    """GET a Kalshi endpoint and return parsed JSON, with light retry/backoff
    on rate limits (429) and transient network errors."""
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items()
                                              if v is not None and v != ""})
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=_HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429 and attempt < retries:
                time.sleep(0.6 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
    raise last


def _f(value, default=0.0):
    """Parse a possibly-string numeric field to float; safe on None/''."""
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _price(market, *keys):
    """
    Pull a price from a market dict, preferring the *_dollars string field
    (current API) and falling back to the legacy integer-cent field / 100.
    Returns dollars in [0, 1].
    """
    for k in keys:
        if k.endswith("_dollars") and k in market:
            return _f(market.get(k))
    # legacy cents fallback
    for k in keys:
        base = k.replace("_dollars", "")
        if base in market:
            return _f(market.get(base)) / 100.0
    return 0.0


def normalize_market(m):
    """Reduce a raw Kalshi market object to the fields the app uses (dollars)."""
    return {
        "ticker": m.get("ticker"),
        "event_ticker": m.get("event_ticker"),
        "title": m.get("title") or m.get("yes_sub_title") or m.get("ticker"),
        "yes_sub_title": m.get("yes_sub_title") or "",
        "no_sub_title": m.get("no_sub_title") or "",
        "status": m.get("status"),
        "result": m.get("result") or "",
        "yes_bid": _price(m, "yes_bid_dollars", "yes_bid"),
        "yes_ask": _price(m, "yes_ask_dollars", "yes_ask"),
        "no_bid": _price(m, "no_bid_dollars", "no_bid"),
        "no_ask": _price(m, "no_ask_dollars", "no_ask"),
        "last_price": _price(m, "last_price_dollars", "last_price"),
        "volume": _f(m.get("volume_fp", m.get("volume"))),
        "volume_24h": _f(m.get("volume_24h_fp", m.get("volume_24h"))),
        "open_interest": _f(m.get("open_interest_fp", m.get("open_interest"))),
        "liquidity": _f(m.get("liquidity_dollars", m.get("liquidity"))),
        "close_time": m.get("close_time"),
        # threshold ladder fields (spread/total markets): the strike line (e.g.
        # 2.5) and its comparison type ("greater"). None for plain Yes/No markets.
        "floor_strike": m.get("floor_strike"),
        "strike_type": m.get("strike_type"),
        # scheduled start (kickoff) for game markets, epoch seconds or None
        "occurrence_ts": espn._iso_ts(m.get("occurrence_datetime")),
        "can_close_early": m.get("can_close_early", False),
        "is_provisional": m.get("is_provisional", False),
        "mve": bool(m.get("mve_collection_ticker")),
    }


def is_tradeable(nm):
    """A market worth showing: a real single market with a live price."""
    if nm.get("is_provisional") or nm.get("mve"):
        return False
    return nm["yes_ask"] > 0 or nm["yes_bid"] > 0


# --------------------------------------------------------------------------
# Raw fetchers
# --------------------------------------------------------------------------

def fetch_events_page(status="open", cursor="", limit=200):
    return _get("/events", {
        "status": status,
        "limit": limit,
        "with_nested_markets": "true",
        "cursor": cursor,
    })


def fetch_market(ticker):
    """Return a normalized single market (live), or None if unavailable.

    Catches *all* network errors (HTTP 4xx/5xx, timeouts, DNS / connection
    resets) so a transient hiccup yields None for the caller to fall back on,
    rather than propagating an exception up into the request handler.
    """
    try:
        data = _get(f"/markets/{urllib.parse.quote(ticker)}")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    m = data.get("market")
    return normalize_market(m) if m else None


def fetch_candlesticks(series_ticker, ticker, period_interval, start_ts, end_ts):
    """
    Fetch the price-over-time history for a market (Kalshi's hero chart data).
    Returns a list of {"t": unix_seconds, "p": yes_close_price_dollars,
    "bid": .., "ask": ..} sorted ascending in time. Empty list on failure.
    """
    if not series_ticker:
        return []
    try:
        data = _get(
            f"/series/{urllib.parse.quote(series_ticker)}"
            f"/markets/{urllib.parse.quote(ticker)}/candlesticks",
            {"start_ts": start_ts, "end_ts": end_ts,
             "period_interval": period_interval},
        )
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        # HTTP 4xx (e.g. range exceeds the 5000-candle cap), 5xx, timeouts,
        # connection resets -- caller decides whether to retry coarser.
        return []
    out = []
    for c in data.get("candlesticks", []) or []:
        price = c.get("price") or {}
        close = price.get("close_dollars")
        # fall back to mean / yes_bid when a period had no trades
        if close in (None, ""):
            close = price.get("mean_dollars") or \
                (c.get("yes_bid") or {}).get("close_dollars")
        out.append({
            "t": c.get("end_period_ts"),
            "p": _f(close),
            "bid": _f((c.get("yes_bid") or {}).get("close_dollars")),
            "ask": _f((c.get("yes_ask") or {}).get("close_dollars")),
            "vol": _f(c.get("volume_fp")),
        })
    out = [c for c in out if c["t"]]
    out.sort(key=lambda c: c["t"])
    return out


def fetch_orderbook(ticker, depth=32):
    """
    Return the live order book as ascending-price ask ladders for each side,
    in dollars:
        {
          "yes_asks": [(price, size), ...],  # cost to BUY a YES contract
          "no_asks":  [(price, size), ...],  # cost to BUY a NO contract
        }
    Kalshi returns resting BIDS per side. A NO bid at price n is equivalent to a
    YES ask at (1 - n), and vice versa -- that conversion is done here so the
    fill engine just walks an ask ladder.
    """
    try:
        data = _get(f"/markets/{urllib.parse.quote(ticker)}/orderbook",
                    {"depth": depth})
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return {"yes_asks": [], "no_asks": []}

    ob = data.get("orderbook_fp")
    in_dollars = True
    if ob is None:
        ob = data.get("orderbook") or {}
        in_dollars = False

    yes_bids = ob.get("yes_dollars" if in_dollars else "yes") or []
    no_bids = ob.get("no_dollars" if in_dollars else "no") or []

    def to_price(p):
        return _f(p) if in_dollars else _f(p) / 100.0

    # Buying YES consumes NO bids -> yes_ask = 1 - no_bid_price
    yes_asks = sorted(
        ((round(1.0 - to_price(p), 6), _f(sz)) for p, sz in no_bids),
        key=lambda x: x[0],
    )
    # Buying NO consumes YES bids -> no_ask = 1 - yes_bid_price
    no_asks = sorted(
        ((round(1.0 - to_price(p), 6), _f(sz)) for p, sz in yes_bids),
        key=lambda x: x[0],
    )
    return {"yes_asks": yes_asks, "no_asks": no_asks}


# --------------------------------------------------------------------------
# In-memory events cache (refreshed by a background thread in server.py)
# --------------------------------------------------------------------------

_cache_lock = threading.Lock()
_cache = {"events": [], "updated": 0.0}
# ticker -> {"series", "event_ticker", "event_title", "category"}
_ticker_meta = {}


def get_meta(ticker):
    """Look up a market's series/event context (for charts & detail view)."""
    with _cache_lock:
        meta = _ticker_meta.get(ticker)
        if meta:
            return dict(meta)
    # fallback: derive the series ticker from the event prefix
    # (event tickers look like "KXELONMARS-99" -> series "KXELONMARS")
    return {"series": ticker.split("-")[0], "event_ticker": None,
            "event_title": None, "category": None}


def find_cached_event(event_ticker):
    """Return the cached event dict for an event_ticker, or None."""
    with _cache_lock:
        for e in _cache["events"]:
            if e["event_ticker"] == event_ticker:
                return e
    return None


def find_cached_market(ticker):
    """Return the normalized market for `ticker` from the events cache, or None.

    Used as a fallback for the detail view when the live single-market fetch
    fails (transient error or a market not currently exposed by /markets/{t}),
    so the detail page always receives a valid `market` object.
    """
    with _cache_lock:
        events = _cache["events"]
        for e in events:
            for m in e["markets"]:
                if m["ticker"] == ticker:
                    return dict(m)
    return None


# Series always pulled into the cache regardless of how deep they sit in the
# default /events ordering (e.g. World Cup games live ~4,400 events deep). Each
# is one cheap /events?series_ticker= call. `kw` adds search keywords so a name
# like "world cup" or "premier league" matches games titled only "A vs B".
# Curated to the MAJOR leagues/competitions (not all 180+ game series).
FEATURED_SERIES = [
    {"series": "KXWCGAME", "kw": "world cup fifa soccer football"},
    {"series": "KXNFLGAME", "kw": "nfl pro football"},
    {"series": "KXNBAGAME", "kw": "nba pro basketball"},
    {"series": "KXMLBGAME", "kw": "mlb pro baseball"},
    {"series": "KXNHLGAME", "kw": "nhl hockey"},
    {"series": "KXWNBAGAME", "kw": "wnba women's basketball"},
    {"series": "KXEPLGAME", "kw": "epl english premier league soccer football"},
    {"series": "KXUCLGAME", "kw": "uefa champions league ucl soccer football"},
    {"series": "KXMLSGAME", "kw": "mls major league soccer football"},
    {"series": "KXLALIGAGAME", "kw": "la liga spain soccer football"},
    {"series": "KXSERIEAGAME", "kw": "serie a italy soccer football"},
    {"series": "KXBUNDESLIGAGAME", "kw": "bundesliga germany soccer football"},
    {"series": "KXLIGUE1GAME", "kw": "ligue 1 france soccer football"},
    {"series": "KXATPGAME", "kw": "atp tennis"},
    {"series": "KXWTAGAME", "kw": "wta tennis"},
    {"series": "KXNCAAFGAME", "kw": "college football ncaa"},
    {"series": "KXNCAAMBGAME", "kw": "college basketball ncaa march madness"},
]

# Curated SPORTS FUTURES / AWARDS (not game outcomes): tournament winners, MVPs,
# Golden Boot, qualifiers, etc. Each is tagged with a custom `group` that becomes
# its own browsable, favoritable section (kept deliberately tight & marquee-only;
# the trivia markets -- "first song", per-group qualifiers, host-nation stats --
# are intentionally excluded). Each entry is one cheap /events call per refresh.
FEATURED_FUTURES = [
    # World Cup -- team outcomes (clean single-concept markets only; per-group /
    # per-region qualifier markets are deliberately excluded as too niche)
    {"series": "KXMENWORLDCUP", "group": "World Cup Teams", "kw": "world cup winner champion"},
    {"series": "KXWC1STTIMEWIN", "group": "World Cup Teams", "kw": "world cup first time winner"},
    {"series": "KXWCGAMEGOALS", "group": "World Cup Teams", "kw": "world cup highest scoring match"},
    {"series": "KXWCNOEURSA", "group": "World Cup Teams", "kw": "world cup winning continent"},
    {"series": "KXWCGSUNDEFEATED", "group": "World Cup Teams", "kw": "world cup win all group stage matches undefeated"},
    # World Cup -- player awards
    {"series": "KXWCGOALLEADER", "group": "World Cup Players", "kw": "world cup golden boot top scorer goal leader"},
    {"series": "KXWCAWARD", "group": "World Cup Players", "kw": "world cup golden ball silver boot award"},
    {"series": "KXWCGBOOTGOALS", "group": "World Cup Players", "kw": "world cup golden boot total goals"},
    # Ballon d'Or (season-long soccer awards)
    {"series": "KXBALLONDOR", "group": "Ballon d'Or", "kw": "ballon dor soccer player award"},
    {"series": "KXSUPERBALLONDOR", "group": "Ballon d'Or", "kw": "super ballon dor"},
    # NBA / WNBA
    {"series": "KXNBAMVP", "group": "NBA Futures", "kw": "nba mvp most valuable player"},
    {"series": "KXWNBA", "group": "WNBA Title", "kw": "wnba champion title"},
    # NFL
    {"series": "KXSB", "group": "NFL Futures", "kw": "super bowl champion nfl"},
    {"series": "KXNFLMVP", "group": "NFL Futures", "kw": "nfl mvp most valuable player"},
    {"series": "KXNFLAFCCHAMP", "group": "NFL Futures", "kw": "afc championship nfl"},
    {"series": "KXNFLNFCCHAMP", "group": "NFL Futures", "kw": "nfc championship nfl"},
]


def _normalize_events(raw_events, kw="", category_override=None):
    """Turn raw Kalshi events (with nested markets) into our cache shape,
    keeping only tradeable single markets. `kw` appends extra search keywords.
    `category_override` re-buckets futures events under a custom group name."""
    out = []
    for ev in raw_events:
        markets = [normalize_market(m) for m in (ev.get("markets") or [])]
        markets = [m for m in markets if is_tradeable(m)]
        if not markets:
            continue
        series_t = ev.get("series_ticker")
        for m in markets:
            m["logo"] = espn.logo_for(series_t, m["yes_sub_title"])
        markets.sort(key=lambda m: m["volume_24h"], reverse=True)
        title = ev.get("title") or ev.get("event_ticker")
        category = category_override or ev.get("category") or "Other"
        names = " ".join((m["title"] or "") + " " + (m["yes_sub_title"] or "")
                         for m in markets)
        search = " ".join([title, category, names, kw]).lower()
        # scheduled-game timing: kickoff (epoch) + whether this is a live game
        start_ts = next((m["occurrence_ts"] for m in markets if m.get("occurrence_ts")), None)
        is_game = bool(series_t and series_t.endswith("GAME"))
        out.append({
            "event_ticker": ev.get("event_ticker"),
            "series_ticker": ev.get("series_ticker"),
            "category": category,
            "title": title,
            "sub_title": ev.get("sub_title") or "",
            "mutually_exclusive": bool(ev.get("mutually_exclusive")),
            "volume_24h": sum(m["volume_24h"] for m in markets),
            "search": search,
            "start_ts": start_ts,
            "is_game": is_game,
            "markets": markets,
        })
    return out


def refresh_events_cache(max_pages=4):
    """Fetch open events with nested markets and store a tradeable subset.

    Pulls the general feed (top of Kalshi's default ordering) PLUS every series
    in FEATURED_SERIES, so high-interest events that sit deep in the feed (e.g.
    World Cup games) are always available.
    """
    events = []
    cursor = ""
    for _ in range(max_pages):
        try:
            page = fetch_events_page(cursor=cursor)
        except (urllib.error.URLError, TimeoutError):
            break
        events.extend(_normalize_events(page.get("events", [])))
        cursor = page.get("cursor")
        if not cursor:
            break

    # Merge in featured series (deduped by event_ticker).
    seen = {e["event_ticker"] for e in events}
    for feat in FEATURED_SERIES:
        try:
            page = _get("/events", {
                "series_ticker": feat["series"], "status": "open",
                "with_nested_markets": "true", "limit": 200,
            })
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            continue
        for e in _normalize_events(page.get("events", []), kw=feat.get("kw", "")):
            if e["event_ticker"] not in seen:
                events.append(e)
                seen.add(e["event_ticker"])
        time.sleep(0.15)  # pace requests to stay under the rate limit

    # Merge in curated FUTURES/AWARDS, each re-bucketed under its custom group.
    for feat in FEATURED_FUTURES:
        try:
            page = _get("/events", {
                "series_ticker": feat["series"], "status": "open",
                "with_nested_markets": "true", "limit": 200,
            })
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            continue
        for e in _normalize_events(page.get("events", []), kw=feat.get("kw", ""),
                                   category_override=feat["group"]):
            if e["event_ticker"] not in seen:
                events.append(e)
                seen.add(e["event_ticker"])
        time.sleep(0.15)

    events.sort(key=lambda e: e["volume_24h"], reverse=True)
    meta = {}
    for e in events:
        for m in e["markets"]:
            meta[m["ticker"]] = {
                "series": e["series_ticker"],
                "event_ticker": e["event_ticker"],
                "event_title": e["title"],
                "category": e["category"],
            }
    with _cache_lock:
        _cache["events"] = events
        _cache["updated"] = time.time()
        _ticker_meta.update(meta)
    return len(events)


def get_cached_events():
    with _cache_lock:
        return list(_cache["events"]), _cache["updated"]


# --------------------------------------------------------------------------
# Spread / Total betting lines (margin-of-victory & over/under ladders)
# --------------------------------------------------------------------------
# A game event (KX{LEAGUE}GAME-{suffix}) has sibling SPREAD and TOTAL events
# under the same suffix (KX{LEAGUE}SPREAD-{suffix}, KX{LEAGUE}TOTAL-{suffix}).
# Each is a ladder of independent Yes/No markets keyed by a `floor_strike` line
# (1.5, 2.5, 3.5, ...) -- exactly the "slide to pick the number" UX. We expose
# them in a tidy shape; betting reuses the normal market/quote/bet path.

def fetch_event(event_ticker):
    """Fetch a single event (with nested markets), or None on any failure."""
    if not event_ticker:
        return None
    try:
        data = _get("/events/" + urllib.parse.quote(event_ticker),
                    {"with_nested_markets": "true"})
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    return data.get("event")


def _line_market(m):
    """Lean normalized shape for one ladder rung (a spread/total threshold)."""
    nm = normalize_market(m)
    return {
        "ticker": nm["ticker"],
        "line": nm.get("floor_strike"),
        "yes_sub_title": nm["yes_sub_title"],
        "yes_bid": nm["yes_bid"], "yes_ask": nm["yes_ask"],
        "no_bid": nm["no_bid"], "no_ask": nm["no_ask"],
        "last_price": nm["last_price"], "status": nm["status"],
    }


def _spread_team(yes_sub):
    """Pull the team name out of a spread market's subtitle, e.g.
    'Reg Time: Argentina wins by more than 2.5 goals' -> 'Argentina'."""
    s = yes_sub or ""
    if ":" in s:                       # drop a 'Reg Time:'-style qualifier
        s = s.split(":", 1)[1].strip()
    low = s.lower()
    for kw in (" wins by", " win by", " to win by"):
        i = low.find(kw)
        if i >= 0:
            return s[:i].strip()
    return s.strip()


def _normalize_spread(ev):
    """Group a spread event's rungs by team (each team -> ascending lines)."""
    groups, order = {}, []
    for m in ev.get("markets", []) or []:
        nm = _line_market(m)
        if nm["line"] is None:
            continue
        team = _spread_team(nm["yes_sub_title"]) or "Team"
        if team not in groups:
            groups[team] = []
            order.append(team)
        groups[team].append(nm)
    sides = []
    for team in order:
        rungs = sorted(groups[team], key=lambda x: x["line"])
        if rungs:
            sides.append({"team": team, "rungs": rungs})
    if len(sides) < 1:
        return None
    return {"event_ticker": ev.get("event_ticker"),
            "title": ev.get("title"), "sides": sides}


def _normalize_total(ev):
    """Flatten a total event into one ascending ladder of over/under lines."""
    rungs = [r for r in (_line_market(m) for m in (ev.get("markets", []) or []))
             if r["line"] is not None]
    rungs.sort(key=lambda x: x["line"])
    if not rungs:
        return None
    unit = ""
    for r in rungs:
        s = (r["yes_sub_title"] or "").lower()
        for u in ("runs", "goals", "points", "maps", "sets", "games", "rounds"):
            if u in s:
                unit = u
                break
        if unit:
            break
    return {"event_ticker": ev.get("event_ticker"),
            "title": ev.get("title"), "unit": unit, "rungs": rungs}


def fetch_game_lines(game_event_ticker, series_ticker):
    """For a GAME event, fetch its sibling SPREAD and TOTAL ladders.

    Returns {"spread": {...}|None, "total": {...}|None}. Empty dict when the
    event isn't a game series or has no derivative markets.
    """
    if not series_ticker or not series_ticker.endswith("GAME"):
        return {}
    if "-" not in (game_event_ticker or ""):
        return {}
    base = series_ticker[:-4]                       # strip trailing "GAME"
    suffix = game_event_ticker.split("-", 1)[1]
    out = {}
    sev = fetch_event(base + "SPREAD-" + suffix)
    if sev:
        sp = _normalize_spread(sev)
        if sp:
            out["spread"] = sp
    tev = fetch_event(base + "TOTAL-" + suffix)
    if tev:
        tt = _normalize_total(tev)
        if tt:
            out["total"] = tt
    return out
