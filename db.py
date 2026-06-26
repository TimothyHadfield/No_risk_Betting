"""
Persistence for the paper-trading app.

DUAL BACKEND (one code path, two stores):
  * Default: **SQLite** in a local file (zero install -- the dev/local workflow).
  * Production: **Postgres** -- used automatically when the `DATABASE_URL`
    environment variable is set (e.g. a free Neon/Supabase database on a host like
    Render whose own disk is ephemeral). This is what lets accounts/bets survive
    restarts and sync across devices without paying for a persistent disk.
Same SQL is used for both; a tiny helper layer translates placeholders (`?` -> `%s`),
auto-increment ids (`RETURNING id`), and upserts. Set `DATABASE_URL` and it just works.

MULTI-USER: every visitor is an anonymous "user" identified by a browser-generated
id (sent as the X-User-Id header). All state (account/bets/parlays/equity) is scoped
by user_id so anyone can use the site independently.

OPTIONAL ACCOUNTS: a visitor can sign up (email + password) so their data syncs
across devices. An account simply binds credentials to a stable user_id -- when an
anonymous visitor signs up we reuse their current browser id as the account's
user_id, so the bets they already placed carry over. Logging in elsewhere returns a
session token that resolves to that same user_id. Passwords are stored only as a
salted PBKDF2-SHA256 hash (stdlib `hashlib`); no plaintext, no third-party service.

All money is in DOLLARS. Contract prices are dollars in [0, 1] (0.30 == 30c == 30%
implied probability). No real money is ever involved -- the balance is virtual.

A single connection is shared across the server's threads and guarded by a lock.
"""

import functools
import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time

DB_PATH = "data.db"
DEFAULT_STARTING_BALANCE = 1000.0

# Postgres when DATABASE_URL is present, else SQLite. Decided once at import.
def _clean_db_url(raw):
    """Tolerate common copy-paste mistakes around a Postgres connection string.
    Hosts' "connect" snippets often wrap the URL, e.g. `psql 'postgresql://...'`
    or `export DATABASE_URL="postgresql://..."`. Strip those so the bare DSN is
    used regardless of which snippet was pasted into the host's env var."""
    s = (raw or "").strip()
    if not s:
        return ""
    for prefix in ("export ", "psql ", "DATABASE_URL=", "database_url="):
        if s.lower().startswith(prefix.lower()):
            s = s[len(prefix):].strip()
    if len(s) >= 2 and s[0] in "'\"" and s[-1] == s[0]:  # surrounding quotes
        s = s[1:-1].strip()
    return s


DATABASE_URL = _clean_db_url(os.environ.get("DATABASE_URL"))
USE_PG = bool(DATABASE_URL)
if USE_PG:
    import psycopg2
    import psycopg2.extras

_lock = threading.RLock()
_conn = None


# --------------------------------------------------------------------------
# Connection + tiny cross-backend helpers
# --------------------------------------------------------------------------

def _connect():
    if USE_PG:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return conn
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _reconnect():
    """Recreate the connection (used to recover from Postgres idle-disconnects,
    e.g. Neon suspending compute after a quiet period)."""
    global _conn
    try:
        if _conn is not None:
            _conn.close()
    except Exception:
        pass
    _conn = _connect()


def _with_retry(fn):
    """On Postgres, transparently reconnect+retry once if the connection dropped;
    roll back on any other DB error so a poisoned transaction can't wedge later
    queries. No-op on SQLite (its local connection doesn't drop)."""
    if not USE_PG:
        return fn

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            with _lock:
                _reconnect()
            return fn(*args, **kwargs)
        except psycopg2.Error:
            try:
                _conn.rollback()
            except Exception:
                pass
            raise
    return wrapper


def _q(sql):
    """Translate the SQLite '?' placeholder style to Postgres '%s'."""
    return sql.replace("?", "%s") if USE_PG else sql


def _query(sql, params=()):
    """Run a SELECT, return a list of dict rows."""
    if USE_PG:
        cur = _conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(_q(sql), params)
        rows = cur.fetchall()
        cur.close()
        return [dict(r) for r in rows]
    return [dict(r) for r in _conn.execute(sql, params).fetchall()]


