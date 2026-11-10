#!/usr/bin/env python3
"""Daily ETF watch: FWRA, IGLN, VUAA, VWRA (London Stock Exchange, USD).

Every morning:
  - gets ~1 year of daily prices from Yahoo Finance,
  - works out a buy signal for each ETF with the reasons behind it,
  - fetches recent news headlines (Google News) for what each ETF tracks,
  - builds dashboard.html and shows a pop-up (swiftDialog if installed,
    otherwise a plain macOS alert) with "Got it" / "See dashboard".

Signals only describe where today's price sits versus its own recent
history. They can't predict the future and aren't financial advice. For
long-term index funds, regular investing usually matters more than timing.

  python3 stocks.py           # normal run (pop-up)
  python3 stocks.py --quiet   # build dashboard + print, no pop-up
"""
import json
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
DIALOG = Path("/usr/local/bin/dialog")
USD_TO_AED = 3.6725

# ticker -> (Yahoo symbol, short description, news search)
ETFS = {
    "VWRA": ("VWRA.L", "Vanguard FTSE All-World · global stocks", "global stock markets"),
    "FWRA": ("FWRA.L", "Invesco FTSE All-World · global stocks", "global equities"),
    "VUAA": ("VUAA.L", "Vanguard S&P 500 · US stocks", "S&P 500"),
    "IGLN": ("IGLN.L", "iShares Physical Gold · gold", "gold price"),
}

DISCLAIMER = ("Signals compare today's price with its own past prices — they can't "
              "predict the future and aren't financial advice.")


def log_error(msg):
    with (HERE / "error.log").open("a") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M}] {msg}\n")


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ---------------------------------------------------------------- data ----

def fetch_prices(symbol):
    res = json.loads(get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=2y&interval=1d"
    ))["chart"]["result"][0]
    pts = [(datetime.fromtimestamp(t, tz=timezone.utc).date(), c)
           for t, c in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]) if c]
    meta = res["meta"]
    price = meta.get("regularMarketPrice")
    if price:
        # Use the latest price for its trading day: replace that day's bar if
        # Yahoo already has one, otherwise add it as a new day.
        day = datetime.fromtimestamp(meta.get("regularMarketTime", 0), tz=timezone.utc).date()
        if pts and pts[-1][0] == day:
            pts[-1] = (day, price)
        elif pts and day > pts[-1][0]:
            pts.append((day, price))
    return pts, meta.get("currency", "USD")


def fetch_news(query, n=3):
    url = ("https://news.google.com/rss/search?q="
           + urllib.parse.quote(f"{query} when:3d") + "&hl=en-US&gl=US&ceid=US:en")
    items = ET.fromstring(get(url)).findall(".//item")
    out = []
    for it in items[:n]:
        title = it.findtext("title") or ""
        source = it.findtext("source") or ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        out.append({"title": title, "source": source, "link": it.findtext("link")})
    return out


# ------------------------------------------------------------- signals ----

def sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def rsi(vals, n=14):
    """Standard 14-day RSI (Wilder's smoothing)."""
    if len(vals) <= n:
        return None
    diffs = [b - a for a, b in zip(vals[:-1], vals[1:])]
    ag = sum(max(d, 0) for d in diffs[:n]) / n
    al = sum(max(-d, 0) for d in diffs[:n]) / n
    for d in diffs[n:]:
        ag = (ag * (n - 1) + max(d, 0)) / n
        al = (al * (n - 1) + max(-d, 0)) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def analyse(pts):
    """Return metrics, label and plain-language reasons for one ETF."""
    closes = [c for _, c in pts]
    last_year = pts[-252:]
    year_closes = [c for _, c in last_year]
    price = closes[-1]
    prev = closes[-2]
    ma50, ma200 = sma(closes, 50), sma(closes, 200)
    high52, low52 = max(year_closes), min(year_closes)
    dd = (high52 - price) / high52 * 100
    r = rsi(closes)
    this_year = pts[-1][0].year
    prior = [c for d, c in pts if d.year < this_year]
    ytd = (price / prior[-1] - 1) * 100 if prior else None
    m1 = (price / closes[-22] - 1) * 100 if len(closes) > 22 else None

    score, reasons = 0, []  # reasons: (kind, text) kind = "+", "-", "i"

    if dd >= 10:
        score += 2
        reasons.append(("+", f"{dd:.1f}% below its 1-year high — a correction. For long-term "
                             "investors, buying after a 10%+ fall has historically worked out well."))
    elif dd >= 5:
        score += 1
        reasons.append(("+", f"{dd:.1f}% below its 1-year high — a pullback, so you're not buying at the top."))
    elif dd < 2:
        score -= 1
        reasons.append(("-", f"Only {dd:.1f}% below its 1-year high — buying near the top."))
    else:
        reasons.append(("i", f"{dd:.1f}% below its 1-year high — a small dip."))

    if r is not None:
        if r < 30:
            score += 2
            reasons.append(("+", f"RSI is {r:.0f} (under 30 = oversold): it has fallen fast and often bounces."))
        elif r < 40:
            score += 1
            reasons.append(("+", f"RSI is {r:.0f}: recent selling pressure, closer to oversold."))
        elif r > 70:
            score -= 2
            reasons.append(("-", f"RSI is {r:.0f} (over 70 = overbought): it has risen fast and often cools off."))
        elif r > 60:
            reasons.append(("i", f"RSI is {r:.0f}: strong recent momentum, not yet overbought."))
        else:
            reasons.append(("i", f"RSI is {r:.0f}: neither oversold nor overbought."))

    if ma50:
        gap50 = (price / ma50 - 1) * 100
        if gap50 < 0:
            score += 1
            reasons.append(("+", f"{abs(gap50):.1f}% below its 50-day average — a short-term dip."))
        elif gap50 > 5:
            score -= 1
            reasons.append(("-", f"{gap50:.1f}% above its 50-day average — stretched in the short term."))
        else:
            reasons.append(("i", f"{gap50:.1f}% above its 50-day average — normal range."))

    if ma200:
        gap200 = (price / ma200 - 1) * 100
        if gap200 >= 0:
            reasons.append(("i", f"{gap200:.1f}% above its 200-day average — the long-term uptrend is intact."))
        else:
            reasons.append(("i", f"{abs(gap200):.1f}% below its 200-day average — in a longer downtrend; "
                                 "dips can go further, so consider buying in smaller steps."))

    if score >= 3:
        label = ("🟢", "Good time to add")
    elif score <= -2:
        label = ("🔴", "Stretched — consider waiting")
    else:
        label = ("🟡", "Neutral — stick to your regular plan")

    return {
        "price": price, "chg1d": (price / prev - 1) * 100, "chg1m": m1, "ytd": ytd,
        "high52": high52, "low52": low52, "dd": dd, "rsi": r, "ma50": ma50, "ma200": ma200,
        "score": score, "emoji": label[0], "label": label[1], "reasons": reasons,
        "series": last_year,
    }


