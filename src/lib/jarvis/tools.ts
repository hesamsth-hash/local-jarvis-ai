import {
  desktopLaunchApp,
  desktopSystemInfo,
} from "./desktop-bridge";

// Tool registry — every JARVIS capability, grouped by category.
// Browser-executable tools are implemented here; OS-level tools get REAL
// implementations through the Tauri desktop bridge when running as the
// installed Windows app, and honest refusals in the browser.

export interface ToolResult {
  ok: boolean;
  data: string; // human-readable result fed back to the user / LLM
  media?: MediaStream; // for screen / webcam capture
}

export interface ToolContext {
  /** Run one of the known sub-actions, e.g. youtube.play, youtube.search */
  sub: (action: string, arg?: string) => Promise<ToolResult>;
  /** Capture screen or camera; returns a stream for the MediaViewer */
  capture: (kind: "screen" | "camera") => Promise<ToolResult>;
  notify: (title: string, body?: string) => void;
  connectFolder: () => Promise<boolean>;
  connected: boolean;
  /** True when running as the native desktop app (Tauri bridge online) */
  desktop: boolean;
}

export interface ToolCategory {
  id: string;
  label: string;
  icon: string;
}

export const CATEGORIES: ToolCategory[] = [
  { id: "web", label: "Web & Research", icon: "globe" },
  { id: "system", label: "System & Control", icon: "monitor" },
  { id: "files", label: "Files & Code", icon: "folder" },
  { id: "comms", label: "Communication", icon: "send" },
  { id: "utilities", label: "Utilities", icon: "zap" },
];

export type ToolHandler = (
  arg: string,
  ctx: ToolContext,
) => Promise<ToolResult>;

export interface JarvisTool {
  id: string;
  name: string;
  category: string;
  description: string; // shown in UI
  llmDescription: string; // shown to the model
  argHint: string;
  desktopOnly?: boolean;
  handler?: ToolHandler;
}

// ---------- web helpers ----------

