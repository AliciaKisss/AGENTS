// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: gift;
// WoR Codes for iPad (Scriptable app) — Watcher of Realms redeem code finder.
//
// Checks a few code-list websites and the Watcher of Realms subreddit,
// collects the redeem codes they list, and:
//   - shows the active codes in a widget (NEW = first seen in the last 3 days),
//   - sends a notification when a new code appears,
//   - tap a code (in the widget or the full view) to copy it,
//   - in the full view, mark codes as used so they move out of the way.
//
// Websites change their layout now and then. The full view lists every
// source with how many codes it found, so you can see if one stops working.
// Codes found only on Reddit are shown as "unconfirmed".

const NOTIFY_NEW_CODES = true;
const NEW_DAYS = 3;               // show "NEW" for this many days after a code first appears

// type "page": a website with a list of codes. type "reddit": subreddit search.
const SOURCES = [
  { name: "Pocket Tactics", type: "page",   url: "https://www.pockettactics.com/watcher-of-realms/codes" },
  { name: "Pocket Gamer",   type: "page",   url: "https://www.pocketgamer.com/watcher-of-realms/codes/" },
  { name: "Destructoid",    type: "page",   url: "https://www.destructoid.com/watcher-of-realms-codes/" },
  { name: "Game Rant",      type: "page",   url: "https://gamerant.com/watcher-of-realms-codes/" },
  { name: "Reddit",         type: "reddit", url: "https://www.reddit.com/r/WatcherOfRealms/search.json?q=code&restrict_sr=1&sort=new&t=month&limit=50" },
];

// Upper-case words that look like codes but aren't.
const STOP = new Set(("CODE CODES REDEEM REDEEMED ACTIVE EXPIRED UPDATE UPDATED UPDATES WATCHER REALMS " +
  "WATCHEROFREALMS GAME GAMES FREE GEMS REWARD REWARDS GOLD NEW LATEST WORKING VALID INVALID " +
  "MOONTON ANDROID IPHONE IOS IPAD STEAM DISCORD REDDIT FACEBOOK TWITTER YOUTUBE TIKTOK INSTAGRAM " +
  "OFFICIAL EVENT EVENTS HERO HEROES SUMMON SUMMONS STAMINA SCROLL SCROLLS LEGENDARY EPIC RARE " +
  "PATCH NOTES GUIDE TIER LIST FAQ HTML HTTPS HTTP WWW COPY PASTE NOTE IMPORTANT EDIT EDITED " +
  "ANNOUNCEMENT MAINTENANCE COMPENSATION SERVER SERVERS GLOBAL TODAY TOMORROW").split(" "));

// ------------------------------------------------------------ parsing ----

function decode(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", hellip: "…" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return named[e.toLowerCase()] != null ? named[e.toLowerCase()] : m;
  });
}

const stripTags = (s) => decode(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function isCode(tok) {
  if (!/^[A-Z0-9][A-Z0-9_-]{4,23}$/.test(tok)) return false;
  if (!/[A-Z]/.test(tok) || STOP.has(tok)) return false;
  return /\d/.test(tok) || tok.length >= 6;
}

function headingKind(text) {
  const t = text.toLowerCase();
  if (/expired|inactive|no longer|old codes|invalid/.test(t)) return "expired";
  if (/\bcodes?\b/.test(t) && !/how|where|what|why|faq|redeem|get more|more codes|other games|similar/.test(t)) return "active";
  return "other";
}

// A code-list web page -> { active: Map(code -> reward), expired: Set(code) }
function parsePage(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "")
             .replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, "");
  const blocks = [];
  const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<(li|p|tr)\b[^>]*>([\s\S]*?)<\/\3>/gi;
  let m, section = "other", sawActive = false;
  while ((m = re.exec(html))) {
    if (m[1]) { section = headingKind(stripTags(m[2])); if (section === "active") sawActive = true; }
    else blocks.push({ tag: m[3].toLowerCase(), inner: m[4], section });
  }
  const active = new Map(), expired = new Set();
  for (const b of blocks) {
    // Pages without a clear "codes" heading: fall back to list items.
    const sec = b.section === "other" && !sawActive && b.tag === "li" ? "active" : b.section;
    if (sec === "other") continue;
    const marked = [...b.inner.matchAll(/<(strong|b|code|em)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((x) => stripTags(x[2]));
    const text = stripTags(b.inner).replace(/\s*[([]\s*(new|added|updated)[^)\]]*[)\]]/gi, "");
    let cands = marked.flatMap((s) => s.split(/[\s,;:–—-]+(?=[A-Z0-9])/)).map((s) => s.replace(/[^A-Za-z0-9_-]/g, ""));
    if (b.tag !== "p" && !cands.some(isCode)) cands = [text.split(/[\s:–—(]/)[0].replace(/[^A-Za-z0-9_-]/g, "")];
    for (const c of cands) {
      if (!isCode(c)) continue;
      if (sec === "expired") { expired.add(c); continue; }
      const i = text.indexOf(c);
      const reward = i >= 0 ? text.slice(i + c.length).replace(/^[\s:–—\-(]+/, "").replace(/\)\s*$/, "").slice(0, 90) : "";
      if (!active.has(c) || (!active.get(c) && reward)) active.set(c, reward);
    }
  }
  return { active, expired };
}