def _query_one(sql, params=()):
    rows = _query(sql, params)
    return rows[0] if rows else None


def _exec(sql, params=()):
    """Run a statement with no result set (no commit)."""
    if USE_PG:
        cur = _conn.cursor()
        cur.execute(_q(sql), params)
        cur.close()
    else:
        _conn.execute(sql, params)


def _insert(sql, params=()):
    """Run an INSERT into an auto-id table, commit, return the new row id."""
    if USE_PG:
        cur = _conn.cursor()
        cur.execute(_q(sql) + " RETURNING id", params)
        rid = cur.fetchone()[0]
        cur.close()
        _conn.commit()
        return rid
    cur = _conn.execute(sql, params)
    _conn.commit()
    return cur.lastrowid


def _commit():
    _conn.commit()


def init(db_path=DB_PATH):
    global _conn, DB_PATH
    DB_PATH = db_path
    _conn = _connect()
    # Backend-specific column types: auto-increment PK and floating point.
    pk = "BIGSERIAL PRIMARY KEY" if USE_PG else "INTEGER PRIMARY KEY AUTOINCREMENT"
    num = "DOUBLE PRECISION" if USE_PG else "REAL"
    ddl = f"""
        CREATE TABLE IF NOT EXISTS accounts (
            user_id     TEXT PRIMARY KEY,
            balance     {num} NOT NULL,
            starting    {num} NOT NULL,
            created_at  {num} NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bets (
            id              {pk},
            user_id         TEXT,
            ticker          TEXT NOT NULL,
            event_ticker    TEXT,
            title           TEXT,
            side            TEXT NOT NULL,
            contracts       {num} NOT NULL,
            avg_price       {num} NOT NULL,
            stake           {num} NOT NULL,
            fee             {num} NOT NULL,
            cost_basis      {num} NOT NULL,
            status          TEXT NOT NULL,
            result          TEXT,
            payout          {num},
            realized_pnl    {num},
            partial         INTEGER DEFAULT 0,
            estimated_fill  INTEGER DEFAULT 0,
            placed_at       {num} NOT NULL,
            closed_at       {num},
            close_time      TEXT,
            category        TEXT,
            user_prob       {num},
            is_public       INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS equity_history (
            user_id     TEXT,
            ts          {num} NOT NULL,
            equity      {num} NOT NULL
        );

        CREATE TABLE IF NOT EXISTS parlays (
            id              {pk},
            user_id         TEXT,
            stake           {num} NOT NULL,
            cost_basis      {num} NOT NULL,
            combined_mult   {num} NOT NULL,
            status          TEXT NOT NULL,
            payout          {num},
            realized_pnl    {num},
            placed_at       {num} NOT NULL,
            closed_at       {num}
        );

        CREATE TABLE IF NOT EXISTS parlay_legs (
            id              {pk},
            parlay_id       INTEGER NOT NULL,
            ticker          TEXT NOT NULL,
            event_ticker    TEXT,
            title           TEXT,
            outcome_name    TEXT,
            side            TEXT NOT NULL,
            entry_price     {num} NOT NULL,
            mult            {num} NOT NULL,
            status          TEXT NOT NULL,
            result          TEXT
        );

        CREATE TABLE IF NOT EXISTS users (
            user_id        TEXT PRIMARY KEY,
            login          TEXT UNIQUE NOT NULL,
            pass_hash      TEXT NOT NULL,
            pass_salt      TEXT NOT NULL,
            recovery_hash  TEXT,
            recovery_salt  TEXT,
            reset_hash     TEXT,
            reset_salt     TEXT,
            reset_expires  {num},
            created_at     {num} NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            created_at  {num} NOT NULL
        );

        CREATE TABLE IF NOT EXISTS profiles (
            user_id     TEXT PRIMARY KEY,
            handle      TEXT UNIQUE,
            handle_lc   TEXT UNIQUE,
            bio         TEXT,
            is_public   INTEGER DEFAULT 0,
            created_at  {num} NOT NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
            id          {pk},
            user_id     TEXT NOT NULL,
            thread      TEXT NOT NULL,
            body        TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'visible',
            created_at  {num} NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reactions (
            id           {pk},
            user_id      TEXT NOT NULL,
            target_type  TEXT NOT NULL,
            target_id    TEXT NOT NULL,
            kind         TEXT NOT NULL DEFAULT 'like',
            created_at   {num} NOT NULL,
            UNIQUE (user_id, target_type, target_id, kind)
        );

        CREATE TABLE IF NOT EXISTS reports (
            id           {pk},
            reporter_id  TEXT NOT NULL,
            target_type  TEXT NOT NULL,
            target_id    TEXT NOT NULL,
            reason       TEXT,
            created_at   {num} NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_parlays_user ON parlays(user_id, status);
        CREATE INDEX IF NOT EXISTS idx_equity_user ON equity_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread, status);
        CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);
    """
    with _lock:
        if USE_PG:
            cur = _conn.cursor()
            cur.execute(ddl)  # psycopg2 runs multiple ;-separated statements
            cur.close()
        else:
            _conn.executescript(ddl)
        _conn.commit()
        _migrate()


