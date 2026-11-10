# iPad widgets

Two Home Screen widgets for iPad that show the same prices and buy signals
as the Mac helpers. They run in the free **Scriptable** app.

| Script | Widget shows | Tap it for |
|---|---|---|
| `Gold Watch.js` | 24K gold, 18K gold and silver in AED per gram, today's change, 🟢🟡🔴 buy signals | Full view: signal reasons and 1-year charts |
| `ETF Watch.js` | FWRA, IGLN, VUAA, VWRA: price, today's change, buy signal | Full view: reasons, 1-year charts with the 50-day average, 1-year range, news links |

Every widget size works: small, medium, large and extra large. The bigger
sizes show more detail. Each widget also sends **one notification a day
after 9 AM** with the prices. iPadOS decides exactly when widgets refresh,
so this usually arrives between 9 and 10 AM.

## Set up (about 5 minutes)

1. Install **Scriptable** from the App Store (free).
2. Add the installer:
   1. Copy the contents of [`Install.js`](Install.js).
   2. In Scriptable, tap **+**, paste, rename it **Install AGENTS** and tap
      **Done**.
   3. Tap **Install AGENTS** to run it. It downloads **Gold Watch** and
      **ETF Watch** into Scriptable and shows ✅ for each.
3. Run each script once from Scriptable by tapping it. You'll see the full
   view. If it asks, allow notifications.
4. Add the widgets:
   1. Touch and hold an empty part of the Home Screen, then tap **Edit** →
      **Add Widget**.
   2. Search for **Scriptable**, choose a size and tap **Add Widget**.
   3. Touch and hold the new widget → **Edit Widget**. Set **Script** to
      *Gold Watch* and **When Interacting** to *Run Script*.
   4. Repeat for *ETF Watch*.

To update after changes in this repo, run **Install AGENTS** again. This
replaces the two scripts, so any changes you made to their settings are reset.

## Settings

At the top of each script:

- `DAILY_NOTIFICATION = false` turns off the daily notification.
- `NOTIFY_HOUR = 9` changes the hour after which the notification is sent.

## Notes

- Prices and signals match `gold-price/` and `stock-watch/` on the Mac:
  - gold and silver use gold-api.com spot prices, with signals worked out
    from Yahoo Finance COMEX prices;
  - the ETFs use Yahoo Finance London prices and the same RSI, 1-year high
    and 50/200-day average rules.
- With no internet connection, the widget shows the last saved prices and
  marks them *offline*.
- Signals only compare today's price with past prices. They can't predict the
  future and aren't financial advice.
