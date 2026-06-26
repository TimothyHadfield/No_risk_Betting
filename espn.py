"""
ESPN live-sports adapter (score + game clock) for sports markets.

Kalshi provides NO score/clock data, so for sports games we read ESPN's public
scoreboard JSON and match each game to its Kalshi event by team names. Read-only,
no API key. Endpoints are unofficial and may change; everything degrades to
"no match" gracefully.
"""

import json
import re
import time
import threading
import unicodedata
import urllib.request
import urllib.error

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
    "Accept": "application/json",
}

# Kalshi series ticker -> ESPN sport/league slug
LEAGUE_SLUG = {
    "KXWCGAME": "soccer/fifa.world",
    "KXEPLGAME": "soccer/eng.1",
    "KXUCLGAME": "soccer/uefa.champions",
    "KXMLSGAME": "soccer/usa.1",
    "KXLALIGAGAME": "soccer/esp.1",
    "KXSERIEAGAME": "soccer/ita.1",
    "KXBUNDESLIGAGAME": "soccer/ger.1",
    "KXLIGUE1GAME": "soccer/fra.1",
    "KXNBAGAME": "basketball/nba",
    "KXWNBAGAME": "basketball/wnba",
    "KXNCAAMBGAME": "basketball/mens-college-basketball",
    "KXNFLGAME": "football/nfl",
    "KXNCAAFGAME": "football/college-football",
    "KXMLBGAME": "baseball/mlb",
    "KXNHLGAME": "hockey/nhl",
}

# normalized Kalshi name -> normalized ESPN name (only the ones that differ)
_ALIAS = {
    "korearepublic": "southkorea", "iriran": "iran", "congodr": "drcongo",
    "usa": "unitedstates", "ivorycoast": "ivorycoast", "czechia": "czechia",
    "capeverde": "capeverde", "turkey": "turkiye", "as": "athletics",
}


def _norm(name):
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    s = re.sub(r"\b(and|the|fc|sc|cf|afc|club)\b", " ", s)
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def _match_name(kalshi_norm, espn_norms):
    """True if a Kalshi team name matches one of an ESPN game's team names."""
    target = _ALIAS.get(kalshi_norm, kalshi_norm)
    for en in espn_norms:
        if target == en or _ALIAS.get(en) == kalshi_norm:
            return True
        # contains fallback for short/long variants (e.g. 'spurs' vs 'sanantoniospurs')
        if len(target) >= 4 and (target in en or en in target):
            return True
    return False


# --------------------------------------------------------------------------
# Scoreboard cache (per league slug)
# --------------------------------------------------------------------------
_lock = threading.Lock()
_cache = {}   # slug -> (parsed_games, fetched_at)
_TTL = 20.0


def _get(url, retries=1):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=_HEADERS)
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(0.5)
                continue
            raise
    raise last


def _parse_game(ev):
    comp = (ev.get("competitions") or [{}])[0]
    status = comp.get("status") or ev.get("status") or {}
    stype = status.get("type") or {}
    cs = comp.get("competitors") or []

    def side(which):
        c = next((x for x in cs if x.get("homeAway") == which), None)
        if not c and cs:
            c = cs[0] if which == "away" else cs[-1]
        t = (c or {}).get("team") or {}
        return {"name": t.get("displayName") or t.get("name") or "",
                "abbr": t.get("abbreviation") or "",
                "logo": (t.get("logos") or [{}])[0].get("href") or t.get("logo"),
                "score": (c or {}).get("score")}

    away, home = side("away"), side("home")
    return {
        "state": stype.get("state"),           # pre | in | post
        "detail": stype.get("shortDetail") or stype.get("detail") or "",
        "completed": bool(stype.get("completed")),
        "clock": status.get("displayClock"),
        "period": status.get("period"),
        "start_ts": _iso_ts(ev.get("date")),
        "away": away, "home": home,
        "_norms": [_norm(away["name"]), _norm(home["name"])],
    }


def _iso_ts(iso):
    if not iso:
        return None
    try:
        # ESPN dates look like 2026-06-24T19:00Z
        import calendar
        t = time.strptime(iso.replace("Z", "UTC"), "%Y-%m-%dT%H:%M%Z")
        return int(calendar.timegm(t))
    except (ValueError, OverflowError):
        try:
            import calendar
            t = time.strptime(iso[:16] + "Z", "%Y-%m-%dT%H:%MZ")
            return int(calendar.timegm(t))
        except ValueError:
            return None


def scoreboard(slug):
    now = time.time()
    with _lock:
        hit = _cache.get(slug)
        if hit and now - hit[1] < _TTL:
            return hit[0]
    try:
        data = _get("https://site.api.espn.com/apis/site/v2/sports/%s/scoreboard" % slug)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return []
    games = [_parse_game(e) for e in data.get("events", [])]
    with _lock:
        _cache[slug] = (games, now)
    return games


_teams_lock = threading.Lock()
_teams_cache = {}   # slug -> (name_norm -> logo_url, fetched_at)
_TEAMS_TTL = 6 * 3600.0


def _team_logo_map(slug):
    now = time.time()
    with _teams_lock:
        hit = _teams_cache.get(slug)
        if hit and now - hit[1] < _TEAMS_TTL:
            return hit[0]
    m = {}
    try:
        data = _get("https://site.api.espn.com/apis/site/v2/sports/%s/teams?limit=1000" % slug)
        for lg in (data.get("sports") or [{}])[0].get("leagues", []):
            for t in lg.get("teams", []):
                tm = t.get("team") or {}
                logo = (tm.get("logos") or [{}])[0].get("href") or tm.get("logo")
                if not logo:
                    continue
                for key in (tm.get("displayName"), tm.get("shortDisplayName"),
                            tm.get("name"), tm.get("location"), tm.get("abbreviation")):
                    if key:
                        m[_norm(key)] = logo
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError):
        m = {}
    with _teams_lock:
        _teams_cache[slug] = (m, now)
    return m


def logo_for(series_ticker, team_name):
    """Logo URL for a sports team option, or None. Countries (World Cup) return
    None so the caller uses a flag image instead."""
    if not team_name or series_ticker == "KXWCGAME":
        return None
    slug = LEAGUE_SLUG.get(series_ticker)
    if not slug:
        return None
    t = _norm(team_name)
    if t in ("tie", "draw", ""):
        return None
    m = _team_logo_map(slug)
    if t in m:
        return m[t]
    if t in _ALIAS and _ALIAS[t] in m:
        return m[_ALIAS[t]]
    for k, url in m.items():       # contains fallback (e.g. "tampabay" in "tampabayrays")
        if len(t) >= 4 and (t in k or k in t):
            return url
    return None


def game_state(series_ticker, team_names):
    """Match a Kalshi event (its team names) to a live ESPN game; return state
    or {'matched': False}. team_names = list of the event's team strings."""
    slug = LEAGUE_SLUG.get(series_ticker)
    if not slug:
        return {"matched": False}
    teams = [_norm(t) for t in team_names
             if t and _norm(t) not in ("tie", "draw", "")]
    if len(teams) < 2:
        return {"matched": False}
    for g in scoreboard(slug):
        if all(any(_match_name(t, [en]) for en in g["_norms"]) for t in teams[:2]):
            return {
                "matched": True, "state": g["state"], "detail": g["detail"],
                "completed": g["completed"], "clock": g["clock"],
                "period": g["period"], "start_ts": g["start_ts"],
                "away": g["away"], "home": g["home"],
            }
    return {"matched": False}
