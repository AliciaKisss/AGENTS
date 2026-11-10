// Gold Watch for iPad (Scriptable app) — gold & silver in AED per gram.
//
// Same prices and buy signals as gold-price/ on the Mac:
//   - live world spot prices from gold-api.com (USD per troy ounce),
//   - converted at the fixed peg 1 USD = 3.6725 AED,
//   - 24K gold, 18K gold (75% of 24K) and silver per gram,
//   - 🟢🟡🔴 buy signals from ~1 year of COMEX prices (Yahoo Finance).
//
// As a widget (small, medium, large or extra large) it shows prices,
// today's change and the signals. Tap it to open the full view with the
// reasons and 1-year charts. Once a day after 9 AM it also sends a
// notification with the prices (turn off with DAILY_NOTIFICATION below).
//
// Signals only compare today's price with past prices. They can't predict
// the future and aren't financial advice.

const DAILY_NOTIFICATION = true;
const NOTIFY_HOUR = 9;            // send the daily notification after this hour

const USD_TO_AED = 3.6725;        // fixed peg
const GRAMS_PER_OZ = 31.1034768;
const K18 = 18 / 24;              // 18K gold is 75% pure
const DUBAI_OFFSET_H = 4;
const DISCLAIMER = "Signals compare with past prices; they can't predict the future and aren't financial advice.";

// Same thresholds as gold-price/signals.py. Silver moves about twice as much
// as gold, so its thresholds are wider.
const RULES = {
  gold:   { symbol: "GC=F", greenAvg: -2.0, greenHigh: 8.0,  redAvg: 3.0, redHigh: 2.0, bigDrop: -3.0 },
  silver: { symbol: "SI=F", greenAvg: -4.0, greenHigh: 15.0, redAvg: 6.0, redHigh: 3.0, bigDrop: -6.0 },
};

const LABELS = {
  "🟢": { full: "Good time to consider buying", short: "Good to consider buying" },
  "🟡": { full: "Neutral — around the usual price", short: "Neutral" },
  "🔴": { full: "Expensive right now — waiting may be better", short: "Expensive right now" },
};

// ------------------------------------------------------------ helpers ----

function toAedGram(usdOz) { return usdOz / GRAMS_PER_OZ * USD_TO_AED; }

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

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const yearOfDay = (dayNum) => new Date(dayNum * 86400000).getUTCFullYear();

// Yahoo daily chart -> [{day, close}] where day = whole days since 1970 in
// Dubai time. The latest live price replaces/extends the last day.
function parseDaily(res) {
  const ts = res.timestamp || [];
  const closes = (res.indicators && res.indicators.quote[0].close) || [];
  const dayOf = (t) => Math.floor((t + DUBAI_OFFSET_H * 3600) / 86400);
  const pts = [];
  ts.forEach((t, i) => { if (closes[i] != null) pts.push({ day: dayOf(t), close: closes[i] }); });
  const m = res.meta || {};
  if (m.regularMarketPrice) {
    const day = dayOf(m.regularMarketTime || 0);
    const last = pts[pts.length - 1];
    if (last && last.day === day) last.close = m.regularMarketPrice;
    else if (last && day > last.day) pts.push({ day, close: m.regularMarketPrice });
  }
  return pts;
}

// Daily points -> weekly closes [{monday, close}] (last close of each Mon-Sun
// week), the same weeks gold-price/signals.py uses. Keeps ~60 weeks.
function toWeeks(pts) {
  const byWeek = new Map();
  for (const p of pts) {
    const weekday = (p.day + 3) % 7;          // 1970-01-01 was a Thursday; Monday = 0
    byWeek.set(p.day - weekday, p.close);
  }
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).slice(-60)
    .map(([monday, close]) => ({ monday, close }));
}

