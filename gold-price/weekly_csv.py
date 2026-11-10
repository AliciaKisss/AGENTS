#!/usr/bin/env python3
"""Build/refresh gold_weekly_<year>.csv: one row per week of the current year.

Columns: 24K gold, 18K gold and silver in AED per gram, plus the world
prices in USD per ounce and week-on-week changes.

Source: Yahoo Finance weekly data for COMEX gold (GC=F) and silver (SI=F),
USD per troy ounce. These track the world spot prices very closely. Each row
is the week's closing price (usually Friday); the current week's row shows
the latest price so far and is updated every day until the week ends.

Run by gold.py every day, or by hand:  python3 weekly_csv.py
"""
import csv
import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
YEAR = datetime.now().year  # new file each year: gold_weekly_2027.csv, ...
OUT = HERE / f"gold_weekly_{YEAR}.csv"
USD_TO_AED = 3.6725
GRAMS_PER_OZ = 31.1034768
K18 = 18 / 24
DUBAI = timezone(timedelta(hours=4))


def fetch_weekly(symbol):
    """Return {monday_date: close_usd} for the year (weeks aligned Mon-Sun)."""
    # Start on a Monday before Jan 1 so Yahoo's weekly bars run Monday-Sunday.
    start = int(datetime(YEAR - 1, 12, 22, tzinfo=timezone.utc).timestamp())
    end = int(datetime(YEAR + 1, 1, 1, tzinfo=timezone.utc).timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={start}&period2={end}&interval=1wk"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)["chart"]["result"][0]
    by_week = {}
    for ts, close in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if close is None:
            continue
        day = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(DUBAI).date()
        monday = day - timedelta(days=day.weekday())
        if (monday + timedelta(days=6)).year < YEAR:  # keep week 1 even if it starts in Dec
            continue
        by_week[monday] = float(close)  # later bars in the same week win
    return by_week


def per_gram(usd_oz):
    return usd_oz / GRAMS_PER_OZ * USD_TO_AED


def pct(now, prev):
    return "" if prev is None else f"{(now - prev) / prev * 100:+.2f}%"


def main():
    gold = fetch_weekly("GC=F")
    silver = fetch_weekly("SI=F")
    today = datetime.now(DUBAI).date()
    prev_g24 = prev_silver = None
    with OUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "Week", "Week start (Mon)", "Week end (Sun)", "Status",
            "24K gold AED/gram", "18K gold AED/gram", "Silver AED/gram",
            "24K change AED/gram", "Gold change %", "Silver change %",
            "Gold USD/oz", "Silver USD/oz",
        ])
        for monday in sorted(gold):
            g24 = per_gram(gold[monday])
            s_usd = silver.get(monday)
            s = per_gram(s_usd) if s_usd is not None else None
            sunday = monday + timedelta(days=6)
            w.writerow([
                f"W{monday.isocalendar()[1]:02d}", monday.isoformat(), sunday.isoformat(),
                "In progress (latest price)" if sunday >= today else "Week close",
                f"{g24:.2f}", f"{g24 * K18:.2f}", "" if s is None else f"{s:.2f}",
                "" if prev_g24 is None else f"{g24 - prev_g24:+.2f}",
                pct(g24, prev_g24),
                "" if s is None else pct(s, prev_silver),
                f"{gold[monday]:.2f}", "" if s_usd is None else f"{s_usd:.2f}",
            ])
            prev_g24 = g24
            if s is not None:
                prev_silver = s
    print(f"wrote {len(gold)} weeks to {OUT}")


if __name__ == "__main__":
    main()
