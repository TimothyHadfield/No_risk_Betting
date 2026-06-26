"""
Order-book fill simulation + Kalshi fee model.

This is the "honesty" layer that separates this tool from naive simulators:
a bet is filled by WALKING the real live order book (consuming successive
price levels), not assumed to fill instantly at the best price with infinite
liquidity. For small bets on liquid markets this matches reality closely;
for large bets or thin books you correctly pay worse average prices, and if
the book runs out you get a PARTIAL fill.

All prices are dollars in [0, 1]. Contracts pay $1 if the side wins, else $0.
"""

import math

# Kalshi general trading fee: ceil(0.07 * C * P * (1 - P)) per fill, in dollars.
FEE_RATE = 0.07


def kalshi_fee(contracts, price):
    if contracts <= 0 or price <= 0 or price >= 1:
        return 0.0
    raw = FEE_RATE * contracts * price * (1.0 - price)
    return math.ceil(raw * 100.0) / 100.0  # round up to the next cent


def walk_book(asks, contracts):
    """
    Consume an ascending-price ask ladder [(price, size), ...] to buy up to
    `contracts` contracts. Returns (filled, cost, avg_price, levels_used).
    """
    remaining = float(contracts)
    cost = 0.0
    filled = 0.0
    levels = 0
    for price, size in asks:
        if remaining <= 1e-9:
            break
        take = min(remaining, float(size))
        if take <= 0:
            continue
        cost += take * price
        filled += take
        remaining -= take
        levels += 1
    avg = (cost / filled) if filled > 0 else 0.0
    return filled, cost, avg, levels


def quote(side, contracts, orderbook, market):
    """
    Price a prospective bet. `orderbook` is from kalshi.fetch_orderbook;
    `market` is a normalized market dict (for the top-of-book fallback).

    Returns a dict describing the fill, including fees and a clear flag when
    the book lacked depth (partial) or was empty (estimated_fill via
    top-of-book ask).
    """
    side = side.lower()
    asks = orderbook["yes_asks"] if side == "yes" else orderbook["no_asks"]
    filled, cost, avg, levels = walk_book(asks, contracts)

    estimated = False
    partial = False

    if filled <= 0:
        # No live book depth -> fall back to the market's top-of-book ask.
        top = market["yes_ask"] if side == "yes" else market["no_ask"]
        if top and top > 0:
            filled = float(contracts)
            avg = top
            cost = filled * top
            estimated = True
        else:
            return {"ok": False, "reason": "No liquidity available for this side."}
    elif filled + 1e-9 < float(contracts):
        partial = True

    fee = kalshi_fee(filled, avg)
    stake = round(cost, 6)
    return {
        "ok": True,
        "side": side,
        "contracts": round(filled, 6),
        "requested": float(contracts),
        "avg_price": round(avg, 6),
        "stake": stake,
        "fee": fee,
        "cost_basis": round(stake + fee, 6),
        "max_payout": round(filled * 1.0, 6),
        "max_profit": round(filled * 1.0 - (stake + fee), 6),
        "partial": partial,
        "estimated_fill": estimated,
        "levels_used": levels,
    }


def position_value(side, contracts, market):
    """
    Mark-to-market: what you could SELL the position for right now, by hitting
    the live bid for the side you hold. (Exit fees are not modeled here, to keep
    unrealized P&L simple; they apply on an actual close.)
    """
    bid = market["yes_bid"] if side == "yes" else market["no_bid"]
    return round(contracts * (bid or 0.0), 6)