// Port of compute() in gold-price/signals.py.
function computeSignal(metal, weeks) {
  const r = RULES[metal];
  const cur = weeks[weeks.length - 1];
  const past = weeks.slice(0, -1).map((w) => w.close);   // completed weeks only
  const nowUsd = cur.close;
  const now = toAedGram(nowUsd);

  const avg12 = toAedGram(avg(past.slice(-12)));
  const high26 = toAedGram(Math.max(...past.slice(-25), nowUsd));
  const thisYear = yearOfDay(cur.monday);
  const year = weeks.filter((w) => yearOfDay(w.monday + 6) === thisYear).map((w) => w.close);
  const yearLow = toAedGram(Math.min(...year)), yearHigh = toAedGram(Math.max(...year));
  const lastWeek = toAedGram(past[past.length - 1]);

  const vsAvg = (now - avg12) / avg12 * 100;
  const belowHigh = (high26 - now) / high26 * 100;
  const weekChg = (now - lastWeek) / lastWeek * 100;
  const span = yearHigh - yearLow;
  const yearPos = span ? (now - yearLow) / span * 100 : 50;

  let color;
  if (vsAvg <= r.greenAvg && belowHigh >= r.greenHigh) color = "🟢";
  else if (vsAvg >= r.redAvg || belowHigh <= r.redHigh) color = "🔴";
  else color = "🟡";

  const where = yearPos < 25 ? "Near the bottom" : yearPos > 75 ? "Near the top" : "In the middle";
  const lines = [
    `${Math.abs(vsAvg).toFixed(1)}% ${vsAvg < 0 ? "below" : "above"} the 12-week average (AED ${fmt(avg12)}/g)`,
    `${belowHigh.toFixed(1)}% below the 6-month high (AED ${fmt(high26)}/g)`,
    `${where} of ${thisYear}'s range (low AED ${fmt(yearLow)}, high AED ${fmt(yearHigh)})`,
    `${weekChg >= 0 ? "+" : ""}${weekChg.toFixed(1)}% vs last week's close`,
  ];
  return {
    color, label: LABELS[color].full, short: LABELS[color].short,
    bigDrop: weekChg <= r.bigDrop, weekChange: weekChg, lines,
  };
}

// Everything the widget and the full view need for one metal.
function analyseMetal(metal, res, spotUsd) {
  const pts = parseDaily(res);
  const n = pts.length;
  const dayChg = n >= 2 ? (pts[n - 1].close / pts[n - 2].close - 1) * 100 : null;
  const weeks = toWeeks(pts);
  const usd = spotUsd || pts[n - 1].close;    // spot price; futures price as backup
  return {
    usd, aed: toAedGram(usd), dayChg,
    signal: weeks.length >= 14 ? computeSignal(metal, weeks) : null,
    chart: weeks.slice(-52).map((w) => ({ monday: w.monday, aed: toAedGram(w.close) })),
  };
}

// ---------------------------------------------------------------- data ----

async function getJSON(url, ua) {
  const req = new Request(url);
  req.headers = { "User-Agent": ua || "Mozilla/5.0" };
  req.timeoutInterval = 25;
  return await req.loadJSON();
}

async function fetchSpot(symbol) {
  try {
    const j = await getJSON("https://api.gold-api.com/price/" + symbol, "gold-price-checker");
    return Number(j.price) || null;
  } catch (e) { return null; }
}

