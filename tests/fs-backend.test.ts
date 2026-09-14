// Bug-check suite for the filesystem layer (fake in-memory backend).
// Run: bun test tests/fs-backend.test.ts

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  deletePath,
  exists,
  listDir,
  makeDir,
  movePath,
  readFile,
  readFileBytes,
  renamePath,
  restoreLastDeleted,
  setBackend,
  writeFile,
  writeFileBytes,
  type FsBackend,
} from "../src/lib/jarvis/fs-tools";
import type { FsEntryView } from "../src/lib/jarvis/types";

/** Minimal in-memory backend that honors the full FsBackend contract. */
export function makeFakeBackend(): FsBackend & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([""]);
  const norm = (p: string) => p.replace(/^[/\\]+|[/\\]+$/g, "");
  const parent = (p: string) => norm(p).split("/").slice(0, -1).join("/");
  const base = (p: string) => norm(p).split("/").pop() ?? "";

  const b: FsBackend & { files: Map<string, Uint8Array> } = {
    files,
    name: () => "fake",
    async listDir(path) {
      const clean = norm(path);
      const prefix = clean ? `${clean}/` : "";
      const seen = new Map<string, FsEntryView>();
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        if (rest.includes("/")) {
          const d = rest.split("/")[0]!;
          if (!seen.has(d)) seen.set(d, { name: d, kind: "directory", size: null, modified: null });
        } else {
          seen.set(rest, { name: rest, kind: "file", size: files.get(f)!.length, modified: null });
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix) && d !== clean) {
          const rest = d.slice(prefix.length);
          if (rest && !rest.includes("/")) {
            if (!seen.has(rest)) seen.set(rest, { name: rest, kind: "directory", size: null, modified: null });
          }
        }
      }
      return { path: clean, entries: [...seen.values()] };
    },
    async readFile(path) {
      const bytes = files.get(norm(path));
      if (bytes === undefined) throw new Error(`no such file: ${path}`);
      return new TextDecoder().decode(bytes);
    },
    async writeFile(path, content) {
      const p = norm(path);
      dirs.add(parent(p));
      files.set(p, new TextEncoder().encode(content));
      return `Wrote ${content.length} bytes to ${p}`;
    },
    async makeDir(path) {
      dirs.add(norm(path));
      return `Created folder ${path}`;
    },
    async renamePath(from, to) {
      const f = norm(from);
      const t = norm(to);
      if (!files.has(f)) throw new Error(`no such file: ${from}`);
      dirs.add(parent(t));
      files.set(t, files.get(f)!);
      files.delete(f);
      return `Renamed ${f} → ${t}`;
    },
    async movePath(from, toDir) {
      return b.renamePath(from, `${norm(toDir)}/${base(from)}`);
    },
    async deletePath(path) {
      files.delete(norm(path));
      return `Deleted ${path}`;
    },
    async restoreLastDeleted() {
      return "Trash is empty — nothing to restore.";
    },
    async exists(path) {
      return files.has(norm(path)) || dirs.has(norm(path));
    },
    async readFileBytes(path) {
      const bytes = files.get(norm(path));
      if (bytes === undefined) throw new Error(`no such file: ${path}`);
      return bytes;
    },
    async writeFileBytes(path, bytes) {
      const p = norm(path);
      dirs.add(parent(p));
      files.set(p, bytes);
      return `Wrote ${bytes.length} bytes to ${p}`;
    },
  };
  return b;
}

describe("fs-tools over a fake backend", () => {
  let backend: ReturnType<typeof makeFakeBackend>;

  beforeEach(() => {
    backend = makeFakeBackend();
    setBackend(backend);
  });

  afterEach(() => {
    setBackend(null);
  });

  test("write → list → read round-trips text", async () => {
    await writeFile("notes/todo.txt", "buy milk");
    const { entries } = await listDir("notes");
    expect(entries.map((e) => e.name)).toEqual(["todo.txt"]);
    expect(await readFile("notes/todo.txt")).toBe("buy milk");
  });

  test("write/read bytes round-trips binary (zip path)", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x42]);
    await writeFileBytes("a/data.bin", bytes);
    expect(await readFileBytes("a/data.bin")).toEqual(bytes);
    expect((await readFileBytes("a/data.bin")).length).toBe(7);
  });

  test("read of a missing file throws (callers surface it)", async () => {
    expect(readFile("ghost.txt")).rejects.toThrow();
    expect(readFileBytes("ghost.bin")).rejects.toThrow();
  });

  test("exists is truthful", async () => {
    await writeFile("x.txt", "hi");
    expect(await exists("x.txt")).toBe(true);
    expect(await exists("nope.txt")).toBe(false);
  });

  test("rename + move preserve content", async () => {
    await writeFile("old.txt", "payload");
    await renamePath("old.txt", "sub/new.txt");
    expect(await exists("old.txt")).toBe(false);
    expect(await readFile("sub/new.txt")).toBe("payload");
    await movePath("sub/new.txt", "");
    expect(await readFile("new.txt")).toBe("payload");
  });

  test("empty-workspace listing is safe", async () => {
    const { entries, path } = await listDir("");
    expect(entries).toEqual([]);
    expect(path).toBe("");
  });
});
