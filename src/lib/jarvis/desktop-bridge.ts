// Desktop bridge — talks to the Tauri backend when the console runs as a
// native Windows/Linux/macOS/Android app. In a plain browser it reports
// unavailable and every call degrades gracefully.

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface TauriEvent {
  listen: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
}

function tauri(): { invoke: TauriInvoke; event?: TauriEvent } | null {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke: TauriInvoke; invokeHandshake?: unknown };
    __TAURI__?: { event?: TauriEvent };
  };
  const internals = w.__TAURI_INTERNALS__;
  if (!internals) return null;
  return { invoke: internals.invoke, event: w.__TAURI__?.event };
}

// ---------------- Python shell backend (pywebview) ----------------
// desktop-python/main.py hosts this same console in a native window and
// exposes a Python js_api with the same command surface as the Rust bridge.
// It is detected AFTER Tauri: the APK/desktop exe keep priority, and the
// plain browser/PWA never sees it.

interface PyBridge {
  [method: string]: (...args: unknown[]) => Promise<unknown>;
}

function pywebview(): PyBridge | null {
  const w = window as unknown as { pywebview?: { api?: PyBridge } };
  return w.pywebview?.api ?? null;
}

/** Resolves once the Python shell's js_api is ready (or 2.5s pass). */
function pywebviewReady(): Promise<PyBridge | null> {
  const w = window as unknown as {
    pywebview?: { api?: PyBridge };
  };
  if (w.pywebview?.api) return Promise.resolve(w.pywebview.api);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500);
    window.addEventListener(
      "pywebviewready",
      () => {
        clearTimeout(timer);
        resolve(w.pywebview?.api ?? null);
      },
      { once: true },
    );
  });
}

let pyReadyCache: PyBridge | null | undefined;

async function py(): Promise<PyBridge | null> {
  if (pyReadyCache !== undefined) return pyReadyCache;
  pyReadyCache = (await pywebviewReady()) ?? null;
  return pyReadyCache;
}

/**
 * Run the same call against the Python shell's js_api when it's present.
 * Returns null when there is no Python backend (caller falls back).
 */
async function pyCall<T>(method: string, ...args: unknown[]): Promise<T | null> {
  const api = await py();
  if (!api || typeof api[method] !== "function") return null;
  try {
    return (await api[method](...args)) as T;
  } catch (e) {
    if (e instanceof Error) throw e;
    return null;
  }
}

let androidCache: boolean | null = null;

/** True when running inside the native Android (APK) build. */
export function isAndroid(): boolean {
  if (androidCache !== null) return androidCache;
  androidCache =
    typeof navigator !== "undefined" &&
    /android/i.test(navigator.userAgent) &&
    tauri() !== null;
  return androidCache;
}

export function isDesktop(): boolean {
  // Tauri first (APK / Windows exe); the Python shell counts too once its
  // js_api is up (pywebview sets window.pywebview.api synchronously on ready).
  if (tauri() !== null) return true;
  const w = window as unknown as { pywebview?: { api?: unknown } };
  return w.pywebview?.api != null;
}

/**
 * True when the native backend has root (Android with KernelSU/Magisk root
 * granted to JARVIS). Desktop builds report false. Root unlocks the full
 * See & Act / input / shell powers on Android.
 */
export async function hasRootAccess(): Promise<boolean> {
  const t = tauri();
  if (!t) return false;
  try {
    const r = (await t.invoke("root_status")) as { root: boolean };
    return r.root === true;
  } catch {
    return false;
  }
}

/**
 * Re-check root right before a gated command runs. On Android this shells
 * `su -c id` for a REAL answer (KernelSU/Magisk can revoke or set
 * session-only grants), so a stale "granted" badge can never mask a missing
 * grant. Returns ok=false plus a message the user can act on.
 */
