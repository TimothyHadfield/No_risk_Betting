# No-Risk Betting — runs on the Python standard library only (no pip installs).
FROM python:3.12-slim

WORKDIR /app
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