def _table_columns(table):
    """Lower-cased set of column names for a table (both backends)."""
    if USE_PG:
        rows = _query("SELECT column_name AS name FROM information_schema.columns "
                      "WHERE table_name = ?", (table,))
        return {r["name"].lower() for r in rows}
    rows = _query(f"PRAGMA table_info({table})")
    return {r["name"].lower() for r in rows}


def _migrate():
    """Idempotently upgrade older databases in place (no data loss):
      * rename the original `email` column to the generic `login`
      * add the recovery-code columns
    Runs every startup; each step is a no-op once applied."""
    cols = _table_columns("users")
    if not cols:
        return
    if "login" not in cols and "email" in cols:
        _exec("ALTER TABLE users RENAME COLUMN email TO login")
        _commit()
        cols = _table_columns("users")
    for col in ("recovery_hash", "recovery_salt", "reset_hash", "reset_salt"):
        if col not in cols:
            _exec(f"ALTER TABLE users ADD COLUMN {col} TEXT")
            _commit()
    if "reset_expires" not in cols:
        num = "DOUBLE PRECISION" if USE_PG else "REAL"
        _exec(f"ALTER TABLE users ADD COLUMN reset_expires {num}")
        _commit()
    if "is_public" not in _table_columns("bets"):
        _exec("ALTER TABLE bets ADD COLUMN is_public INTEGER DEFAULT 0")
        _commit()


# ---- account -------------------------------------------------------------

def _ensure_account(uid, starting=DEFAULT_STARTING_BALANCE):
    if USE_PG:
        _exec("INSERT INTO accounts (user_id, balance, starting, created_at) "
              "VALUES (?,?,?,?) ON CONFLICT (user_id) DO NOTHING",
              (uid, starting, starting, time.time()))
    else:
        _exec("INSERT OR IGNORE INTO accounts (user_id, balance, starting, created_at) "
              "VALUES (?,?,?,?)", (uid, starting, starting, time.time()))


@_with_retry
def get_account(uid):
    with _lock:
        _ensure_account(uid)
        _commit()
        return _query_one("SELECT * FROM accounts WHERE user_id = ?", (uid,))


@_with_retry
def adjust_balance(uid, delta):
    with _lock:
        _ensure_account(uid)
        _exec("UPDATE accounts SET balance = balance + ? WHERE user_id = ?",
              (delta, uid))
        _commit()


@_with_retry
def reset_account(uid, starting=DEFAULT_STARTING_BALANCE):
    with _lock:
        now = time.time()
        _exec("DELETE FROM bets WHERE user_id = ?", (uid,))
        _exec("DELETE FROM equity_history WHERE user_id = ?", (uid,))
        _exec("DELETE FROM parlay_legs WHERE parlay_id IN "
              "(SELECT id FROM parlays WHERE user_id = ?)", (uid,))
        _exec("DELETE FROM parlays WHERE user_id = ?", (uid,))
        _ensure_account(uid, starting)
        _exec("UPDATE accounts SET balance = ?, starting = ?, created_at = ? "
              "WHERE user_id = ?", (starting, starting, now, uid))
        _commit()