export async function ensureRootForCommand(): Promise<{
  ok: boolean;
  message?: string;
}> {
  const t = tauri();
  if (!t) return { ok: false, message: "This command needs the native app." };
  if (!isAndroid()) return { ok: true }; // desktop build: no root gating
  try {
    const probe = (await t.invoke("execute_command", {
      command: "su",
      args: ["id"],
    })) as { ok: boolean; message: string };
    if (probe.ok) return { ok: true };
    // Grant lapsed (KernelSU "until reboot" / session-only / timed out).
    // Running `su` again is what pops the manager's allow dialog — do it once
    // here so the user can approve in place instead of hunting the Tools tab.
    const retry = await requestRootAccess();
    if (retry.ok) return { ok: true };
    return {
      ok: false,
      message:
        "Root access isn't active right now for JARVIS. Approve it in the KernelSU/Magisk dialog that just appeared (choose “Until reboot” or “Forever”), or open Tools → “Grant root access”, then try again.",
    };
  } catch {
    return {
      ok: false,
      message:
        "Root check failed — is KernelSU or Magisk installed and JARVIS approved? Tools tab → “Grant root access”.",
    };
  }
}

/**
 * Ask the user's root manager (KernelSU / Magisk) to grant JARVIS superuser
 * access. Running `su` is what makes the manager pop its allow dialog — this
 * triggers exactly that, then reports whether it was approved. Works only in
 * the Android app on a rooted device.
 */
export async function requestRootAccess(): Promise<{
  ok: boolean;
  message: string;
}> {
  const t = tauri();
  if (!t) return { ok: false, message: "Root access only applies inside the Android app." };
  try {
    const r = (await t.invoke("execute_command", {
      command: "su",
      args: ["id"],
    })) as { ok: boolean; message: string };
    return r;
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Root request failed.",
    };
  }
}

export interface DesktopSystemInfo {
  os_name: string;
  os_version: string;
  hostname: string;
  cpu_brand: string;
  cpu_cores: number;
  cpu_usage_percent: number;
  total_memory_gb: number;
  used_memory_gb: number;
  gpus: string[];
  uptime_secs: number;
}

export async function desktopSystemInfo(): Promise<DesktopSystemInfo | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("system_info")) as DesktopSystemInfo;
    } catch {
      return null;
    }
  }
  // Python shell: psutil-backed readout (None without the extra — the caller
  // then shows its own browser-level stats).
  return pyCall<DesktopSystemInfo>("system_info");
}

// ---------------- input ----------------

export async function desktopMouseMove(
  x: number,
  y: number,
  relative = false,
): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("mouse_move", { x, y, relative })) as string;
    } catch (e) {
      return e instanceof Error ? `Mouse move failed: ${e.message}` : "Mouse move failed.";
    }
  }
  return pyCall<string>("mouse_move", x, y, relative);
}

export async function desktopMouseClick(
  button: "left" | "right" | "middle" = "left",
  kind: "click" | "down" | "up" = "click",
): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("mouse_click", { button, kind })) as string;
    } catch (e) {
      return e instanceof Error ? `Click failed: ${e.message}` : "Click failed.";
    }
  }
  return pyCall<string>("mouse_click", button, kind);
}

export async function desktopMouseDoubleClick(): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("mouse_double_click")) as string;
    } catch (e) {
      return e instanceof Error ? `Double-click failed: ${e.message}` : "Double-click failed.";
    }
  }
  return pyCall<string>("mouse_double_click");
}

export async function desktopMouseScroll(amount: number): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("mouse_scroll", { amount })) as string;
    } catch (e) {
      return e instanceof Error ? `Scroll failed: ${e.message}` : "Scroll failed.";
    }
  }
  return pyCall<string>("mouse_scroll", amount);
}

export async function desktopMouseDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps?: number,
): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("mouse_drag", { fromX, fromY, toX, toY, steps })) as string;
    } catch (e) {
      return e instanceof Error ? `Drag failed: ${e.message}` : "Drag failed.";
    }
  }
  return pyCall<string>("mouse_drag", fromX, fromY, toX, toY, steps);
}