async function fetchJsonpDuck(arg: string): Promise<ToolResult> {
  const q = encodeURIComponent(arg);
  return new Promise((resolve) => {
    const cb = `jd_${Date.now().toString(36)}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, data: "Search request timed out." });
    }, 8000);
    function cleanup() {
      clearTimeout(timer);
      delete (window as unknown as Record<string, unknown>)[cb];
      script.remove();
    }
    (window as unknown as Record<string, unknown>)[cb] = (data: unknown) => {
      cleanup();
      const d = data as {
        RelatedTopics?: { Text?: string; FirstURL?: string }[];
        AbstractText?: string;
        Heading?: string;
      };
      const snippets: string[] = [];
      if (d.AbstractText) snippets.push(d.AbstractText);
      for (const t of d.RelatedTopics ?? []) {
        if (t.Text) snippets.push(t.Text);
        if (snippets.length >= 5) break;
      }
      resolve({
        ok: true,
        data: snippets.length
          ? `Results for "${arg}":\n${snippets.map((s) => `• ${s}`).join("\n")}`
          : `No instant results for "${arg}" (DuckDuckGo API returned nothing).`,
      });
    };
    script.src = `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&callback=${cb}`;
    script.onerror = () => {
      cleanup();
      resolve({ ok: false, data: "Search failed (network blocked?)." });
    };
    document.head.appendChild(script);
  });
}

// ---------- tool definitions ----------

export const TOOLS: JarvisTool[] = [
  // ============ WEB & RESEARCH ============
  {
    id: "web_search",
    name: "Web Search",
    category: "web",
    description: "Searches the web and summarizes results.",
    llmDescription:
      "search the web for a topic and get summarized snippets",
    argHint: "search query",
    handler: (arg) => fetchJsonpDuck(arg),
  },
  {
    id: "weather",
    name: "Weather Report",
    category: "web",
    description: "Live weather via the free open-meteo API (no key).",
    llmDescription: "get current weather for a city name",
    argHint: "city name",
    handler: async (arg) => {
      try {
        const geo = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(arg)}&count=1`,
        ).then((r) => r.json());
        const g = (
          geo as { results?: { latitude: number; longitude: number; name: string; country?: string }[] }
        ).results?.[0];
        if (!g) return { ok: false, data: `Couldn't find a city called "${arg}".` };
        const wx = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`,
        ).then((r) => r.json());
        const c = (
          wx as {
            current?: {
              temperature_2m: number;
              relative_humidity_2m: number;
              wind_speed_10m: number;
              weather_code: number;
            };
          }
        ).current;
        if (!c) return { ok: false, data: "Weather data unavailable." };
        const codes: Record<number, string> = {
          0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
          45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle",
          55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
          71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers",
          81: "rain showers", 82: "violent showers", 95: "thunderstorm",
          96: "thunderstorm w/ hail", 99: "severe thunderstorm",
        };
        return {
          ok: true,
          data: `${g.name}${g.country ? `, ${g.country}` : ""}: ${Math.round(c.temperature_2m)}°C, ${codes[c.weather_code] ?? "mixed"}, humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} km/h`,
        };
      } catch {
        return { ok: false, data: "Weather lookup failed." };
      }
    },
  },
  {
    id: "youtube",
    name: "YouTube Control",
    category: "web",
    description: "Search & play YouTube videos in a new tab.",
    llmDescription:
      'control YouTube — actions: search <query>, play <query>, music <query>',
    argHint: "action + query",
    handler: async (arg, ctx) => ctx.sub("youtube", arg),
  },
  {
    id: "browser_automation",
    name: "Browser Control",
    category: "web",
    description: "Opens sites / performs navigations in your browser.",
    llmDescription:
      'automate the browser — open a website URL or search on a site. actions: open <url>, google <query>, maps <query>',
    argHint: "action + target",
    handler: async (arg, ctx) => ctx.sub("browser", arg),
  },

  // ============ SYSTEM & CONTROL ============
  {
    id: "system_monitor",
    name: "System Monitor",
    category: "system",
    description:
      "CPU, RAM, GPU, battery, screen & uptime — full detail in the desktop app.",
    llmDescription:
      "report this device's hardware status (CPU model + load, RAM usage, GPU, battery, screen)",
    argHint: "",
    handler: async () => {
      // Desktop bridge: real OS-level stats
      const info = await desktopSystemInfo();
      if (info) {
        const mins = Math.floor(info.uptime_secs / 60);
        const hours = Math.floor(mins / 60);
        return {
          ok: true,
          data: `${info.hostname} · ${info.os_name} ${info.os_version} · CPU ${info.cpu_brand} (${info.cpu_cores} cores, ${info.cpu_usage_percent.toFixed(0)}% load) · RAM ${info.used_memory_gb.toFixed(1)}/${info.total_memory_gb.toFixed(1)} GB${info.gpu_names.length ? ` · GPU ${info.gpu_names.join(", ")}` : ""} · up ${hours}h ${mins % 60}m`,
        };
      }
      // Browser fallback: what a tab can see
      const nav = navigator as Navigator & {
        deviceMemory?: number;
        getBattery?: () => Promise<{ level: number; charging: boolean }>;
      };
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } })
        .memory;
      const lines: string[] = [];
      lines.push(`CPU cores: ${navigator.hardwareConcurrency ?? "unknown"}`);
      if (nav.deviceMemory) lines.push(`Device memory: ~${nav.deviceMemory} GB`);
      if (mem)
        lines.push(
          `JS heap: ${(mem.usedJSHeapSize / 1048576).toFixed(0)} / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB`,
        );
      try {
        const gl = document.createElement("canvas").getContext("webgl");
        const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
        if (gl && dbg)
          lines.push(
            `GPU: ${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`,
          );
      } catch {
        // ignore
      }
      try {
        const b = await nav.getBattery?.();
        if (b)
          lines.push(
            `Battery: ${Math.round(b.level * 100)}% ${b.charging ? "(charging)" : ""}`,
          );
      } catch {
        // ignore
      }
      lines.push(`Screen: ${screen.width}×${screen.height} @ ${window.devicePixelRatio}x`);
      lines.push(`Online: ${navigator.onLine ? "yes" : "no"}`);
      return { ok: true, data: lines.join(" · ") };
    },
  },
  {
    id: "screen_camera",
    name: "Screen & Camera",
    category: "system",
    description: "Captures your screen or webcam (shown in the viewer).",
    llmDescription:
      'capture video — actions: screen (share the screen), camera (webcam)',
    argHint: "screen | camera",
    handler: async (arg, ctx) =>
      ctx.capture(arg.includes("cam") ? "camera" : "screen"),
  },
  {
    id: "open_app",
    name: "Open App",
    category: "system",
    description:
      "Launches real apps via the desktop bridge, or URL schemes in the browser.",
    llmDescription:
      'open an application — actions: app <name> (notepad, calculator, vscode, spotify, steam…), url <full-url>',
    argHint: "app name or scheme",
    handler: async (arg, ctx) => {
      const msg = await desktopLaunchApp(arg);
      if (msg) return { ok: true, data: msg };
      return ctx.sub("openapp", arg);
    },
  },
  {
    id: "computer_settings",
    name: "Computer Settings",
    category: "system",
    description:
      "Volume, brightness, WiFi and power need OS access — opens the matching system panel instead.",
    llmDescription:
      "adjust system settings — volume, brightness, wifi, power. NOTE: browsers cannot change these; the tool tells the user how to open the right settings panel",
    argHint: "volume|brightness|wifi|power",
    handler: async (arg) => {
      const a = arg.toLowerCase();
      if (a.includes("vol")) {
        return {
          ok: true,
          data: "Browsers can't change system volume — use your keyboard media keys or the OS sound panel. (Tab audio can be muted from the tab itself.)",
        };
      }
      if (a.includes("bright")) {
        return {
          ok: true,
          data: "Browsers can't change screen brightness — use your keyboard brightness keys or the OS display panel.",
        };
      }
      if (a.includes("wifi") || a.includes("wi-fi")) {
        return {
          ok: true,
          data: "WiFi is OS-level. Open the network panel from your system tray / menu bar.",
        };
      }
      return {
        ok: true,
        data: "Power settings live in the OS control panel; a web page can't change them.",
      };
    },
  },
  {
    id: "computer_control",
    name: "Computer Control",
    category: "system",
    description:
      "Keyboard, mouse and window automation require a native bridge — not possible from a browser tab.",
    llmDescription:
      "keyboard shortcuts, mouse and window management — DESKTOP ONLY: this browser console cannot control the OS input; say a native bridge is required",
    argHint: "",
    desktopOnly: true,
  },
  {
    id: "desktop_control",
    name: "Desktop Control",
    category: "system",
    description:
      "Desktop & taskbar management needs a native OS bridge — outside browser reach.",
    llmDescription:
      "manage the desktop and taskbar — DESKTOP ONLY: requires a native bridge outside the browser",
    argHint: "",
    desktopOnly: true,
  },

  // ============ FILES & CODE ============
  {
    id: "file_controller",
    name: "File Controller",
    category: "files",
    description: "List, read, write, rename, move and delete local files.",
    llmDescription:
      'local file operations on the connected workspace — actions: list [path], read <path>, write <path> with <text>, mkdir <path>, rename <a> to <b>, move <a> to <dir>, delete <path>, search <term>, undo',
    argHint: "action + args",
    handler: async (arg, ctx) => ctx.sub("fs", arg),
  },
  {
    id: "file_processor",
    name: "File Processor",
    category: "files",
    description: "Reads a local file and summarizes its content.",
    llmDescription: "read a local file and summarize what it contains",
    argHint: "file path",
    handler: async (arg, ctx) => ctx.sub("fs", `read ${arg}`),
  },
  {
    id: "code_helper",
    name: "Code Helper",
    category: "files",
    description:
      "Reads a code file and asks the local LLM to review / explain it.",
    llmDescription:
      "review or explain code — reads a code file from the workspace and analyzes it",
    argHint: "file path",
    handler: async (arg, ctx) => ctx.sub("code", arg),
  },
  {
    id: "developer_agent",
    name: "Developer Agent",
    category: "files",
    description:
      "Multi-step dev helper: scans the workspace, then reviews with the LLM.",
    llmDescription:
      "run developer tasks on the workspace — scans project files and reports structure / issues",
    argHint: "task description",
    handler: async (arg, ctx) => ctx.sub("dev", arg),
  },

  // ============ COMMUNICATION ============
  {
    id: "send_message",
    name: "Send Message",
    category: "comms",
    description: "Opens a pre-filled email (mailto) — no account access.",
    llmDescription:
      'send a message — actions: email <address> about <text>, whatsapp <text> (opens share), sms <text>',
    argHint: "action + text",
    handler: async (arg, ctx) => ctx.sub("send", arg),
  },
  {
    id: "reminder",
    name: "Reminder",
    category: "comms",
    description: "Schedules OS notifications (works while the tab is open).",
    llmDescription:
      'set a reminder — args: "<minutes> <message>", e.g. "20 stand up" or "in 5 drink water"',
    argHint: "minutes + message",
    handler: async (arg, ctx) => ctx.sub("remind", arg),
  },

  // ============ UTILITIES ============
  {
    id: "flight_finder",
    name: "Flight Finder",
    category: "utilities",
    description: "Opens flight search for your route (Google Flights).",
    llmDescription:
      'search flights — args: "<from> to <to>", e.g. "Berlin to Tokyo"',
    argHint: "from to to",
    handler: async (arg, ctx) => ctx.sub("flights", arg),
  },
  {
    id: "game_updater",
    name: "Game Updater",
    category: "utilities",
    description:
      "Opens Steam / Epic download pages; deep library scanning needs the desktop bridge.",
    llmDescription:
      'game updates — actions: steam (open Steam), epic (open Epic Games); note real library scanning needs a native bridge',
    argHint: "steam|epic",
    handler: async (arg, ctx) => ctx.sub("games", arg),
  },
  {
    id: "background_monitor",
    name: "Background Monitor",
    category: "utilities",
    description:
      "Watches a topic and reports new results while the console is open.",
    llmDescription: 'watch a topic in the background — args: "<topic>"',
    argHint: "topic",
    handler: async (arg, ctx) => ctx.sub("monitor", arg),
  },
  {
    id: "proactive_checkins",
    name: "Proactive Check-ins",
    category: "utilities",
    description: "Time & context-aware nudges while the console is open.",
    llmDescription:
      'schedule proactive check-ins — args: "<minutes> <nudge text>"',
    argHint: "minutes + text",
    handler: async (arg, ctx) => ctx.sub("checkin", arg),
  },
];

export function toolsForLlm(): ToolSpecLike[] {
  return TOOLS.map((t) => ({
    id: t.id,
    description: t.llmDescription,
    args: t.argHint ? `"${t.argHint}"` : undefined,
  }));
}

export interface ToolSpecLike {
  id: string;
  description: string;
  args?: string;
}

export function findTool(id: string): JarvisTool | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** Execute a tool by id with a free-form arg string. */
export async function executeTool(
  id: string,
  arg: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = findTool(id);
  if (!tool) {
    return { ok: false, data: `Unknown tool "${id}".` };
  }
  if (!tool.handler) {
    return {
      ok: false,
      data: `"${tool.name}" needs a native desktop bridge — a browser tab can't control the OS at that level.`,
    };
  }
  try {
    return await tool.handler(arg, ctx);
  } catch (e) {
    return {
      ok: false,
      data: e instanceof Error ? e.message : "Tool execution failed.",
    };
  }
}
