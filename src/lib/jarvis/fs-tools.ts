// Filesystem tools — real local operations via the browser File System Access API.
// The user explicitly picks a root folder once; everything after that happens on-device.

import type { FsEntryView } from "./types";

export function fsSupported(): boolean {
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
  const store = globalThis as unknown as {
    __jarvisRoot?: FileSystemDirectoryHandle;
  };
  if (!store.__jarvisRoot) {
    throw new Error("No workspace folder connected. Say \"connect folder\" first.");
  }
  return store.__jarvisRoot;
}

export function setRoot(handle: FileSystemDirectoryHandle) {
  (globalThis as unknown as { __jarvisRoot?: FileSystemDirectoryHandle })
    .__jarvisRoot = handle;
}

export function hasRoot(): boolean {
  return !!(globalThis as unknown as { __jarvisRoot?: FileSystemDirectoryHandle })
    .__jarvisRoot;
}

export function rootName(): string | null {
  return (
    (globalThis as unknown as { __jarvisRoot?: FileSystemDirectoryHandle })
      .__jarvisRoot?.name ?? null
  );
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
  const { dir, name } = await resolveDir(path);
  const fh = await dir.getFileHandle(name);
  const file = await fh.getFile();
  return await file.text();
}

export async function writeFile(path: string, content: string): Promise<string> {
  const { dir, name } = await resolveDir(path, true);
  const fh = await dir.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
  return `Wrote ${content.length} bytes to ${path}`;
}

export async function makeDir(path: string): Promise<string> {
  await resolveDir(path, true);
  return `Created folder ${path}`;
}

export async function renamePath(from: string, to: string): Promise<string> {
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
