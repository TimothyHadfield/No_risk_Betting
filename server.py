"""
No-Risk Betting -- local paper-trading server.

Serves the single-page frontend and a small JSON API. Reads REAL live odds
from Kalshi's public market-data API (no account / key / money) and records
fake bets in a local SQLite database. Because bets are never transmitted to
Kalshi, they can't move the real order book -- so, for small bets on liquid
markets, the result is theoretically identical to betting real money.

Run:  python server.py        (then open http://localhost:8000)

PRIVATE / PERSONAL USE ONLY -- see the data-terms note in kalshi.py.
"""

import json
import os
import re
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import kalshi
import db
import fills
import analytics
import espn
import mailer

# Config from environment (so hosts like Render/Railway/Fly/Heroku just work).
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8765"))
DB_FILE = os.environ.get("NRB_DB", "data.db")
HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = {"/": "index.html", "/index.html": "index.html",
          "/app.js": "app.js", "/styles.css": "styles.css"}
CONTENT_TYPES = {".html": "text/html", ".js": "application/javascript",
                 ".css": "text/css", ".json": "application/json",
                 ".webmanifest": "application/manifest+json",
                 ".svg": "image/svg+xml", ".png": "image/png",
                 ".ico": "image/x-icon"}

# Short-lived cache of live single markets, to avoid hammering the API when
# valuing several open positions at once.
_mkt_lock = threading.Lock()
_mkt_cache = {}  # ticker -> (normalized_market, fetched_at)
_MKT_TTL = 15.0

# Best-effort in-memory rate limiting for auth endpoints (single instance on the
# free tier, so a dict is fine; it just resets on restart).
_rl_lock = threading.Lock()
_rl_hits = {}  # key -> [timestamps within window]


def _rate_ok(key, limit, window):
    """True if this hit is allowed; False once `key` exceeds `limit` hits in the
    last `window` seconds."""
    now = time.time()
    with _rl_lock:
        hits = [t for t in _rl_hits.get(key, ()) if now - t < window]
        if len(hits) >= limit:
            _rl_hits[key] = hits
            return False
        hits.append(now)
        _rl_hits[key] = hits
        # opportunistic cleanup so the dict can't grow unbounded
        if len(_rl_hits) > 5000:
            for k in [k for k, v in _rl_hits.items()
                      if not any(now - t < window for t in v)]:
                _rl_hits.pop(k, None)
        return True


def _clamp_prob(v):
    """Validate an optional user forecast probability (0..1). Returns None if absent/invalid."""
    try:
        if v is None or v == "":
            return None
        p = float(v)
    except (TypeError, ValueError):
        return None
    if p <= 0 or p >= 1:
        return max(0.01, min(0.99, p)) if 0 <= p <= 1 else None
    return p


def live_market(ticker, max_age=_MKT_TTL):
    now = time.time()
    with _mkt_lock:
        hit = _mkt_cache.get(ticker)
        if hit and now - hit[1] < max_age:
            return hit[0]
    m = kalshi.fetch_market(ticker)
    if m:
        with _mkt_lock:
            _mkt_cache[ticker] = (m, now)
    return m


# --------------------------------------------------------------------------
# Bet enrichment / settlement
# --------------------------------------------------------------------------

def enrich_open_bet(b):
    """Attach live mark-to-market fields to an open bet for display."""
    m = live_market(b["ticker"])
    out = dict(b)
    if m:
        cur_value = fills.position_value(b["side"], b["contracts"], m)
        cur_price = m["yes_bid"] if b["side"] == "yes" else m["no_bid"]
        out["current_price"] = cur_price
        out["current_value"] = cur_value
        out["unrealized_pnl"] = round(cur_value - b["cost_basis"], 4)
        out["market_status"] = m["status"]
        out["market_result"] = m["result"]
    else:
        out["current_price"] = None
        out["current_value"] = None
        out["unrealized_pnl"] = None
    return out


def settle_if_resolved(b):
    """If the underlying market has resolved, settle the bet. Returns bool."""
    m = live_market(b["ticker"], max_age=5.0)
    if not m:
        return False
    result = (m["result"] or "").lower()
    if result not in ("yes", "no"):
        return False
    payout = b["contracts"] * 1.0 if result == b["side"] else 0.0
    realized = round(payout - b["cost_basis"], 6)
    db.adjust_balance(b["user_id"], payout)
    db.resolve_bet(b["id"], "settled", result, round(payout, 6), realized)
    return True


