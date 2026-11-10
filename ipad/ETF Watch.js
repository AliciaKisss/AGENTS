// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: chart-line;
// ETF Watch for iPad (Scriptable app): FWRA, IGLN, VUAA and VWRA.
//
// Same data and buy signals as stock-watch/ on the Mac:
//   - ~2 years of daily prices from Yahoo Finance (London Stock Exchange, USD),
//   - a buy signal per ETF (1-year high, RSI, 50/200-day averages) with reasons,
//   - recent news headlines from Google News (in the full view).
//
// As a widget (small, medium, large or extra large) it shows each ETF's
// price, today's change and its signal. Tap it to open the full view with
// the reasons, 1-year charts and news. Once a day after 9 AM it also sends a
// notification with the prices (turn off with DAILY_NOTIFICATION below).
//
// Signals only describe where today's price sits versus its own recent
// history. They can't predict the future and aren't financial advice. For
// long-term index funds, regular investing usually matters more than timing.

const DAILY_NOTIFICATION = true;
const NOTIFY_HOUR = 9;            // send the daily notification after this hour

const USD_TO_AED = 3.6725;

// ticker -> [Yahoo symbol, short description, news search]
const ETFS = {
  VWRA: ["VWRA.L", "Vanguard FTSE All-World · global stocks", "global stock markets"],
  FWRA: ["FWRA.L", "Invesco FTSE All-World · global stocks", "global equities"],
  VUAA: ["VUAA.L", "Vanguard S&P 500 · US stocks", "S&P 500"],
  IGLN: ["IGLN.L", "iShares Physical Gold · gold", "gold price"],
};

const DISCLAIMER = "Signals compare today's price with its own past prices — they can't predict the future and aren't financial advice.";

// ------------------------------------------------------------ helpers ----

