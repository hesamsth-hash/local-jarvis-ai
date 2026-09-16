#!/usr/bin/env python3
"""JARVIS — Python shell (pywebview) for Windows.

Wraps the existing JARVIS web console in a native window so the whole
assistant runs as a pure-Python desktop app — no Tauri, no browser tab,
no Node build step required to launch.

Isolation guarantee: this folder does not import, modify or depend on
anything under src/. If the shell is cancelled at any point, the web/PWA
app keeps working exactly as before.

Modes
-----
  python main.py              # production: load the built UI from ../dist
  python main.py --dev        # development: load the Vite dev server URL
  python main.py --url X      # load an arbitrary URL
  python main.py --check      # environment check, no window

If pywebview is not installed, the script falls back to opening the UI in
the default browser so the command never dead-ends.
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.request import urlopen

from bridge import JARVISApi
from tray import start_tray

APP_TITLE = "JARVIS — Local Voice Console"
WINDOW_SIZE = (1280, 860)
MIN_SIZE = (900, 640)
DEV_URL = "http://localhost:5173"
ROOT = Path(__file__).resolve().parent.parent  # project root
DIST_INDEX = ROOT / "dist" / "index.html"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="JARVIS Python shell")
    p.add_argument("--dev", action="store_true", help="load the Vite dev server")
    p.add_argument("--url", default=None, help="load this URL instead of the build")
    p.add_argument("--check", action="store_true", help="environment check, no window")
    return p.parse_args()


def resolve_target(args: argparse.Namespace) -> str | None:
    """Decide what the window loads. Returns None if no UI exists."""
    if args.url:
        return args.url
    if args.dev:
        return DEV_URL
    # Frozen exe (PyInstaller): the UI ships bundled next to the binary as
    # dist/ — resolve relative to the exe, not the source file.
    if getattr(sys, "frozen", False):
        bundled = Path(sys.executable).parent / "dist" / "index.html"
        if bundled.exists():
            return bundled.as_uri()
        data_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        bundled = data_dir / "dist" / "index.html"
        if bundled.exists():
            return bundled.as_uri()
    if DIST_INDEX.exists():
        return DIST_INDEX.as_uri()
    print(
        "[jarvis] no UI found.\n"
        "  - production: run 'bun run build' first (creates dist/), or\n"
        "  - development: python main.py --dev (needs the dev server running)",
        file=sys.stderr,
    )
    return None


def probe(url: str, timeout: float = 2.0) -> bool:
    try:
        with urlopen(url, timeout=timeout):
            return True
    except Exception:
        return False


def open_in_browser(target: str) -> None:
    print(f"[jarvis] pywebview unavailable — opening {target} in your browser.")
    webbrowser.open(target)


def run(args: argparse.Namespace) -> int:
    target = resolve_target(args)
    if target is None:
        return 1

    if args.check:
        try:
            import webview  # noqa: F401
            print("[jarvis] pywebview: OK")
        except ImportError:
            print("[jarvis] pywebview: MISSING (pip install pywebview)")
        print(f"[jarvis] target: {target}")
        print(f"[jarvis] target reachable: {probe(target) if target.startswith('http') else 'file UI'}")
        return 0

    try:
        import webview
    except ImportError:
        open_in_browser(target)
        return 0

    # Quiet EdgeChromium debug noise on Windows console runs.
    if os.name == "nt":
        os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection")

    window = webview.create_window(
        APP_TITLE,
        target,
        width=WINDOW_SIZE[0],
        height=WINDOW_SIZE[1],
        min_size=MIN_SIZE,
        background_color="#050a14",
        js_api=JARVISApi(),
    )

    def on_loaded():
        try:
            # Keep the taskbar/window title consistent with the product.
            window.set_title(APP_TITLE)
        except Exception:
            pass

    tray = start_tray(
        on_open=lambda: None,  # window already opening
        on_quit=lambda: window.destroy(),
    )
    webview.start(func=on_loaded, http_server=True)
    try:
        tray.stop()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
