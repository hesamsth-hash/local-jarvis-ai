# JARVIS as an Android App

Same JARVIS — voice (Kokoro + Whisper), keyless/local LLM brains, memory,
web tools, plugins — packaged as a real Android **`.apk`** you install like
any app. You never need Android Studio, the NDK, or Rust locally: a GitHub
Actions workflow (`.github/workflows/android-build.yml`) builds it for you on
every push.

---

## Get the APK in 3 steps

1. Open the repo's **Actions** tab → wait for the **"Build Android APK"**
   workflow to go green (~15–30 min the first time).
2. Open the run → **Artifacts** → download **`JARVIS-Android-APK`** and unzip it.
3. Copy `app-aarch64-release.apk` to your phone and tap it.

**First install:** Android will warn about unknown apps — allow
*"Install unknown apps"* for your browser/file manager when prompted
(normal for self-built, un-Play-Store APKs).

**First launch:** JARVIS downloads the voice models (~40 MB) once, then
works offline. Grant microphone permission when asked (voice input), and
notification permission (reminders).

### Rooted phone? Unlock the full Mark-III mode

On a rooted device (KernelSU / Magisk), open your root manager → grant
**superuser** access to **JARVIS Local Console**. That single grant unlocks:

- **See & Act** — JARVIS screenshots the real screen (`screencap`), finds
  what you describe with the vision model, and taps/drags/draws on it
- **Computer Control** — `"tap the search bar"`, `"type hello"`,
  `"press back"`, `"scroll down"` — real input injection, any app
- **Open App / Execute** — `"open whatsapp"`, or any shell command with
  output (`su -c`)

No root? Everything else still works; the power tools just explain
themselves instead of failing.

---

## What works on Android — and what can't

| Capability | Android APK (no root) | Android APK (**rooted** — KernelSU/Magisk) | Why |
|---|---|---|---|
| Kokoro TTS + Whisper STT (voice) | ✅ | ✅ | runs in the app's webview |
| Keyless brains (Pollinations…), Ollama/key presets | ✅ | ✅ | same Brain tab |
| Memory + "welcome back / continue" | ✅ | ✅ | same, stored on-device |
| Web search, weather, YouTube, browser open | ✅ | ✅ | links open in your browser |
| Plugins & JARVIS-built tools (`make_tool`) | ✅ | ✅ | sandboxed workers |
| Notifications / reminders | ✅ | ✅ | Android system notifications |
| System Monitor | ✅ | ✅ | real CPU/RAM/uptime stats (sysinfo) |
| File tools (read/write/rename/delete) | ✅* | ✅* | pick a folder via the file picker |
| Open App | ❌ | ✅ **real** — launches any installed app (`monkey`/`am`) | package manager access |
| Execute / shell | ❌ | ✅ **real** — root shell with output (`su -c`) | needs uid 0 |
| See & Act (screenshot + act) | ❌ | ✅ **real** — `screencap` → vision → `input tap/swipe/text` | screen capture of other apps is root-only |
| Computer Control (tap/drag/type/keys) | ❌ | ✅ **real** — `input` injection | same |

Without root, the gated tools reply honestly: JARVIS explains that root is
needed and how to grant it. The Windows build keeps every power regardless.

---

## Signing

CI builds are **debug-signed**: Android auto-generates a key and signs the
APK with it — perfect for side-loading (which is exactly this use case).
The APK installs on any device with "unknown apps" allowed.

Two things to know:
- Installing an update built with a *different* debug key? Uninstall the old
  app first (Android refuses cross-key updates).
- Play Store distribution would need a proper release keystore — generate one
  with `keytool` and follow [Tauri's Android signing guide](
  https://v2.tauri.app/distribute/sign/android/). For personal use, the
  debug-signed APK is all you need.

---

## Building locally (optional)

```bash
# one-time: Android Studio (SDK + NDK) and Rust with android targets
rustup target add aarch64-linux-android
bun install
bun tauri android init
bun tauri android build --apk --target aarch64
# → src-tauri/gen/android/app/build/outputs/apk/aarch64/release/
```