@_with_retry
def all_user_ids():
    with _lock:
        return [r["user_id"] for r in _query("SELECT user_id FROM accounts")]


# ---- accounts / login (optional cross-device sync) -----------------------
# Login is a username OR an email -- just an unverified identifier (we never send
# email). Forgotten passwords are recovered with a one-time RECOVERY CODE shown at
# signup; both the password and the recovery code are stored only as salted
# PBKDF2-SHA256 hashes. No plaintext, no third-party service.

_PBKDF2_ROUNDS = 200_000
# Recovery-code alphabet: unambiguous (no 0/O/1/I/L).
_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _hash_secret(secret, salt_hex):
    return hashlib.pbkdf2_hmac(
        "sha256", secret.encode("utf-8"), bytes.fromhex(salt_hex),
        _PBKDF2_ROUNDS).hex()


# back-compat alias (older callers/tests used _hash_pw)
_hash_pw = _hash_secret


def _norm_login(s):
    return (s or "").strip().lower()


def _norm_code(s):
    """Recovery codes compare case-insensitively, ignoring spaces."""
    return (s or "").strip().upper().replace(" ", "")


def gen_recovery_code():
    groups = ["".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
              for _ in range(3)]
    return "NRB-" + "-".join(groups)


def gen_reset_code():
    """Shorter, time-limited code emailed for password reset (e.g. K7P2-9QXM)."""
    groups = ["".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
              for _ in range(2)]
    return "-".join(groups)


@_with_retry
def login_taken(login):
    with _lock:
        return _query_one("SELECT 1 FROM users WHERE login = ?",
                          (_norm_login(login),)) is not None


@_with_retry
def create_user(login, password, claim_uid=None):
    """Register an account. Returns (user_id, recovery_code) on success, or
    (None, None) if the login is already taken. If `claim_uid` is an unclaimed
    anonymous id, it becomes the account's user_id so that browser's existing
    bets/balance carry over. The recovery code is returned ONCE (only its hash is
    stored)."""
    login = _norm_login(login)
    with _lock:
        if _query_one("SELECT 1 FROM users WHERE login = ?", (login,)):
            return None, None
        uid = None
        if claim_uid:
            if not _query_one("SELECT 1 FROM users WHERE user_id = ?", (claim_uid,)):
                uid = claim_uid
        if not uid:
            uid = secrets.token_hex(16)
        psalt = secrets.token_hex(16)
        code = gen_recovery_code()
        rsalt = secrets.token_hex(16)
        _exec("INSERT INTO users (user_id, login, pass_hash, pass_salt, "
              "recovery_hash, recovery_salt, created_at) VALUES (?,?,?,?,?,?,?)",
              (uid, login, _hash_secret(password, psalt), psalt,
               _hash_secret(_norm_code(code), rsalt), rsalt, time.time()))
        _ensure_account(uid)  # guarantee a balance row (no-op if it already exists)
        _commit()
        return uid, code


@_with_retry
def verify_login(login, password):
    """Return the user_id if the login/password match, else None."""
    with _lock:
        row = _query_one(
            "SELECT user_id, pass_hash, pass_salt FROM users WHERE login = ?",
            (_norm_login(login),))
    if not row:
        return None
    if hmac.compare_digest(_hash_secret(password, row["pass_salt"]), row["pass_hash"]):
        return row["user_id"]
    return None


@_with_retry
def verify_recovery(login, code):
    """Return the user_id if the login + recovery code match, else None."""
    with _lock:
        row = _query_one(
            "SELECT user_id, recovery_hash, recovery_salt FROM users WHERE login = ?",
            (_norm_login(login),))
    if not row or not row.get("recovery_hash"):
        return None
    if hmac.compare_digest(_hash_secret(_norm_code(code), row["recovery_salt"]),
                           row["recovery_hash"]):
        return row["user_id"]
    return None