# --------------------------------------------------------------- popup ----

def pct(v):
    if v is None:
        return "—"
    return f"{'▲' if v > 0 else '▼' if v < 0 else '■'} {v:+.2f}%"


def show_swiftdialog(rows):
    table = "| ETF | USD | AED | Today | Signal |\n|:--|--:|--:|--:|:--|\n"
    for t, a in rows:
        if a:
            table += (f"| **{t}** | {a['price']:,.2f} | {a['price'] * USD_TO_AED:,.2f} | "
                      f"{pct(a['chg1d'])} | {a['emoji']} {a['label']} |\n")
        else:
            table += f"| **{t}** | — | — | — | data unavailable |\n"
    tops = []
    for t, a in rows:
        if a:
            why = next((txt for k, txt in a["reasons"] if k in "+-"), a["reasons"][0][1])
            tops.append(f"**{t}:** {why}")
    message = (f"### {datetime.now():%A, %d %B %Y}\n\n{table}\n"
               + "\n\n".join(tops)
               + f"\n\n_Full reasons, charts and news in the dashboard. {DISCLAIMER}_")
    r = subprocess.run([
        str(DIALOG), "--title", "Your ETFs Today",
        "--titlefont", "size=22,weight=bold",
        "--message", message, "--messagefont", "size=13",
        "--icon", "SF=chart.line.uptrend.xyaxis.circle.fill,color=#1F9D55",
        "--iconsize", "90",
        "--button1text", "Got it", "--button2text", "See dashboard",
        "--width", "760", "--height", "620",
        "--moveable", "--ontop", "--timer", "28800", "--hidetimerbar",
    ], check=False)
    return "dash" if r.returncode == 2 else None


def show_plain_alert(rows):
    lines = [f"{datetime.now():%a %d %b %Y}\n"]
    for t, a in rows:
        lines.append(f"{t}: ${a['price']:,.2f} (AED {a['price'] * USD_TO_AED:,.2f})  "
                     f"{pct(a['chg1d'])}  {a['emoji']} {a['label']}"
                     if a else f"{t}: data unavailable")
    lines.append(f"\n{DISCLAIMER}")
    script = (
        f"set r to display alert \"Your ETFs Today\" message "
        f"{json.dumps(chr(10).join(lines), ensure_ascii=False)} "
        'buttons {"See dashboard", "Got it"} default button "Got it" giving up after 28800\n'
        "return button returned of r"
    )
    out = subprocess.run(["osascript", "-e", script], capture_output=True, text=True).stdout.strip()
    return "dash" if out == "See dashboard" else None


# ---------------------------------------------------------------- main ----

def main():
    data = {}
    for t, (sym, desc, query) in ETFS.items():
        entry = {"symbol": sym, "desc": desc, "analysis": None, "news": [], "currency": "USD"}
        try:
            pts, cur = fetch_prices(sym)
            entry["analysis"], entry["currency"] = analyse(pts), cur
        except Exception as e:
            log_error(f"{t} prices failed: {e}")
        try:
            entry["news"] = fetch_news(query)
        except Exception as e:
            log_error(f"{t} news failed: {e}")
        data[t] = entry

    dash = None
    try:
        import stock_dashboard
        dash = stock_dashboard.build(data, USD_TO_AED, DISCLAIMER)
    except Exception as e:
        log_error(f"dashboard failed: {e}")

    rows = [(t, d["analysis"]) for t, d in data.items()]
    for t, a in rows:
        print(f"{t}: " + (f"{a['price']:.2f} {pct(a['chg1d'])} {a['emoji']} {a['label']} (score {a['score']})"
                          if a else "unavailable"))
    print(f"dashboard: {dash}")
    if "--quiet" in sys.argv:
        return

    subprocess.run(["afplay", "/System/Library/Sounds/Glass.aiff"], check=False)
    for _ in range(20):  # pop-up returns after "See dashboard"; closes on "Got it"
        choice = show_swiftdialog(rows) if DIALOG.exists() else show_plain_alert(rows)
        if choice != "dash":
            break
        if dash:
            subprocess.run(["open", str(dash)], check=False)


if __name__ == "__main__":
    main()