async function fetchYahoo(symbol) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`);
  return j.chart.result[0];
}

async function loadData() {
  const [goldSpot, silverSpot, goldRes, silverRes] = await Promise.all([
    fetchSpot("XAU"), fetchSpot("XAG"), fetchYahoo(RULES.gold.symbol), fetchYahoo(RULES.silver.symbol),
  ]);
  return {
    time: Date.now(),
    gold: analyseMetal("gold", goldRes, goldSpot),
    silver: analyseMetal("silver", silverRes, silverSpot),
  };
}

// Keep the last good data so the widget still shows something offline.
const CACHE_NAME = "gold-watch-cache.json";
const STATE_NAME = "gold-watch-state.json";

function fileIO(name) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), name);
  return {
    read() { try { return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null; } catch (e) { return null; } },
    write(obj) { try { fm.writeString(path, JSON.stringify(obj)); } catch (e) {} },
  };
}

async function getData() {
  const cache = fileIO(CACHE_NAME);
  try {
    const d = await loadData();
    cache.write(d);
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
  gold: new Color("#C8930C"),
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

function priceRow(w, name, aed, chg, sig, size, showLabel) {
  const row = w.addStack();
  row.centerAlignContent();
  addText(row, name, size - 3, C.muted, true);
  row.addSpacer(4);
  addText(row, fmt(aed), size, C.text, true);
  row.addSpacer();
  addText(row, pct(chg), size - 4, changeColor(chg));
  if (sig !== undefined) {
    row.addSpacer(6);
    addText(row, sig ? sig.color + (showLabel ? " " + sig.short : "") : "—", size - 4, C.text);
  }
}

function buildWidget(d, stale, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  const big = family === "large" || family === "extraLarge";
  const small = family === "small";
  w.setPadding(14, 14, 14, 14);

  const drops = ["gold", "silver"].filter((m) => d[m].signal && d[m].signal.bigDrop);
  const head = w.addStack();
  head.centerAlignContent();
  addText(head, drops.length ? "⚠️ Big drop this week" : small ? "Gold & Silver" : "Gold & Silver · AED / gram",
          small ? 13 : 15, drops.length ? C.down : C.gold, true);
  head.addSpacer();
  if (!small) addText(head, (stale ? "offline · " : "") + hhmm(d.time), 11, C.muted);
  w.addSpacer(small ? 6 : 10);

  const size = small ? 15 : big ? 22 : 18;
  const g = d.gold, s = d.silver;
  priceRow(w, "24K", g.aed, g.dayChg, g.signal, size, !small);
  w.addSpacer(small ? 3 : 6);
  priceRow(w, "18K", g.aed * K18, g.dayChg, undefined, size);
  w.addSpacer(small ? 3 : 6);
  priceRow(w, "Silver", s.aed, s.dayChg, s.signal, size, !small);

  if (big) {
    for (const [name, m] of [["Gold", g], ["Silver", s]]) {
      w.addSpacer(12);
      addText(w, `${name}: ${m.signal ? m.signal.color + " " + m.signal.label : "signal unavailable today"}`, 13, C.text, true);
      if (m.signal) {
        for (const line of m.signal.lines.slice(0, family === "extraLarge" ? 4 : 2)) {
          w.addSpacer(2);
          const t = addText(w, "• " + line, 11, C.muted);
          t.lineLimit = 2;
        }
      }
    }
  }

  w.addSpacer();
  const foot = w.addStack();
  if (small) addText(foot, (stale ? "offline · " : "") + hhmm(d.time), 10, C.muted);
  else addText(foot, `World spot: gold $${fmt(g.usd)}/oz · silver $${fmt(s.usd)}/oz` + (big ? ". Not financial advice." : ""), 10, C.muted);
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  addText(w, "Gold & Silver", 14, C.gold, true);
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

function svgChart(points, color, id) {
  if (points.length < 2) return "<p class='muted'>Not enough data yet.</p>";
  const W = 640, H = 180, L = 52, R = 10, T = 14, B = 26;
  const w = W - L - R, h = H - T - B;
  const vals = points.map((p) => p.aed);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 1, lo2 = lo - pad, hi2 = hi + pad;
  const x = (i) => L + w * i / (points.length - 1);
  const y = (v) => T + h * (1 - (v - lo2) / (hi2 - lo2));
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${L},${T + h} ${line} ${x(vals.length - 1).toFixed(1)},${T + h}`;
  let grid = "";
  for (let k = 0; k < 4; k++) {
    const v = lo2 + (hi2 - lo2) * k / 3;
    grid += `<line x1='${L}' x2='${W - R}' y1='${y(v).toFixed(1)}' y2='${y(v).toFixed(1)}' class='grid'/>` +
            `<text x='${L - 6}' y='${(y(v) + 4).toFixed(1)}' class='axis' text-anchor='end'>${fmt(v)}</text>`;
  }
  let labels = "", lastMonth = -1;
  points.forEach((p, i) => {
    const m = new Date(p.monday * 86400000).getUTCMonth();
    if (m !== lastMonth && m % 2 === 0 && i > 0)
      labels += `<text x='${x(i).toFixed(1)}' y='${H - 6}' class='axis' text-anchor='middle'>${MONTHS[m]}</text>`;
    lastMonth = m;
  });
  let marks = "";
  for (const [i, tag] of [[vals.indexOf(hi), "high"], [vals.indexOf(lo), "low"]]) {
    // keep the label inside the chart: anchor it left/right near the edges
    const anchor = x(i) < L + 50 ? "start" : x(i) > W - R - 50 ? "end" : "middle";
    const tx = anchor === "start" ? x(i) + 6 : anchor === "end" ? x(i) - 6 : x(i);
    marks += `<circle cx='${x(i).toFixed(1)}' cy='${y(vals[i]).toFixed(1)}' r='3.5' fill='${color}'/>` +
             `<text x='${tx.toFixed(1)}' y='${(y(vals[i]) + (tag === "high" ? -9 : 16)).toFixed(1)}' class='axis' text-anchor='${anchor}'>${tag} ${fmt(vals[i])}</text>`;
  }
  return `<svg viewBox='0 0 ${W} ${H}' class='chart'>
    <defs><linearGradient id='${id}' x1='0' x2='0' y1='0' y2='1'>
      <stop offset='0%' stop-color='${color}' stop-opacity='.35'/><stop offset='100%' stop-color='${color}' stop-opacity='0'/>
    </linearGradient></defs>
    ${grid}<polygon points='${area}' fill='url(#${id})'/>
    <polyline points='${line}' fill='none' stroke='${color}' stroke-width='2.4' stroke-linejoin='round'/>
    ${marks}<circle cx='${x(vals.length - 1).toFixed(1)}' cy='${y(vals[vals.length - 1]).toFixed(1)}' r='5' fill='${color}'/>
    ${labels}</svg>`;
}

