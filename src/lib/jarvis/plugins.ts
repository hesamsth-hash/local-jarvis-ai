// Plugin engine — lets JARVIS extend itself at runtime.
//
// When the model has no tool for a request, it can WRITE a new tool
// (make_tool). The tool is defined as a sandboxed JS function that runs in a
// Web Worker with a small, explicit API surface — so a badly written plugin
// can throw or return junk, but can't touch the console state, the workspace
// handles, or the OS directly.
//
// Everything persists in IndexedDB so installed tools survive reloads.

// ---------- types ----------

export interface PluginSpec {
  id: string; // slug, e.g. "hacker-news"
  name: string;
  description: string; // one line, shown in UI + fed to the model
  argHint: string; // what "arg" is, e.g. "query"
  code: string; // body of async function run(args, jv) — see sandbox
  createdAt: number;
  source: "jarvis" | "user";
}

// ---------- persistence (IndexedDB) ----------

const DB_NAME = "jarvis-plugins";
const STORE = "plugins";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function idbAll(): Promise<PluginSpec[]> {
  return new Promise((resolve) => {
    void (async () => {
      const db = await openDb();
      if (!db) {
        resolve([]);
        return;
      }
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as PluginSpec[]);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    })();
  });
}

function idbPut(p: PluginSpec): Promise<boolean> {
  return new Promise((resolve) => {
    void (async () => {
      const db = await openDb();
      if (!db) {
        resolve(false);
        return;
      }
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(p);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    })();
  });
}

function idbDelete(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    void (async () => {
      const db = await openDb();
      if (!db) {
        resolve(false);
        return;
      }
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    })();
  });
}

// ---------- sandbox worker ----------

// The worker executes the plugin body inside try/catch and reports back.
// API surface ("jv") available inside plugin code:
//   jv.fetchJson(url, init?)     — JSON request (CORS applies, like any page)
//   jv.fetchText(url, init?)
//   jv.open(url)                 — open a URL in a new tab
//   jv.notify(title, body?)      — OS notification
//   jv.desktop                   — boolean: desktop bridge available
//   jv.desktopCommand(cmd, payload) — raw call into the Tauri bridge (desktop only)
const WORKER_SRC = `
self.onmessage = async (e) => {
  const { id, code, args, api } = e.data;
  const post = (msg) => self.postMessage(Object.assign({ id }, msg));
  const jv = {
    fetchJson: (url, init) =>
      fetch(url, init).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
    fetchText: (url, init) =>
      fetch(url, init).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }),
    open: (url) => post({ open: String(url) }),
    notify: (title, body) => post({ notify: { title: String(title), body: body ? String(body) : '' } }),
    desktop: api.desktop === true,
    desktopCommand: (cmd, payload) => {
      if (!jv.desktop) throw new Error('desktop bridge not available');
      post({ desktop: { cmd: String(cmd), payload: payload || {} } });
      return 'desktop command dispatched: ' + cmd;
    },
  };
  let result = null;
  let error = null;
  try {
    const fn = new Function('args', 'jv', '"use strict";\\n' + code);
    result = await fn(args, jv);
  } catch (err) {
    error = err && err.message ? String(err.message) : String(err);
  }
  post({ result: result === undefined ? null : result, error });
};
`;

interface PendingRequest {
  id: string;
  resolve: (r: { result: unknown; error: string | null }) => void;
  /** Side-channel outputs the worker sends before resolving. */
  openUrl?: string;
  notify?: { title: string; body: string };
}

