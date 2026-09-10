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

## Option 2 — Native Windows app with real OS powers (Tauri)

The PWA is great, but browsers sandbox OS access. The Tauri build in
`src-tauri/` ships a real `.exe` + installer where the **System Monitor** reads
actual CPU/RAM/GPU/uptime and **Open App** launches real programs (notepad,
calculator, vscode, steam, spotify, discord…).

### Build it on your Windows machine

Prerequisites (one-time):
1. **Rust** — install from <https://rustup.rs>
2. **Visual Studio Build Tools** with "Desktop development with C++"
   <https://visualstudio.microsoft.com/visual-cpp-build-tools/>
3. **Bun** (you likely have it) and **WebView2** (preinstalled on Windows 11)

Then from the project root:

```powershell
# dev mode — window opens with hot reload
bun add -D @tauri-apps/cli
bun tauri dev

# build the installer
bun tauri build
```

The installer appears in `src-tauri/target/release/bundle/`:
- `nsis/JARVIS Local Console_1.0.0_x64-setup.exe` — standard installer
- `msi/JARVIS Local Console_1.0.0_x64_en-US.msi` — MSI package

### What unlocks in the desktop build

| Capability | Browser / PWA | Desktop (.exe) |
|---|---|---|
| Kokoro TTS, Whisper STT | ✅ | ✅ |
| File tools (list/read/write/rename/delete) | ✅ (pick a folder) | ✅ (pick a folder) |
| Local LLM (Ollama/Kobold/LM Studio) | ✅ | ✅ |
| Web search, weather, YouTube | ✅ | ✅ |
| System Monitor | limited (tab-level) | **real CPU/RAM/GPU/uptime** |
| Open App | URL schemes only | **launches real programs** |
| Screen & camera capture | ✅ (with permission bar) | ✅ |
| Reminders & notifications | ✅ while tab open | ✅ while app open |

### Architecture notes

- `src-tauri/src/lib.rs` — Rust commands: `system_info`, `launch_app`,
  `open_url`, `desktop_status` (uses the `sysinfo` + `open` crates)
- `src/lib/jarvis/desktop-bridge.ts` — typed frontend bridge; auto-detects the
  desktop runtime and falls back to browser behavior otherwise
- The tool registry checks `ctx.desktop` and upgrades System Monitor / Open App
  automatically — no code changes needed between targets
- Cross-compiling from Linux/macOS to Windows isn't supported for Tauri;
  run `bun tauri build` on the Windows machine itself
