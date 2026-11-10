#!/usr/bin/env python3
"""Simple "is it cheap or expensive right now?" signals for gold and silver.

Uses ~1 year of weekly closes from Yahoo Finance (COMEX gold GC=F, silver
SI=F) and compares the current price with recent history. This describes
where the price sits versus the past — it does NOT predict the future and is
not financial advice.

Silver moves roughly twice as much as gold, so its thresholds are wider
(otherwise it would flip between green and red all the time).

                         Gold     Silver
  🟢 Good time to consider buying (both must be true):
     below 12-week avg   >= 2%    >= 4%
     below 6-month high  >= 8%    >= 15%
  🔴 Expensive right now (either is true):
     above 12-week avg   >= 3%    >= 6%
     within x% of 6-mo high  2%   3%
  🟡 Neutral: everything else
  ⚠️ Big drop vs last week's close:
                         -3%      -6%

  python3 signals.py   # print today's signals for both
"""
import json
import urllib.request
from datetime import datetime, timedelta, timezone

USD_TO_AED = 3.6725
GRAMS_PER_OZ = 31.1034768
DUBAI = timezone(timedelta(hours=4))

RULES = {
    "gold":   {"symbol": "GC=F", "green_avg": -2.0, "green_high": 8.0,
               "red_avg": 3.0, "red_high": 2.0, "big_drop": -3.0},
    "silver": {"symbol": "SI=F", "green_avg": -4.0, "green_high": 15.0,
               "red_avg": 6.0, "red_high": 3.0, "big_drop": -6.0},
}


def to_aed_gram(usd_oz):
    return usd_oz / GRAMS_PER_OZ * USD_TO_AED


def fetch_weeks(symbol):
    """Return [(monday_date, close_usd)] for ~60 weeks, latest week last."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(weeks=60)
    start -= timedelta(days=start.weekday())  # align to a Monday so weeks are Mon-Sun
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={int(start.timestamp())}&period2={int(now.timestamp()) + 86400}&interval=1wk"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)["chart"]["result"][0]
    by_week = {}
    for ts, close in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if close is None:
            continue
        day = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(DUBAI).date()
        by_week[day - timedelta(days=day.weekday())] = float(close)
    return sorted(by_week.items())


def compute(metal="gold"):
    r = RULES[metal]
    weeks = fetch_weeks(r["symbol"])
    this_monday, now_usd = weeks[-1]
    past = [c for _, c in weeks[:-1]]  # completed weeks only
    now = to_aed_gram(now_usd)

    avg12 = to_aed_gram(sum(past[-12:]) / len(past[-12:]))
    high26 = to_aed_gram(max(past[-25:] + [now_usd]))
    year = [c for m, c in weeks if (m + timedelta(days=6)).year == this_monday.year]
    year_low, year_high = to_aed_gram(min(year)), to_aed_gram(max(year))
    last_week = to_aed_gram(past[-1])

    vs_avg = (now - avg12) / avg12 * 100
    below_high = (high26 - now) / high26 * 100
    week_chg = (now - last_week) / last_week * 100
    span = year_high - year_low
    year_pos = (now - year_low) / span * 100 if span else 50

    if vs_avg <= r["green_avg"] and below_high >= r["green_high"]:
        label = "🟢 Good time to consider buying"
    elif vs_avg >= r["red_avg"] or below_high <= r["red_high"]:
        label = "🔴 Expensive right now — waiting may be better"
    else:
        label = "🟡 Neutral — around the usual price"

    where = "near the bottom" if year_pos < 25 else "near the top" if year_pos > 75 else "in the middle"

    lines = [
        label,
        f"• {abs(vs_avg):.1f}% {'below' if vs_avg < 0 else 'above'} the 12-week average (AED {avg12:,.2f}/g)",
        f"• {below_high:.1f}% below the 6-month high (AED {high26:,.2f}/g)",
        f"• {where.capitalize()} of {this_monday.year}'s range "
        f"(low AED {year_low:,.2f}, high AED {year_high:,.2f})",
        f"• {week_chg:+.1f}% vs last week's close",
    ]
    return {
        "label": label,
        "color": label[0],  # 🟢 / 🟡 / 🔴
        "big_drop": week_chg <= r["big_drop"],
        "week_change": week_chg,
        "vs_avg": vs_avg,
        "avg12": avg12,
        "below_high": below_high,
        "high26": high26,
        "year_low": year_low,
        "year_high": year_high,
        "year_pos": year_pos,
        "lines": lines[1:],
        "text": "\n".join(lines),
    }


if __name__ == "__main__":
    for metal in RULES:
        print(f"{metal.capitalize()}:\n{compute(metal)['text']}\n")
