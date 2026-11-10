#!/usr/bin/env python3
"""Move screenshots older than 3 days from ~/Screenshots to the Trash.

Runs every hour via launchd. Only touches image/video files directly
inside ~/Screenshots (not subfolders). Nothing is permanently deleted;
emptying the Trash is up to you.

  python3 clean.py            # normal run
  python3 clean.py --dry-run  # show what would be moved, move nothing
"""
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

FOLDER = Path.home() / "Screenshots"
TRASH = Path.home() / ".Trash"
MAX_AGE_DAYS = 3
EXTS = {".png", ".jpg", ".jpeg", ".heic", ".tiff", ".tif", ".gif", ".pdf", ".mov", ".mp4"}
LOG = Path(__file__).resolve().parent / "run.log"


def log(msg):
    line = f"[{datetime.now():%Y-%m-%d %H:%M}] {msg}"
    print(line)
    with LOG.open("a") as f:
        f.write(line + "\n")


def trash_path(name):
    dest = TRASH / name
    n = 1
    while dest.exists():
        dest = TRASH / f"{Path(name).stem} ({n}){Path(name).suffix}"
        n += 1
    return dest


def main():
    dry = "--dry-run" in sys.argv
    cutoff = time.time() - MAX_AGE_DAYS * 86400
    moved = 0
    for f in FOLDER.iterdir():
        if not f.is_file() or f.suffix.lower() not in EXTS:
            continue
        st = f.stat()
        created = getattr(st, "st_birthtime", st.st_mtime)
        if created >= cutoff:
            continue
        if dry:
            print(f"would trash: {f.name}")
        else:
            shutil.move(str(f), str(trash_path(f.name)))
        moved += 1
    if moved or dry:
        log(f"{'would move' if dry else 'moved'} {moved} screenshot(s) to Trash")


if __name__ == "__main__":
    main()
