// Archive + integrity tools — zip, unzip, hash and duplicate finding.
// All local: fflate does pure-JS zip, WebCrypto does SHA-256. Works over both
// the browser File System Access backend and the Android root-shell backend
// (which grew binary read/write support for exactly this).

import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import {
  listDir,
  readFileBytes,
  writeFileBytes,
  exists,
  deletePath,
} from "./fs-tools";

// ---------- size helpers ----------

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------- hashing ----------

/** SHA-256 of a file's bytes, hex-encoded. */
export async function hashFile(path: string): Promise<string> {
  const bytes = await readFileBytes(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Human description of a file's hash + size. */
export async function describeFileHash(path: string): Promise<string> {
  const [hash, bytes] = await Promise.all([hashFile(path), readFileBytes(path)]);
  return `${path} — SHA-256 ${hash} (${humanSize(bytes.length)})`;
}

// ---------- zip ----------

/** Which files go into a zip of a folder (recursive). */
async function collectFiles(dirPath: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (p: string) => {
    const { entries } = await listDir(p);
    for (const e of entries) {
      const rel = p ? `${p}/${e.name}` : e.name;
      if (e.kind === "directory") {
        await walk(rel);
      } else {
        out.push(rel);
      }
    }
  };
  await walk(dirPath);
  return out;
}

/**
 * Zip a folder (recursively) or a list of files into `zipPath`.
 * Uses the store method for already-compressed types, deflate otherwise.
 */
export async function zipFolderOrFiles(
  sources: string[],
  zipPath: string,
): Promise<string> {
  const tree: Record<string, Uint8Array> = {};
  let fileCount = 0;

  for (const src of sources) {
    if (!(await exists(src))) {
      throw new Error(`"${src}" doesn't exist in the workspace.`);
    }
    const { entries } = await listDir(src).catch(() => ({ entries: [] }));
    const isDir = entries.length > 0;
    if (isDir) {
      const files = await collectFiles(src);
      const base = src.split("/").pop() ?? src;
      for (const f of files) {
        tree[`${base}/${f.slice(src.length + 1)}`] = await readFileBytes(f);
      }
      fileCount += files.length;
    } else {
      tree[src.split("/").pop() ?? src] = await readFileBytes(src);
      fileCount += 1;
    }
  }

  if (fileCount === 0) throw new Error("Nothing to zip — source is empty.");

  const zipped = zipSync(tree, {
    // fflate picks deflate by default; this stays synchronous + simple
  });
  await writeFileBytes(zipPath, zipped as Uint8Array<ArrayBuffer>);
  return `Zipped ${fileCount} file${fileCount === 1 ? "" : "s"} → ${zipPath} (${humanSize(zipped.length)})`;
}

// ---------- unzip ----------

/** Extract a zip into a target folder (created if missing). */
export async function unzipInto(
  zipPath: string,
  destDir: string,
): Promise<string> {
  const bytes = await readFileBytes(zipPath);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("That doesn't look like a valid zip archive.");
  }
  const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
  let made = 0;
  for (const name of names) {
    const outPath = destDir ? `${destDir}/${name}` : name;
    await writeFileBytes(outPath, entries[name]! as Uint8Array<ArrayBuffer>);
    made++;
  }
  return `Extracted ${made} file${made === 1 ? "" : "s"} from ${zipPath} → ${destDir || "workspace root"}`;
}

// ---------- duplicate finder ----------

export interface DupGroup {
  hash: string;
  size: number;
  files: string[];
}

export interface DupReport {
  groups: DupGroup[];
  scanned: number;
  wastedBytes: number;
}

/** Match files by name pattern; "*" = everything. */
function matchPattern(name: string, pattern: string): boolean {
  if (!pattern || pattern === "*") return true;
  const re = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    "i",
  );
  return re.test(name);
}

/**
 * Find duplicate files under `root` (recursive), grouped by content hash.
 * `pattern` narrows candidates, e.g. "*.jpg" or "*.mp3".
 */
export async function findDuplicates(
  root = "",
  pattern = "*",
): Promise<DupReport> {
  const files: { path: string; size: number }[] = [];
  const walk = async (p: string) => {
    const { entries } = await listDir(p);
    for (const e of entries) {
      if (e.name === ".jarvis-trash") continue; // never scan the trash
      const rel = p ? `${p}/${e.name}` : e.name;
      if (e.kind === "directory") {
        await walk(rel);
      } else if (matchPattern(e.name, pattern)) {
        files.push({ path: rel, size: e.size ?? 0 });
      }
    }
  };
  await walk(root);

  // group by size first (cheap), hash only within equal-size groups
  const bySize = new Map<number, string[]>();
  for (const f of files) {
    bySize.set(f.size, [...(bySize.get(f.size) ?? []), f.path]);
  }

  const groups: DupGroup[] = [];
  let wasted = 0;
  let scanned = 0;
  for (const [size, paths] of bySize) {
    if (paths.length < 2 || size === 0) continue;
    const byHash = new Map<string, string[]>();
    for (const p of paths) {
      const h = await hashFile(p);
      scanned++;
      byHash.set(h, [...(byHash.get(h) ?? []), p]);
    }
    for (const [hash, ps] of byHash) {
      if (ps.length >= 2) {
        groups.push({ hash, size, files: ps.sort() });
        wasted += size * (ps.length - 1);
      }
    }
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  return { groups, scanned, wastedBytes: wasted };
}

export function describeDupReport(r: DupReport): string {
  if (r.groups.length === 0) {
    return `No duplicates found (${r.scanned === 0 ? "nothing hashable" : `${r.scanned} same-size files hashed`}).`;
  }
  const lines = r.groups.slice(0, 5).map((g, i) => {
    const keep = g.files[0];
    const dups = g.files.slice(1).join(", ");
    return `${i + 1}. ${humanSize(g.size)} ×${g.files.length}: keep ${keep} · dups: ${dups}`;
  });
  const more =
    r.groups.length > 5 ? `\n… +${r.groups.length - 5} more groups` : "";
  return `Found ${r.groups.length} duplicate group${r.groups.length === 1 ? "" : "s"} — ${humanSize(r.wastedBytes)} reclaimable.\n${lines.join("\n")}${more}\nSay "delete duplicates" to trash the extras (undo-able).`;
}

/**
 * Delete every duplicate beyond the first file of each group.
 * Goes through the normal trash flow → "undo delete" brings them back.
 */
export async function deleteDuplicates(
  root = "",
  pattern = "*",
): Promise<string> {
  const report = await findDuplicates(root, pattern);
  if (report.groups.length === 0) return "No duplicates to delete.";
  let deleted = 0;
  let freed = 0;
  for (const g of report.groups) {
    for (const dup of g.files.slice(1)) {
      await deletePath(dup);
      deleted++;
      freed += g.size;
    }
  }
  return `Deleted ${deleted} duplicate file${deleted === 1 ? "" : "s"} — ${humanSize(freed)} freed. "undo delete" restores them.`;
}