function chgSpan(v) {
  return `<span class='${v > 0 ? "up" : v < 0 ? "down" : "muted"}'>${pct(v)}</span>`;
}

function signalCard(name, m) {
  const s = m.signal;
  if (!s) return `<div class='card'><h3>${name}</h3><p class='muted'>Signal unavailable today.</p></div>`;
  const cls = { "🟢": "good", "🟡": "neutral", "🔴": "bad" }[s.color];
  return `<div class='card'><h3>${name} buy signal</h3>
    <div class='badge ${cls}'>${s.color} ${esc(s.label)}</div>
    <ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
}

function buildHTML(d, stale) {
  const g = d.gold, s = d.silver, now = new Date(d.time);
  const drops = [["Gold", g], ["Silver", s]].filter(([, m]) => m.signal && m.signal.bigDrop)
    .map(([n, m]) => `${n} ${m.signal.weekChange.toFixed(1)}%`);
  return `<!doctype html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<style>
:root{--bg:#f4f1ea;--card:#fff;--text:#1d1d1f;--muted:#6b6b70;--line:#e6e1d6;--gold:#c8930c;--silver:#7d8a99;--up:#1f9d55;--down:#d64545}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1f1f22;--text:#f2f2f7;--muted:#9a9aa0;--line:#2e2e33;--gold:#e0b23a;--silver:#a9b6c6}}
body{margin:0;background:var(--bg);color:var(--text);font:16px -apple-system,system-ui,sans-serif;padding:20px 16px 40px}
.wrap{max-width:900px;margin:0 auto}
h1{font-size:28px;margin:0 0 2px}h3{margin:0 0 10px;font-size:17px}
.muted{color:var(--muted)}.small{font-size:13px}.up{color:var(--up)}.down{color:var(--down)}
.alert{background:var(--down);color:#fff;border-radius:12px;padding:10px 14px;margin:14px 0;font-weight:600}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.price .name{font-size:14px;color:var(--muted);font-weight:600}
.price .value{font-size:30px;font-weight:700;margin:4px 0}
.badge{display:inline-block;border-radius:999px;padding:6px 12px;font-weight:600;font-size:14px;margin-bottom:6px}
.good{background:#1f9d5522;color:var(--up)}.neutral{background:#e0a10022;color:#b07d00}.bad{background:#d6454522;color:var(--down)}
@media (prefers-color-scheme:dark){.neutral{color:#f0c040}}
ul{margin:6px 0 0;padding-left:20px}li{margin:4px 0}
.chart{width:100%;height:auto;display:block}.grid{stroke:var(--line)}.axis{fill:var(--muted);font-size:11px}
footer{margin-top:20px;font-size:13px;color:var(--muted)}
</style></head><body><div class='wrap'>
<h1>Gold & Silver Today</h1>
<div class='muted'>${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} · updated ${hhmm(d.time)}${stale ? " · offline, showing last saved prices" : ""}</div>
${drops.length ? `<div class='alert'>⚠️ Big drop this week: ${esc(drops.join(", "))}</div>` : ""}
<div class='grid3'>
  <div class='card price'><div class='name'>24K gold</div><div class='value'>AED ${fmt(g.aed)}</div><div>per gram · ${chgSpan(g.dayChg)} today</div></div>
  <div class='card price'><div class='name'>18K gold</div><div class='value'>AED ${fmt(g.aed * K18)}</div><div>per gram · ${chgSpan(g.dayChg)} today</div></div>
  <div class='card price'><div class='name'>Silver</div><div class='value'>AED ${fmt(s.aed)}</div><div>per gram · ${chgSpan(s.dayChg)} today</div></div>
</div>
<div class='grid2'>${signalCard("Gold", g)}${signalCard("Silver", s)}</div>
<div class='card' style='margin-top:12px'><h3>24K gold, last 12 months <span class='muted small'>AED / gram, weekly</span></h3>${svgChart(g.chart, "var(--gold)", "gg")}</div>
<div class='card' style='margin-top:12px'><h3>Silver, last 12 months <span class='muted small'>AED / gram, weekly</span></h3>${svgChart(s.chart, "var(--silver)", "gs")}</div>
<footer>World spot: gold $${fmt(g.usd)}/oz · silver $${fmt(s.usd)}/oz, converted at 1 USD = ${USD_TO_AED} AED. Shop prices in Dubai can differ slightly (plus making charges on jewellery). ${esc(DISCLAIMER)}</footer>
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
  const g = d.gold, s = d.silver;
  const drops = [["Gold", g], ["Silver", s]].filter(([, m]) => m.signal && m.signal.bigDrop)
    .map(([n, m]) => `${n} ${m.signal.weekChange.toFixed(1)}%`);
  const n = new Notification();
  n.title = drops.length ? "⚠️ Big drop this week: " + drops.join(", ") : "Gold & Silver Today";
  n.body = `24K AED ${fmt(g.aed)} (${pct(g.dayChg)}) · 18K AED ${fmt(g.aed * K18)} · Silver AED ${fmt(s.aed)} (${pct(s.dayChg)})\n` +
           `Gold: ${g.signal ? g.signal.color + " " + g.signal.short : "—"} · Silver: ${s.signal ? s.signal.color + " " + s.signal.short : "—"}`;
  n.openURL = URLScheme.forRunningScript();
  await n.schedule();
}

// ----------------------------------------------------------------- run ----

async function main() {
  if (config.runsInWidget) {
    let w;
    try {
      const { d, stale } = await getData();
      w = buildWidget(d, stale, config.widgetFamily);
      await maybeNotify(d, stale, true);
    } catch (e) {
      w = errorWidget(e);
    }
    Script.setWidget(w);
  } else {
    const { d, stale } = await getData();
    await maybeNotify(d, stale, false);
    const wv = new WebView();
    await wv.loadHTML(buildHTML(d, stale));
    await wv.present(true);
  }
  Script.complete();
}

// ---- RUN ----
await main();
