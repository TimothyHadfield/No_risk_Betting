# Hosting No-Risk Betting

The app is a single Python program using **only the standard library** (no
dependencies). It reads config from environment variables, so most hosts run it
with zero changes:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT`   | `8765`  | Port to listen on (hosts inject this automatically) |
| `HOST`   | `0.0.0.0` | Bind address (leave as-is for hosting) |
| `NRB_DB` | `data.db` | SQLite file path (point at a persistent disk to keep data) |

Health check endpoint: **`GET /healthz`** → `{"ok": true}`.

### Accounts & persistent storage (cross-device login)
Visitors are anonymous by default (data keyed to their browser). They can also
**create a free account** (email + password) to sync their bets/balance across
devices — see the burger menu → *Log in / Sign up*. Accounts live in the same
SQLite database (`NRB_DB`), so **the database must be on a persistent disk** or
accounts reset on every redeploy. Passwords are stored only as a salted
PBKDF2-SHA256 hash (Python stdlib) — no plaintext, no third-party service.

Storage is tiny: a bet is a few hundred bytes, so even thousands of users fit in
well under the free allowances below.

**Two ways to get persistent storage for free:**
- **No credit card (recommended if you can't risk any spend): Render + Neon.**
  Host the app on Render's free web service (no card) and keep the data in a free
  **Neon** Postgres database (no card). The app already supports Postgres — set the
  `DATABASE_URL` env var and it switches from SQLite to Postgres automatically. See
  **Option A**.
- **Single platform, but needs a card on file: Fly.io.** Fly gives a free
  persistent volume so SQLite works unchanged, but requires a payment method (usage
  is billed, so a small surprise charge is possible). See **Option C**.

Locally you never need any of this — with no `DATABASE_URL` set, `python server.py`
just uses a local SQLite file as before.

---

## ⚠️ Read first: data terms (the one real blocker to a public launch)
The app shows **Kalshi's** live market prices (and **ESPN** scores). Kalshi's
Data Terms restrict publicly redistributing their market data without written
consent, and ESPN's endpoints are unofficial. For a **private/personal/educational**
deployment this is low-risk; before opening it to the public at scale you should
get Kalshi's permission (or a data license) and review ESPN's terms. This is a
legal step, not a technical one.

---

## Option A ⭐ recommended (free, **no credit card**) — Render + Neon
Render runs the app; Neon stores the data so it survives restarts. Neither needs a
card.

**Step 1 — create the free database (Neon):**
1. Go to <https://neon.tech> → sign up (GitHub login works; no card).
2. Create a project (any name, pick a region near you). Neon gives you a
   **connection string** that looks like:
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`
3. Copy that whole string — you'll paste it into Render as `DATABASE_URL`.

**Step 2 — host the app (Render):**
1. Push this folder to a **GitHub** repo (already done: github.com/TimothyHadfield/No_risk_Betting).
2. Go to <https://render.com> → sign up (no card) → **New → Web Service** → connect the repo.
3. Render auto-detects the **Dockerfile**. Settings:
   - **Instance type:** Free.
   - **Health check path:** `/healthz`
   - **Environment → Add Environment Variable:** key `DATABASE_URL`, value = the
     Neon string from step 1. (That single variable flips the app to Postgres.)
4. **Create Web Service.** After the build you get a public URL like
   `https://no-risk-betting.onrender.com`. Open it, then try *Log in / Sign up* in
   two different browsers to confirm accounts sync.

Notes: Render's free tier spins down after ~15 min idle, so the *first* request
after a quiet spell takes ~30–60s to wake (normal). You do **not** need a Render
Disk in this setup — the data lives in Neon, not on Render's filesystem.

## Option B — Railway.app
1. Push to GitHub. 2. <https://railway.app> → **New Project → Deploy from GitHub**.
3. Railway builds the Dockerfile and injects `PORT`. Add a **Volume** mounted at
   `/data` to persist the database. Generate a public domain in the service settings.

## Option C — Fly.io (free persistent disk, but **requires a card on file**)
Only use this if you're comfortable adding a payment method to Fly. It keeps
SQLite (no `DATABASE_URL` needed) by giving the app its own persistent volume.
A ready-made **`fly.toml`** is already in this folder (persistent volume mounted
at `/data`, health check on `/healthz`, scale-to-zero when idle). Steps:

1. **Install the CLI** (Windows PowerShell):
   ```powershell
   pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```
   Then open a new terminal so `fly` is on your PATH.
2. **Sign up / log in:** `fly auth signup`  (or `fly auth login` if you have an account).
3. **Pick a unique app name:** open `fly.toml` and, if you like, change the
   `app = "no-risk-betting"` line to something unique (Fly names are global). Set
   `primary_region` to one near you (e.g. `lhr` London, `iad` US-East).
4. **Create the app + database disk** (run inside this folder):
   ```sh
   fly apps create <your-app-name>          # skip if you kept the default and it's free
   fly volumes create data --size 1 --region <your-region>
   ```
5. **Deploy:** `fly deploy`
6. Fly prints your URL, e.g. `https://<your-app-name>.fly.dev`. Open it and try
   *Log in / Sign up* from two browsers to confirm accounts sync.

To ship later changes: commit, then just run `fly deploy` again (or wire up the
GitHub action Fly offers). Free allowance covers one small machine + a 1 GB volume.

## Putting it on GitHub (first time)
```sh
cd "No_risk_Betting"
git init
git add .
git commit -m "No-Risk Betting"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/no-risk-betting.git
git branch -M main
git push -u origin main
```
(`.gitignore` already excludes `data.db`, logs, and caches.)

## Run with Docker locally (to test the production image)
```sh
docker build -t norisk .
docker run -p 8765:8765 norisk
# open http://localhost:8765
```

## Plain local run (no Docker)
```sh
python server.py            # serves on http://localhost:8765
PORT=3000 python server.py  # custom port
```