@_with_retry
def set_password(uid, new_password):
    """Set a new password, clear any pending reset code, and invalidate all
    existing sessions for the user."""
    salt = secrets.token_hex(16)
    with _lock:
        _exec("UPDATE users SET pass_hash = ?, pass_salt = ?, reset_hash = NULL, "
              "reset_salt = NULL, reset_expires = NULL WHERE user_id = ?",
              (_hash_secret(new_password, salt), salt, uid))
        _exec("DELETE FROM sessions WHERE user_id = ?", (uid,))
        _commit()


@_with_retry
def user_id_by_login(login):
    with _lock:
        row = _query_one("SELECT user_id FROM users WHERE login = ?",
                         (_norm_login(login),))
        return row["user_id"] if row else None


@_with_retry
def set_reset_code(uid, ttl_seconds=1800):
    """Generate a time-limited password-reset code, store only its hash, and
    return the plaintext code (to be emailed)."""
    code = gen_reset_code()
    salt = secrets.token_hex(16)
    with _lock:
        _exec("UPDATE users SET reset_hash = ?, reset_salt = ?, reset_expires = ? "
              "WHERE user_id = ?",
              (_hash_secret(_norm_code(code), salt), salt,
               time.time() + ttl_seconds, uid))
        _commit()
    return code


@_with_retry
def verify_reset_code(login, code):
    """Return the user_id if the emailed reset code matches and hasn't expired."""
    with _lock:
        row = _query_one(
            "SELECT user_id, reset_hash, reset_salt, reset_expires FROM users "
            "WHERE login = ?", (_norm_login(login),))
    if not row or not row.get("reset_hash") or not row.get("reset_expires"):
        return None
    if float(row["reset_expires"]) < time.time():
        return None
    if hmac.compare_digest(_hash_secret(_norm_code(code), row["reset_salt"]),
                           row["reset_hash"]):
        return row["user_id"]
    return None


def verify_recovery_or_reset(login, code):
    """Accept either the permanent recovery code or a valid emailed reset code."""
    return verify_recovery(login, code) or verify_reset_code(login, code)


@_with_retry
def get_user(uid):
    with _lock:
        return _query_one(
            "SELECT user_id, login, created_at FROM users WHERE user_id = ?", (uid,))


@_with_retry
def delete_user(uid):
    """Permanently remove an account and ALL of its data (including social)."""
    with _lock:
        _exec("DELETE FROM sessions WHERE user_id = ?", (uid,))
        _exec("DELETE FROM bets WHERE user_id = ?", (uid,))
        _exec("DELETE FROM equity_history WHERE user_id = ?", (uid,))
        _exec("DELETE FROM parlay_legs WHERE parlay_id IN "
              "(SELECT id FROM parlays WHERE user_id = ?)", (uid,))
        _exec("DELETE FROM parlays WHERE user_id = ?", (uid,))
        _exec("DELETE FROM comments WHERE user_id = ?", (uid,))
        _exec("DELETE FROM reactions WHERE user_id = ?", (uid,))
        _exec("DELETE FROM reports WHERE reporter_id = ?", (uid,))
        _exec("DELETE FROM profiles WHERE user_id = ?", (uid,))
        _exec("DELETE FROM accounts WHERE user_id = ?", (uid,))
        _exec("DELETE FROM users WHERE user_id = ?", (uid,))
        _commit()


@_with_retry
def create_session(uid):
    token = secrets.token_urlsafe(32)
    with _lock:
        _exec("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)",
              (token, uid, time.time()))
        _commit()
    return token


@_with_retry
def user_id_for_token(token):
    if not token:
        return None
    with _lock:
        row = _query_one("SELECT user_id FROM sessions WHERE token = ?", (token,))
        return row["user_id"] if row else None


@_with_retry
def delete_session(token):
    if not token:
        return
    with _lock:
        _exec("DELETE FROM sessions WHERE token = ?", (token,))
        _commit()


# ---- bets ----------------------------------------------------------------