function fmt(v, d = 2) {
  if (v == null || !isFinite(v)) return "—";
  const [i, f] = Math.abs(v).toFixed(d).split(".");
  return (v < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}

function pct(v) {
  if (v == null || !isFinite(v)) return "—";
  const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "■";
  return `${arrow} ${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

const yearOfDay = (dayNum) => new Date(dayNum * 86400000).getUTCFullYear();

// Yahoo daily chart -> [{day, close}] (day = whole days since 1970, UTC).
// The latest live price replaces that day's bar, or is added as a new day.
function parseDaily(res) {
  const ts = res.timestamp || [];
  const closes = (res.indicators && res.indicators.quote[0].close) || [];
  const dayOf = (t) => Math.floor(t / 86400);
  const pts = [];
  ts.forEach((t, i) => { if (closes[i]) pts.push({ day: dayOf(t), close: closes[i] }); });
  const m = res.meta || {};
  if (m.regularMarketPrice) {
    const day = dayOf(m.regularMarketTime || 0);
    const last = pts[pts.length - 1];
    if (last && last.day === day) last.close = m.regularMarketPrice;
    else if (last && day > last.day) pts.push({ day, close: m.regularMarketPrice });
  }
  return pts;
}

function sma(vals, n) {
  return vals.length >= n ? vals.slice(-n).reduce((s, x) => s + x, 0) / n : null;
}

// Standard 14-day RSI (Wilder's smoothing).
function rsi(vals, n = 14) {
  if (vals.length <= n) return null;
  const diffs = vals.slice(1).map((v, i) => v - vals[i]);
  let ag = diffs.slice(0, n).reduce((s, d) => s + Math.max(d, 0), 0) / n;
  let al = diffs.slice(0, n).reduce((s, d) => s + Math.max(-d, 0), 0) / n;
  for (const d of diffs.slice(n)) {
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

// Port of analyse() in stock-watch/stocks.py.
function analyse(pts) {
  const closes = pts.map((p) => p.close);
  const lastYear = pts.slice(-252);
  const yearCloses = lastYear.map((p) => p.close);
  const price = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const ma50 = sma(closes, 50), ma200 = sma(closes, 200);
  const high52 = Math.max(...yearCloses), low52 = Math.min(...yearCloses);
  const dd = (high52 - price) / high52 * 100;
  const r = rsi(closes);
  const thisYear = yearOfDay(pts[pts.length - 1].day);
  const prior = pts.filter((p) => yearOfDay(p.day) < thisYear);
  const ytd = prior.length ? (price / prior[prior.length - 1].close - 1) * 100 : null;
  const m1 = closes.length > 22 ? (price / closes[closes.length - 22] - 1) * 100 : null;

  let score = 0;
  const reasons = [];   // [kind, text]  kind: "+" good for buying, "-" against, "i" info

  if (dd >= 10) {
    score += 2;
    reasons.push(["+", `${dd.toFixed(1)}% below its 1-year high — a correction. For long-term investors, buying after a 10%+ fall has historically worked out well.`]);
  } else if (dd >= 5) {
    score += 1;
    reasons.push(["+", `${dd.toFixed(1)}% below its 1-year high — a pullback, so you're not buying at the top.`]);
  } else if (dd < 2) {
    score -= 1;
    reasons.push(["-", `Only ${dd.toFixed(1)}% below its 1-year high — buying near the top.`]);
  } else {
    reasons.push(["i", `${dd.toFixed(1)}% below its 1-year high — a small dip.`]);
  }

  if (r != null) {
    const rs = r.toFixed(0);
    if (r < 30) { score += 2; reasons.push(["+", `RSI is ${rs} (under 30 = oversold): it has fallen fast and often bounces.`]); }
    else if (r < 40) { score += 1; reasons.push(["+", `RSI is ${rs}: recent selling pressure, closer to oversold.`]); }
    else if (r > 70) { score -= 2; reasons.push(["-", `RSI is ${rs} (over 70 = overbought): it has risen fast and often cools off.`]); }
    else if (r > 60) reasons.push(["i", `RSI is ${rs}: strong recent momentum, not yet overbought.`]);
    else reasons.push(["i", `RSI is ${rs}: neither oversold nor overbought.`]);
  }

  if (ma50) {
    const gap50 = (price / ma50 - 1) * 100;
    if (gap50 < 0) { score += 1; reasons.push(["+", `${Math.abs(gap50).toFixed(1)}% below its 50-day average — a short-term dip.`]); }
    else if (gap50 > 5) { score -= 1; reasons.push(["-", `${gap50.toFixed(1)}% above its 50-day average — stretched in the short term.`]); }
    else reasons.push(["i", `${gap50.toFixed(1)}% above its 50-day average — normal range.`]);
  }

  if (ma200) {
    const gap200 = (price / ma200 - 1) * 100;
    if (gap200 >= 0) reasons.push(["i", `${gap200.toFixed(1)}% above its 200-day average — the long-term uptrend is intact.`]);
    else reasons.push(["i", `${Math.abs(gap200).toFixed(1)}% below its 200-day average — in a longer downtrend; dips can go further, so consider buying in smaller steps.`]);
  }

  let emoji, label, short;
  if (score >= 3) [emoji, label, short] = ["🟢", "Good time to add", "Good time to add"];
  else if (score <= -2) [emoji, label, short] = ["🔴", "Stretched — consider waiting", "Stretched"];
  else [emoji, label, short] = ["🟡", "Neutral — stick to your regular plan", "Neutral"];

  // 1-year chart with the 50-day average (computed over the full history)
  const series = lastYear.map((p) => {
    const idx = pts.indexOf(p);
    const ma = idx >= 49 ? closes.slice(idx - 49, idx + 1).reduce((s, x) => s + x, 0) / 50 : null;
    return { day: p.day, close: p.close, ma50: ma };
  });

  return {
    price, chg1d: (price / prev - 1) * 100, chg1m: m1, ytd, high52, low52, dd, rsi: r,
    ma50, ma200, score, emoji, label, short, reasons, series,
  };
}

// ---------------------------------------------------------------- data ----

