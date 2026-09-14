// Android filesystem backend — real file access on rooted devices via `su`.
// The Android webview has no showDirectoryPicker, so the workspace toggle
// appeared dead there. With this backend, JARVIS uses root shell commands to
// browse the WHOLE device ( Downloads, DCIM, Documents…), no picker needed.

import { desktopExecuteRaw } from "./desktop-bridge";
import type { FsBackend } from "./fs-tools";
import type { FsEntryView } from "./types";

const DEFAULT_ROOT = "/sdcard";

interface LsLine {
  perms: string;
  name: string;
}

function parseLsLong(out: string): FsEntryView[] {
  const entries: FsEntryView[] = [];
  for (const line of out.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("total") || l.startsWith("opendir") || l === "Permission denied") continue;
    // toybox ls -l: "-rw-rw---- 1 root sdcard 12345 2024-01-01 12:00 name"
    const m = l.match(
      /^([\-dlbcps][rwxsStT\-]{9})\s+\S+\s+\S+\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s(.+)$/,
    );
    if (!m) continue;
    const perms = m[1] ?? "";
    const size = Number(m[2] ?? 0);
    const name = (m[3] ?? "").trim();
    if (!name || name === "." || name === "..") continue;
    entries.push({
      name,
      kind: perms.startsWith("d") ? "directory" : "file",
      size: perms.startsWith("d") ? null : size,
      modified: null,
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

/** Run a shell command as root; throws on failure with the error text. */
async function sh(script: string): Promise<string> {
  const r = await desktopExecuteRaw("su", ["-c", script]);
  if (!r) throw new Error("Shell backend unavailable (open the Android app).");
  if (!r.ok) throw new Error(r.message);
  return r.message;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function joinPath(dir: string, name: string): string {
  const d = dir.replace(/\/+$/, "");
  return d ? `${d}/${name}` : `/${name}`;
}

export function androidFsSupported(): boolean {
  return typeof window !== "undefined" && !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export const androidFs: FsBackend = {
  name: () => "Device storage (root)",

  async listDir(path) {
    const clean = path.replace(/^[/\\]+|[/\\]+$/g, "");
    const target = clean ? joinPath(DEFAULT_ROOT, clean) : DEFAULT_ROOT;
    const out = await sh(`ls -l ${shellQuote(target)} 2>&1`);
    const entries = parseLsLong(out);
    if (entries.length === 0) {
      // distinguish "empty" from "cannot access" (bad path / denied)
      const probe = await sh(
        `[ -d ${shellQuote(target)} ] && echo DIR_OK || echo NOT_DIR`,
      );
      if (!probe.includes("DIR_OK")) throw new Error(`Cannot open ${target}`);
    }
    return { path: clean, entries };
  },

  async readFile(path) {
    const target = joinPath(DEFAULT_ROOT, path.replace(/^[/\\]+|[/\\]+$/g, ""));
    return await sh(`cat ${shellQuote(target)}`);
  },

  async writeFile(path, content) {
    const target = joinPath(DEFAULT_ROOT, path.replace(/^[/\\]+|[/\\]+$/g, ""));
    const b64 = btoa(
      String.fromCharCode(...new TextEncoder().encode(content)),
    );
    await sh(
      `mkdir -p $(dirname ${shellQuote(target)}) && echo ${shellQuote(b64)} | base64 -d > ${shellQuote(target)}`,
    );
    return `Wrote ${content.length} bytes to ${target}`;
  },

  async makeDir(path) {
    const target = joinPath(DEFAULT_ROOT, path.replace(/^[/\\]+|[/\\]+$/g, ""));
    await sh(`mkdir -p ${shellQuote(target)}`);
    return `Created folder ${target}`;
  },

  async renamePath(from, to) {
    const f = joinPath(DEFAULT_ROOT, from.replace(/^[/\\]+|[/\\]+$/g, ""));
    const t = joinPath(DEFAULT_ROOT, to.replace(/^[/\\]+|[/\\]+$/g, ""));
    await sh(`mkdir -p $(dirname ${shellQuote(t)}) && mv ${shellQuote(f)} ${shellQuote(t)}`);
    return `Renamed ${f} → ${t}`;
  },

  async movePath(from, toDir) {
    const f = joinPath(DEFAULT_ROOT, from.replace(/^[/\\]+|[/\\]+$/g, ""));
    const name = f.split("/").pop() ?? f;
    const t = joinPath(DEFAULT_ROOT, toDir.replace(/^[/\\]+|[/\\]+$/g, ""));
    await sh(`mkdir -p ${shellQuote(t)} && mv ${shellQuote(f)} ${shellQuote(joinPath(t, name))}`);
    return `Moved ${name} to ${t}`;
  },

  async deletePath(path) {
    const target = joinPath(DEFAULT_ROOT, path.replace(/^[/\\]+|[/\\]+$/g, ""));
    const trash = `${DEFAULT_ROOT}/.jarvis-trash`;
    const stamp = Date.now().toString(36);
    await sh(
      `mkdir -p ${shellQuote(trash)} && (mv ${shellQuote(target)} ${shellQuote(joinPath(trash, `${path.split("/").pop()}.${stamp}`))} || rm -rf ${shellQuote(target)})`,
    );
    return `Deleted ${target} (backup kept in .jarvis-trash)`;
  },

  async restoreLastDeleted() {
    const trash = `${DEFAULT_ROOT}/.jarvis-trash`;
    const out = await sh(
      `ls -1 ${shellQuote(trash)} 2>/dev/null | sort | tail -1`,
    );
    const latest = out.trim().split("\n").pop()?.trim();
    if (!latest) return "Trash is empty — nothing to restore.";
    const base = latest.replace(/\.[a-z0-9]+$/i, "");
    await sh(`mv ${shellQuote(joinPath(trash, latest))} ${shellQuote(joinPath(DEFAULT_ROOT, base))}`);
    return `Restored ${base}`;
  },

  async exists(path) {
    const target = joinPath(DEFAULT_ROOT, path.replace(/^[/\\]+|[/\\]+$/g, ""));
    const out = await sh(`[ -e ${shellQuote(target)} ] && echo Y || echo N`);
    return out.includes("Y");
  },

  // ---------- binary IO (archive / hash features) ----------

  async readFileBytes(path): Promise<Uint8Array<ArrayBuffer>> {
    const target = joinPath(DEFAULT_ROOT, path.replace(/^[/\\]+|[/\\]+$/g, ""));
    const b64 = await sh(`base64 < ${shellQuote(target)} | tr -d '\n'`);
    const bin = atob(b64.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  },

  async writeFileBytes(path, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const target = joinPath(DEFAULT_ROOT, path.replace(/^[/\\]+|[/\\]+$/g, ""));
    // Android caps a single argv at ~128KB, so base64 goes to a temp file in
    // small appended chunks, then decodes once at the end.
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CH));
    }
    const b64 = btoa(bin);
    const tmp = `${target}.b64.tmp`;
    const CHUNK = 60000; // safely under the argv cap
    await sh(`mkdir -p $(dirname ${shellQuote(target)}) && : > ${shellQuote(tmp)}`);
    for (let i = 0; i < b64.length; i += CHUNK) {
      await sh(`echo -n ${shellQuote(b64.slice(i, i + CHUNK))} >> ${shellQuote(tmp)}`);
    }
    await sh(`base64 -d ${shellQuote(tmp)} > ${shellQuote(target)} && rm -f ${shellQuote(tmp)}`);
    return `Wrote ${bytes.length} bytes to ${target}`;
  },
};

/** Rooted-device filesystem, mapped as additional "workspaces" (no picker needed). */
export const ANDROID_WORKSPACES = [
  { name: "Downloads", path: "Download" },
  { name: "Camera / DCIM", path: "DCIM" },
  { name: "Documents", path: "Documents" },
  { name: "Pictures", path: "Pictures" },
  { name: "Movies", path: "Movies" },
  { name: "Music", path: "Music" },
  { name: "Root storage (/sdcard)", path: "" },
] as const;

/** Absolute-path escape hatch (root can go anywhere: /data, /system…). */
export async function openAbsoluteDir(absPath: string): Promise<boolean> {
  const out = await sh(`[ -d ${shellQuote(absPath)} ] && echo DIR_OK || echo NOT_DIR`);
  return out.includes("DIR_OK");
}
