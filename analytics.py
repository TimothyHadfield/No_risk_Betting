"""
Forecasting-skill analytics -- the headline differentiator of this tool.

Profit/loss tells you whether you got lucky. These metrics tell you whether
your probability estimates were actually GOOD:

  * Brier score    -- mean squared error of your predicted probability vs the
                      outcome (0 = perfect, 0.25 = a coin flip, lower is better).
  * Log loss       -- penalizes confident wrong calls heavily.
  * Calibration    -- when you bet at "70%", do those bets win ~70% of the time?
                      Bucketed predicted-vs-actual, i.e. a reliability diagram.

Each settled bet contributes a (prediction, outcome) pair:
    prediction = entry price of the side you took (its implied probability)
    outcome    = 1 if that side won, else 0
Only bets settled by real market RESOLUTION are scored (manually closed
positions have a P&L but no ground-truth outcome).
"""

import math

EPS = 1e-15


def _pairs(settled_bets):
    pairs = []
    for b in settled_bets:
        if b.get("status") != "settled" or not b.get("result"):
            continue
        pred = b["avg_price"]  # implied prob the side wins, in [0,1]
        outcome = 1 if b["result"] == b["side"] else 0
        pairs.append((pred, outcome))
    return pairs


def brier_score(pairs):
    if not pairs:
        return None
    return sum((p - o) ** 2 for p, o in pairs) / len(pairs)


def log_loss(pairs):
    if not pairs:
        return None
    total = 0.0
    for p, o in pairs:
        p = min(1 - EPS, max(EPS, p))
        total += -(o * math.log(p) + (1 - o) * math.log(1 - p))
    return total / len(pairs)


def calibration(pairs, n_buckets=10):
    """Return per-bucket predicted-vs-actual for a reliability diagram."""
    buckets = []
    for i in range(n_buckets):
        lo, hi = i / n_buckets, (i + 1) / n_buckets
        sel = [(p, o) for p, o in pairs
               if (p >= lo and (p < hi or (i == n_buckets - 1 and p <= hi)))]
        if sel:
            buckets.append({
                "lo": round(lo, 3),
                "hi": round(hi, 3),
                "n": len(sel),
                "predicted": round(sum(p for p, _ in sel) / len(sel), 4),
                "actual": round(sum(o for _, o in sel) / len(sel), 4),
            })
        else:
            buckets.append({"lo": round(lo, 3), "hi": round(hi, 3),
                            "n": 0, "predicted": None, "actual": None})
    return buckets


def by_category(all_bets):
    """Per-category forecasting skill — surfaces where you're sharp vs. lucky."""
    cats = {}
    for b in all_bets:
        c = b.get("category") or "Other"
        cats.setdefault(c, []).append(b)
    out = []
    for c, bets in cats.items():
        pairs = _pairs(bets)
        resolved = [b for b in bets if b.get("status") == "settled" and b.get("result")]
        settled = [b for b in bets if b.get("status") in ("settled", "closed")]
        wins = sum(1 for b in resolved if b["result"] == b["side"])
        out.append({
            "category": c,
            "n": len(bets),
            "n_scored": len(pairs),
            "brier": brier_score(pairs),
            "win_rate": round(wins / len(resolved), 4) if resolved else None,
            "realized_pnl": round(sum((b.get("realized_pnl") or 0.0) for b in settled), 2),
        })
    out.sort(key=lambda x: (x["n_scored"], x["n"]), reverse=True)
    return out


def recent_results(all_bets, n=12):
    """Most-recent resolved outcomes (1 = won, 0 = lost) for a streak display."""
    resolved = [b for b in all_bets if b.get("status") == "settled" and b.get("result")]
    resolved.sort(key=lambda b: b.get("closed_at") or 0, reverse=True)
    return [1 if b["result"] == b["side"] else 0 for b in resolved[:n]]


def forecast_stats(all_bets):
    """Predict-then-bet: compare YOUR stated probability (user_prob) to the market
    price you paid, scored against the real outcome. This isolates forecasting
    skill from merely following the market."""
    your, mkt, beat = [], [], 0
    cal_pairs = []
    value, novalue = [], []   # (realized_pnl, cost_basis) split by whether you saw value
    for b in all_bets:
        q = b.get("user_prob")
        if q is None:
            continue
        p = b["avg_price"]                       # market-implied prob of the side you backed
        # value-bet ROI uses any settled/closed bet with a forecast
        if b.get("status") in ("settled", "closed"):
            bucket = value if q > p + 0.005 else novalue
            bucket.append((b.get("realized_pnl") or 0.0, b.get("cost_basis") or 0.0))
        # skill scoring needs a real resolution
        if b.get("status") != "settled" or not b.get("result"):
            continue
        o = 1 if b["result"] == b["side"] else 0
        your.append((q - o) ** 2)
        mkt.append((p - o) ** 2)
        if abs(q - o) < abs(p - o):
            beat += 1
        cal_pairs.append((q, o))

    def roi(rows):
        inv = sum(c for _, c in rows)
        return (round(sum(r for r, _ in rows) / inv, 4) if inv > 0 else None)

    n = len(your)
    return {
        "n": n,
        "your_brier": round(sum(your) / n, 4) if n else None,
        "market_brier": round(sum(mkt) / n, 4) if n else None,
        "beat_rate": round(beat / n, 4) if n else None,
        "calibration": calibration(cal_pairs),
        "value_roi": roi(value), "value_n": len(value),
        "novalue_roi": roi(novalue), "novalue_n": len(novalue),
    }


def summary(all_bets):
    """Aggregate P&L / ROI / win-rate plus the forecasting metrics."""
    settled = [b for b in all_bets if b.get("status") in ("settled", "closed")]
    resolved = [b for b in all_bets if b.get("status") == "settled"]
    pairs = _pairs(all_bets)

    realized = sum((b.get("realized_pnl") or 0.0) for b in settled)
    invested = sum(b["cost_basis"] for b in settled)
    wins = sum(1 for b in resolved if b["result"] == b["side"])

    return {
        "n_bets_total": len(all_bets),
        "n_open": sum(1 for b in all_bets if b["status"] == "open"),
        "n_settled": len(resolved),
        "n_closed": sum(1 for b in all_bets if b["status"] == "closed"),
        "realized_pnl": round(realized, 2),
        "invested": round(invested, 2),
        "roi": round(realized / invested, 4) if invested > 0 else None,
        "win_rate": round(wins / len(resolved), 4) if resolved else None,
        "brier": brier_score(pairs),
        "log_loss": log_loss(pairs),
        "n_scored": len(pairs),
        "calibration": calibration(pairs),
        "by_category": by_category(all_bets),
        "recent_results": recent_results(all_bets),
        "forecast": forecast_stats(all_bets),
    }