async function fetchPrices(symbol) {
  const req = new Request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`);
  req.headers = { "User-Agent": "Mozilla/5.0" };
  req.timeoutInterval = 25;
  const res = (await req.loadJSON()).chart.result[0];
  return analyse(parseDaily(res));
}

// Google News RSS -> [{title, source, link}]
async function fetchNews(query, n = 3) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(`${query} when:3d`) + "&hl=en-US&gl=US&ceid=US:en";
  const req = new Request(url);
  req.headers = { "User-Agent": "Mozilla/5.0" };
  req.timeoutInterval = 20;
  const xml = await req.loadString();
  const items = [];
  let cur = null, text = "";
  const p = new XMLParser(xml);
  p.didStartElement = (name) => { if (name === "item") cur = {}; text = ""; };
  p.foundCharacters = (s) => { text += s; };
  p.didEndElement = (name) => {
    if (cur && ["title", "link", "source"].includes(name)) cur[name] = text.trim();
    if (name === "item" && cur) { items.push(cur); cur = null; }
    text = "";
  };
  p.parse();
  return items.slice(0, n).map((it) => {
    let title = it.title || "";
    const source = it.source || "";
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    return { title, source, link: it.link };
  });
}

async function loadData(withNews) {
  const tickers = Object.keys(ETFS);
  const results = await Promise.all(tickers.map(async (t) => {
    const [sym, desc, query] = ETFS[t];
    const [a, news] = await Promise.all([
      fetchPrices(sym).catch(() => null),
      withNews ? fetchNews(query).catch(() => []) : Promise.resolve([]),
    ]);
    return [t, { desc, analysis: a, news }];
  }));
  const etfs = Object.fromEntries(results);
  if (!tickers.some((t) => etfs[t].analysis)) throw new Error("No ETF prices available");
  return { time: Date.now(), etfs };
}

// Keep the last good prices so the widget still shows something offline.
const CACHE_NAME = "etf-watch-cache.json";
const STATE_NAME = "etf-watch-state.json";

function fileIO(name) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), name);
  return {
    read() { try { return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null; } catch (e) { return null; } },
    write(obj) { try { fm.writeString(path, JSON.stringify(obj)); } catch (e) {} },
  };
}

async function getData(withNews) {
  const cache = fileIO(CACHE_NAME);
  try {
    const d = await loadData(withNews);
    // Fill any ETF that failed this time from the last saved data.
    const old = cache.read();
    if (old) for (const t of Object.keys(d.etfs)) if (!d.etfs[t].analysis && old.etfs[t]) d.etfs[t].analysis = old.etfs[t].analysis;
    const slim = { time: d.time, etfs: {} };   // cache without news / charts
    for (const [t, e] of Object.entries(d.etfs)) {
      slim.etfs[t] = { desc: e.desc, news: [], analysis: e.analysis && { ...e.analysis, series: e.analysis.series.slice(-260) } };
    }
    cache.write(slim);
    return { d, stale: false };
  } catch (e) {
    const d = cache.read();
    if (d) return { d, stale: true };
    throw e;
  }
}

// ------------------------------------------------------------ display ----

const C = {
  bg: Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E")),
  text: Color.dynamic(new Color("#111111"), new Color("#F2F2F7")),
  muted: Color.dynamic(new Color("#6B6B70"), new Color("#9A9AA0")),
  accent: new Color("#1F9D55"),
  up: new Color("#1F9D55"),
  down: new Color("#D64545"),
};
const changeColor = (v) => (v > 0 ? C.up : v < 0 ? C.down : C.muted);

function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function addText(stack, s, size, color, bold) {
  const t = stack.addText(s);
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.text;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function fixed(row, width, fn) {   // a fixed-width column so rows line up
  const s = row.addStack();
  s.size = new Size(width, 0);
  fn(s);
  return s;
}

function buildWidget(d, stale, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const small = family === "small";
  const big = family === "large" || family === "extraLarge";
  w.setPadding(14, 14, 14, 14);

  const head = w.addStack();
  head.centerAlignContent();
  addText(head, small ? "Your ETFs" : "Your ETFs Today", small ? 13 : 15, C.accent, true);
  head.addSpacer();
  addText(head, (stale ? "offline · " : "") + hhmm(d.time), 10, C.muted);
  w.addSpacer(small ? 6 : 10);

  const size = small ? 13 : big ? 17 : 15;
  for (const [t, e] of Object.entries(d.etfs)) {
    const a = e.analysis;
    const row = w.addStack();
    row.centerAlignContent();
    if (small) {
      addText(row, t, size, C.text, true);
      row.addSpacer();
      if (a) { addText(row, pct(a.chg1d), size - 2, changeColor(a.chg1d)); row.addSpacer(4); addText(row, a.emoji, size - 2); }
      else addText(row, "—", size - 2, C.muted);
    } else {
      fixed(row, 52, (s) => addText(s, t, size, C.text, true));
      fixed(row, 80, (s) => { s.addSpacer(); addText(s, a ? "$" + fmt(a.price) : "—", size, C.text, true); });
      fixed(row, 86, (s) => { s.addSpacer(); if (a) addText(s, pct(a.chg1d), size - 3, changeColor(a.chg1d)); });
      row.addSpacer(10);
      addText(row, a ? `${a.emoji} ${big ? a.label : a.short}` : "data unavailable", size - 3, a ? C.text : C.muted);
      row.addSpacer();
    }
    if (big && a) {
      const why = (a.reasons.find(([k]) => k !== "i") || a.reasons[0])[1];
      w.addSpacer(2);
      const r = addText(w, why, 11, C.muted);
      r.lineLimit = family === "extraLarge" ? 2 : 1;
    }
    w.addSpacer(small ? 4 : big ? 10 : 6);
  }

  w.addSpacer();
  if (!small) addText(w, `Prices in USD (1 USD = ${USD_TO_AED} AED).` + (big ? " Not financial advice." : ""), 10, C.muted);
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  addText(w, "Your ETFs", 14, C.accent, true);
  w.addSpacer(6);
  const t = addText(w, "Couldn't load prices. Will retry soon.", 12, C.muted);
  t.lineLimit = 3;
  w.addSpacer();
  addText(w, String(msg).slice(0, 80), 9, C.muted);
  return w;
}

// ------------------------------------------------- full view (in app) ----

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function svgChart(series, color, id) {
  if (series.length < 2) return "";
  const W = 620, H = 200, L = 62, R = 8, T = 12, B = 26;
  const w = W - L - R, h = H - T - B;
  const closes = series.map((p) => p.close);
  const all = closes.concat(series.map((p) => p.ma50).filter((v) => v != null));
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 1;
  lo -= pad; hi += pad;
  const x = (i) => L + w * i / (series.length - 1);
  const y = (v) => T + h * (1 - (v - lo) / (hi - lo));
  const line = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${L},${T + h} ${line} ${x(closes.length - 1).toFixed(1)},${T + h}`;
  const l50 = series.map((p, i) => (p.ma50 != null ? `${x(i).toFixed(1)},${y(p.ma50).toFixed(1)}` : null)).filter(Boolean).join(" ");
  let grid = "";
  for (let k = 0; k < 4; k++) {
    const v = lo + (hi - lo) * k / 3;
    grid += `<line x1='${L}' x2='${W - R}' y1='${y(v).toFixed(1)}' y2='${y(v).toFixed(1)}' class='grid'/>` +
            `<text x='${L - 6}' y='${(y(v) + 4).toFixed(1)}' class='axis' text-anchor='end'>${fmt(v)}</text>`;
  }
  let labels = "", lastMonth = -1;
  series.forEach((p, i) => {
    const m = new Date(p.day * 86400000).getUTCMonth();
    if (m !== lastMonth && m % 2 === 0 && i > 0)
      labels += `<text x='${x(i).toFixed(1)}' y='${H - 6}' class='axis' text-anchor='middle'>${MONTHS[m]}</text>`;
    lastMonth = m;
  });
  return `<svg viewBox='0 0 ${W} ${H}' class='chart'>
    <defs><linearGradient id='${id}' x1='0' x2='0' y1='0' y2='1'>
      <stop offset='0%' stop-color='${color}' stop-opacity='.28'/><stop offset='100%' stop-color='${color}' stop-opacity='0'/>
    </linearGradient></defs>
    ${grid}<polygon points='${area}' fill='url(#${id})'/>
    <polyline points='${l50}' fill='none' stroke='var(--muted)' stroke-width='1.4' stroke-dasharray='4 4'/>
    <polyline points='${line}' fill='none' stroke='${color}' stroke-width='2.2' stroke-linejoin='round'/>
    <circle cx='${x(closes.length - 1).toFixed(1)}' cy='${y(closes[closes.length - 1]).toFixed(1)}' r='4.5' fill='${color}'/>
    ${labels}</svg>`;
}

