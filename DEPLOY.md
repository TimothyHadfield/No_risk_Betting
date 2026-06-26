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

---

## ⚠️ Read first: data terms (the one real blocker to a public launch)
The app shows **Kalshi's** live market prices (and **ESPN** scores). Kalshi's
Data Terms restrict publicly redistributing their market data without written
consent, and ESPN's endpoints are unofficial. For a **private/personal/educational**
deployment this is low-risk; before opening it to the public at scale you should
get Kalshi's permission (or a data license) and review ESPN's terms. This is a
legal step, not a technical one.

---

## Option A — Render.com (easiest, has a free tier)
1. Push this folder to a **GitHub** repo (see "Putting it on GitHub" below).
2. Go to <https://render.com> → sign up → **New → Web Service** → connect your repo.
3. Render detects the **Dockerfile** automatically. Settings:
   - **Instance type:** Free is fine to start.
   - **Health check path:** `/healthz`
   - (Optional, to keep user data across restarts) add a **Disk**, mount path
     `/data` — the Dockerfile already points `NRB_DB` at `/data/data.db`.
4. Click **Create Web Service**. After the build you'll get a public URL like
   `https://no-risk-betting.onrender.com`.

Note: Render's free tier spins down after ~15 min idle (slow first request) and
its free filesystem is ephemeral (data resets on redeploy) unless you add a Disk.

## Option B — Railway.app
1. Push to GitHub. 2. <https://railway.app> → **New Project → Deploy from GitHub**.
3. Railway builds the Dockerfile and injects `PORT`. Add a **Volume** mounted at
   `/data` to persist the database. Generate a public domain in the service settings.

## Option C — Fly.io (CLI)
1. Install `flyctl`, run `fly launch` in this folder (it detects the Dockerfile).
2. `fly volumes create data --size 1`, then add to `fly.toml`:
   `[mounts]\n source="data"\n destination="/data"`. 3. `fly deploy`.

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
