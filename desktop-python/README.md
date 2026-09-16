# JARVIS — Python Shell (pywebview)

A pure-Python desktop wrapper for the **existing** JARVIS console: one small
Python process opens the web UI in a native window — no Tauri, no browser tab,
no second app to maintain.

**Isolation guarantee:** this folder never imports or modifies anything under
`src/`. If the shell is cancelled at any point, the web/PWA app and the future
sidecar plan are exactly where they were.

## Run it

```bash
# 1) one-time setup
cd desktop-python
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

# 2) production UI (built app in a native window)
cd ..
bun run build          # creates dist/
cd desktop-python
.venv\Scripts\python main.py

# 2b) development UI (hot reload)
# terminal A: bun run dev
# terminal B: cd desktop-python && .venv\Scripts\python main.py --dev
```

No `pywebview` installed? `main.py` falls back to opening the UI in your
default browser — the command never dead-ends.

## Flags

| Flag | What it does |
|---|---|
| `--dev` | load the Vite dev server (`http://localhost:5173`) |
| `--url <url>` | load an arbitrary URL |
| `--check` | environment check without opening a window |

## Status & roadmap

- [x] Native window shell (pywebview, EdgeChromium runtime on Windows)
- [x] Dev + prod modes, browser fallback, `--check`
- [x] **Native bridge (`bridge.py`)** — Python equivalent of the Tauri command
      set, exposed via `window.pywebview.api`:
      - `execute_command` (shell with output), `launch_app`, `open_url`
      - `system_info` via psutil (real CPU/RAM/uptime/GPU), `screen_metrics`
      - `desktop_picture` via Pillow (screenshots for Desktop Control / See & Act)
      - `notify` — real Windows toasts (PowerShell), osascript on macOS,
        notify-send on Linux
      - `mouse_*` / `key_press` / `type_text` via pyautogui
      Every method degrades gracefully when an extra is missing — the console
      shows its browser fallback or an honest "pip install X" hint instead of
      failing.
- [x] Console auto-detects the Python backend (Tauri keeps priority; plain
      browser/PWA unaffected)
- [x] **Autostart** — `set_autostart(true/false)` writes the Windows Run key
      (HKCU, no admin needed); registers the exe when frozen, `pythonw main.py`
      when run from source; non-Windows answers honestly
- [x] **System tray** (`tray.py`) — optional pystray icon: Open / Quit.
      Missing pystray+Pillow → simply no tray, shell runs fine
- [x] **Sidecar** (`sidecar.py`) — localhost-only HTTP server:
      faster-whisper STT (`/transcribe`) + optional kokoro-onnx TTS (`/tts`),
      `/health` probe. The console auto-detects it and prefers it for
      transcription, silently falling back to the in-browser Whisper engine
- [x] **One-file `.exe`** — `JARVIS.spec` for PyInstaller, UI bundled, works
      from the frozen exe without a Python install
- [ ] Optional: tray settings menu, sidecar auto-launch from the shell

## Sidecar (better voice recognition)

```bash
.venv\Scripts\pip install faster-whisper
.venv\Scripts\python sidecar.py            # 127.0.0.1:8791, loads on first use
.venv\Scripts\python sidecar.py --model small.en   # more accurate, slower
```

The console probes `http://127.0.0.1:8791/health` (cached 15 s) and sends
mic audio there when present — faster-whisper is noticeably better than the
in-browser Whisper WASM. Sidecar off? Nothing breaks: the built-in engine
takes over silently. Optional TTS: `pip install kokoro-onnx onnxruntime` and
place `kokoro-v1.0.onnx` + `voices-v1.0.bin` next to `sidecar.py`.

## Bridge extras

```bash
.venv\Scripts\pip install psutil Pillow pyautogui
```

| Extra | Unlocks |
|---|---|
| psutil | System Monitor with real CPU/RAM/uptime + GPU names |
| Pillow | Desktop screenshots → Desktop Control tool, See & Act vision |
| pyautogui | Computer Control (move/click/scroll/type) + See & Act actions |

## Build a one-file .exe (Windows)

```bash
.venv\Scripts\pip install pyinstaller
bun run build
.venv\Scripts\pyinstaller JARVIS.spec
# → desktop-python\dist\JARVIS.exe  (UI bundled, no Python needed on target)
```

## Cancel-anytime story

- The web app (`src/`) is untouched — PWA and Android build keep working. The
  only `src/` change is additive: `desktop-bridge.ts` now *also* checks for the
  Python backend (after Tauri), which is inert everywhere else.
- Delete `desktop-python/` and you're back to the pure web app with zero residue.
- New tools keep landing in BOTH builds automatically — they call the same
  `desktop-bridge.ts` functions, which now route to Tauri OR the Python shell.
