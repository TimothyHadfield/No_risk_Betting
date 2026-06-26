# No-Risk Betting — runs on the Python standard library only (no pip installs).
FROM python:3.12-slim

WORKDIR /app

# Install the optional Postgres driver (used only when DATABASE_URL is set).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hosts (Render/Railway/Fly/etc.) inject $PORT; the server reads it.
ENV HOST=0.0.0.0 \
    PORT=8765 \
    NRB_DB=/data/data.db

# /data is where the SQLite file lives; mount a persistent volume here so
# user accounts/bets survive restarts.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8765
CMD ["python", "server.py"]
