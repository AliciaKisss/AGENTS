#!/usr/bin/env python3
"""Build dashboard.html: a styled card with today's prices, buy signals and
2026 charts for gold and silver (from the weekly CSV).

Self-contained: no internet or external libraries needed to view it.
Opened from the pop-up's "See chart" button, or by hand:
  open dashboard.html
"""
import csv
import html
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "dashboard.html"

BADGE = {"🟢": ("good", "Good time to consider buying"),
         "🟡": ("neutral", "Neutral — around the usual price"),
         "🔴": ("bad", "Expensive right now")}


def read_weekly():
    files = sorted(HERE.glob("gold_weekly_*.csv"))
    if not files:
        return []
    with files[-1].open() as f:
        return list(csv.DictReader(f))


def chart(rows, key, color, unit_fmt, height=170, width=640):
    pts = [(r["Week"], float(r[key])) for r in rows if r.get(key)]
    if len(pts) < 2:
        return "<p class='muted'>Not enough data yet.</p>"
    vals = [v for _, v in pts]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.12 or 1
    lo_p, hi_p = lo - pad, hi + pad
    left, right, top, bottom = 52, 10, 12, 26
    w, h = width - left - right, height - top - bottom

    def xy(i, v):
        x = left + w * i / (len(pts) - 1)
        y = top + h * (1 - (v - lo_p) / (hi_p - lo_p))
        return x, y

    coords = [xy(i, v) for i, (_, v) in enumerate(pts)]
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)
    area = f"{left},{top + h} " + line + f" {coords[-1][0]:.1f},{top + h}"
    grid = ""
    for k in range(4):
        v = lo_p + (hi_p - lo_p) * k / 3
        _, y = xy(0, v)
        grid += (f"<line x1='{left}' x2='{width - right}' y1='{y:.1f}' y2='{y:.1f}' class='grid'/>"
                 f"<text x='{left - 6}' y='{y + 4:.1f}' class='axis' text-anchor='end'>{unit_fmt(v)}</text>")
    labels = ""
    for i in range(0, len(pts), max(1, len(pts) // 6)):
        x, _ = coords[i]
        labels += f"<text x='{x:.1f}' y='{height - 6}' class='axis' text-anchor='middle'>{pts[i][0]}</text>"
    i_hi, i_lo = vals.index(hi), vals.index(lo)
    marks = ""
    for i, tag in ((i_hi, "high"), (i_lo, "low")):
        x, y = coords[i]
        marks += (f"<circle cx='{x:.1f}' cy='{y:.1f}' r='3.5' fill='{color}'/>"
                  f"<text x='{x:.1f}' y='{y + (-9 if tag == 'high' else 16):.1f}' class='axis' "
                  f"text-anchor='middle'>{tag} {unit_fmt(vals[i])}</text>")
    lx, ly = coords[-1]
    gid = key.split()[0].replace("K", "k")
    return f"""
<svg viewBox='0 0 {width} {height}' class='chart' role='img'>
  <defs><linearGradient id='g{gid}' x1='0' x2='0' y1='0' y2='1'>
    <stop offset='0%' stop-color='{color}' stop-opacity='.35'/>
    <stop offset='100%' stop-color='{color}' stop-opacity='0'/></linearGradient></defs>
  {grid}
  <polygon points='{area}' fill='url(#g{gid})'/>
  <polyline points='{line}' fill='none' stroke='{color}' stroke-width='2.4' stroke-linejoin='round'/>
  {marks}
  <circle cx='{lx:.1f}' cy='{ly:.1f}' r='5' fill='{color}' class='pulse'/>
  {labels}
</svg>"""


def price_card(name, value, change, accent):
    if change is None:
        chg = "<span class='muted'>—</span>"
    else:
        cls = "up" if change > 0 else "down" if change < 0 else "flat"
        arrow = "▲" if change > 0 else "▼" if change < 0 else "■"
        chg = f"<span class='{cls}'>{arrow} {change:+.2f}%</span>"
    return f"""
<div class='card price' style='--accent:{accent}'>
  <div class='label'>{name}</div>
  <div class='value'><small>AED</small> {value:,.2f}</div>
  <div class='sub'>per gram · {chg} <span class='muted'>since last update</span></div>
</div>"""


def signal_card(metal, sig, accent):
    if not sig:
        return f"<div class='card'><div class='label'>{metal}</div><p class='muted'>Signal unavailable today.</p></div>"
    cls, text = BADGE.get(sig["color"], ("neutral", sig["label"]))
    pos = max(0, min(100, sig["year_pos"]))
    items = "".join(f"<li>{html.escape(l.lstrip('• '))}</li>" for l in sig["lines"])
    drop = (f"<div class='drop'>⚠️ Big drop this week: {sig['week_change']:.1f}%</div>"
            if sig["big_drop"] else "")
    return f"""
<div class='card signal'>
  <div class='label'>{metal} buy signal</div>
  <div class='badge {cls}'>{sig['color']} {text}</div>
  {drop}
  <div class='range'>
    <div class='bar' style='--accent:{accent}'><div class='dot' style='left:{pos:.0f}%'></div></div>
    <div class='ends'><span>{sig['year_low']:,.2f}</span><span>{datetime.now().year} range</span><span>{sig['year_high']:,.2f}</span></div>
  </div>
  <ul>{items}</ul>
</div>"""


def build(d):
    """d: dict with g24, g18, silver, chg_gold, chg_silver, gold_usd, silver_usd,
    sig_gold, sig_silver (signal dicts or None)."""
    rows = read_weekly()
    now = datetime.now()
    page = f"""<!doctype html>
<html lang='en'><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>Gold &amp; Silver Today</title>
<style>
:root {{ --bg:#f6f4ee; --card:#ffffff; --text:#1d1b16; --muted:#857f72; --line:#e8e3d6;
        --gold:#c9971c; --silver:#7d8a99; --up:#1f9d55; --down:#d64545; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --bg:#14130f; --card:#1f1d18; --text:#f3efe4; --muted:#9a937f; --line:#34302a;
          --gold:#e8b931; --silver:#aab6c4; --up:#3ecf7c; --down:#ff6b6b; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--text);
       font:15px/1.45 -apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif; }}
.wrap {{ max-width:980px; margin:0 auto; padding:28px 16px 40px; }}
header {{ display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:18px; }}
h1 {{ margin:0; font-size:26px; letter-spacing:-.02em; }}
h1 span {{ background:linear-gradient(90deg,var(--gold),#f3d36b,var(--silver));
          -webkit-background-clip:text; background-clip:text; color:transparent; }}
h2 {{ font-size:15px; margin:26px 0 10px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.06em; }}
.muted {{ color:var(--muted); }}
.grid3 {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }}
.grid2 {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }}
.card {{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; }}
.price {{ border-top:4px solid var(--accent); }}
.label {{ font-size:13px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.05em; }}
.value {{ font-size:32px; font-weight:700; letter-spacing:-.02em; margin:6px 0 2px; font-variant-numeric:tabular-nums; }}
.value small {{ font-size:15px; color:var(--muted); font-weight:600; }}
.sub {{ font-size:13px; }}
.up {{ color:var(--up); font-weight:600; }} .down {{ color:var(--down); font-weight:600; }}
.badge {{ display:inline-block; margin:10px 0 4px; padding:6px 12px; border-radius:999px; font-weight:600; font-size:14px; }}
.badge.good {{ background:color-mix(in srgb,var(--up) 16%,transparent); color:var(--up); }}
.badge.bad {{ background:color-mix(in srgb,var(--down) 16%,transparent); color:var(--down); }}
.badge.neutral {{ background:color-mix(in srgb,#d4a017 18%,transparent); color:#b8860b; }}
.drop {{ margin-top:8px; font-weight:600; color:var(--down); }}
.range {{ margin:14px 0 6px; }}
.bar {{ position:relative; height:8px; border-radius:99px;
       background:linear-gradient(90deg,var(--up),#e0b93a,var(--down)); opacity:.85; }}
.dot {{ position:absolute; top:50%; width:16px; height:16px; border-radius:50%; background:var(--card);
       border:3px solid var(--text); transform:translate(-50%,-50%); }}
.ends {{ display:flex; justify-content:space-between; font-size:12px; color:var(--muted); margin-top:6px; }}
ul {{ margin:10px 0 0; padding-left:18px; font-size:13.5px; }} li {{ margin:3px 0; }}
.chart {{ width:100%; height:auto; display:block; }}
.chart .grid {{ stroke:var(--line); }}
.chart .axis {{ fill:var(--muted); font-size:11px; }}
.pulse {{ animation:pulse 1.8s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }}
@keyframes pulse {{ 50% {{ transform:scale(1.6); opacity:.5; }} }}
footer {{ margin-top:26px; font-size:12.5px; color:var(--muted); }}
</style></head><body><div class='wrap'>
<header>
  <h1>🪙 <span>Gold &amp; Silver</span> today</h1>
  <div class='muted'>{now:%A, %d %B %Y · %H:%M} · AED per gram</div>
</header>
<div class='grid3'>
  {price_card('24K gold', d['g24'], d['chg_gold'], 'var(--gold)')}
  {price_card('18K gold', d['g18'], d['chg_gold'], 'var(--gold)')}
  {price_card('Silver', d['silver'], d['chg_silver'], 'var(--silver)')}
</div>
<h2>Buy signals</h2>
<div class='grid2'>
  {signal_card('Gold', d['sig_gold'], 'var(--gold)')}
  {signal_card('Silver', d['sig_silver'], 'var(--silver)')}
</div>
<h2>{now.year} — weekly closing price</h2>
<div class='grid2'>
  <div class='card'><div class='label'>24K gold · AED/gram</div>
    {chart(rows, '24K gold AED/gram', '#d9a521', lambda v: f'{v:,.0f}')}</div>
  <div class='card'><div class='label'>Silver · AED/gram</div>
    {chart(rows, 'Silver AED/gram', '#8e9bab', lambda v: f'{v:,.2f}')}</div>
</div>
<footer>
  World spot: gold ${d['gold_usd']:,.2f}/oz · silver ${d['silver_usd']:,.2f}/oz · 1 USD = 3.6725 AED.
  18K = 75% of 24K. Shop prices in Dubai may differ slightly, plus making charges.<br>
  Signals compare today's price with past prices — they can't predict the future and aren't financial advice.
</footer>
</div></body></html>"""
    OUT.write_text(page)
    return OUT
