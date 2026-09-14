// Bug-checks for the archive module (zip / unzip / hash / duplicates).
// listDir + bytes come from the fake fs backend, so these run end-to-end.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  deleteDuplicates,
  describeDupReport,
  findDuplicates,
  hashFile,
  humanSize,
  unzipInto,
  zipFolderOrFiles,
} from "../src/lib/jarvis/archive";
import {
  exists,
  readFileBytes,
  setBackend,
  writeFile,
  writeFileBytes,
} from "../src/lib/jarvis/fs-tools";
import { makeFakeBackend } from "./fs-backend.test";

describe("archive over the fake backend", () => {
  beforeEach(() => {
    setBackend(makeFakeBackend());
  });
  afterEach(() => {
    setBackend(null);
  });

  test("humanSize formats sanely", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(2048)).toBe("2.0 KB");
    expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  test("hash is stable and correct for known input", async () => {
    await writeFileBytes("a.txt", new TextEncoder().encode("hello jarvis"));
    const h = await hashFile("a.txt");
    // verified against `printf 'hello jarvis' | sha256sum`
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(
      "8af06512e137ce5047e5190bb64f7d0d2a718398999672d0f9a9982b67a5e0b9",
    );
  });

  test("zip a folder → entries present; unzip restores them byte-identical", async () => {
    await writeFile("docs/a.txt", "alpha");
    await writeFile("docs/sub/b.txt", "bravo");

    const zipMsg = await zipFolderOrFiles(["docs"], "bundle.zip");
    expect(zipMsg).toContain("2 files");
    expect(await exists("bundle.zip")).toBe(true);

    await unzipInto("bundle.zip", "restored");
    expect(await exists("restored/docs/a.txt")).toBe(true);
    expect(await exists("restored/docs/sub/b.txt")).toBe(true);
    const bytes = await readFileBytes("restored/docs/sub/b.txt");
    expect(new TextDecoder().decode(bytes)).toBe("bravo");
  });

  test("unzip a corrupt file fails cleanly (no crash)", async () => {
    await writeFileBytes("bad.zip", new Uint8Array([1, 2, 3, 4]));
    expect(unzipInto("bad.zip", "out")).rejects.toThrow(/valid zip/i);
  });

  test("zip refuses missing source", async () => {
    expect(zipFolderOrFiles(["ghost"], "x.zip")).rejects.toThrow(/doesn't exist/i);
  });

  test("duplicates: identical content groups, differing content doesn't", async () => {
    await writeFileBytes("p1.jpg", new Uint8Array([9, 9, 9]));
    await writeFileBytes("copy of p1.jpg", new Uint8Array([9, 9, 9]));
    await writeFileBytes("other.jpg", new Uint8Array([1, 2, 3]));

    const report = await findDuplicates("");
    expect(report.groups.length).toBe(1);
    expect(report.groups[0]!.files.length).toBe(2);
    expect(report.wastedBytes).toBe(3);
    expect(describeDupReport(report)).toContain("reclaimable");
  });

  test("deleteDuplicates keeps one copy and frees the rest", async () => {
    await writeFileBytes("p1.jpg", new Uint8Array([7, 7, 7]));
    await writeFileBytes("dup.jpg", new Uint8Array([7, 7, 7]));
    await writeFileBytes("keep.jpg", new Uint8Array([8, 8, 8]));

    const msg = await deleteDuplicates("");
    expect(msg).toContain("Deleted 1 duplicate");
    // keeps the first copy in sorted order ("dup.jpg" < "p1.jpg")
    expect(await exists("dup.jpg")).toBe(true);
    expect(await exists("p1.jpg")).toBe(false);
    expect(await exists("keep.jpg")).toBe(true);
  });

  test(".jarvis-trash is never scanned for duplicates", async () => {
    await writeFileBytes("photo.jpg", new Uint8Array([5]));
    await writeFileBytes(".jarvis-trash/photo.jpg.abc", new Uint8Array([5]));
    const report = await findDuplicates("");
    expect(report.groups.length).toBe(0);
  });
});