let pending: PendingRequest[] = [];
let worker: Worker | null = null;
let workerBroken = false;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    const blob = new Blob([WORKER_SRC], { type: "text/javascript" });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as Record<string, unknown> | null;
      if (!data || typeof data.id !== "string") return;
      const idx = pending.findIndex((p) => p.id === data.id);
      if (idx === -1) return;
      const req = pending[idx]!;
      pending.splice(idx, 1);
      if (typeof data.open === "string") req.openUrl = data.open;
      else if (data.notify !== undefined)
        req.notify = data.notify as { title: string; body: string };
      if (data.result !== undefined || data.error !== undefined)
        req.resolve({
          result: data.result,
          error: (data.error as string | null) ?? null,
        });
    };
    worker.onerror = () => {
      for (const p of pending) p.resolve({ result: null, error: "Plugin sandbox crashed." });
      pending = [];
      workerBroken = true;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

const RUN_TIMEOUT_MS = 15000;

export interface PluginRunResult {
  ok: boolean;
  data: string;
  openUrl?: string;
  notify?: { title: string; body: string };
}

/** Run a plugin body inside the sandbox. */
export function runPlugin(
  code: string,
  args: string,
  api: { desktop: boolean },
): Promise<PluginRunResult> {
  return new Promise((resolve) => {
    const w = getWorker();
    if (!w) {
      resolve({ ok: false, data: "Plugin sandbox unavailable in this environment." });
      return;
    }
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const req = {
      id,
      resolve: (r: { result: unknown; error: string | null }) => {
        clearTimeout(timer);
        resolve({
          ok: !r.error,
          data: r.error
            ? `Plugin failed: ${r.error}`
            : typeof r.result === "string"
              ? r.result
              : JSON.stringify(r.result, null, 2) ?? "done",
          openUrl: req.openUrl,
          notify: req.notify,
        });
      },
      openUrl: undefined as string | undefined,
      notify: undefined as { title: string; body: string } | undefined,
    };
    pending.push(req);
    const timer = setTimeout(() => {
      const idx = pending.findIndex((p) => p.id === id);
      if (idx !== -1) {
        pending.splice(idx, 1);
        resolve({ ok: false, data: "Plugin timed out (15s limit)." });
      }
    }, RUN_TIMEOUT_MS);
    w.postMessage({ id, code, args, api });
  });
}

// ---------- registry sync ----------

/** Module-level notify sink, set once by the console (useJarvis). */
let pluginNotify: (title: string, body?: string) => void = () => undefined;

export function setPluginNotifier(
  fn: (title: string, body?: string) => void,
): void {
  pluginNotify = fn;
}

function pluginHandler(code: string) {
  return async (arg: string, toolCtx: import("./tools").ToolContext) => {
    const r = await runPlugin(code, arg, { desktop: toolCtx.desktop });
    if (r.openUrl) {
      void toolCtx.sub("browser", `open ${r.openUrl}`).catch(() => undefined);
    }
    if (r.notify) pluginNotify(r.notify.title, r.notify.body);
    return { ok: r.ok, data: r.data };
  };
}

/** Push every saved plugin into TOOLS so the brain + UI see them. */
export async function syncPluginTools(): Promise<number> {
  const plugins = await idbAll();
  const { TOOLS, findTool } = await import("./tools");
  let added = 0;
  for (const p of plugins) {
    if (findTool(`plugin.${p.id}`)) continue;
    TOOLS.push({
      id: `plugin.${p.id}`,
      name: p.name,
      category: "utilities",
      description: p.description,
      llmDescription: `${p.description} (installed plugin)`,
      argHint: p.argHint,
      handler: pluginHandler(p.code),
    });
    added++;
  }
  return added;
}

export interface PluginSaveResult {
  ok: boolean;
  data: string;
}

/** Write (or overwrite) a plugin tool and register it immediately. */
export async function savePlugin(spec: {
  id?: string;
  name: string;
  description: string;
  argHint?: string;
  code: string;
  source?: "jarvis" | "user";
}): Promise<PluginSaveResult> {
  const slug =
    (spec.id ??
      spec.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40)) || `tool-${Date.now().toString(36)}`;
  const plugin: PluginSpec = {
    id: slug,
    name: spec.name.trim() || slug,
    description: spec.description.trim() || "Custom tool",
    argHint: spec.argHint?.trim() || "input",
    code: spec.code,
    createdAt: Date.now(),
    source: spec.source ?? "jarvis",
  };
  const ok = await idbPut(plugin);
  if (!ok) {
    return { ok: false, data: "Plugin storage unavailable (IndexedDB blocked)." };
  }
  const { TOOLS } = await import("./tools");
  const existing = TOOLS.findIndex((t) => t.id === `plugin.${plugin.id}`);
  const tool = {
    id: `plugin.${plugin.id}`,
    name: plugin.name,
    category: "utilities",
    description: plugin.description,
    llmDescription: `${plugin.description} (installed plugin)`,
    argHint: plugin.argHint,
    handler: pluginHandler(plugin.code),
  };
  if (existing === -1) TOOLS.push(tool);
  else TOOLS[existing] = tool;
  return { ok: true, data: `Tool "${plugin.name}" installed (id: ${plugin.id}).` };
}

export async function listPlugins(): Promise<PluginSpec[]> {
  return idbAll();
}

export async function removePlugin(id: string): Promise<boolean> {
  const ok = await idbDelete(id);
  const { TOOLS } = await import("./tools");
  const idx = TOOLS.findIndex((t) => t.id === `plugin.${id}`);
  if (idx !== -1) TOOLS.splice(idx, 1);
  return ok;
}
