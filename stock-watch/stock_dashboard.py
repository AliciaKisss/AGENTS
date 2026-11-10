#!/usr/bin/env python3
"""Build dashboard.html for the ETF watch: one card per ETF with price,
changes, buy signal + reasons, a 1-year chart (with 50/200-day averages),
the 1-year range and news links. Self-contained (no internet needed to view
except for the news links themselves)."""
import html
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "dashboard.html"
BADGE = {"🟢": "good", "🟡": "neutral", "🔴": "bad"}
ICON = {"+": ("plus", "▲"), "-": ("minus", "▼"), "i": ("info", "•")}


def esc(s):
    return html.escape(str(s), quote=True)


def chip(name, v):
    if v is None:
        return f"<span class='chip'>{name} —</span>"
    cls = "up" if v > 0 else "down" if v < 0 else ""
    return f"<span class='chip {cls}'>{name} {v:+.2f}%</span>"


def chart(series, color, width=620, height=190):
    closes = [c for _, c in series]
    if len(closes) < 2:
        return ""

    def ma(n):
        return [sum(closes[i - n + 1:i + 1]) / n if i >= n - 1 else None for i in range(len(closes))]

    m50 = ma(50)
    lo, hi = min(closes), max(closes)
    pad = (hi - lo) * 0.1 or 1
    lo, hi = lo - pad, hi + pad
    left, right, top, bottom = 48, 8, 10, 24
    w, h = width - left - right, height - top - bottom

    def x(i):
        return left + w * i / (len(closes) - 1)

    def y(v):
        return top + h * (1 - (v - lo) / (hi - lo))

    line = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(closes))
    area = f"{left},{top + h} {line} {x(len(closes) - 1):.1f},{top + h}"
    l50 = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(m50) if v is not None)
    grid = ""
    for k in range(4):
        v = lo + (hi - lo) * k / 3
        grid += (f"<line x1='{left}' x2='{width - right}' y1='{y(v):.1f}' y2='{y(v):.1f}' class='grid'/>"
                 f"<text x='{left - 6}' y='{y(v) + 4:.1f}' class='axis' text-anchor='end'>{v:,.2f}</text>")
    labels = ""
    last_month = None
    for i, (d, _) in enumerate(series):
        if d.month != last_month and d.month % 2 == 1:
            labels += f"<text x='{x(i):.1f}' y='{height - 6}' class='axis' text-anchor='middle'>{d:%b}</text>"
        last_month = d.month
    gid = f"g{abs(hash(color)) % 10000}{len(closes)}"
    return f"""
<svg viewBox='0 0 {width} {height}' class='chart'>
  <defs><linearGradient id='{gid}' x1='0' x2='0' y1='0' y2='1'>
    <stop offset='0%' stop-color='{color}' stop-opacity='.28'/>
    <stop offset='100%' stop-color='{color}' stop-opacity='0'/></linearGradient></defs>
  {grid}
  <polygon points='{area}' fill='url(#{gid})'/>
  <polyline points='{l50}' fill='none' stroke='var(--muted)' stroke-width='1.4' stroke-dasharray='4 4'/>
  <polyline points='{line}' fill='none' stroke='{color}' stroke-width='2.2' stroke-linejoin='round'/>
  <circle cx='{x(len(closes) - 1):.1f}' cy='{y(closes[-1]):.1f}' r='4.5' fill='{color}' class='pulse'/>
  {labels}
</svg>"""


def card(ticker, d, aed):
    a = d["analysis"]
    if not a:
        return f"<div class='card'><h3>{ticker}</h3><p class='muted'>Price data unavailable today.</p></div>"
    color = {"🟢": "#1f9d55", "🟡": "#c98a0b", "🔴": "#d64545"}[a["emoji"]]
    pos = (a["price"] - a["low52"]) / ((a["high52"] - a["low52"]) or 1) * 100
    reasons = "".join(
        f"<li class='{ICON[k][0]}'><span>{ICON[k][1]}</span>{esc(t)}</li>" for k, t in a["reasons"])
    news = "".join(
        f"<li><a href='{esc(n['link'])}' target='_blank' rel='noopener'>{esc(n['title'])}</a>"
        f"<span class='muted'> · {esc(n['source'])}</span></li>" for n in d["news"]
    ) or "<li class='muted'>No recent headlines found.</li>"
    return f"""
<div class='card etf'>
  <div class='top'>
    <div><h3>{ticker}</h3><div class='muted small'>{esc(d['desc'])}</div></div>
    <div class='right'>
      <div class='value'>${a['price']:,.2f}</div>
      <div class='muted small'>≈ AED {a['price'] * aed:,.2f}</div>
    </div>
  </div>
  <div class='chips'>{chip('Today', a['chg1d'])}{chip('1 month', a['chg1m'])}{chip('This year', a['ytd'])}</div>
  <div class='badge {BADGE[a['emoji']]}'>{a['emoji']} {esc(a['label'])}</div>
  <div class='label'>Why</div>
  <ul class='reasons'>{reasons}</ul>
  <div class='label'>Last 12 months <span class='legend'>— price · <i>- - 50-day average</i></span></div>
  {chart(a['series'], color)}
  <div class='range'>
    <div class='bar'><div class='dot' style='left:{max(0, min(100, pos)):.0f}%'></div></div>
    <div class='ends'><span>low ${a['low52']:,.2f}</span><span>1-year range</span><span>high ${a['high52']:,.2f}</span></div>
  </div>
  <div class='label'>News</div>
  <ul class='news'>{news}</ul>
  <a class='more' href='https://finance.yahoo.com/quote/{esc(d['symbol'])}' target='_blank' rel='noopener'>More on Yahoo Finance →</a>
</div>"""


