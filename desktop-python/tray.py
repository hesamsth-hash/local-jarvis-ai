#!/usr/bin/env python3
"""JARVIS optional system-tray icon (pystray + Pillow).

Runs the tray icon in a background thread and returns a handle with a
``stop()`` method — so it is fully optional: if pystray or Pillow is missing,
``start_tray()`` returns None and the shell simply runs without a tray.
"""

from __future__ import annotations

import sys
import threading
import time
import webbrowser
from typing import Any


def _optional(module: str):
    try:
        return __import__(module)
    except Exception:
        return None


def start_tray(on_open=None, on_quit=None) -> Any:
    """Start the tray icon; returns a handle with .stop(), or None when the
    optional deps aren't installed (honest degradation, never a crash)."""
    pystray = _optional("pystray")
    pil = _optional("PIL")
    if pystray is None or pil is None:
        return None

    from PIL import Image, ImageDraw  # type: ignore

    def default_icon():
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((8, 8, 56, 56), fill=(14, 165, 233, 255))
        d.ellipse((22, 22, 42, 42), fill=(207, 250, 254, 255))
        return img

    try:
        menu = pystray.Menu(
            pystray.MenuItem("Open JARVIS", lambda: (on_open or (lambda: None))(), default=True),
            pystray.MenuItem("JARVIS website", lambda: webbrowser.open("https://github.com/")),
            pystray.MenuItem("Quit", lambda: (on_quit or (lambda: None))()),
        )
        icon = pystray.Icon("JARVIS", default_icon(), "JARVIS — Local Voice Console", menu)
        t = threading.Thread(target=icon.run, daemon=True)
        t.start()
        return type("TrayHandle", (), {"stop": icon.stop})()
    except Exception:
        return None


if __name__ == "__main__":  # manual test: python tray.py
    h = start_tray(on_open=lambda: print("open"), on_quit=lambda: sys.exit(0))
    print("tray running" if h else "pystray/Pillow missing — no tray (OK)")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
