"""
SQLite persistence for the paper-trading app.

MULTI-USER: every visitor is an anonymous "user" identified by a browser-generated
id (sent as the X-User-Id header). All state (account/bets/parlays/equity) is scoped
by user_id so anyone can use the site independently. No login, no personal data.

All money is in DOLLARS (REAL). Contract prices are dollars in [0, 1] (0.30 == 30c
== 30% implied probability). No real money is ever involved -- the balance is virtual.

A single connection is shared across the server's threads (check_same_thread=False)
and guarded by a lock.
"""

import sqlite3
import threading
import time

DB_PATH = "data.db"
DEFAULT_STARTING_BALANCE = 1000.0

_lock = threading.RLock()
_conn = None


def _connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init(db_path=DB_PATH):
    global _conn, DB_PATH
    DB_PATH = db_path
    _conn = _connect()
    with _lock:
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                user_id     TEXT PRIMARY KEY,
                balance     REAL NOT NULL,
                starting    REAL NOT NULL,
                created_at  REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bets (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         TEXT,
                ticker          TEXT NOT NULL,
                event_ticker    TEXT,
                title           TEXT,
                side            TEXT NOT NULL,
                contracts       REAL NOT NULL,
                avg_price       REAL NOT NULL,
                stake           REAL NOT NULL,
                fee             REAL NOT NULL,
                cost_basis      REAL NOT NULL,
                status          TEXT NOT NULL,
                result          TEXT,
                payout          REAL,
                realized_pnl    REAL,
                partial         INTEGER DEFAULT 0,
                estimated_fill  INTEGER DEFAULT 0,
                placed_at       REAL NOT NULL,
                closed_at       REAL,
                close_time      TEXT,
                category        TEXT,
                user_prob       REAL
            );

            CREATE TABLE IF NOT EXISTS equity_history (
                user_id     TEXT,
                ts          REAL NOT NULL,
                equity      REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS parlays (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         TEXT,
                stake           REAL NOT NULL,
                cost_basis      REAL NOT NULL,
                combined_mult   REAL NOT NULL,
                status          TEXT NOT NULL,
                payout          REAL,
                realized_pnl    REAL,
                placed_at       REAL NOT NULL,
                closed_at       REAL
            );

            CREATE TABLE IF NOT EXISTS parlay_legs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                parlay_id       INTEGER NOT NULL,
                ticker          TEXT NOT NULL,
                event_ticker    TEXT,
                title           TEXT,
                outcome_name    TEXT,
                side            TEXT NOT NULL,
                entry_price     REAL NOT NULL,
                mult            REAL NOT NULL,
                status          TEXT NOT NULL,
                result          TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, status);
            CREATE INDEX IF NOT EXISTS idx_parlays_user ON parlays(user_id, status);
            CREATE INDEX IF NOT EXISTS idx_equity_user ON equity_history(user_id);
            """
        )
        _conn.commit()


# ---- account -------------------------------------------------------------

def _ensure_account(uid, starting=DEFAULT_STARTING_BALANCE):
    _conn.execute(
        "INSERT OR IGNORE INTO accounts (user_id, balance, starting, created_at) "
        "VALUES (?,?,?,?)", (uid, starting, starting, time.time()))


def get_account(uid):
    with _lock:
        _ensure_account(uid)
        row = _conn.execute("SELECT * FROM accounts WHERE user_id = ?", (uid,)).fetchone()
        _conn.commit()
        return dict(row)


def adjust_balance(uid, delta):
    with _lock:
        _ensure_account(uid)
        _conn.execute("UPDATE accounts SET balance = balance + ? WHERE user_id = ?",
                      (delta, uid))
        _conn.commit()


def reset_account(uid, starting=DEFAULT_STARTING_BALANCE):
    with _lock:
        now = time.time()
        _conn.execute("DELETE FROM bets WHERE user_id = ?", (uid,))
        _conn.execute("DELETE FROM equity_history WHERE user_id = ?", (uid,))
        _conn.execute("DELETE FROM parlay_legs WHERE parlay_id IN "
                      "(SELECT id FROM parlays WHERE user_id = ?)", (uid,))
        _conn.execute("DELETE FROM parlays WHERE user_id = ?", (uid,))
        _ensure_account(uid, starting)
        _conn.execute("UPDATE accounts SET balance = ?, starting = ?, created_at = ? "
                      "WHERE user_id = ?", (starting, starting, now, uid))
        _conn.commit()


def all_user_ids():
    with _lock:
        return [r["user_id"] for r in
                _conn.execute("SELECT user_id FROM accounts").fetchall()]


# ---- bets ----------------------------------------------------------------

def insert_bet(uid, b):
    with _lock:
        cur = _conn.execute(
            """INSERT INTO bets
               (user_id, ticker, event_ticker, title, side, contracts, avg_price,
                stake, fee, cost_basis, status, partial, estimated_fill, placed_at,
                close_time, category, user_prob)
               VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?,?,?,?,?,?)""",
            (uid, b["ticker"], b.get("event_ticker"), b.get("title"), b["side"],
             b["contracts"], b["avg_price"], b["stake"], b["fee"], b["cost_basis"],
             1 if b.get("partial") else 0, 1 if b.get("estimated_fill") else 0,
             time.time(), b.get("close_time"), b.get("category"), b.get("user_prob")),
        )
        _conn.commit()
        return cur.lastrowid


def get_bet(bet_id):
    with _lock:
        row = _conn.execute("SELECT * FROM bets WHERE id = ?", (bet_id,)).fetchone()
        return dict(row) if row else None


def list_bets(uid, status=None):
    with _lock:
        if status:
            rows = _conn.execute(
                "SELECT * FROM bets WHERE user_id = ? AND status = ? "
                "ORDER BY placed_at DESC", (uid, status)).fetchall()
        else:
            rows = _conn.execute(
                "SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC",
                (uid,)).fetchall()
        return [dict(r) for r in rows]


def all_open_bets():
    """Across all users -- for the settlement poller."""
    with _lock:
        rows = _conn.execute("SELECT * FROM bets WHERE status = 'open'").fetchall()
        return [dict(r) for r in rows]


def resolve_bet(bet_id, status, result, payout, realized_pnl):
    with _lock:
        _conn.execute(
            "UPDATE bets SET status = ?, result = ?, payout = ?, realized_pnl = ?, "
            "closed_at = ? WHERE id = ?",
            (status, result, payout, realized_pnl, time.time(), bet_id))
        _conn.commit()


# ---- equity history ------------------------------------------------------

def record_equity(uid, equity):
    with _lock:
        _conn.execute("INSERT INTO equity_history (user_id, ts, equity) VALUES (?,?,?)",
                      (uid, time.time(), equity))
        _conn.commit()


def equity_history(uid):
    with _lock:
        rows = _conn.execute(
            "SELECT ts, equity FROM equity_history WHERE user_id = ? ORDER BY ts",
            (uid,)).fetchall()
        return [dict(r) for r in rows]


# ---- parlays -------------------------------------------------------------

def insert_parlay(uid, stake, cost_basis, combined_mult, legs):
    with _lock:
        cur = _conn.execute(
            "INSERT INTO parlays (user_id, stake, cost_basis, combined_mult, status, "
            "placed_at) VALUES (?,?,?,?, 'open', ?)",
            (uid, stake, cost_basis, combined_mult, time.time()))
        pid = cur.lastrowid
        for lg in legs:
            _conn.execute(
                "INSERT INTO parlay_legs (parlay_id, ticker, event_ticker, title, "
                "outcome_name, side, entry_price, mult, status) "
                "VALUES (?,?,?,?,?,?,?,?, 'open')",
                (pid, lg["ticker"], lg.get("event_ticker"), lg.get("title"),
                 lg.get("outcome_name"), lg["side"], lg["entry_price"], lg["mult"]))
        _conn.commit()
        return pid


def _legs_for(pid):
    rows = _conn.execute("SELECT * FROM parlay_legs WHERE parlay_id = ? ORDER BY id",
                         (pid,)).fetchall()
    return [dict(r) for r in rows]


def get_parlay(pid):
    with _lock:
        row = _conn.execute("SELECT * FROM parlays WHERE id = ?", (pid,)).fetchone()
        if not row:
            return None
        p = dict(row); p["legs"] = _legs_for(pid)
        return p


def list_parlays(uid, status=None):
    with _lock:
        if status:
            rows = _conn.execute("SELECT * FROM parlays WHERE user_id = ? AND status = ? "
                                 "ORDER BY placed_at DESC", (uid, status)).fetchall()
        else:
            rows = _conn.execute("SELECT * FROM parlays WHERE user_id = ? "
                                 "ORDER BY placed_at DESC", (uid,)).fetchall()
        out = []
        for r in rows:
            p = dict(r); p["legs"] = _legs_for(p["id"]); out.append(p)
        return out


def all_open_parlays():
    """Across all users -- for the settlement poller."""
    with _lock:
        rows = _conn.execute("SELECT * FROM parlays WHERE status = 'open'").fetchall()
        out = []
        for r in rows:
            p = dict(r); p["legs"] = _legs_for(p["id"]); out.append(p)
        return out


def set_leg(leg_id, status, result):
    with _lock:
        _conn.execute("UPDATE parlay_legs SET status = ?, result = ? WHERE id = ?",
                      (status, result, leg_id))
        _conn.commit()


def resolve_parlay(pid, status, payout, realized_pnl):
    with _lock:
        _conn.execute("UPDATE parlays SET status = ?, payout = ?, realized_pnl = ?, "
                      "closed_at = ? WHERE id = ?",
                      (status, payout, realized_pnl, time.time(), pid))
        _conn.commit()
