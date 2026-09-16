# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the JARVIS Python shell (Windows one-file exe).
# Build from desktop-python/:
#   .venv\Scripts\pyinstaller JARVIS.spec
# Output: desktop-python/dist/JARVIS.exe
#
# Prereq: the web UI must be built first (bun run build at the repo root) —
# it gets bundled as dist/ and main.py prefers it at runtime.

import os

block_cipher = None

a = Analysis(
    ["main.py"],
    pathex=[os.path.dirname(os.path.abspath(__file__))],
    binaries=[],
    datas=[("../dist", "dist")],
    # bridge.py imports its extras lazily (__import__ by name), so PyInstaller
    # can't see them — they must be listed here or the exe degrades silently.
    hiddenimports=[
        "bridge",
        "tray",
        "pystray",
        "PIL",
        "psutil",
        "pyautogui",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="JARVIS",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=None,  # optionally: icon="app.ico"
)