function chip(name, v) {
  if (v == null) return `<span class='chip'>${name} —</span>`;
  return `<span class='chip ${v > 0 ? "up" : v < 0 ? "down" : ""}'>${name} ${v > 0 ? "+" : ""}${v.toFixed(2)}%</span>`;
}

function card(t, e) {
  const a = e.analysis;
  if (!a) return `<div class='card'><h3>${t}</h3><p class='muted'>Price data unavailable today.</p></div>`;
  const color = { "🟢": "#1f9d55", "🟡": "#c98a0b", "🔴": "#d64545" }[a.emoji];
  const cls = { "🟢": "good", "🟡": "neutral", "🔴": "bad" }[a.emoji];
  const icon = { "+": ["plus", "▲"], "-": ["minus", "▼"], i: ["info", "•"] };
  const pos = Math.max(0, Math.min(100, (a.price - a.low52) / ((a.high52 - a.low52) || 1) * 100));
  const reasons = a.reasons.map(([k, txt]) => `<li class='${icon[k][0]}'><span>${icon[k][1]}</span>${esc(txt)}</li>`).join("");
  const news = e.news.length
    ? e.news.map((n) => `<li><a href='${esc(n.link)}'>${esc(n.title)}</a><span class='muted'> · ${esc(n.source)}</span></li>`).join("")
    : "<li class='muted'>No recent headlines found.</li>";
  return `<div class='card'>
    <div class='top'><div><h3>${t}</h3><div class='muted small'>${esc(e.desc)}</div></div>
      <div class='right'><div class='value'>$${fmt(a.price)}</div><div class='muted small'>≈ AED ${fmt(a.price * USD_TO_AED)}</div></div></div>
    <div class='chips'>${chip("Today", a.chg1d)}${chip("1 month", a.chg1m)}${chip("This year", a.ytd)}</div>
    <div class='badge ${cls}'>${a.emoji} ${esc(a.label)}</div>
    <div class='label'>Why</div><ul class='reasons'>${reasons}</ul>
    <div class='label'>Last 12 months <span class='muted'>— price · - - 50-day average</span></div>
    ${svgChart(a.series, color, "c" + t)}
    <div class='range'><span>1-year low $${fmt(a.low52)}</span><div class='bar'><i style='left:${pos.toFixed(0)}%'></i></div><span>high $${fmt(a.high52)}</span></div>
    <div class='label'>News</div><ul class='news'>${news}</ul></div>`;
}