@_with_retry
def insert_bet(uid, b):
    with _lock:
        return _insert(
            """INSERT INTO bets
               (user_id, ticker, event_ticker, title, side, contracts, avg_price,
                stake, fee, cost_basis, status, partial, estimated_fill, placed_at,
                close_time, category, user_prob)
               VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?,?,?,?,?,?)""",
            (uid, b["ticker"], b.get("event_ticker"), b.get("title"), b["side"],
             b["contracts"], b["avg_price"], b["stake"], b["fee"], b["cost_basis"],
             1 if b.get("partial") else 0, 1 if b.get("estimated_fill") else 0,
             time.time(), b.get("close_time"), b.get("category"), b.get("user_prob")))


@_with_retry
def get_bet(bet_id):
    with _lock:
        return _query_one("SELECT * FROM bets WHERE id = ?", (bet_id,))


@_with_retry
def list_bets(uid, status=None):
    with _lock:
        if status:
            return _query("SELECT * FROM bets WHERE user_id = ? AND status = ? "
                          "ORDER BY placed_at DESC", (uid, status))
        return _query("SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC",
                      (uid,))


@_with_retry
def all_open_bets():
    """Across all users -- for the settlement poller."""
    with _lock:
        return _query("SELECT * FROM bets WHERE status = 'open'")


@_with_retry
def resolve_bet(bet_id, status, result, payout, realized_pnl):
    with _lock:
        _exec("UPDATE bets SET status = ?, result = ?, payout = ?, realized_pnl = ?, "
              "closed_at = ? WHERE id = ?",
              (status, result, payout, realized_pnl, time.time(), bet_id))
        _commit()


# ---- equity history ------------------------------------------------------

@_with_retry
def record_equity(uid, equity):
    with _lock:
        _exec("INSERT INTO equity_history (user_id, ts, equity) VALUES (?,?,?)",
              (uid, time.time(), equity))
        _commit()


@_with_retry
def equity_history(uid):
    with _lock:
        return _query("SELECT ts, equity FROM equity_history WHERE user_id = ? "
                      "ORDER BY ts", (uid,))


# ---- parlays -------------------------------------------------------------

@_with_retry
def insert_parlay(uid, stake, cost_basis, combined_mult, legs):
    with _lock:
        # Insert parlay + its legs atomically (one commit at the end).
        if USE_PG:
            cur = _conn.cursor()
            cur.execute(_q("INSERT INTO parlays (user_id, stake, cost_basis, "
                           "combined_mult, status, placed_at) "
                           "VALUES (?,?,?,?, 'open', ?) RETURNING id"),
                        (uid, stake, cost_basis, combined_mult, time.time()))
            pid = cur.fetchone()[0]
            cur.close()
        else:
            cur = _conn.execute(
                "INSERT INTO parlays (user_id, stake, cost_basis, combined_mult, "
                "status, placed_at) VALUES (?,?,?,?, 'open', ?)",
                (uid, stake, cost_basis, combined_mult, time.time()))
            pid = cur.lastrowid
        for lg in legs:
            _exec("INSERT INTO parlay_legs (parlay_id, ticker, event_ticker, title, "
                  "outcome_name, side, entry_price, mult, status) "
                  "VALUES (?,?,?,?,?,?,?,?, 'open')",
                  (pid, lg["ticker"], lg.get("event_ticker"), lg.get("title"),
                   lg.get("outcome_name"), lg["side"], lg["entry_price"], lg["mult"]))
        _commit()
        return pid


def _legs_for(pid):
    return _query("SELECT * FROM parlay_legs WHERE parlay_id = ? ORDER BY id", (pid,))


@_with_retry
def get_parlay(pid):
    with _lock:
        p = _query_one("SELECT * FROM parlays WHERE id = ?", (pid,))
        if not p:
            return None
        p["legs"] = _legs_for(pid)
        return p


@_with_retry
def list_parlays(uid, status=None):
    with _lock:
        if status:
            rows = _query("SELECT * FROM parlays WHERE user_id = ? AND status = ? "
                          "ORDER BY placed_at DESC", (uid, status))
        else:
            rows = _query("SELECT * FROM parlays WHERE user_id = ? "
                          "ORDER BY placed_at DESC", (uid,))
        for p in rows:
            p["legs"] = _legs_for(p["id"])
        return rows


