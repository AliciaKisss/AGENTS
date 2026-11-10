#!/usr/bin/env python3
"""Daily gold & silver prices in AED.

Gets the live world prices (USD per troy ounce) for gold and silver from
gold-api.com (free, no account), converts them to AED with the fixed peg
(1 USD = 3.6725 AED), and shows:
  - 24K gold per gram
  - 18K gold per gram (75% gold, i.e. 0.75 x 24K)
  - silver per gram
plus the change since the last update and buy signals for gold and silver.

Display:
  - A swiftDialog pop-up (if installed) with buttons:
      "Got it" · "See chart" (opens dashboard.html) · "Open spreadsheet"
  - Falls back to a plain macOS alert if swiftDialog isn't installed.
Daily history is kept in history.csv; the weekly yearly CSV is refreshed too.

Note: these are international spot prices. Shop prices in Dubai are
usually very close but can differ slightly (plus making charges on jewelry).

  python3 gold.py          # normal run (pop-up)
  python3 gold.py --quiet  # print only, no pop-up
  python3 gold.py --check  # manual check: pop-up, but don't save to history
"""
import csv
import json
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
HISTORY = HERE / "history.csv"
API = "https://api.gold-api.com/price/"
USD_TO_AED = 3.6725          # fixed peg
GRAMS_PER_OZ = 31.1034768
K18 = 18 / 24                # 18K gold is 75% pure
DIALOG = Path("/usr/local/bin/dialog")
DISCLAIMER = ("Signals compare with past prices; they can't predict the future "
              "and aren't financial advice.")


def fetch_usd_per_oz(symbol):
    req = urllib.request.Request(API + symbol, headers={"User-Agent": "gold-price-checker"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return float(json.load(r)["price"])


def per_gram_aed(usd_oz):
    return usd_oz / GRAMS_PER_OZ * USD_TO_AED


def last_prices():
    """Return (gold24_gram, silver_gram) from the last history row, or Nones."""
    if not HISTORY.exists():
        return None, None
    rows = [r for r in csv.reader(HISTORY.open()) if r]
    if not rows:
        return None, None
    last = rows[-1]
    gold = float(last[1]) if len(last) > 1 else None
    silver = float(last[2]) if len(last) > 2 and last[2] else None
    return gold, silver


def pct_change(now, prev):
    return None if prev is None else (now - prev) / prev * 100


def fmt_change(pct):
    if pct is None:
        return "—"
    arrow = "▲" if pct > 0 else "▼" if pct < 0 else "■"
    return f"{arrow} {pct:+.2f}%"


def log_error(msg):
    with (HERE / "error.log").open("a") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M}] {msg}\n")


def current_csv():
    files = sorted(HERE.glob("gold_weekly_*.csv"))
    return files[-1] if files else None


def open_choice(choice, dash):
    if choice == "chart" and dash:
        subprocess.run(["open", str(dash)], check=False)
    elif choice == "sheet" and current_csv():
        subprocess.run(["open", str(current_csv())], check=False)


def show_swiftdialog(title, d, dash):
    def sig_md(name, s):
        if not s:
            return f"**{name}:** signal unavailable today"
        return f"**{name}:** {s['label']}  \n_" + " · ".join(
            l.lstrip("• ") for l in s["lines"][:2]) + "_"

    message = (
        f"### {datetime.now():%A, %d %B %Y}\n\n"
        f"| | AED / gram | Change |\n|:--|--:|--:|\n"
        f"| **24K gold** | **{d['g24']:,.2f}** | {fmt_change(d['chg_gold'])} |\n"
        f"| **18K gold** | **{d['g18']:,.2f}** | {fmt_change(d['chg_gold'])} |\n"
        f"| **Silver** | **{d['silver']:,.2f}** | {fmt_change(d['chg_silver'])} |\n\n"
        f"---\n\n"
        f"{sig_md('Gold', d['sig_gold'])}\n\n"
        f"{sig_md('Silver', d['sig_silver'])}\n\n"
        f"---\n\n"
        f"_World spot: gold ${d['gold_usd']:,.2f}/oz · silver ${d['silver_usd']:,.2f}/oz. "
        f"{DISCLAIMER}_"
    )
    r = subprocess.run([
        str(DIALOG),
        "--title", title,
        "--titlefont", "size=22,weight=bold",
        "--message", message,
        "--messagefont", "size=14",
        "--icon", "SF=dollarsign.circle.fill,color=#D4A017",
        "--iconsize", "90",
        "--button1text", "Got it",
        "--button2text", "See chart",
        "--infobuttontext", "Open spreadsheet",
        "--width", "640", "--height", "560",
        "--moveable", "--ontop",
        "--timer", "28800", "--hidetimerbar",
    ], check=False)
    return {2: "chart", 3: "sheet"}.get(r.returncode)