function buildHTML(d, stale) {
  const now = new Date(d.time);
  return `<!doctype html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<style>
:root{--bg:#eef3f0;--card:#fff;--text:#1d1d1f;--muted:#6b6b70;--line:#dfe6e2;--up:#1f9d55;--down:#d64545}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1f1f22;--text:#f2f2f7;--muted:#9a9aa0;--line:#2e2e33}}
body{margin:0;background:var(--bg);color:var(--text);font:16px -apple-system,system-ui,sans-serif;padding:20px 16px 40px}
.wrap{max-width:1100px;margin:0 auto}h1{font-size:28px;margin:0 0 2px}h3{margin:0;font-size:20px}
.muted{color:var(--muted)}.small{font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.top{display:flex;justify-content:space-between;gap:10px}.right{text-align:right}.value{font-size:24px;font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.chip{font-size:13px;padding:4px 10px;border-radius:999px;background:var(--line)}
.chip.up{color:var(--up)}.chip.down{color:var(--down)}
.badge{display:inline-block;border-radius:999px;padding:6px 12px;font-weight:600;font-size:14px}
.good{background:#1f9d5522;color:var(--up)}.neutral{background:#e0a10022;color:#b07d00}.bad{background:#d6454522;color:var(--down)}
@media (prefers-color-scheme:dark){.neutral{color:#f0c040}}
.label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 6px}
ul{margin:0;padding:0;list-style:none}li{margin:6px 0;font-size:14px;line-height:1.35}
.reasons li{display:flex;gap:8px}.reasons span{flex:0 0 14px;font-size:12px;padding-top:2px}
.plus span{color:var(--up)}.minus span{color:var(--down)}.info span{color:var(--muted)}
.news a{color:inherit}
.chart{width:100%;height:auto;display:block}.chart .grid{stroke:var(--line)}.axis{fill:var(--muted);font-size:15px}
.range{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-top:6px}
.bar{flex:1;height:6px;border-radius:3px;background:linear-gradient(90deg,var(--up),#e0a100,var(--down));position:relative}
.bar i{position:absolute;top:-4px;width:4px;height:14px;margin-left:-2px;border-radius:2px;background:var(--text)}
footer{margin-top:20px;font-size:13px;color:var(--muted)}
</style></head><body><div class='wrap'>
<h1>Your ETFs Today</h1>
<div class='muted'>${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} · updated ${hhmm(d.time)}${stale ? " · offline, showing last saved prices" : ""}</div>
<div class='grid'>${Object.entries(d.etfs).map(([t, e]) => card(t, e)).join("")}</div>
<footer>Prices in USD from the London Stock Exchange (Yahoo Finance), ≈ AED at 1 USD = ${USD_TO_AED}. ${esc(DISCLAIMER)} For long-term index funds, regular investing usually matters more than timing.</footer>
</div></body></html>`;
}

