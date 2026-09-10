// Desktop bridge — talks to the Tauri backend when the console runs as a
// native Windows/Linux/macOS app. In a plain browser it reports unavailable
// and every call degrades gracefully.

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

function invokeOrNull(): TauriInvoke | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke: TauriInvoke } };
  return w.__TAURI_INTERNALS__?.invoke ?? null;
}

export function isDesktop(): boolean {
  return invokeOrNull() !== null;
}

export interface DesktopSystemInfo {
  os_name: string;
  os_version: string;
  kernel: string;
  hostname: string;
  cpu_brand: string;
  cpu_cores: number;
  cpu_usage_percent: number;
  total_memory_gb: number;
  used_memory_gb: number;
  gpu_names: string[];
  uptime_secs: number;
}

export async function desktopSystemInfo(): Promise<DesktopSystemInfo | null> {
  const invoke = invokeOrNull();
  if (!invoke) return null;
  try {
    return (await invoke("system_info")) as DesktopSystemInfo;
  } catch {
    return null;
  }
}

export async function desktopLaunchApp(name: string): Promise<string | null> {
  const invoke = invokeOrNull();
  if (!invoke) return null;
  try {
    const res = (await invoke("launch_app", { name })) as {
      ok: boolean;
      message: string;
    };
    return res.message;
  } catch {
    return null;
  }
}

export async function desktopOpenUrl(url: string): Promise<string | null> {
  const invoke = invokeOrNull();
  if (!invoke) return null;
  try {
    const res = (await invoke("open_url", { url })) as {
      ok: boolean;
      message: string;
    };
    return res.message;
  } catch {
    return null;
  }
}

export async function desktopStatus(): Promise<boolean> {
  const invoke = invokeOrNull();
  if (!invoke) return false;
  try {
    const res = await invoke("desktop_status");
    return res === "desktop-bridge-online";
  } catch {
    return false;
  }
}
