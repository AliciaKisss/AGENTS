# AGENTS

Small background helpers for macOS. They use built-in Python only (no
packages to install), run on a schedule with macOS `launchd`, and take less
than a second of work each time.

| Agent | When | What it does |
|---|---|---|
| `gold-price/` | Every day, 9:00 AM | Pop-up with 24K / 18K gold and silver prices in AED per gram, buy signals (🟢🟡🔴), a chart page, and a weekly CSV for the year |
| `stock-watch/` | Every day, 9:05 AM | Pop-up and dashboard for the ETFs FWRA, IGLN, VUAA and VWRA: price, daily / 1-month / year changes, buy signal with reasons, 1-year chart and news links |
| `report-reminder/` | Mondays 12:01 AM, 1st of each month 12:01 AM | Pop-up reminding you to make the weekly / monthly report, with a 1-hour snooze |
| `screenshot-cleaner/` | Every hour | Moves screenshots older than 3 days from `~/Screenshots` to the Trash |

**On iPad:** `ipad/` has Home Screen widgets for gold & silver and the ETFs
(same prices and signals), using the free Scriptable app. See
[ipad/README.md](ipad/README.md) for setup.

## Set up on a Mac

```bash
git clone https://github.com/AliciaKisss/AGENTS.git ~/AGENTS
cd ~/AGENTS
./install.sh
```

`install.sh`:

- creates the schedules in `~/Library/LaunchAgents` with the right paths for this Mac,
- makes screenshots save to `~/Screenshots`,
- offers to install [swiftDialog](https://swiftdialog.app) for the nicer pop-ups (needs your Mac password once).

- creates two apps in `~/Applications`, **Gold Watch** and **ETF Watch**, to check
  prices any time (open them with Spotlight ⌘Space, or drag them to the Dock).

Run it again any time after pulling changes. To stop everything:

```bash
./install.sh --uninstall
```

## Handy commands

```bash
python3 gold-price/gold.py              # show today's gold & silver pop-up now
python3 gold-price/signals.py           # print buy signals
open gold-price/gold_weekly_*.csv       # weekly prices for the year
python3 stock-watch/stocks.py           # show today's ETF pop-up now
open stock-watch/dashboard.html         # ETF dashboard
python3 report-reminder/remind.py --test     # preview the report reminder
python3 screenshot-cleaner/clean.py --dry-run  # see what would be trashed
```

## Notes

- Gold and silver prices are world spot prices (gold-api.com, Yahoo Finance)
  converted at 1 USD = 3.6725 AED. Dubai shop prices can differ slightly.
- Buy signals only compare today's price with past prices. They can't predict
  the future and aren't financial advice.
- Personal data (price history, logs, reminder state) is kept out of git via
  `.gitignore` and is recreated automatically.