def build(data, aed, disclaimer):
    now = datetime.now()
    counts = {"🟢": 0, "🟡": 0, "🔴": 0}
    for d in data.values():
        if d["analysis"]:
            counts[d["analysis"]["emoji"]] += 1
    summary = " · ".join(f"{e} {n}" for e, n in counts.items() if n)
    cards = "".join(card(t, d, aed) for t, d in data.items())
    page = f"""<!doctype html>
<html lang='en'><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>ETF Watch</title>
<style>
:root {{ --bg:#f4f6f8; --card:#fff; --text:#16191d; --muted:#6c7682; --line:#e3e7ec;
        --up:#1f9d55; --down:#d64545; --warn:#b7791f; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --bg:#0f1215; --card:#191d22; --text:#eef1f4; --muted:#8f99a5; --line:#2b3138;
          --up:#3ecf7c; --down:#ff6b6b; --warn:#f0b429; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--text);
       font:15px/1.45 -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif; }}
.wrap {{ max-width:1180px; margin:0 auto; padding:28px 16px 40px; }}
header {{ display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px; margin-bottom:18px; }}
h1 {{ margin:0; font-size:26px; letter-spacing:-.02em; }}
h3 {{ margin:0; font-size:22px; letter-spacing:-.01em; }}
.muted {{ color:var(--muted); }} .small {{ font-size:13px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr)); gap:16px; }}
.card {{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; min-width:0; }}
.top {{ display:flex; justify-content:space-between; gap:12px; }}
.right {{ text-align:right; }}
.value {{ font-size:28px; font-weight:700; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }}
.chips {{ display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 4px; }}
.chip {{ font-size:12.5px; padding:3px 9px; border-radius:99px; border:1px solid var(--line); font-weight:600; }}
.chip.up {{ color:var(--up); }} .chip.down {{ color:var(--down); }}
.badge {{ display:inline-block; margin:10px 0 2px; padding:6px 12px; border-radius:999px; font-weight:600; font-size:14px; }}
.badge.good {{ background:color-mix(in srgb,var(--up) 15%,transparent); color:var(--up); }}
.badge.bad {{ background:color-mix(in srgb,var(--down) 15%,transparent); color:var(--down); }}
.badge.neutral {{ background:color-mix(in srgb,var(--warn) 18%,transparent); color:var(--warn); }}
.label {{ margin:16px 0 6px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }}
.legend {{ text-transform:none; letter-spacing:0; font-weight:500; }}
ul {{ margin:0; padding:0; list-style:none; }}
.reasons li {{ display:flex; gap:8px; margin:5px 0; font-size:14px; }}
.reasons li span {{ flex:none; width:16px; text-align:center; font-weight:700; }}
.reasons .plus span {{ color:var(--up); }} .reasons .minus span {{ color:var(--down); }} .reasons .info span {{ color:var(--muted); }}
.chart {{ width:100%; height:auto; display:block; }}
.chart .grid {{ stroke:var(--line); }} .chart .axis {{ fill:var(--muted); font-size:11px; }}
.pulse {{ animation:pulse 1.8s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }}
@keyframes pulse {{ 50% {{ transform:scale(1.6); opacity:.5; }} }}
.range {{ margin-top:10px; }}
.bar {{ position:relative; height:7px; border-radius:99px; background:linear-gradient(90deg,var(--up),#e0b93a,var(--down)); opacity:.85; }}
.dot {{ position:absolute; top:50%; width:15px; height:15px; border-radius:50%; background:var(--card); border:3px solid var(--text); transform:translate(-50%,-50%); }}
.ends {{ display:flex; justify-content:space-between; font-size:12px; color:var(--muted); margin-top:6px; }}
.news li {{ margin:6px 0; font-size:14px; }}
a {{ color:inherit; text-decoration-color:color-mix(in srgb,currentColor 35%,transparent); text-underline-offset:3px; }}
a:hover {{ color:var(--up); }}
.more {{ display:inline-block; margin-top:12px; font-size:13px; color:var(--muted); }}
footer {{ margin-top:24px; font-size:12.5px; color:var(--muted); }}
</style></head><body><div class='wrap'>
<header>
  <h1>📈 ETF Watch</h1>
  <div class='muted'>{now:%A, %d %B %Y · %H:%M} · {summary}</div>
</header>
<div class='grid'>{cards}</div>
<footer>
  Prices from Yahoo Finance (London Stock Exchange, USD; previous close when the market is shut) ·
  AED at 1 USD = {aed}. News from Google News, last 3 days.<br>
  How signals work: points for being well below the 1-year high, a low RSI (oversold) and trading
  under the 50-day average; points off for being near the high, a high RSI (overbought) or far above
  the 50-day average. 3+ points = 🟢, −2 or less = 🔴, otherwise 🟡.<br>{esc(disclaimer)}
</footer>
</div></body></html>"""
    OUT.write_text(page)
    return OUT
