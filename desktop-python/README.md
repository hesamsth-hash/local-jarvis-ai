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
- [ ] Optional native notify (Windows toast) via pywebview's `evaluate_js` bridge
- [ ] Optional tray icon / autostart
- [ ] Optional sidecar: faster-whisper STT served on localhost for the console

## Cancel-anytime story

- The web app (`src/`) is untouched — PWA and Android build keep working.
- Delete `desktop-python/` and you're back to the pure web app with zero residue.
- The sidecar idea can be added later independently; nothing here depends on it.