// Reddit search JSON -> Map(code -> {link, title})
function parseReddit(json, now = Date.now()) {
  const out = new Map();
  const posts = ((json && json.data && json.data.children) || []).map((c) => c.data);
  for (const p of posts) {
    if (!p || now / 1000 - p.created_utc > 30 * 86400) continue;
    const text = `${p.title || ""}\n${p.selftext || ""}`;
    if (!/code/i.test(text)) continue;
    for (const line of text.split("\n")) {
      if (!/code/i.test(line) && !/^\s*[-*•]?\s*[`*]*[A-Z0-9]{6,}/.test(line)) continue;
      for (const tok of line.match(/\b[A-Z0-9][A-Z0-9_-]{5,23}\b/g) || []) {
        if (isCode(tok) && /\d/.test(tok) || isCode(tok) && tok.length >= 8) {
          if (!out.has(tok)) out.set(tok, { link: "https://www.reddit.com" + (p.permalink || ""), title: p.title || "" });
        }
      }
    }
  }
  return out;
}

// Combine all sources into one list of codes.
function merge(results) {
  const codes = new Map();
  const get = (c) => {
    if (!codes.has(c)) codes.set(c, { code: c, reward: "", sources: [], expiredBy: [], link: null, onPage: false });
    return codes.get(c);
  };
  for (const r of results) {
    if (!r.ok) continue;
    if (r.type === "page") {
      for (const [c, reward] of r.active) { const e = get(c); e.sources.push(r.name); e.onPage = true; if (!e.reward && reward) e.reward = reward; }
      for (const c of r.expired) get(c).expiredBy.push(r.name);
    } else {
      for (const [c, info] of r.found) { const e = get(c); e.sources.push(r.name); e.link = e.link || info.link; }
    }
  }
  const list = [...codes.values()].map((e) => ({
    ...e,
    expired: e.expiredBy.length > 0 && e.expiredBy.length >= e.sources.length,
    confirmed: e.onPage || e.sources.length >= 2,
  }));
  return list.filter((e) => e.sources.length > 0 || e.expired);
}

// ---------------------------------------------------------------- data ----

async function fetchSource(src) {
  const req = new Request(src.url);
  req.headers = {
    "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept-Language": "en",
  };
  req.timeoutInterval = 20;
  try {
    const body = await req.loadString();
    const status = req.response && req.response.statusCode;
    if (status && status >= 400) return { ...src, ok: false, error: `HTTP ${status}` };
    if (src.type === "page") {
      const { active, expired } = parsePage(body);
      return { ...src, ok: true, active, expired, count: active.size };
    }
    const found = parseReddit(JSON.parse(body));
    return { ...src, ok: true, found, count: found.size };
  } catch (e) {
    return { ...src, ok: false, error: String(e.message || e).slice(0, 80) };
  }
}

function fileIO(name) {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), name);
  return {
    read() { try { return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null; } catch (e) { return null; } },
    write(obj) { try { fm.writeString(path, JSON.stringify(obj)); } catch (e) {} },
  };
}
const CACHE = fileIO("wor-codes-cache.json");
const STATE = fileIO("wor-codes-state.json");

async function getData() {
  const results = await Promise.all(SOURCES.map(fetchSource));
  const status = results.map((r) => ({ name: r.name, url: r.url, ok: r.ok, count: r.count || 0, error: r.error || "" }));
  if (!results.some((r) => r.ok)) {
    const cached = CACHE.read();
    if (cached) return { ...cached, status, stale: true };
    return { time: Date.now(), codes: [], status, stale: true };
  }
  const d = { time: Date.now(), codes: merge(results), status };
  CACHE.write(d);
  return { ...d, stale: false };
}

// Remember when each code was first seen and which ones you've used.
// Returns the codes that are new since the last check.
function updateState(d) {
  const st = STATE.read() || { initialized: false, seen: {}, used: [] };
  const fresh = [];
  for (const c of d.codes) {
    if (c.expired || c.code in st.seen) continue;
    st.seen[c.code] = st.initialized ? d.time : 0;   // codes found on the first run aren't "new"
    if (st.initialized) fresh.push(c);
  }
  if (!d.stale && d.codes.length) st.initialized = true;
  STATE.write(st);
  return { st, fresh };
}

function decorate(d, st) {
  const used = new Set(st.used || []);
  const cutoff = Date.now() - NEW_DAYS * 86400000;
  const all = d.codes.map((c) => ({ ...c, used: used.has(c.code), isNew: (st.seen[c.code] || 0) > cutoff }));
  const order = (a, b) => (b.isNew - a.isNew) || (b.sources.length - a.sources.length) || a.code.localeCompare(b.code);
  return {
    active: all.filter((c) => !c.expired && c.confirmed && !c.used).sort(order),
    unconfirmed: all.filter((c) => !c.expired && !c.confirmed && !c.used).sort(order),
    used: all.filter((c) => !c.expired && c.used).sort(order),
    expired: all.filter((c) => c.expired).sort(order),
  };
}

// ------------------------------------------------------------- widget ----

const C = {
  bg: Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E")),
  text: Color.dynamic(new Color("#111111"), new Color("#F2F2F7")),
  muted: Color.dynamic(new Color("#6B6B70"), new Color("#9A9AA0")),
  accent: new Color("#7B4FD6"),
  newc: new Color("#1F9D55"),
};

function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function addText(stack, s, size, color, font) {
  const t = stack.addText(s);
  t.font = font === "mono" ? Font.boldMonospacedSystemFont(size) : font === "bold" ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.text;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

const copyURL = (code) => URLScheme.forRunningScript() + "?copy=" + encodeURIComponent(code);

function buildWidget(d, groups, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
  w.setPadding(14, 14, 14, 14);
  const small = family === "small";
  const max = { small: 3, medium: 4, large: 10, extraLarge: 10 }[family] || 4;
  const list = groups.active.concat(groups.unconfirmed).slice(0, max);
  const nNew = groups.active.filter((c) => c.isNew).length;

  const head = w.addStack();
  head.centerAlignContent();
  addText(head, small ? "WoR codes" : "Watcher of Realms codes", small ? 13 : 15, C.accent, "bold");
  head.addSpacer();
  if (!small) addText(head, (d.stale ? "offline · " : "") + hhmm(d.time), 10, C.muted);
  w.addSpacer(2);
  addText(w, `${groups.active.length} active` + (nNew ? ` · ${nNew} new` : "") +
             (groups.unconfirmed.length && !small ? ` · ${groups.unconfirmed.length} unconfirmed` : ""), 11, C.muted);
  w.addSpacer(small ? 6 : 8);

  if (!list.length) {
    const t = addText(w, groups.used.length ? "You've used all the codes found. 🎉" : "No active codes found right now.", 12, C.muted);
    t.lineLimit = 3;
  }
  for (const c of list) {
    const row = w.addStack();
    row.centerAlignContent();
    if (!small) row.url = copyURL(c.code);
    addText(row, c.code, small ? 12 : 14, c.confirmed ? C.text : C.muted, "mono");
    if (c.isNew) { row.addSpacer(5); addText(row, "NEW", 9, C.newc, "bold"); }
    if (!c.confirmed && !small) { row.addSpacer(5); addText(row, "Reddit", 9, C.muted); }
    row.addSpacer();
    if (!small && c.reward) addText(row, c.reward, 11, C.muted);
    w.addSpacer(small ? 3 : 5);
  }

  w.addSpacer();
  addText(w, small ? (d.stale ? "offline · " : "") + hhmm(d.time) : "Tap a code to copy it", 10, C.muted);
  return w;
}

// ---------------------------------------------------- full view (app) ----

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function codeCard(c, kind) {
  const tags = (c.isNew ? "<span class='tag new'>NEW</span>" : "") +
    (kind === "unconfirmed" ? "<span class='tag'>unconfirmed</span>" : "");
  const from = c.link
    ? `${esc(c.sources.join(", "))} · <a href='${esc(c.link)}'>see post</a>`
    : esc((kind === "expired" ? c.expiredBy : c.sources).join(", "));
  const buttons = kind === "expired" ? "" :
    `<button onclick="go('copy',this)">Copy</button>` +
    `<button class='ghost' onclick="go('used',this)">${kind === "used" ? "Not used" : "Mark used"}</button>`;
  return `<div class='code ${kind}' data-code='${esc(c.code)}'>
    <div class='main'><div class='c'>${esc(c.code)} ${tags}</div>
      ${c.reward ? `<div class='reward'>${esc(c.reward)}</div>` : ""}
      <div class='from'>${kind === "expired" ? "Listed as expired by " : "Found on "}${from}</div></div>
    <div class='btns'>${buttons}</div></div>`;
}

function section(title, list, kind, note) {
  if (!list.length) return "";
  return `<h2>${title} <span class='n'>${list.length}</span></h2>${note ? `<p class='note'>${note}</p>` : ""}
    ${list.map((c) => codeCard(c, kind)).join("")}`;
}

function buildHTML(d, g, copied) {
  const status = d.status.map((s) =>
    `<li><span class='${s.ok ? "ok" : "bad"}'>${s.ok ? "✓" : "✗"}</span> <a href='${esc(s.url)}'>${esc(s.name)}</a> — ` +
    (s.ok ? `${s.count} code${s.count === 1 ? "" : "s"} found` : `couldn't load (${esc(s.error)})`) + "</li>").join("");
  return `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>
<style>
:root{--bg:#f3f0fa;--card:#fff;--text:#1d1d1f;--muted:#6b6b70;--line:#e4def2;--accent:#7b4fd6;--new:#1f9d55}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1f1f22;--text:#f2f2f7;--muted:#9a9aa0;--line:#2e2e33;--accent:#a685f0}}
body{margin:0;background:var(--bg);color:var(--text);font:16px -apple-system,system-ui,sans-serif;padding:20px 16px 40px}
.wrap{max-width:760px;margin:0 auto}h1{font-size:28px;margin:0 0 2px}
h2{font-size:18px;margin:26px 0 10px}.n{color:var(--muted);font-weight:500}
.muted,.note{color:var(--muted)}.note{font-size:14px;margin:-4px 0 10px}
.banner{background:var(--new);color:#fff;border-radius:12px;padding:10px 14px;margin:14px 0;font-weight:600}
.code{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:8px 0}
.main{flex:1;min-width:0}.c{font:700 20px ui-monospace,Menlo,monospace;letter-spacing:.03em;word-break:break-all}
.reward{margin-top:4px}.from{font-size:13px;color:var(--muted);margin-top:4px}.from a{color:inherit}
.tag{font:700 11px -apple-system,system-ui;letter-spacing:0;vertical-align:middle;padding:2px 7px;border-radius:999px;background:var(--line);color:var(--muted)}
.tag.new{background:var(--new);color:#fff}.tag+.tag{margin-left:4px}
.btns{display:flex;flex-direction:column;gap:6px}
button{font:600 15px -apple-system,system-ui;border:0;border-radius:10px;padding:9px 14px;background:var(--accent);color:#fff;min-width:96px}
button.ghost{background:transparent;color:var(--accent);border:1px solid var(--line)}
.used .c,.expired .c{color:var(--muted)}.expired .c{text-decoration:line-through}
.done{opacity:.45}
ul{padding-left:0;list-style:none}li{margin:6px 0;font-size:14px}li a{color:inherit}
.ok{color:var(--new)}.bad{color:#d64545}
footer{margin-top:24px;font-size:13px;color:var(--muted)}
</style></head><body><div class='wrap'>
<h1>Watcher of Realms codes</h1>
<div class='muted'>Checked at ${hhmm(d.time)}${d.stale ? " · couldn't reach any source, showing last saved codes" : ""}</div>
${copied ? `<div class='banner'>Copied ${esc(copied)} — paste it into the game's redeem code box.</div>` : ""}
${section("Active codes", g.active, "active")}
${!g.active.length ? `<p class='muted' style='margin-top:20px'>${g.used.length ? "You've used all the codes found. 🎉" : "No active codes found right now."}</p>` : ""}
${section("Unconfirmed", g.unconfirmed, "unconfirmed", "Only seen on Reddit so far. They may be typos, old or not codes at all.")}
${section("Used", g.used, "used")}
${section("Probably expired", g.expired, "expired")}
<h2>Sources</h2><ul>${status}</ul>
<footer>Codes are collected from the websites above and may be out of date. If a source shows ✗ or 0 codes for a long time, its page may have changed.</footer>
</div>
<script>
function go(action, btn){
  var card = btn.closest('.code'), code = card.getAttribute('data-code');
  if (action === 'copy') { btn.textContent = 'Copied ✓'; setTimeout(function(){ btn.textContent = 'Copy'; }, 1500); }
  else { card.classList.toggle('done'); btn.textContent = card.classList.contains('done') ? 'Undo' : btn.textContent; }
  location.href = action + ':' + encodeURIComponent(code);
}
</script></body></html>`;
}

// ------------------------------------------------------- notification ----

async function notifyNew(fresh) {
  if (!NOTIFY_NEW_CODES || !fresh.length) return;
  const confirmed = fresh.filter((c) => c.confirmed);
  const list = confirmed.length ? confirmed : fresh;
  const n = new Notification();
  n.title = list.length === 1 ? "New Watcher of Realms code" : `${list.length} new Watcher of Realms codes`;
  n.body = list.slice(0, 5).map((c) => c.code + (c.reward ? " — " + c.reward : "") + (c.confirmed ? "" : " (unconfirmed)")).join("\n") +
           "\nTap to copy" + (list.length === 1 ? " it." : " the first one.");
  n.openURL = copyURL(list[0].code);
  await n.schedule();
}

// ----------------------------------------------------------------- run ----

function toggleUsed(code) {
  const st = STATE.read() || { initialized: false, seen: {}, used: [] };
  const used = new Set(st.used || []);
  used.has(code) ? used.delete(code) : used.add(code);
  st.used = [...used];
  STATE.write(st);
}

async function main() {
  const d = await getData();
  const { st, fresh } = updateState(d);
  const g = decorate(d, st);
  if (config.runsInWidget) {
    Script.setWidget(buildWidget(d, g, config.widgetFamily));
    await notifyNew(fresh);
  } else {
    const copied = args.queryParameters && args.queryParameters.copy;
    if (copied) Pasteboard.copy(copied);
    const wv = new WebView();
    wv.shouldAllowRequest = (req) => {
      const m = /^(copy|used):(.+)$/.exec(req.url);
      if (m) {
        const code = decodeURIComponent(m[2]);
        if (m[1] === "copy") Pasteboard.copy(code); else toggleUsed(code);
        return false;
      }
      if (/^https?:/i.test(req.url)) { Safari.open(req.url); return false; }
      return true;
    };
    await wv.loadHTML(buildHTML(d, g, copied));
    await wv.present(true);
  }
  Script.complete();
}

// ---- RUN ----
await main();
