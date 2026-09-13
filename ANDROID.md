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

---

## What works on Android — and what can't

| Capability | Android APK | Why |
|---|---|---|
| Kokoro TTS + Whisper STT (voice) | ✅ | runs in the app's webview |
| Keyless brains (Pollinations…), Ollama/key presets | ✅ | same Brain tab |
| Memory + "welcome back / continue" | ✅ | same, stored on-device |
| Web search, weather, YouTube, browser open | ✅ | links open in your browser |
| Plugins & JARVIS-built tools (`make_tool`) | ✅ | sandboxed workers |
| Notifications / reminders | ✅ | Android system notifications |
| System Monitor | ✅ | real CPU/RAM/uptime stats (sysinfo) |
| File tools (read/write/rename/delete) | ✅* | pick a folder via the file picker |
| Computer Control (mouse/keyboard) | ❌ | Android never lets one app click another |
| See & Act / desktop screenshot | ❌ | same reason — screen capture of other apps is blocked |
| Open App / Execute programs | ❌ (yet) | needs an Android "intent" layer — ask and it'll be added |

The ❌ tools reply honestly instead of failing: JARVIS explains Android's
restriction and offers what it *can* do. The Windows build keeps every power.

---

## Signing (only matters if you reinstall updates)

Each build signs the APK with the repo secret **`ANDROID_KEYSTORE_BASE64`**
if you set one (base64 of your `.keystore`). Without it, a temporary key is
used — fine for testing, but Android will refuse to **update** an installed
app with an APK signed by a different key (uninstall first, or set up a
stable keystore):

```bash
keytool -genkeypair -v -keystore jarvis.keystore -alias jarvis \
  -keyalg RSA -keysize 2048 -validity 36500 -storepass YOURPASS
base64 -w0 jarvis.keystore   # paste as ANDROID_KEYSTORE_BASE64 secret
```

Optional repo secrets: `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PRIVATE_PASSWORD`.

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
