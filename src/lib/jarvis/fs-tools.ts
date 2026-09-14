// Filesystem tools — real local operations via the browser File System Access API.
// The user explicitly picks a root folder once; everything after that happens on-device.
// Multiple roots are supported (switchable); on rooted Android a shell backend
// (see android-fs.ts) takes over because the webview has no folder picker.

import type { FsEntryView } from "./types";

/** Minimal interface both backends (browser handles / Android shell) implement. */
export interface FsBackend {
  listDir(path: string): Promise<{ path: string; entries: FsEntryView[] }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<string>;
  makeDir(path: string): Promise<string>;
  renamePath(from: string, to: string): Promise<string>;
  movePath(from: string, toDir: string): Promise<string>;
  deletePath(path: string): Promise<string>;
  restoreLastDeleted(): Promise<string>;
  exists(path: string): Promise<boolean>;
  name(): string | null;
  /** Binary read — required for archive/hash features. */
  readFileBytes?(path: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Binary write — required for archive/hash features. */
  writeFileBytes?(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<string>;
}

let androidBackend: FsBackend | null = null;

/** Register the Android shell backend (rooted device) as the active filesystem. */
export function setBackend(b: FsBackend | null) {
  androidBackend = b;
}

export function backendActive(): boolean {
  return androidBackend !== null;
}

export function fsSupported(): boolean {
  if (androidBackend) return true;
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Ask the user to grant access to a local folder (this is the "workspace root"). */
export async function pickRootFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!fsSupported()) return null;
  try {
    const picker = (
      window as unknown as {
        showDirectoryPicker: (opts?: {
          mode?: "read" | "readwrite";
          id?: string;
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    return await picker({ mode: "readwrite", id: "jarvis-workspace" });
  } catch {
    return null; // user cancelled
  }
}

function root(): FileSystemDirectoryHandle {
  const handle = activeBrowserRoot();
  if (!handle) {
    throw new Error("No workspace folder connected. Say \"connect folder\" first.");
  }
  return handle;
}

// ---------- multi-root registry ----------

interface RootRegistry {
  names: string[];
  active: string | null;
}

const REG_KEY = "workspace-list";
const ACTIVE_KEY = "workspace-active";
const rootKey = (name: string) => `root:${name}`;

async function readRegistry(db: IDBDatabase): Promise<RootRegistry> {
  return await new Promise<RootRegistry>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const get = (key: string) =>
      new Promise<unknown>((res) => {
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      });
    void Promise.all([get(REG_KEY), get(ACTIVE_KEY)]).then(([list, active]) => {
      resolve({
        names: (list as string[] | undefined) ?? [],
        active: (active as string | null | undefined) ?? null,
      });
    });
  });
}

async function writeRegistry(db: IDBDatabase, reg: RootRegistry): Promise<void> {
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(reg.names, REG_KEY);
    tx.objectStore(STORE).put(reg.active, ACTIVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function saveNamedHandle(name: string, handle: FileSystemDirectoryHandle) {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, rootKey(name));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

async function loadNamedHandle(
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  const db = await idb();
  if (!db) return null;
  return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(rootKey(name));
    req.onsuccess = () =>
      resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function deleteNamedHandle(name: string) {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(rootKey(name));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

const store = globalThis as unknown as {
  __jarvisRoot?: FileSystemDirectoryHandle;
  __jarvisRootName?: string | null;
  __jarvisRoots?: Map<string, FileSystemDirectoryHandle>;
};

function rootsMap(): Map<string, FileSystemDirectoryHandle> {
  store.__jarvisRoots ??= new Map();
  return store.__jarvisRoots;
}

function activeName(): string | null {
  if (store.__jarvisRootName) return store.__jarvisRootName;
  const first = rootsMap().keys().next();
  return first.done ? null : first.value;
}

function activeBrowserRoot(): FileSystemDirectoryHandle | null {
  const name = activeName();
  if (!name) return null;
  return rootsMap().get(name) ?? null;
}

/** Names of every connected workspace (browser backend). */
export async function listRoots(): Promise<string[]> {
  if (androidBackend) return [];
  const db = await idb();
  if (!db) return store.__jarvisRoots ? [...store.__jarvisRoots.keys()] : [];
  const reg = await readRegistry(db);
  db.close();
  return reg.names;
}

/** Switch the active workspace by name. Returns false if unknown. */
export async function setActiveRoot(name: string): Promise<boolean> {
  if (androidBackend) return false;
  let handle = rootsMap().get(name) ?? null;
  if (!handle) handle = await loadNamedHandle(name);
  if (!handle) return false;
  rootsMap().set(name, handle);
  store.__jarvisRootName = name;
  store.__jarvisRoot = handle;
  const db = await idb();
  if (db) {
    const reg = await readRegistry(db);
    await writeRegistry(db, { ...reg, active: name });
    db.close();
  }
  return true;
}

/** Add a picked folder as a NEW workspace and make it active (never replaces). */
export async function addRoot(
  handle: FileSystemDirectoryHandle,
): Promise<string> {
  const name = handle.name || "workspace";
  rootsMap().set(name, handle);
  store.__jarvisRootName = name;
  store.__jarvisRoot = handle;
  await saveNamedHandle(name, handle);
  const db = await idb();
  if (db) {
    const reg = await readRegistry(db);
    const names = reg.names.includes(name) ? reg.names : [...reg.names, name];
    await writeRegistry(db, { names, active: name });
    db.close();
  }
  void saveRoot(handle); // legacy single-key mirror (harmless if redundant)
  return name;
}

/** Remove a workspace entirely (registry entry + grant). Falls back to another root if it was active. */
export async function removeRoot(name: string): Promise<void> {
  rootsMap().delete(name);
  await deleteNamedHandle(name);
  const db = await idb();
  if (db) {
    const reg = await readRegistry(db);
    const names = reg.names.filter((n) => n !== name);
    const active = reg.active === name ? (names[0] ?? null) : reg.active;
    await writeRegistry(db, { names, active });
    db.close();
  }
  if (activeName() === name || !activeName()) {
    const next = [...rootsMap().keys()][0] ?? null;
    if (next) {
      await setActiveRoot(next);
    } else {
      store.__jarvisRootName = null;
      store.__jarvisRoot = undefined;
      await clearSavedRoot();
    }
  }
}

export function setRoot(handle: FileSystemDirectoryHandle) {
  void addRoot(handle);
}

// ---------- workspace persistence (IndexedDB) ----------

const DB_NAME = "jarvis-fs";
const STORE = "handles";
const KEY = "workspace-root";

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

async function loadSavedRoot(): Promise<FileSystemDirectoryHandle | null> {
  const db = await idb();
  if (!db) return null;
  const handle = await new Promise<FileSystemDirectoryHandle | null>(
    (resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () =>
        resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    },
  );
  db.close();
  return handle;
}

export async function clearSavedRoot(): Promise<void> {
  rootsMap().clear();
  store.__jarvisRoot = undefined;
  store.__jarvisRootName = null;
  const db = await idb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.objectStore(STORE).delete(REG_KEY);
    tx.objectStore(STORE).delete(ACTIVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

export type RootPermission = "granted" | "prompt" | "denied" | "none";

interface PermissionHandle {
  queryPermission?: (d: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (d: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
}

async function permOf(
  handle: FileSystemDirectoryHandle,
): Promise<Exclude<RootPermission, "none">> {
  const p = handle as unknown as PermissionHandle;
  try {
    const state =
      (await p.queryPermission?.({ mode: "readwrite" })) ?? "prompt";
    return state as Exclude<RootPermission, "none">;
  } catch {
    return "prompt";
  }
}

/** Re-attach the saved workspace(s) after a reload. Returns the active root's permission state. */
export async function restoreRoot(): Promise<RootPermission> {
  if (androidBackend) return "granted";
  const db = await idb();
  if (db) {
    const reg = await readRegistry(db);
    for (const name of reg.names) {
      const h = await loadNamedHandle(name);
      if (h) rootsMap().set(name, h);
    }
    const want =
      reg.active && rootsMap().has(reg.active)
        ? reg.active
        : ([...rootsMap().keys()][0] ?? null);
    if (want) {
      store.__jarvisRootName = want;
      store.__jarvisRoot = rootsMap().get(want);
      return permOf(store.__jarvisRoot!);
    }
    // legacy single-root migration
    const legacy = await loadSavedRoot();
    if (legacy) {
      await addRoot(legacy);
      return permOf(legacy);
    }
    return "none";
  }
  const handle = await loadSavedRoot();
  if (!handle) return "none";
  store.__jarvisRoot = handle;
  return permOf(handle);
}

/** Ask for readwrite access on the active saved handle (must run in a user gesture). */
export async function requestRootAccess(): Promise<boolean> {
  if (androidBackend) return true;
  const handle = activeBrowserRoot();
  if (!handle) return false;
  try {
    const state = await (
      handle as unknown as PermissionHandle
    ).requestPermission?.({ mode: "readwrite" });
    return state === "granted";
  } catch {
    return false;
  }
}

export function hasRoot(): boolean {
  if (androidBackend) return true;
  return !!activeBrowserRoot();
}

export function rootName(): string | null {
  if (androidBackend) return androidBackend.name();
  return activeName();
}

/** Resolve a path like "projects/notes.txt" to its parent dir handle + basename. */
async function resolveDir(
  path: string,
  create = false,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const clean = path.replace(/^[/\\]+|[/\\]+$/g, "");
  const parts = clean.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Empty path.");
  }
  let dir = root();
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create });
  }
  return { dir, name: parts[parts.length - 1] };
}

export async function listDir(
  path = "",
): Promise<{ path: string; entries: FsEntryView[] }> {
  if (androidBackend) return androidBackend.listDir(path);
  const clean = path.replace(/^[/\\]+|[/\\]+$/g, "");
  const dir = clean
    ? await (await resolveDir(clean)).dir
    : root();
  const entries: FsEntryView[] = [];
  // @ts-expect-error async iterator exists at runtime
  for await (const [name, handle] of dir.entries()) {
    const isFile = handle.kind === "file";
    let size: number | null = null;
    let modified: number | null = null;
    if (isFile) {
      try {
        const f = await (handle as FileSystemFileHandle).getFile();
        size = f.size;
        modified = f.lastModified;
      } catch {
        // ignore unreadable entries
      }
    }
    entries.push({ name, kind: isFile ? "file" : "directory", size, modified });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: clean, entries };
}

export async function readFile(path: string): Promise<string> {
  if (androidBackend) return androidBackend.readFile(path);
  const { dir, name } = await resolveDir(path);
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return await file.text();
}

/** Binary read — works on both the browser and Android-root backends. */
export async function readFileBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  if (androidBackend?.readFileBytes) return androidBackend.readFileBytes(path);
  const { dir, name } = await resolveDir(path);
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

/** Binary write — works on both the browser and Android-root backends. */
export async function writeFileBytes(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (androidBackend?.writeFileBytes)
    return androidBackend.writeFileBytes(path, bytes);
  const { dir, name } = await resolveDir(path, true);
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(bytes);
  await writable.close();
  return `Wrote ${bytes.length} bytes to ${path}`;
}

export async function writeFile(path: string, content: string): Promise<string> {
  if (androidBackend) return androidBackend.writeFile(path, content);
  const { dir, name } = await resolveDir(path, true);
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
  return `Wrote ${content.length} bytes to ${path}`;
}

export async function makeDir(path: string): Promise<string> {
  if (androidBackend) return androidBackend.makeDir(path);
  await resolveDir(path, true);
  return `Created folder ${path}`;
}

export async function renamePath(from: string, to: string): Promise<string> {
  if (androidBackend) return androidBackend.renamePath(from, to);
  const src = await resolveDir(from);
  const dest = await resolveDir(to);
  const isDir = await isDirectory(from);
  if (isDir) {
    const destDir = await dest.dir.getDirectoryHandle(dest.name, { create: true });
    await copyDirectory(src.dir, destDir);
    await src.dir.removeEntry(src.name, { recursive: true });
  } else {
    const fh = await src.dir.getFileHandle(src.name);
    const file = await fh.getFile();
    const destFile = await dest.dir.getFileHandle(dest.name, { create: true });
    const w = await destFile.createWritable();
    await w.write(await file.arrayBuffer());
    await w.close();
    await src.dir.removeEntry(src.name);
  }
  return `Renamed ${from} → ${to}`;
}

export async function movePath(from: string, toDir: string): Promise<string> {
  if (androidBackend) return androidBackend.movePath(from, toDir);
  const name = from.split(/[\\/]+/).pop() ?? from;
  return await renamePath(from, `${toDir.replace(/[/\\]+$/, "")}/${name}`);
}

async function copyDirectory(
  src: FileSystemDirectoryHandle,
  dest: FileSystemDirectoryHandle,
) {
  // @ts-expect-error async iterator exists at runtime
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      const destFile = await dest.getFileHandle(name, { create: true });
      const w = await destFile.createWritable();
      await w.write(await file.arrayBuffer());
      await w.close();
    } else {
      const sub = await dest.getDirectoryHandle(name, { create: true });
      await copyDirectory(handle as FileSystemDirectoryHandle, sub);
    }
  }
}

async function isDirectory(path: string): Promise<boolean> {
  const { dir, name } = await resolveDir(path);
  try {
    await dir.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Trash-style delete: move into a hidden .jarvis-trash folder (undo-able). */
export async function deletePath(path: string): Promise<string> {
  if (androidBackend) return androidBackend.deletePath(path);
  const { dir, name } = await resolveDir(path);
  const isDir = await isDirectory(path);
  try {
    const trash = await root().getDirectoryHandle(".jarvis-trash", {
      create: true,
    });
    const stamp = Date.now().toString(36);
    if (isDir) {
      const destDir = await trash.getDirectoryHandle(`${name}.${stamp}`, {
        create: true,
      });
      await copyDirectory(dir, destDir);
    } else {
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      const destFile = await trash.getFileHandle(`${name}.${stamp}`, {
        create: true,
      });
      const w = await destFile.createWritable();
      await w.write(await file.arrayBuffer());
      await w.close();
    }
  } catch {
    // trash is best-effort; continue with delete
  }
  await dir.removeEntry(name, { recursive: isDir });
  return `Deleted ${path} (kept a backup in .jarvis-trash)`;
}

export async function restoreLastDeleted(): Promise<string> {
  if (androidBackend) return androidBackend.restoreLastDeleted();
  let trash: FileSystemDirectoryHandle;
  try {
    trash = await root().getDirectoryHandle(".jarvis-trash");
  } catch {
    return "Trash is empty — nothing to restore.";
  }
  // @ts-expect-error async iterator exists at runtime
  for await (const [name, handle] of trash.entries()) {
    // restore the most recent entry (timestamps are encoded in the name)
    const base = name.replace(/\.[a-z0-9]+$/i, "");
    const isDir = handle.kind === "directory";
    if (isDir) {
      const destDir = await root().getDirectoryHandle(base, { create: true });
      await copyDirectory(handle as FileSystemDirectoryHandle, destDir);
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      const destFile = await root().getFileHandle(base, { create: true });
      const w = await destFile.createWritable();
      await w.write(await file.arrayBuffer());
      await w.close();
    }
    await trash.removeEntry(name, { recursive: isDir });
    return `Restored ${base}`;
  }
  return "Trash is empty — nothing to restore.";
}

export async function exists(path: string): Promise<boolean> {
  if (androidBackend) return androidBackend.exists(path);
  try {
    const { dir, name } = await resolveDir(path);
    try {
      await dir.getFileHandle(name);
      return true;
    } catch {
      await dir.getDirectoryHandle(name);
      return true;
    }
  } catch {
    return false;
  }
}