def show_plain_alert(title, d):
    lines = [
        f"Prices today ({datetime.now():%a %d %b %Y}), AED per gram\n",
        f"24K gold:  AED {d['g24']:,.2f}   {fmt_change(d['chg_gold'])}",
        f"18K gold:  AED {d['g18']:,.2f}   {fmt_change(d['chg_gold'])}",
        f"Silver:    AED {d['silver']:,.2f}   {fmt_change(d['chg_silver'])}",
    ]
    for name, s in (("Gold", d["sig_gold"]), ("Silver", d["sig_silver"])):
        lines.append(f"\n{name} buy signal:\n" + (s["text"] if s else "unavailable today"))
    lines.append(f"\n{DISCLAIMER}")
    script = (
        f"set r to display alert {json.dumps(title, ensure_ascii=False)} message "
        f"{json.dumps(chr(10).join(lines), ensure_ascii=False)} "
        'buttons {"Open spreadsheet", "See chart", "Got it"} default button "Got it" '
        "giving up after 28800\nreturn button returned of r"
    )
    out = subprocess.run(["osascript", "-e", script], capture_output=True, text=True).stdout.strip()
    return {"See chart": "chart", "Open spreadsheet": "sheet"}.get(out)


def main():
    try:
        gold_usd = fetch_usd_per_oz("XAU")
        silver_usd = fetch_usd_per_oz("XAG")
    except Exception as e:
        log_error(f"could not get price: {e}")
        return

    g24 = per_gram_aed(gold_usd)
    silver = per_gram_aed(silver_usd)
    prev_gold, prev_silver = last_prices()
    # Manual checks (--check) don't save, so "since last update" always
    # compares with the last scheduled 9 AM price.
    if "--check" not in sys.argv:
        with HISTORY.open("a", newline="") as f:
            csv.writer(f).writerow(
                [datetime.now().strftime("%Y-%m-%d %H:%M"), f"{g24:.2f}", f"{silver:.2f}"]
            )

    # Refresh the weekly CSV for this year (gold_weekly_<year>.csv)
    try:
        import weekly_csv
        weekly_csv.main()
    except Exception as e:
        log_error(f"weekly CSV update failed: {e}")

    # Buy signals (cheap vs expensive compared with recent history)
    sigs, drops = {}, []
    for metal in ("gold", "silver"):
        try:
            import signals
            sigs[metal] = signals.compute(metal)
            if sigs[metal]["big_drop"]:
                drops.append(f"{metal.capitalize()} {sigs[metal]['week_change']:.1f}%")
        except Exception as e:
            sigs[metal] = None
            log_error(f"{metal} signals failed: {e}")
    title = ("⚠️ Big drop this week: " + ", ".join(drops)) if drops else "Gold & Silver Today"

    d = {
        "g24": g24, "g18": g24 * K18, "silver": silver,
        "chg_gold": pct_change(g24, prev_gold),
        "chg_silver": pct_change(silver, prev_silver),
        "gold_usd": gold_usd, "silver_usd": silver_usd,
        "sig_gold": sigs["gold"], "sig_silver": sigs["silver"],
    }

    dash = None
    try:
        import dashboard
        dash = dashboard.build(d)
    except Exception as e:
        log_error(f"dashboard failed: {e}")

    print(f"24K {g24:.2f} | 18K {g24 * K18:.2f} | silver {silver:.2f} AED/g | dashboard: {dash}")
    if "--quiet" in sys.argv:
        return

    # Keep showing the pop-up after "See chart" / "Open spreadsheet" so you can
    # use both; it only closes for good on "Got it" (or after 8 hours).
    subprocess.run(["afplay", "/System/Library/Sounds/Glass.aiff"], check=False)
    for _ in range(20):  # safety limit
        choice = show_swiftdialog(title, d, dash) if DIALOG.exists() else show_plain_alert(title, d)
        if not choice:
            break
        open_choice(choice, dash)


if __name__ == "__main__":
    main()