@_with_retry
def all_open_parlays():
    """Across all users -- for the settlement poller."""
    with _lock:
        rows = _query("SELECT * FROM parlays WHERE status = 'open'")
        for p in rows:
            p["legs"] = _legs_for(p["id"])
        return rows


@_with_retry
def set_leg(leg_id, status, result):
    with _lock:
        _exec("UPDATE parlay_legs SET status = ?, result = ? WHERE id = ?",
              (status, result, leg_id))
        _commit()


@_with_retry
def resolve_parlay(pid, status, payout, realized_pnl):
    with _lock:
        _exec("UPDATE parlays SET status = ?, payout = ?, realized_pnl = ?, "
              "closed_at = ? WHERE id = ?",
              (status, payout, realized_pnl, time.time(), pid))
        _commit()


# ==========================================================================
# Social layer: public profiles, leaderboard, public bets feed, comments,
# reactions, reports. Privacy rule: only `handle` (and chosen bio) is ever
# exposed publicly -- never email/login or the raw user_id.
# ==========================================================================

# ---- profiles ------------------------------------------------------------

def _ensure_profile(uid):
    if USE_PG:
        _exec("INSERT INTO profiles (user_id, is_public, created_at) "
              "VALUES (?, 0, ?) ON CONFLICT (user_id) DO NOTHING",
              (uid, time.time()))
    else:
        _exec("INSERT OR IGNORE INTO profiles (user_id, is_public, created_at) "
              "VALUES (?, 0, ?)", (uid, time.time()))


@_with_retry
def get_profile(uid):
    with _lock:
        _ensure_profile(uid)
        _commit()
        return _query_one("SELECT * FROM profiles WHERE user_id = ?", (uid,))


@_with_retry
def get_profile_by_handle(handle):
    with _lock:
        return _query_one("SELECT * FROM profiles WHERE handle_lc = ?",
                          ((handle or "").strip().lower(),))


@_with_retry
def handle_available(handle, exclude_uid=None):
    lc = (handle or "").strip().lower()
    with _lock:
        row = _query_one("SELECT user_id FROM profiles WHERE handle_lc = ?", (lc,))
    return (row is None) or (row["user_id"] == exclude_uid)


@_with_retry
def set_profile(uid, handle=None, bio=None, is_public=None):
    """Create/update a profile. Returns (ok, error). Handle is unique
    (case-insensitive)."""
    with _lock:
        _ensure_profile(uid)
        if handle is not None:
            lc = handle.strip().lower()
            row = _query_one("SELECT user_id FROM profiles WHERE handle_lc = ?", (lc,))
            if row and row["user_id"] != uid:
                _commit()
                return False, "That handle is taken."
            _exec("UPDATE profiles SET handle = ?, handle_lc = ? WHERE user_id = ?",
                  (handle.strip(), lc, uid))
        if bio is not None:
            _exec("UPDATE profiles SET bio = ? WHERE user_id = ?", (bio, uid))
        if is_public is not None:
            _exec("UPDATE profiles SET is_public = ? WHERE user_id = ?",
                  (1 if is_public else 0, uid))
        _commit()
        return True, None


@_with_retry
def public_profiles():
    """Public profiles that have chosen a handle -- candidates for the leaderboard."""
    with _lock:
        return _query("SELECT user_id, handle, bio FROM profiles "
                      "WHERE is_public = 1 AND handle IS NOT NULL")


# ---- public bets feed ----------------------------------------------------

@_with_retry
def set_bet_public(bet_id, uid, public):
    with _lock:
        _exec("UPDATE bets SET is_public = ? WHERE id = ? AND user_id = ?",
              (1 if public else 0, bet_id, uid))
        _commit()


_FEED_COLS = ("b.id, b.ticker, b.event_ticker, b.title, b.side, b.contracts, "
              "b.avg_price, b.stake, b.cost_basis, b.status, b.result, "
              "b.realized_pnl, b.placed_at, b.category, b.user_prob, p.handle")


