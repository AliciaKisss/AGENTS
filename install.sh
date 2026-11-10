#!/bin/bash
# Set up (or remove) all agents on this Mac.
#
#   ./install.sh              install / update everything
#   ./install.sh --uninstall  stop and remove all schedules (keeps the files)
#
# Safe to run more than once: it replaces existing schedules.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
LA="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
AGENTS=(gold-price stock-watch report-reminder screenshot-cleaner)

label() { echo "com.essen.$1"; }

unload() {
  launchctl bootout "gui/$UID_NUM/$(label "$1")" 2>/dev/null || true
  rm -f "$LA/$(label "$1").plist"
}

if [[ "${1:-}" == "--uninstall" ]]; then
  for a in "${AGENTS[@]}"; do unload "$a"; echo "removed schedule: $a"; done
  rm -rf "$HOME/Applications/Gold Watch.app" "$HOME/Applications/ETF Watch.app"
  echo "removed apps: Gold Watch, ETF Watch"
  echo
  echo "Schedules removed. Screenshots still save to ~/Screenshots; to switch back:"
  echo "  defaults write com.apple.screencapture location ~/Desktop && killall SystemUIServer"
  exit 0
fi

# --- Python -----------------------------------------------------------------
PY=""
for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [[ -x "$p" ]] && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then
    PY="$p"; break
  fi
done
if [[ -z "$PY" ]]; then
  echo "Python 3.9+ not found. Install it with:  brew install python   (or: xcode-select --install)"
  exit 1
fi
echo "Using Python: $PY"

mkdir -p "$LA"

write_plist() {  # name, script, schedule-xml
  local name="$1" script="$2" schedule="$3"
  unload "$name"
  cat > "$LA/$(label "$name").plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(label "$name")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$DIR/$name/$script</string>
  </array>
$schedule
  <key>StandardErrorPath</key><string>$DIR/$name/error.log</string>
</dict>
</plist>
EOF
  launchctl bootstrap "gui/$UID_NUM" "$LA/$(label "$name").plist"
  echo "scheduled: $name"
}

# --- Gold & silver prices: every day 9:00 AM ---------------------------------
write_plist gold-price gold.py '  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>'

# --- ETF watch (FWRA, IGLN, VUAA, VWRA): every day 9:05 AM ------------------
write_plist stock-watch stocks.py '  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>5</integer></dict>'

# --- Report reminder: Mondays 00:01, 1st of month 00:01, and at login -------
# Mark the current week/month as done on a fresh install so it doesn't pop up now.
[[ -f "$DIR/report-reminder/state.json" ]] || "$PY" "$DIR/report-reminder/remind.py" --seed
write_plist report-reminder remind.py '  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>0</integer><key>Minute</key><integer>1</integer></dict>
    <dict><key>Day</key><integer>1</integer><key>Hour</key><integer>0</integer><key>Minute</key><integer>1</integer></dict>
  </array>
  <key>RunAtLoad</key><true/>'

# --- Screenshot cleaner: every hour and at login ----------------------------
mkdir -p "$HOME/Screenshots"
defaults write com.apple.screencapture location "$HOME/Screenshots"
killall SystemUIServer 2>/dev/null || true
echo "screenshots now save to: $HOME/Screenshots"
write_plist screenshot-cleaner clean.py '  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>'

# --- Clickable apps for checking any time (Spotlight / Dock) ----------------
APPS="$HOME/Applications"
mkdir -p "$APPS"
make_app() {  # app name, command to run
  rm -rf "$APPS/$1.app"
  osacompile -o "$APPS/$1.app" -e "do shell script \"$2 > /dev/null 2>&1 &\""
  echo "app: $APPS/$1.app"
}
make_app "Gold Watch" "'$PY' '$DIR/gold-price/gold.py' --check"
make_app "ETF Watch" "'$PY' '$DIR/stock-watch/stocks.py'"

# --- swiftDialog (nicer pop-ups) ---------------------------------------------
if [[ -x /usr/local/bin/dialog ]]; then
  echo "swiftDialog: installed"
else
  echo
  echo "swiftDialog (nicer pop-ups) is not installed. Agents still work with plain pop-ups."
  if command -v brew >/dev/null && [[ -t 0 ]]; then
    read -r -p "Install it now with Homebrew? It will ask for your Mac password. [y/N] " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then brew install --cask swiftdialog; fi
  else
    echo "To install later:  brew install --cask swiftdialog   (or download from https://swiftdialog.app)"
  fi
fi

echo
echo "All set. Agents live in: $DIR"
