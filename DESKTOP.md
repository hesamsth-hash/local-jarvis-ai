# JARVIS as a Windows App

Two ways to run JARVIS on your desktop — pick based on how deep you want to go.

---

## Option 1 — Install as a Windows app (PWA) · ~30 seconds, no tooling

The console is a full PWA: it installs into your **Start menu** with its own
window, taskbar icon, and **works offline** (the UI, Kokoro and Whisper models
are already cached in your browser).

1. Open the console in **Edge** or **Chrome** (Edge gives the most native feel).
2. Look for the **Install app** button — in the landing header, the dashboard
   top bar, or Edge's address bar (the "install" icon on the right side).
3. Click it → confirm. JARVIS now appears in your Start menu like any other app.

Uninstall anytime via right-click on the Start menu entry.

---

## Option 2 — Native Windows `.exe` installer, built automatically (recommended)

You do **not** need Rust on your machine. A GitHub Actions workflow
(`.github/workflows/desktop-build.yml`) builds the real installer for you on
Microsoft's servers every time the code lands on `main`.

### Get the installer in 3 steps

1. **Push this project to a GitHub repo** (e.g. `you/jarvis`).
2. Wait for the **"Build Windows installer"** action to finish (Actions tab,
   ~10–15 min the first time). It runs `bun tauri build` on `windows-latest`.
3. Download from either place:
   - The run's **Artifacts** section → `JARVIS-Windows-Installer`
     (NSIS `.exe` setup + `.msi`), or `JARVIS-Windows-Portable` (single exe)
   - Tagged versions (`v1.0.0` etc.) additionally land in the repo's
     **Releases** page as permanent download links

Then just run the setup exe → JARVIS installs like any Windows program
(Start menu entry, uninstaller included).

### Prefer building locally?

```powershell
# one-time prerequisites: Rust (rustup.rs) + VS Build Tools (C++ workload)
bun add -D @tauri-apps/cli
bun tauri dev    # dev window with hot reload
bun tauri build  # installer → src-tauri/target/release/bundle/
```

### What unlocks in the desktop build

| Capability | Browser / PWA | Desktop (.exe) |
|---|---|---|
| Kokoro TTS, Whisper STT | ✅ | ✅ |
| File tools (list/read/write/rename/delete) | ✅ (pick a folder) | ✅ (pick a folder) |
| Local LLM (Ollama/Kobold/LM Studio) | ✅ | ✅ |
| Web search, weather, YouTube | ✅ | ✅ |
| System Monitor | limited (tab-level) | **real CPU model + load, RAM, GPUs, uptime** |
| Open App | URL schemes only | **launches real programs** |
| Computer Control (mouse/keyboard) | ❌ | **real: move/click/scroll/key/type** |
| Desktop Control (see the screen) | ❌ (webcam/screen-share only) | **real desktop screenshot** |
| Volume / brightness | ❌ | **real media keys** |
| Reminders & notifications | ✅ while tab open | ✅ system notifications |

### How the OS powers work

- `src-tauri/src/lib.rs` — Rust commands (enigo input control, sysinfo stats,
  screenshots desktop capture, launch/open/notify)
- `src/lib/jarvis/desktop-bridge.ts` — typed frontend bridge; auto-detects the
  desktop runtime and falls back to browser behavior otherwise
- The tool registry upgrades Computer Control, Desktop Control, System Monitor,
  Open App and Computer Settings automatically when the bridge is present

### Mark-III parity notes

Like the fatihmakes Mark repositories, JARVIS sees and controls the real
machine in the desktop build: it can move the mouse, click, scroll, press keys,
type text, capture the desktop to an image viewer, report live CPU/RAM/GPU
stats (streamed every 2s via the `desktop-stats` event), launch applications,
and fire OS notifications — all on-device, no cloud involved.