@_with_retry
def public_feed(limit=50):
    with _lock:
        return _query(
            f"SELECT {_FEED_COLS} FROM bets b JOIN profiles p ON b.user_id = p.user_id "
            "WHERE b.is_public = 1 AND p.is_public = 1 AND p.handle IS NOT NULL "
            "ORDER BY b.placed_at DESC LIMIT ?", (limit,))


@_with_retry
def public_bets_for_user(uid, limit=50):
    with _lock:
        return _query(
            f"SELECT {_FEED_COLS} FROM bets b JOIN profiles p ON b.user_id = p.user_id "
            "WHERE b.user_id = ? AND b.is_public = 1 "
            "ORDER BY b.placed_at DESC LIMIT ?", (uid, limit))


# ---- comments ------------------------------------------------------------

@_with_retry
def add_comment(uid, thread, body):
    with _lock:
        return _insert(
            "INSERT INTO comments (user_id, thread, body, status, created_at) "
            "VALUES (?,?,?, 'visible', ?)", (uid, thread, body, time.time()))


@_with_retry
def list_comments(thread, limit=200):
    with _lock:
        return _query(
            "SELECT c.id, c.user_id, c.body, c.created_at, p.handle "
            "FROM comments c LEFT JOIN profiles p ON c.user_id = p.user_id "
            "WHERE c.thread = ? AND c.status = 'visible' "
            "ORDER BY c.created_at ASC LIMIT ?", (thread, limit))


@_with_retry
def get_comment(cid):
    with _lock:
        return _query_one("SELECT * FROM comments WHERE id = ?", (cid,))


@_with_retry
def count_comments(thread):
    with _lock:
        row = _query_one("SELECT COUNT(*) AS n FROM comments "
                         "WHERE thread = ? AND status = 'visible'", (thread,))
        return row["n"] if row else 0


@_with_retry
def set_comment_status(cid, status):
    with _lock:
        _exec("UPDATE comments SET status = ? WHERE id = ?", (status, cid))
        _commit()


# ---- reactions -----------------------------------------------------------

@_with_retry
def toggle_reaction(uid, target_type, target_id, kind="like"):
    """Toggle a reaction. Returns True if now on, False if removed."""
    target_id = str(target_id)
    with _lock:
        row = _query_one(
            "SELECT id FROM reactions WHERE user_id = ? AND target_type = ? "
            "AND target_id = ? AND kind = ?", (uid, target_type, target_id, kind))
        if row:
            _exec("DELETE FROM reactions WHERE id = ?", (row["id"],))
            _commit()
            return False
        _exec("INSERT INTO reactions (user_id, target_type, target_id, kind, created_at) "
              "VALUES (?,?,?,?,?)", (uid, target_type, target_id, kind, time.time()))
        _commit()
        return True


@_with_retry
def reaction_counts(target_type, target_ids, kind="like"):
    """Map of target_id -> count for a batch of targets."""
    ids = [str(t) for t in target_ids]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    with _lock:
        rows = _query(
            f"SELECT target_id, COUNT(*) AS n FROM reactions "
            f"WHERE target_type = ? AND kind = ? AND target_id IN ({placeholders}) "
            "GROUP BY target_id", (target_type, kind, *ids))
    return {r["target_id"]: r["n"] for r in rows}


@_with_retry
def reactions_by_user(uid, target_type, kind="like"):
    """Set of target_ids the user has reacted to (for highlighting)."""
    with _lock:
        rows = _query("SELECT target_id FROM reactions WHERE user_id = ? "
                      "AND target_type = ? AND kind = ?", (uid, target_type, kind))
    return {r["target_id"] for r in rows}


# ---- reports (moderation) ------------------------------------------------

@_with_retry
def add_report(reporter_id, target_type, target_id, reason):
    with _lock:
        _exec("INSERT INTO reports (reporter_id, target_type, target_id, reason, "
              "created_at) VALUES (?,?,?,?,?)",
              (reporter_id, target_type, str(target_id), (reason or "")[:500],
               time.time()))
        _commit()
