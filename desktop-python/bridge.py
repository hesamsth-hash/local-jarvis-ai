#!/usr/bin/env python3
"""JARVIS native bridge — the Python equivalent of the Tauri command set.

Exposed to the web console through pywebview's js_api: methods are called
from JavaScript as ``window.pywebview.api.<method>(...)`` and return
JSON-serializable values (dicts / strings / None).

Design rules, mirroring the Rust bridge:
  * every method degrades gracefully — a missing optional dependency
    returns None or an honest message, never a crash;
  * shapes match the TypeScript DesktopSystemInfo / {ok, message} contract
    in src/lib/jarvis/desktop-bridge.ts, so the console can use either
    backend without knowing the difference.

Optional extras (see requirements.txt):
  psutil    -> real CPU/RAM system info
  Pillow    -> desktop screenshots (See & Act / Desktop Control)
  pyautogui -> mouse + keyboard control
"""

from __future__ import annotations

import base64
import ctypes
import io
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from typing import Any

IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
OUTPUT_CAP = 8000
COMMAND_TIMEOUT = 30


def _optional(module: str):
    """Import an optional dependency, or None when it isn't installed."""
    try:
        return __import__(module)
    except Exception:
        return None


class JARVISApi:
    """The object exposed to JavaScript as window.pywebview.api."""

    # ---------- identity ----------

    def ping(self) -> dict[str, Any]:
        return {"ok": True, "bridge": "python", "platform": sys.platform}

    # ---------- shell ----------

    def execute_command(self, command: str, args: list[str] | None = None) -> dict[str, Any]:
        """Run a program (no shell interpolation) and capture its output."""
        argv = [command, *(args or [])]
        try:
            proc = subprocess.run(  # noqa: S603 — parity with the Tauri bridge; UI gates dangerous calls
                argv,
                capture_output=True,
                text=True,
                timeout=COMMAND_TIMEOUT,
                shell=False,
            )
        except FileNotFoundError:
            return {"ok": False, "message": f"Couldn't run '{command}' — is it on PATH?"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "message": f"'{command}' timed out after {COMMAND_TIMEOUT}s."}
        except OSError as exc:
            return {"ok": False, "message": f"Execute failed: {exc}"}
        out = ((proc.stdout or "") + (proc.stderr or "")).strip()
        out = out[-OUTPUT_CAP:]
        if not out:
            out = f"{command} finished (exit {proc.returncode})."
        return {"ok": proc.returncode == 0, "message": out}

    KNOWN_APPS = {
        "notepad": "notepad",
        "calculator": "calc",
        "calc": "calc",
        "paint": "mspaint",
        "mspaint": "mspaint",
        "cmd": "cmd",
        "terminal": "wt",
        "powershell": "powershell",
        "explorer": "explorer",
        "task manager": "taskmgr",
        "taskmgr": "taskmgr",
        "vscode": "code",
        "visual studio code": "code",
        "code": "code",
        "spotify": "spotify",
        "steam": "steam",
        "discord": "discord",
    }

    def launch_app(self, name: str) -> dict[str, Any]:
        target = self.KNOWN_APPS.get(name.strip().lower())
        try:
            if target and shutil.which(target):
                subprocess.Popen([target])
                return {"ok": True, "message": f"Launched {name}."}
            if IS_WINDOWS and hasattr(os, "startfile"):
                os.startfile(name)  # type: ignore[attr-defined]  # resolves paths, .lnk, URLs
                return {"ok": True, "message": f"Opened {name}."}
            if shutil.which(name):
                subprocess.Popen([name])
                return {"ok": True, "message": f"Launched {name}."}
            return {"ok": False, "message": f"Couldn't find an app called '{name}'."}
        except Exception as exc:
            return {"ok": False, "message": f"Launch failed: {exc}"}

    def open_url(self, url: str) -> dict[str, Any]:
        ok = webbrowser.open(url)
        return {"ok": ok, "message": f"Opened {url}." if ok else "Couldn't open a browser."}

    # ---------- system info ----------

    def system_info(self) -> dict[str, Any] | None:
        """Full DesktopSystemInfo with psutil; None without it (the console
        falls back to its own browser-level readout)."""
        psutil = _optional("psutil")
        if psutil is None:
            return None
        try:
            vm = psutil.virtual_memory()
            uptime = max(0, int(time.time() - psutil.boot_time()))
            gpus: list[str] = []
            if IS_WINDOWS:
                gpus = self._windows_gpus()
            return {
                "os_name": platform.system(),
                "os_version": platform.release(),
                "hostname": socket.gethostname(),
                "cpu_brand": platform.processor() or platform.machine(),
                "cpu_cores": psutil.cpu_count(logical=True) or 0,
                "cpu_usage_percent": psutil.cpu_percent(interval=0.2),
                "total_memory_gb": round(vm.total / 1e9, 2),
                "used_memory_gb": round((vm.total - vm.available) / 1e9, 2),
                "gpus": gpus,
                "uptime_secs": uptime,
            }
        except Exception:
            return None

    @staticmethod
    def _windows_gpus() -> list[str]:
        try:
            out = subprocess.run(
                ["wmic", "path", "win32_VideoController", "get", "name"],
                capture_output=True, text=True, timeout=5,
            )
            names = [ln.strip() for ln in (out.stdout or "").splitlines()[1:] if ln.strip()]
            return names[:4]
        except Exception:
            return []

    def screen_metrics(self) -> dict[str, int] | None:
        try:
            if IS_WINDOWS:
                user32 = ctypes.windll.user32  # type: ignore[attr-defined]
                user32.SetProcessDPIAware()
                return {
                    "width": int(user32.GetSystemMetrics(0)),
                    "height": int(user32.GetSystemMetrics(1)),
                }
            pil = _optional("PIL")
            if pil is not None:
                from PIL import ImageGrab  # type: ignore

                box = ImageGrab.grab().size
                return {"width": int(box[0]), "height": int(box[1])}
        except Exception:
            pass
        return None

    # ---------- capture ----------

    def desktop_picture(self) -> dict[str, Any] | None:
        if _optional("PIL") is None:
            return None
        try:
            from PIL import ImageGrab  # type: ignore

            shot = ImageGrab.grab()
            buf = io.BytesIO()
            shot.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return {
                "data_uri": f"data:image/png;base64,{b64}",
                "width": shot.width,
                "height": shot.height,
            }
        except Exception:
            return None

    # ---------- notifications ----------

    def notify(self, title: str, body: str) -> bool:
        try:
            if IS_WINDOWS:
                return self._windows_toast(title, body)
            if IS_MAC:
                script = f'display notification "{body}" with title "{title}"'
                subprocess.run(["osascript", "-e", script], timeout=5)
                return True
            if shutil.which("notify-send"):
                subprocess.run(["notify-send", title, body], timeout=5)
                return True
        except Exception:
            pass
        print(f"[jarvis notify] {title}: {body}")
        return False

    @staticmethod
    def _windows_toast(title: str, body: str) -> bool:
        esc = lambda s: s.replace("'", "''")  # noqa: E731
        ps = (
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications,"
            " ContentType = WindowsRuntime] | Out-Null;"
            "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
            "[Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
            "$n=$t.GetElementsByTagName('text');"
            f"$n.Item(0).AppendChild($t.CreateTextNode('{esc(title)}'))|Out-Null;"
            f"$n.Item(1).AppendChild($t.CreateTextNode('{esc(body)}'))|Out-Null;"
            "$toast=[Windows.UI.Notifications.ToastNotification]::new($t);"
            "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
            "'JARVIS.Local.Console').Show($toast)"
        )
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                capture_output=True, text=True, timeout=12,
            )
            return r.returncode == 0
        except Exception:
            return False

    # ---------- input (pyautogui extras) ----------

    KEYMAP = {
        "enter": "enter", "return": "enter", "tab": "tab", "escape": "esc", "esc": "esc",
        "space": "space", "backspace": "backspace", "delete": "del", "del": "del",
        "up": "up", "down": "down", "left": "left", "right": "right",
        "home": "home", "end": "end", "pageup": "pageup", "pagedown": "pagedown",
        "insert": "insert", "capslock": "capslock",
    }
    # Not supported by pyautogui — reported honestly instead of failing silently.
    UNSUPPORTED_KEYS = {
        "volumemute", "volumeup", "volumedown",
        "medianext", "mediaprev", "mediaplaypause",
    }

    @staticmethod
    def _pyautogui():
        ag = _optional("pyautogui")
        if ag is not None:
            ag.FAILSAFE = False
        return ag

    def mouse_move(self, x: int, y: int, relative: bool = False) -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Mouse control needs the Python extra: pip install pyautogui"
        try:
            if relative:
                ag.moveRel(int(x), int(y), duration=0.15)
            else:
                ag.moveTo(int(x), int(y), duration=0.15)
            return f"Mouse at {ag.position().x}, {ag.position().y}."
        except Exception as exc:
            return f"Mouse move failed: {exc}"

    def mouse_click(self, button: str = "left", kind: str = "click") -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Mouse control needs the Python extra: pip install pyautogui"
        try:
            ag.click(button=button if button in ("left", "right", "middle") else "left")
            return f"{button.capitalize()} click sent."
        except Exception as exc:
            return f"Click failed: {exc}"

    def mouse_double_click(self) -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Mouse control needs the Python extra: pip install pyautogui"
        try:
            ag.doubleClick()
            return "Double-click sent."
        except Exception as exc:
            return f"Double-click failed: {exc}"

    def mouse_scroll(self, amount: int) -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Scroll control needs the Python extra: pip install pyautogui"
        try:
            ag.scroll(int(amount))
            return f"Scrolled {amount}."
        except Exception as exc:
            return f"Scroll failed: {exc}"

    def mouse_drag(self, from_x: int, from_y: int, to_x: int, to_y: int, steps: int | None = None) -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Mouse control needs the Python extra: pip install pyautogui"
        try:
            ag.moveTo(int(from_x), int(from_y), duration=0.1)
            ag.dragRel(int(to_x) - int(from_x), int(to_y) - int(from_y), duration=0.4)
            return f"Dragged ({from_x},{from_y}) → ({to_x},{to_y})."
        except Exception as exc:
            return f"Drag failed: {exc}"

    def mouse_draw(self, points: list[list[int]]) -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Drawing needs the Python extra: pip install pyautogui"
        try:
            first = points[0]
            ag.moveTo(int(first[0]), int(first[1]), duration=0.1)
            ag.mouseDown()
            for p in points[1:]:
                ag.moveTo(int(p[0]), int(p[1]), duration=0.02)
            ag.mouseUp()
            return f"Drew the stroke ({len(points)} points)."
        except Exception as exc:
            try:
                ag.mouseUp()
            except Exception:
                pass
            return f"Draw failed: {exc}"

    def key_press(self, key: str) -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Keyboard control needs the Python extra: pip install pyautogui"
        k = (key or "").strip().lower()
        if k in self.UNSUPPORTED_KEYS:
            return "Media/volume keys aren't supported by the Python bridge — use the Tauri desktop build for those."
        try:
            if len(k) == 1:
                ag.press(k)
            else:
                ag.press(self.KEYMAP.get(k, k))
            return f"Pressed {key}."
        except Exception as exc:
            return f"Key press failed: {exc}"

    def type_text(self, text: str) -> str | None:
        ag = self._pyautogui()
        if ag is None:
            return "Text injection needs the Python extra: pip install pyautogui"
        try:
            ag.write(text, interval=0.01)
            return "Text typed."
        except Exception as exc:
            return f"Typing failed: {exc}"