def current_equity(uid):
    acct = db.get_account(uid)
    equity = acct["balance"]
    for b in db.list_bets(uid, status="open"):
        m = live_market(b["ticker"])
        if m:
            equity += fills.position_value(b["side"], b["contracts"], m)
    # open parlays: hold their staked cost as value until they resolve
    for p in db.list_parlays(uid, status="open"):
        equity += p["cost_basis"]
    return round(equity, 4)


def settle_parlays_if_resolved():
    """Resolve each open parlay: any leg lost -> parlay lost; all legs won -> pay out."""
    for p in db.all_open_parlays():
        any_lost = all_won = False
        legs = p["legs"]
        for lg in legs:
            if lg["status"] != "open":
                continue
            m = live_market(lg["ticker"], max_age=10.0)
            res = (m["result"] or "").lower() if m else ""
            if res in ("yes", "no"):
                won = (res == lg["side"])
                db.set_leg(lg["id"], "won" if won else "lost", res)
        legs = db.get_parlay(p["id"])["legs"]
        any_lost = any(l["status"] == "lost" for l in legs)
        all_won = all(l["status"] == "won" for l in legs)
        if any_lost:
            db.resolve_parlay(p["id"], "settled", 0.0, round(-p["cost_basis"], 6))
        elif all_won:
            payout = round(p["stake"] * p["combined_mult"], 6)
            db.adjust_balance(p["user_id"], payout)
            db.resolve_parlay(p["id"], "settled", payout, round(payout - p["cost_basis"], 6))


# --------------------------------------------------------------------------
# Background workers
# --------------------------------------------------------------------------

def events_refresher():
    while True:
        try:
            kalshi.refresh_events_cache()
        except Exception as e:  # keep the thread alive no matter what
            print("events refresh error:", e)
        time.sleep(90)


