// Installs or updates the AGENTS iPad scripts in Scriptable.
// Paste into a new Scriptable script once and run it. Run it again to update.
// It finds every script in the repo's ipad/ folder by itself, and keeps
// itself up to date too.
const OWNER_REPO = "AliciaKisss/AGENTS";
const RAW = "https://raw.githubusercontent.com/" + OWNER_REPO + "/main/ipad/";
const FALLBACK = ["Gold Watch", "ETF Watch", "WoR Codes"];   // used if GitHub's file list can't be read

const fm = module.filename.includes("Documents/iCloud~") ? FileManager.iCloud() : FileManager.local();

async function listScripts() {
  try {
    const req = new Request("https://api.github.com/repos/" + OWNER_REPO + "/contents/ipad?ref=main");
    req.headers = { "Accept": "application/vnd.github+json", "User-Agent": "AGENTS-installer" };
    const files = await req.loadJSON();
    const names = files.filter((f) => f.type === "file" && f.name.endsWith(".js") && f.name !== "Install.js")
                       .map((f) => f.name.slice(0, -3));
    if (names.length) return names;
  } catch (e) {}
  return FALLBACK;
}

async function download(file) {
  const req = new Request(RAW + encodeURIComponent(file));
  try {
    const text = await req.loadString();
    if (req.response.statusCode === 200 && text.includes("// ---- RUN ----")) return text;
  } catch (e) {}
  return null;
}

const result = [];
for (const name of await listScripts()) {
  const code = await download(name + ".js");
  if (code) {
    fm.writeString(fm.joinPath(fm.documentsDirectory(), name + ".js"), code);
    result.push("✅ " + name);
  } else {
    result.push("❌ " + name + " — couldn't download");
  }
}

// Update this installer itself.
const self = await download("Install.js");
if (self && self !== fm.readString(module.filename)) {
  fm.writeString(module.filename, self);
  result.push("✅ Installer updated");
}

const alert = new Alert();
alert.title = "AGENTS for iPad";
alert.message = result.join("\n") + "\n\nRun this script again any time to update.";
alert.addAction("OK");
await alert.presentAlert();

// ---- RUN ----