// ------------------------------------------------- daily notification ----

function todayKey() {
  const n = new Date();
  return `${n.getFullYear()}-${n.getMonth() + 1}-${n.getDate()}`;
}

async function maybeNotify(d, stale, send) {
  if (!DAILY_NOTIFICATION || stale || new Date().getHours() < NOTIFY_HOUR) return;
  const state = fileIO(STATE_NAME);
  const st = state.read() || {};
  if (st.notified === todayKey()) return;
  st.notified = todayKey();
  state.write(st);
  if (!send) return;   // already looking at it in the app
  const n = new Notification();
  n.title = "Your ETFs Today";
  n.body = Object.entries(d.etfs).map(([t, e]) => e.analysis
    ? `${t} $${fmt(e.analysis.price)} ${pct(e.analysis.chg1d)} ${e.analysis.emoji} ${e.analysis.short}`
    : `${t}: unavailable`).join("\n");
  n.openURL = URLScheme.forRunningScript();
  await n.schedule();
}

// ----------------------------------------------------------------- run ----

async function main() {
  if (config.runsInWidget) {
    let w;
    try {
      const { d, stale } = await getData(false);
      w = buildWidget(d, stale, config.widgetFamily);
      await maybeNotify(d, stale, true);
    } catch (e) {
      w = errorWidget(e);
    }
    Script.setWidget(w);
  } else {
    const { d, stale } = await getData(true);
    await maybeNotify(d, stale, false);
    const wv = new WebView();
    // News links open in Safari instead of inside the script.
    wv.shouldAllowRequest = (req) => {
      if (/^https?:/i.test(req.url)) { Safari.open(req.url); return false; }
      return true;
    };
    await wv.loadHTML(buildHTML(d, stale));
    await wv.present(true);
  }
  Script.complete();
}

// ---- RUN ----
await main();
