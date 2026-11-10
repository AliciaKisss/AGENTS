#!/usr/bin/env python3
"""Weekly / monthly report reminder.

Scheduled by launchd for Mondays 00:01 and the 1st of each month 00:01,
plus at login. It remembers which week/month it has already reminded you
about (state.json), so if the Mac was asleep or off at 00:01 you still
get the reminder once it wakes / you log in, and never twice.

Display: a swiftDialog pop-up (if installed) with buttons
  "Got it"  ·  "Remind me in 1 hour" (the pop-up comes back an hour later)
Falls back to a plain macOS alert with the same buttons otherwise.
The pop-up stays on screen until you click a button.

  python3 remind.py          # normal run
  python3 remind.py --seed   # mark the current week & month as done (no alert)
  python3 remind.py --test   # show the pop-up now without changing state
"""
import json
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "state.json"
LOG = HERE / "run.log"
DIALOG = Path("/usr/local/bin/dialog")
SNOOZE_SECONDS = 3600


def log(msg):
    with LOG.open("a") as f:
        f.write(f"[{datetime.now():%Y-%m-%d %H:%M}] {msg}\n")


def due_items(today, weekly, monthly):
    """Return [(icon, name, covers)] for the reports that are due."""
    items = []
    if weekly:
        mon = today - timedelta(days=today.weekday())
        last_mon, last_sun = mon - timedelta(days=7), mon - timedelta(days=1)
        items.append(("📝", "Weekly report",
                      f"Last week: {last_mon:%a %d %b} – {last_sun:%a %d %b %Y}"))
    if monthly:
        last_month = today.replace(day=1) - timedelta(days=1)
        items.append(("📊", "Monthly report", f"Last month: {last_month:%B %Y}"))
    return items


def show_swiftdialog(title, items, snoozed):
    rows = "\n\n".join(f"### {icon} {name}\n{covers}" for icon, name, covers in items)
    note = "\n\n_⏰ Snoozed reminder_" if snoozed else ""
    message = f"Time to make your report{'s' if len(items) > 1 else ''}:\n\n{rows}{note}"
    r = subprocess.run([
        str(DIALOG),
        "--title", title,
        "--titlefont", "size=22,weight=bold",
        "--message", message,
        "--messagefont", "size=15",
        "--icon", "SF=doc.text.fill,color=#2F6FDE",
        "--iconsize", "90",
        "--button1text", "Got it",
        "--button2text", "Remind me in 1 hour",
        "--width", "560", "--height", "320" if len(items) == 1 else "400",
        "--moveable", "--ontop",
    ], check=False)
    return "snooze" if r.returncode == 2 else None


def show_plain_alert(title, items, snoozed):
    text = "Time to make your:\n\n" + "\n\n".join(
        f"{icon} {name}\n{covers}" for icon, name, covers in items)
    if snoozed:
        text += "\n\n⏰ Snoozed reminder"
    script = (
        f"set r to display alert {json.dumps(title, ensure_ascii=False)} message "
        f"{json.dumps(text, ensure_ascii=False)} "
        'buttons {"Remind me in 1 hour", "Got it"} default button "Got it"\n'
        "return button returned of r"
    )
    out = subprocess.run(["osascript", "-e", script], capture_output=True, text=True).stdout.strip()
    return "snooze" if out == "Remind me in 1 hour" else None


def remind(title, items):
    """Show the pop-up; if snoozed, wait an hour and show it again."""
    snoozed = False
    for _ in range(24):  # safety limit: at most a day of snoozing
        subprocess.run(["afplay", "/System/Library/Sounds/Glass.aiff"], check=False)
        show = show_swiftdialog if DIALOG.exists() else show_plain_alert
        if show(title, items, snoozed) != "snooze":
            return
        log("snoozed 1 hour")
        snoozed = True
        time.sleep(SNOOZE_SECONDS)


def main():
    today = date.today()
    y, w, _ = today.isocalendar()
    week_key = f"{y}-W{w:02d}"
    month_key = today.strftime("%Y-%m")

    if "--test" in sys.argv:
        remind("Report reminder (test)", due_items(today, True, True))
        return

    state = json.loads(STATE.read_text()) if STATE.exists() else {}

    if "--seed" in sys.argv:
        state.update(week=week_key, month=month_key)
        STATE.write_text(json.dumps(state))
        log(f"seeded {week_key} / {month_key}")
        return

    items = due_items(today, state.get("week") != week_key, state.get("month") != month_key)
    if not items:
        log("nothing due")
        return

    state.update(week=week_key, month=month_key)
    STATE.write_text(json.dumps(state))
    log("reminded: " + "; ".join(name for _, name, _ in items))
    remind("Report reminder", items)


if __name__ == "__main__":
    main()
