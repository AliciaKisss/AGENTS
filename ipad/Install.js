// Installs or updates Gold Watch and ETF Watch in Scriptable.
// Paste into a new Scriptable script once and run it. Run it again to update.
const REPO = "https://raw.githubusercontent.com/AliciaKisss/AGENTS/";
const BRANCHES = ["main", "claude/awesome-newton-766wr3"];
const SCRIPTS = ["Gold Watch", "ETF Watch"];

const fm = module.filename.includes("Documents/iCloud~") ? FileManager.iCloud() : FileManager.local();
const result = [];
for (const name of SCRIPTS) {
  let code = null;
  for (const branch of BRANCHES) {
    const req = new Request(REPO + branch + "/ipad/" + encodeURIComponent(name) + ".js");
    try {
      const text = await req.loadString();
      if (req.response.statusCode === 200 && text.includes("// ---- RUN ----")) { code = text; break; }
    } catch (e) {}
  }
  if (code) {
    fm.writeString(fm.joinPath(fm.documentsDirectory(), name + ".js"), code);
    result.push("✅ " + name);
  } else {
    result.push("❌ " + name + " — couldn't download");
  }
}
const alert = new Alert();
alert.title = "AGENTS for iPad";
alert.message = result.join("\n") + "\n\nRun this script again any time to update.";
alert.addAction("OK");
await alert.presentAlert();
