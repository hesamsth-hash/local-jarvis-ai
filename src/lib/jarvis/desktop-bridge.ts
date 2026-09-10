// Desktop bridge — talks to the Tauri backend when the console runs as a
// native Windows/Linux/macOS app. In a plain browser it reports unavailable
// and every call degrades gracefully.

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

export function isDesktop(): boolean {
  return tauri() !== null;
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
  if (!t) return null;
  try {
    return (await t.invoke("system_info")) as DesktopSystemInfo;
  } catch {
    return null;
  }
}

// ---------------- input ----------------

export async function desktopMouseMove(
  x: number,
  y: number,
  relative = false,
): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("mouse_move", { x, y, relative })) as string;
  } catch (e) {
    return e instanceof Error ? `Mouse move failed: ${e.message}` : "Mouse move failed.";
  }
}

export async function desktopMouseClick(
  button: "left" | "right" | "middle" = "left",
  kind: "click" | "down" | "up" = "click",
): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("mouse_click", { button, kind })) as string;
  } catch (e) {
    return e instanceof Error ? `Click failed: ${e.message}` : "Click failed.";
  }
}

export async function desktopMouseDoubleClick(): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("mouse_double_click")) as string;
  } catch (e) {
    return e instanceof Error ? `Double-click failed: ${e.message}` : "Double-click failed.";
  }
}

export async function desktopMouseScroll(amount: number): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("mouse_scroll", { amount })) as string;
  } catch (e) {
    return e instanceof Error ? `Scroll failed: ${e.message}` : "Scroll failed.";
  }
}

export async function desktopMouseDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps?: number,
): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("mouse_drag", { fromX, fromY, toX, toY, steps })) as string;
  } catch (e) {
    return e instanceof Error ? `Drag failed: ${e.message}` : "Drag failed.";
  }
}

export async function desktopMouseDraw(
  points: { x: number; y: number }[],
): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("mouse_draw", {
      points: points.map((p) => [p.x, p.y]),
    })) as string;
  } catch (e) {
    return e instanceof Error ? `Draw failed: ${e.message}` : "Draw failed.";
  }
}

export async function desktopKeyPress(key: string): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("key_press", { key })) as string;
  } catch (e) {
    return e instanceof Error ? `Key failed: ${e.message}` : "Key failed.";
  }
}

export async function desktopTypeText(text: string): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("type_text", { text })) as string;
  } catch (e) {
    return e instanceof Error ? `Typing failed: ${e.message}` : "Typing failed.";
  }
}

// ---------------- capture ----------------

export interface DesktopScreenshot {
  data_uri: string;
  width: number;
  height: number;
}

export async function desktopPicture(): Promise<DesktopScreenshot | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("desktop_picture")) as DesktopScreenshot;
  } catch {
    return null;
  }
}

/** Display size in the same coordinate space the mouse commands use. */
export interface DesktopScreenMetrics {
  width: number;
  height: number;
}

export async function desktopScreenMetrics(): Promise<DesktopScreenMetrics | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return (await t.invoke("screen_metrics")) as DesktopScreenMetrics;
  } catch {
    return null;
  }
}

// ---------------- apps / urls / notifications ----------------

export async function desktopLaunchApp(name: string): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
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

/**
 * Launch ANY program, script, document or folder by name/path — goes through
 * the native shell, so PATH apps, .lnk targets and files resolve too.
 */
export async function desktopExecute(
  command: string,
  args: string[] = [],
): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
  try {
    const res = (await t.invoke("execute_command", { command, args })) as {
      ok: boolean;
      message: string;
    };
    return res.message;
  } catch (e) {
    return e instanceof Error ? `Execute failed: ${e.message}` : "Execute failed.";
  }
}

export async function desktopOpenUrl(url: string): Promise<string | null> {
  const t = tauri();
  if (!t) return null;
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

export async function desktopNotify(title: string, body: string): Promise<boolean> {
  const t = tauri();
  if (!t) return false;
  try {
    await t.invoke("notify", { title, body });
    return true;
  } catch {
    return false;
  }
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