export async function desktopMouseDraw(
  points: { x: number; y: number }[],
): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("mouse_draw", {
        points: points.map((p) => [p.x, p.y]),
      })) as string;
    } catch (e) {
      return e instanceof Error ? `Draw failed: ${e.message}` : "Draw failed.";
    }
  }
  return pyCall<string>("mouse_draw", points.map((p) => [p.x, p.y]));
}

export async function desktopKeyPress(key: string): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("key_press", { key })) as string;
    } catch (e) {
      return e instanceof Error ? `Key failed: ${e.message}` : "Key failed.";
    }
  }
  return pyCall<string>("key_press", key);
}

export async function desktopTypeText(text: string): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("type_text", { text })) as string;
    } catch (e) {
      return e instanceof Error ? `Typing failed: ${e.message}` : "Typing failed.";
    }
  }
  return pyCall<string>("type_text", text);
}

// ---------------- capture ----------------

export interface DesktopScreenshot {
  data_uri: string;
  width: number;
  height: number;
}

export async function desktopPicture(): Promise<DesktopScreenshot | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("desktop_picture")) as DesktopScreenshot;
    } catch {
      return null;
    }
  }
  return pyCall<DesktopScreenshot>("desktop_picture");
}

/** Display size in the same coordinate space the mouse commands use. */
export interface DesktopScreenMetrics {
  width: number;
  height: number;
}

export async function desktopScreenMetrics(): Promise<DesktopScreenMetrics | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("screen_metrics")) as DesktopScreenMetrics;
    } catch {
      return null;
    }
  }
  return pyCall<DesktopScreenMetrics>("screen_metrics");
}

// ---------------- apps / urls / notifications ----------------

export async function desktopLaunchApp(name: string): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      const res = (await t.invoke("launch_app", { name })) as {
        ok: boolean;
        message: string;
      };
      return res.message;
    } catch {
      return null;
    }
  }
  const r = await pyCall<{ ok: boolean; message: string }>("launch_app", name);
  return r ? r.message : null;
}

/**
 * Launch ANY program, script, document or folder by name/path — goes through
 * the native shell, so PATH apps, .lnk targets and files resolve too.
 */
export async function desktopExecute(
  command: string,
  args: string[] = [],
): Promise<string | null> {
  const r = await desktopExecuteRaw(command, args);
  return r?.message ?? (r ? "Done (no output)." : null);
}

/** Raw execute_command result — keeps the ok flag (needed for the FS backend). */
export async function desktopExecuteRaw(
  command: string,
  args: string[] = [],
): Promise<{ ok: boolean; message: string } | null> {
  const t = tauri();
  if (t) {
    try {
      return (await t.invoke("execute_command", { command, args })) as {
        ok: boolean;
        message: string;
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Execute failed.",
      };
    }
  }
  return pyCall<{ ok: boolean; message: string }>("execute_command", command, args);
}

export async function desktopOpenUrl(url: string): Promise<string | null> {
  const t = tauri();
  if (t) {
    try {
      const res = (await t.invoke("open_url", { url })) as {
        ok: boolean;
        message: string;
      };
      return res.message;
    } catch {
      return null;
    }
  }
  const r = await pyCall<{ ok: boolean; message: string }>("open_url", url);
  return r ? r.message : null;
}

export async function desktopNotify(title: string, body: string): Promise<boolean> {
  const t = tauri();
  if (t) {
    try {
      await t.invoke("notify", { title, body });
      return true;
    } catch {
      return false;
    }
  }
  return (await pyCall<boolean>("notify", title, body)) === true;
}

// ---------------- live stats ----------------

export function onDesktopStats(
  handler: (info: DesktopSystemInfo) => void,
): () => void {
  const t = tauri();
  const listen = t?.event?.listen;
  if (!listen) return () => undefined;
  let unlisten: (() => void) | null = null;
  void listen("desktop-stats", (e) => handler(e.payload as DesktopSystemInfo)).then(
    (un) => {
      unlisten = un;
    },
  );
  return () => unlisten?.();
}