def positions_poller():
    # small initial delay so startup isn't contended
    time.sleep(8)
    while True:
        try:
            for b in db.all_open_bets():
                settle_if_resolved(b)
            settle_parlays_if_resolved()
            for uid in db.all_user_ids():
                db.record_equity(uid, current_equity(uid))
        except Exception as e:
            print("poller error:", e)
        time.sleep(25)


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    # ---- helpers ----
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, name):
        path = os.path.join(HERE, name)
        if not os.path.isfile(path):
            self._send_json({"error": "not found"}, 404)
            return
        ext = os.path.splitext(name)[1]
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "text/plain"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, ValueError):
            return {}

    # ---- routing ----
    def do_GET(self):
        self._safe(self._get_route)

    def do_POST(self):
        self._safe(self._post_route)

    def _safe(self, fn):
        """Never let one bad request crash the handler -- return JSON 500."""
        try:
            fn()
        except Exception as e:
            print("request error:", e)
            try:
                self._send_json({"error": "server error"}, 500)
            except Exception:
                pass

    def _get_route(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        q = urllib.parse.parse_qs(parsed.query)

        if path == "/healthz":
            return self._send_json({"ok": True})
        if path == "/" or path == "/index.html":
            return self._send_static("index.html")
        # serve any local static asset (js/css/html) by bare filename
        name = path.lstrip("/")
        if name and "/" not in name and "\\" not in name \
                and os.path.splitext(name)[1] in CONTENT_TYPES:
            return self._send_static(name)
        if path == "/api/categories":
            return self.api_categories()
        if path == "/api/markets":
            return self.api_markets(q)
        if path == "/api/home":
            return self.api_home()
        if path.startswith("/api/market/"):
            return self.api_market(urllib.parse.unquote(path[len("/api/market/"):]))
        if path == "/api/history":
            return self.api_history(q)
        if path == "/api/game":
            return self.api_game(q)
        if path == "/api/quote":
            return self.api_quote(q)
        if path == "/api/bets":
            return self.api_list_bets()
        if path == "/api/parlays":
            return self.api_list_parlays()
        if path == "/api/account":
            return self._send_json(db.get_account(self._uid()))
        if path == "/api/summary":
            return self.api_summary()
        if path == "/api/analytics":
            return self.api_analytics()
        if path == "/api/auth/me":
            return self.api_me()
        return self._send_json({"error": "not found"}, 404)

    def _post_route(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._body()

        if path == "/api/auth/signup":
            return self.api_signup(body)
        if path == "/api/auth/login":
            return self.api_login(body)
        if path == "/api/auth/request-reset":
            return self.api_request_reset(body)
        if path == "/api/auth/recover":
            return self.api_recover(body)
        if path == "/api/auth/password":
            return self.api_change_password(body)
        if path == "/api/auth/delete":
            return self.api_delete_account(body)
        if path == "/api/auth/logout":
            return self.api_logout()
        if path == "/api/bets":
            return self.api_place_bet(body)
        if path == "/api/settle":
            return self.api_settle_all()
        if path == "/api/account/reset":
            return self.api_reset(body)
        if path.startswith("/api/bets/") and path.endswith("/close"):
            return self.api_close_bet(self._bet_id(path, "/close"))
        if path.startswith("/api/bets/") and path.endswith("/force_settle"):
            return self.api_force_settle(self._bet_id(path, "/force_settle"), body)
        if path == "/api/parlays":
            return self.api_create_parlay(body)
        if path.startswith("/api/parlays/") and path.endswith("/force_settle"):
            try:
                pid = int(path[len("/api/parlays/"):-len("/force_settle")])
            except ValueError:
                pid = -1
            return self.api_force_settle_parlay(pid, body)
        return self._send_json({"error": "not found"}, 404)

    @staticmethod
    def _bet_id(path, suffix):
        try:
            return int(path[len("/api/bets/"):-len(suffix)])
        except ValueError:
            return -1

    def _client_ip(self):
        """Best-effort client IP (Render/Proxies put the real one in XFF)."""
        xff = self.headers.get("X-Forwarded-For") or ""
        if xff:
            return xff.split(",")[0].strip()
        return self.client_address[0] if self.client_address else "?"

    def _throttled(self, bucket, limit, window):
        """If the client IP exceeds the limit for `bucket`, send 429 and return
        True (caller should return immediately)."""
        if not _rate_ok(f"{bucket}:{self._client_ip()}", limit, window):
            self._send_json(
                {"error": "Too many attempts. Please wait a few minutes and try again."},
                429)
            return True
        return False

    def _anon_uid(self):
        """The raw per-browser id from the X-User-Id header (no session)."""
        raw = self.headers.get("X-User-Id") or ""
        uid = "".join(c for c in raw if c.isalnum() or c in "-_")[:64]
        return uid or None

    def _uid(self):
        """The effective user id for this request: a logged-in account (resolved
        from the X-Session-Token header) if present and valid, else the anonymous
        per-browser id from X-User-Id."""
        uid = db.user_id_for_token(self.headers.get("X-Session-Token") or "")
        if uid:
            return uid
        return self._anon_uid() or "anon"

    # ---- API: discovery ----
    def api_categories(self):
        events, updated = kalshi.get_cached_events()
        counts = {}
        for e in events:
            counts[e["category"]] = counts.get(e["category"], 0) + 1
        cats = [{"name": k, "count": v}
                for k, v in sorted(counts.items(), key=lambda x: -x[1])]
        self._send_json({"categories": cats, "updated": updated,
                         "loading": not events})

    # series_ticker -> friendly carousel title (with an emoji), for /api/home
    LEAGUE_TITLES = {
        "KXWCGAME": "⚽ World Cup", "KXEPLGAME": "⚽ Premier League",
        "KXUCLGAME": "⚽ Champions League", "KXMLSGAME": "⚽ MLS",
        "KXLALIGAGAME": "⚽ La Liga", "KXSERIEAGAME": "⚽ Serie A",
        "KXBUNDESLIGAGAME": "⚽ Bundesliga", "KXLIGUE1GAME": "⚽ Ligue 1",
        "KXNBAGAME": "\U0001f3c0 NBA", "KXWNBAGAME": "\U0001f3c0 WNBA",
        "KXNCAAMBGAME": "\U0001f3c0 College Basketball",
        "KXNFLGAME": "\U0001f3c8 NFL", "KXNCAAFGAME": "\U0001f3c8 College Football",
        "KXMLBGAME": "⚾ MLB", "KXNHLGAME": "\U0001f3d2 NHL",
        "KXATPGAME": "\U0001f3be ATP Tennis", "KXWTAGAME": "\U0001f3be WTA Tennis",
    }

    def api_home(self):
        events, _ = kalshi.get_cached_events()
        if not events:
            return self._send_json({"sections": [], "loading": True})

        def top(evs, n=16):
            return sorted(evs, key=lambda e: e["volume_24h"], reverse=True)[:n]

        sections = [{"key": "trending", "title": "\U0001f525 Trending",
                     "events": top(events, 18)}]
        by_series, by_cat = {}, {}
        for e in events:
            by_series.setdefault(e.get("series_ticker"), []).append(e)
            if e["category"] != "Sports":
                by_cat.setdefault(e["category"], []).append(e)
        # live sports leagues, in the curated order above
        for sk, title in self.LEAGUE_TITLES.items():
            evs = by_series.get(sk)
            if evs:
                sections.append({"key": sk, "title": title, "events": top(evs)})
        # remaining categories, by total volume
        for cat in sorted(by_cat, key=lambda c: -sum(e["volume_24h"]
                                                      for e in by_cat[c])):
            sections.append({"key": "cat:" + cat, "title": cat,
                             "events": top(by_cat[cat])})
        self._send_json({"sections": sections, "loading": False})

    def api_markets(self, q):
        events, updated = kalshi.get_cached_events()
        category = (q.get("category", [""])[0] or "").strip()
        query = (q.get("q", [""])[0] or "").strip().lower()
        limit = int(q.get("limit", ["40"])[0])

        terms = query.split()
        result = []
        for e in events:
            if category and e["category"] != category:
                continue
            if terms:
                blob = e.get("search") or (e["title"] or "").lower()
                if not all(t in blob for t in terms):
                    continue
            result.append(e)
            if len(result) >= limit:
                break
        self._send_json({"events": result, "updated": updated,
                         "loading": not events})

    def api_market(self, ticker):
        # Prefer the live single-market fetch. If it fails (transient error,
        # 404, or a ticker not exposed by /markets/{t}), fall back to the
        # market object cached in the events feed so the detail view always
        # receives a valid `market`.
        m = live_market(ticker, max_age=5.0)
        if not m:
            m = kalshi.find_cached_market(ticker)
        if not m:
            return self._send_json({"error": "market not found"}, 404)
        meta = kalshi.get_meta(ticker)
        m["logo"] = m.get("logo") or espn.logo_for(meta.get("series"),
                                                    m.get("yes_sub_title"))
        # Sibling markets: for a multi-outcome event (e.g. a game with
        # TeamA / TeamB / Tie) return every outcome's live market so the detail
        # view can show ALL outcomes (never "No"). Prices fetched live (15s cache);
        # logo comes from the cached event market.
        siblings = []
        ev = kalshi.find_cached_event(meta.get("event_ticker"))
        if ev and ev.get("mutually_exclusive") and len(ev.get("markets", [])) > 1:
            for s in ev["markets"]:
                lm = live_market(s["ticker"]) or s
                siblings.append({
                    "ticker": lm["ticker"], "yes_sub_title": lm["yes_sub_title"],
                    "title": lm["title"], "yes_bid": lm["yes_bid"],
                    "yes_ask": lm["yes_ask"], "no_bid": lm["no_bid"],
                    "no_ask": lm["no_ask"], "last_price": lm["last_price"],
                    "logo": s.get("logo"),
                })
        self._send_json({"market": m, "meta": meta, "siblings": siblings,
                         "event_title": ev["title"] if ev else None})

    # range -> (period_interval_minutes, lookback_seconds)
    # (preferred candle interval in minutes, lookback seconds). Finer = more
    # points. Kalshi caps a request at 5000 candles, so: 1-min works up to
    # ~3.4 days; 1W/1M/ALL must use coarser candles. The fallback loop below
    # steps to a coarser interval if a finer one is empty/over the cap.
    _RANGES = {
        "1H": (1, 3600),
        "6H": (1, 6 * 3600),
        "1D": (1, 24 * 3600),     # 1-minute candles, like Kalshi's day view
        "1W": (60, 7 * 24 * 3600),
        "1M": (60, 30 * 24 * 3600),
        "ALL": (1440, 365 * 24 * 3600),
    }

    # Candlestick intervals (minutes), coarsest-last, for graceful fallback.
    _INTERVALS = [1, 60, 1440]
    # Kalshi caps a single candlesticks request at 5000 candles.
    _MAX_CANDLES = 5000

    def api_history(self, q):
        ticker = q.get("ticker", [""])[0]
        if not ticker:
            return self._send_json({"error": "ticker required"}, 400)
        meta = kalshi.get_meta(ticker)
        series = q.get("series", [meta.get("series")])[0] or meta.get("series")
        now = int(time.time())

        start = q.get("start", [""])[0]
        if start:  # explicit window (e.g. the in-game timeline)
            try:
                start_ts = int(float(start))
            except ValueError:
                start_ts = now - 6 * 3600
            try:
                end_ts = int(float(q.get("end", [""])[0]))
            except (ValueError, TypeError):
                end_ts = now
            rng, interval, lookback = "GAME", 1, max(60, end_ts - start_ts)
        else:
            rng = (q.get("range", ["1D"])[0] or "1D").upper()
            interval, lookback = self._RANGES.get(rng, self._RANGES["1D"])
            start_ts, end_ts = now - lookback, now

        # Try the requested interval first, then progressively coarser ones.
        # Skip intervals that would exceed Kalshi's 5000-candle cap (which
        # otherwise 400s and yields an empty chart), and intervals finer than
        # the one requested for this range.
        points = []
        for iv in self._INTERVALS:
            if iv < interval:
                continue
            if lookback / (iv * 60) > self._MAX_CANDLES:
                continue
            points = kalshi.fetch_candlesticks(series, ticker, iv, start_ts, end_ts)
            if points:
                break
        self._send_json({"ticker": ticker, "range": rng, "points": points})

    def api_game(self, q):
        ev_t = q.get("event_ticker", [""])[0]
        if not ev_t:
            return self._send_json({"matched": False})
        ev = kalshi.find_cached_event(ev_t)
        if not ev:
            return self._send_json({"matched": False})
        teams = [m.get("yes_sub_title") for m in ev.get("markets", [])]
        self._send_json(espn.game_state(ev.get("series_ticker"), teams))

    # ---- API: betting ----
    def api_quote(self, q):
        ticker = q.get("ticker", [""])[0]
        side = q.get("side", ["yes"])[0]
        try:
            contracts = float(q.get("contracts", ["0"])[0])
        except ValueError:
            contracts = 0
        if not ticker or contracts <= 0 or side not in ("yes", "no"):
            return self._send_json({"ok": False, "reason": "bad parameters"}, 400)
        m = live_market(ticker, max_age=5.0)
        if not m:
            return self._send_json({"ok": False, "reason": "market not found"}, 404)
        ob = kalshi.fetch_orderbook(ticker)
        self._send_json(fills.quote(side, contracts, ob, m))

    def api_place_bet(self, body):
        ticker = body.get("ticker")
        side = (body.get("side") or "").lower()
        try:
            contracts = float(body.get("contracts", 0))
        except (TypeError, ValueError):
            contracts = 0
        if not ticker or side not in ("yes", "no") or contracts <= 0:
            return self._send_json({"error": "bad parameters"}, 400)

        m = live_market(ticker, max_age=5.0)
        if not m:
            return self._send_json({"error": "market not found"}, 404)
        ob = kalshi.fetch_orderbook(ticker)
        qd = fills.quote(side, contracts, ob, m)
        if not qd.get("ok"):
            return self._send_json({"error": qd.get("reason", "no fill")}, 400)

        uid = self._uid()
        acct = db.get_account(uid)
        if qd["cost_basis"] > acct["balance"] + 1e-9:
            return self._send_json(
                {"error": "Insufficient virtual balance.",
                 "needed": qd["cost_basis"], "balance": acct["balance"]}, 400)

        bet_id = db.insert_bet(uid, {
            "ticker": ticker, "event_ticker": m["event_ticker"],
            "title": m["title"], "side": side, "contracts": qd["contracts"],
            "avg_price": qd["avg_price"], "stake": qd["stake"], "fee": qd["fee"],
            "cost_basis": qd["cost_basis"], "partial": qd["partial"],
            "estimated_fill": qd["estimated_fill"], "close_time": m["close_time"],
            "category": kalshi.get_meta(ticker).get("category"),
            "user_prob": _clamp_prob(body.get("user_prob")),
        })
        db.adjust_balance(uid, -qd["cost_basis"])
        self._send_json({"ok": True, "bet": db.get_bet(bet_id), "quote": qd})

    def api_list_bets(self):
        bets = db.list_bets(self._uid())
        out = [enrich_open_bet(b) if b["status"] == "open" else b for b in bets]
        self._send_json({"bets": out})

    def api_close_bet(self, bet_id):
        uid = self._uid()
        b = db.get_bet(bet_id)
        if not b or b["status"] != "open" or b["user_id"] != uid:
            return self._send_json({"error": "no open bet with that id"}, 404)
        m = live_market(b["ticker"], max_age=5.0)
        if not m:
            return self._send_json({"error": "market not found"}, 404)
        bid = m["yes_bid"] if b["side"] == "yes" else m["no_bid"]
        proceeds = b["contracts"] * (bid or 0.0)
        exit_fee = fills.kalshi_fee(b["contracts"], bid or 0.0)
        net = round(proceeds - exit_fee, 6)
        realized = round(net - b["cost_basis"], 6)
        db.adjust_balance(b["user_id"], net)
        db.resolve_bet(bet_id, "closed", None, net, realized)
        self._send_json({"ok": True, "proceeds": net, "realized_pnl": realized,
                         "bet": db.get_bet(bet_id)})

    def api_force_settle(self, bet_id, body):
        """Testing helper: settle a bet at a chosen result without waiting."""
        uid = self._uid()
        b = db.get_bet(bet_id)
        if not b or b["status"] != "open" or b["user_id"] != uid:
            return self._send_json({"error": "no open bet with that id"}, 404)
        result = (body.get("result") or "").lower()
        if result not in ("yes", "no"):
            return self._send_json({"error": "result must be yes|no"}, 400)
        payout = b["contracts"] * 1.0 if result == b["side"] else 0.0
        realized = round(payout - b["cost_basis"], 6)
        db.adjust_balance(uid, payout)
        db.resolve_bet(bet_id, "settled", result, round(payout, 6), realized)
        self._send_json({"ok": True, "bet": db.get_bet(bet_id)})

    def api_settle_all(self):
        settled = 0
        for b in db.list_bets(self._uid(), status="open"):
            if settle_if_resolved(b):
                settled += 1
        self._send_json({"ok": True, "settled": settled})

    # ---- API: parlays ----
    def api_create_parlay(self, body):
        legs_in = body.get("legs") or []
        try:
            stake = float(body.get("stake", 0))
        except (TypeError, ValueError):
            stake = 0
        if len(legs_in) < 2:
            return self._send_json({"error": "A parlay needs at least 2 legs."}, 400)
        if stake <= 0:
            return self._send_json({"error": "Enter a stake."}, 400)
        tickers = [l.get("ticker") for l in legs_in]
        if len(set(tickers)) != len(tickers):
            return self._send_json({"error": "Duplicate legs in parlay."}, 400)

        legs, combined = [], 1.0
        for l in legs_in:
            side = (l.get("side") or "yes").lower()
            m = live_market(l.get("ticker"), max_age=5.0) or \
                kalshi.find_cached_market(l.get("ticker"))
            if not m:
                return self._send_json({"error": "A leg's market is unavailable."}, 400)
            price = m["yes_ask"] if side == "yes" else m["no_ask"]
            if not price or price <= 0:
                return self._send_json(
                    {"error": "No liquidity for one of the legs."}, 400)
            mult = 1.0 / price
            combined *= mult
            legs.append({
                "ticker": m["ticker"], "event_ticker": m["event_ticker"],
                "title": m["title"],
                "outcome_name": (m["yes_sub_title"] or m["title"]) if side == "yes" else "No",
                "side": side, "entry_price": round(price, 6), "mult": round(mult, 4),
            })

        uid = self._uid()
        acct = db.get_account(uid)
        if stake > acct["balance"] + 1e-9:
            return self._send_json({"error": "Insufficient virtual balance."}, 400)
        combined = round(combined, 4)
        pid = db.insert_parlay(uid, stake, round(stake, 6), combined, legs)
        db.adjust_balance(uid, -stake)
        self._send_json({"ok": True, "parlay": db.get_parlay(pid),
                         "potential_payout": round(stake * combined, 2)})

    def api_list_parlays(self):
        self._send_json({"parlays": db.list_parlays(self._uid())})

    def api_force_settle_parlay(self, pid, body):
        uid = self._uid()
        p = db.get_parlay(pid)
        if not p or p["status"] != "open" or p["user_id"] != uid:
            return self._send_json({"error": "no open parlay with that id"}, 404)
        result = (body.get("result") or "").lower()
        if result == "win":
            for lg in p["legs"]:
                db.set_leg(lg["id"], "won", lg["side"])
            payout = round(p["stake"] * p["combined_mult"], 6)
            db.adjust_balance(uid, payout)
            db.resolve_parlay(pid, "settled", payout, round(payout - p["cost_basis"], 6))
        elif result == "lose":
            db.set_leg(p["legs"][0]["id"], "lost", "no" if p["legs"][0]["side"] == "yes" else "yes")
            db.resolve_parlay(pid, "settled", 0.0, round(-p["cost_basis"], 6))
        else:
            return self._send_json({"error": "result must be win|lose"}, 400)
        self._send_json({"ok": True, "parlay": db.get_parlay(pid)})

    # ---- API: accounts / login (optional cross-device sync) ----
    # Login id is a username OR email (just an unverified identifier).
    _EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    _USERNAME_RE = re.compile(r"^[a-z0-9_.\-]{3,30}$")

    @classmethod
    def _validate_login(cls, raw):
        """Return (normalized_login, error_or_None). Accepts an email or a
        3-30 char username (letters/digits/._-)."""
        s = (raw or "").strip().lower()
        if not s:
            return None, "Enter a username or email."
        if "@" in s:
            if not cls._EMAIL_RE.match(s):
                return None, "Enter a valid email address."
        elif not cls._USERNAME_RE.match(s):
            return None, ("Username must be 3-30 characters: letters, numbers, "
                          "and . _ - only.")
        return s, None

    def _token_uid(self):
        return db.user_id_for_token(self.headers.get("X-Session-Token") or "")

    def api_signup(self, body):
        if self._throttled("signup", 10, 600):
            return
        login, err = self._validate_login(body.get("login") or body.get("email"))
        if err:
            return self._send_json({"error": err}, 400)
        password = body.get("password") or ""
        if len(password) < 6:
            return self._send_json(
                {"error": "Password must be at least 6 characters."}, 400)
        # Reuse this browser's anonymous id so the bets/balance already placed
        # carry over into the new account.
        uid, code = db.create_user(login, password, claim_uid=self._anon_uid())
        if not uid:
            return self._send_json(
                {"error": "That username/email is already taken — try logging in."}, 409)
        token = db.create_session(uid)
        # recovery_code is returned exactly once for the user to save.
        self._send_json({"ok": True, "token": token, "user_id": uid,
                         "login": login, "recovery_code": code})

    def api_login(self, body):
        if self._throttled("login", 20, 300):
            return
        login = (body.get("login") or body.get("email") or "").strip().lower()
        password = body.get("password") or ""
        uid = db.verify_login(login, password)
        if not uid:
            return self._send_json({"error": "Wrong username/email or password."}, 401)
        token = db.create_session(uid)
        self._send_json({"ok": True, "token": token, "user_id": uid, "login": login})

    def api_request_reset(self, body):
        """Email a time-limited reset code to an email-based account. Always
        responds generically so it never reveals whether an email is registered."""
        if self._throttled("reqreset", 5, 3600):  # per-IP: cap email-send abuse
            return
        login = (body.get("login") or "").strip().lower()
        if "@" not in login or not self._EMAIL_RE.match(login):
            return self._send_json(
                {"error": "Enter the email address you signed up with."}, 400)
        if not mailer.is_configured():
            return self._send_json(
                {"error": "Email isn't set up on this server yet."}, 503)
        # per-recipient cap: don't let anyone flood one inbox / spend the quota
        if not _rate_ok("reqreset-to:" + login, 3, 3600):
            return self._send_json({"ok": True})  # silent: no leak, no send
        uid = db.user_id_by_login(login)
        if uid:
            code = db.set_reset_code(uid)
            try:
                mailer.send_reset_code(login, code)
            except Exception as e:
                print("reset email error:", e)
                return self._send_json(
                    {"error": "Couldn't send the email. Try again shortly."}, 502)
        self._send_json({"ok": True})

    def api_recover(self, body):
        """Reset a password using either the saved recovery code or an emailed
        reset code."""
        if self._throttled("recover", 20, 300):  # brute-force guard on codes
            return
        login = (body.get("login") or "").strip().lower()
        code = body.get("code") or ""
        new_password = body.get("password") or ""
        if len(new_password) < 6:
            return self._send_json(
                {"error": "New password must be at least 6 characters."}, 400)
        uid = db.verify_recovery_or_reset(login, code)
        if not uid:
            return self._send_json(
                {"error": "Wrong username/email or code."}, 401)
        db.set_password(uid, new_password)  # also clears old sessions
        token = db.create_session(uid)
        u = db.get_user(uid)
        self._send_json({"ok": True, "token": token, "user_id": uid,
                         "login": u["login"] if u else login})

    def api_change_password(self, body):
        uid = self._token_uid()
        if not uid:
            return self._send_json({"error": "Not logged in."}, 401)
        u = db.get_user(uid)
        if not u or not db.verify_login(u["login"], body.get("current") or ""):
            return self._send_json({"error": "Current password is incorrect."}, 401)
        new_password = body.get("password") or ""
        if len(new_password) < 6:
            return self._send_json(
                {"error": "New password must be at least 6 characters."}, 400)
        db.set_password(uid, new_password)  # clears all sessions
        token = db.create_session(uid)      # keep this device logged in
        self._send_json({"ok": True, "token": token})

    def api_delete_account(self, body):
        uid = self._token_uid()
        if not uid:
            return self._send_json({"error": "Not logged in."}, 401)
        u = db.get_user(uid)
        if not u or not db.verify_login(u["login"], body.get("password") or ""):
            return self._send_json({"error": "Password is incorrect."}, 401)
        db.delete_user(uid)
        self._send_json({"ok": True})

    def api_logout(self):
        db.delete_session(self.headers.get("X-Session-Token") or "")
        self._send_json({"ok": True})

    def api_me(self):
        uid = self._token_uid()
        u = db.get_user(uid) if uid else None
        if not u:
            return self._send_json({"logged_in": False})
        self._send_json({"logged_in": True, "login": u["login"], "user_id": uid})

    def api_reset(self, body):
        uid = self._uid()
        try:
            starting = float(body.get("starting", db.DEFAULT_STARTING_BALANCE))
        except (TypeError, ValueError):
            starting = db.DEFAULT_STARTING_BALANCE
        db.reset_account(uid, starting)
        self._send_json({"ok": True, "account": db.get_account(uid)})

    def api_summary(self):
        """Lightweight header data (balance + live equity) -- avoids the full
        analytics computation on the 30s header refresh."""
        uid = self._uid()
        acct = db.get_account(uid)
        self._send_json({"balance": acct["balance"], "starting": acct["starting"],
                         "equity": current_equity(uid)})

    def api_analytics(self):
        uid = self._uid()
        s = analytics.summary(db.list_bets(uid))
        # fold settled-parlay P&L into the headline totals (reality check)
        settled_p = [p for p in db.list_parlays(uid) if p["status"] == "settled"]
        if settled_p:
            s["realized_pnl"] = round(s["realized_pnl"] +
                sum((p.get("realized_pnl") or 0.0) for p in settled_p), 2)
            s["invested"] = round(s["invested"] +
                sum(p["cost_basis"] for p in settled_p), 2)
            s["roi"] = round(s["realized_pnl"] / s["invested"], 4) if s["invested"] > 0 else None
        s["equity_history"] = db.equity_history(uid)
        s["account"] = db.get_account(uid)
        self._send_json(s)


class Server(ThreadingHTTPServer):
    daemon_threads = True        # don't hang on client threads at shutdown
    allow_reuse_address = True   # restart cleanly without "address in use"


def main():
    db.init(DB_FILE)
    threading.Thread(target=events_refresher, daemon=True).start()
    threading.Thread(target=positions_poller, daemon=True).start()
    server = Server((HOST, PORT), Handler)
    print(f"No-Risk Betting running on http://{HOST}:{PORT}  (db: {DB_FILE})")
    print("Loading live market data in the background...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
