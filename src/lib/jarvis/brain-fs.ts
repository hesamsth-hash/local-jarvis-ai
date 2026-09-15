// FS action router — shared by the tool registry's file_controller,
// file_processor, code_helper and developer_agent handlers.

import {
  deletePath,
  exists,
  listDir,
  makeDir,
  movePath,
  readFile,
  renamePath,
  restoreLastDeleted,
  writeFile,
} from "./fs-tools";
import type { ToolResult } from "./tools";

export async function runFsAction(
  arg: string,
  isConnected: () => boolean,
  confirmAction?: (title: string, detail: string) => Promise<boolean>,
): Promise<ToolResult> {
  if (!isConnected()) {
    return {
      ok: false,
      data: 'No workspace connected. Say "connect folder" first.',
    };
  }
  const a = arg.trim();
  const text = a.toLowerCase();

  const fmt = (entries: { name: string; kind: string }[], path: string) =>
    entries.length
      ? `${path || "workspace root"}: ${entries
          .slice(0, 15)
          .map((e) => (e.kind === "directory" ? `${e.name}/` : e.name))
          .join(", ")}${entries.length > 15 ? `, +${entries.length - 15} more` : ""}`
      : `${path || "workspace root"} is empty.`;

  try {
    // zip <sources> into <name>.zip
    if (/^zip\b/i.test(text)) {
      const { zipFolderOrFiles } = await import("./archive");
      const m = a.match(/^zip\s+(.+?)\s+(?:into|to|as)\s+["']?([\w\- .]+\.zip)["']?$/i);
      if (!m) {
        return {
          ok: false,
          data: 'Try: "zip projects into backup.zip" (folders or files, space-separated).',
        };
      }
      const sources = m[1].split(/,|\band\b/).map((s) => s.replace(/["']/g, "").trim()).filter(Boolean);
      const zipName = m[2].replace(/["']/g, "").trim();
      if (await exists(zipName)) {
        return { ok: false, data: `"${zipName}" already exists — pick a different archive name.` };
      }
      return { ok: true, data: await zipFolderOrFiles(sources, zipName) };
    }

    // unzip <archive> [into <folder>]
    if (/^(unzip|extract)\b/i.test(text)) {
      const { unzipInto } = await import("./archive");
      const m = a.match(/^(?:unzip|extract)\s+["']?([\w\- ./]+\.zip)["']?(?:\s+(?:into|to|in)\s+["']?([\w\- ./]+)["']?)?$/i);
      if (!m) {
        return {
          ok: false,
          data: 'Try: "unzip backup.zip" or "unzip backup.zip into extracted".',
        };
      }
      const zipPath = m[1].replace(/["']/g, "").trim();
      const dest = (m[2]?.replace(/["']/g, "").trim()) || zipPath.replace(/\.zip$/i, "");
      return { ok: true, data: await unzipInto(zipPath, dest) };
    }

    // hash / checksum <path>
    if (/^(hash|checksum|sha)\b/i.test(text)) {
      const { describeFileHash } = await import("./archive");
      const path = a.replace(/^(hash|checksum|sha256|sha)\s*/i, "").replace(/["']/g, "").trim();
      if (!path) return { ok: false, data: 'Try: "hash notes.txt".' };
      if (!(await exists(path))) return { ok: false, data: `"${path}" doesn't exist in the workspace.` };
      return { ok: true, data: await describeFileHash(path) };
    }

    // duplicate finder
    if (/duplicate/i.test(text)) {
      const { findDuplicates, describeDupReport, deleteDuplicates } = await import("./archive");
      const patternM = a.match(/\*\.[a-z0-9]+|\*/i);
      const pattern = patternM ? patternM[0] : "*";
      if (/\b(delete|remove|clean|trash)\b/i.test(text)) {
        if (!/\bconfirm\b/i.test(text)) {
          const r = await findDuplicates("", pattern);
          const n = r.groups.reduce((acc, g) => acc + g.files.length - 1, 0);
          return {
            ok: n > 0,
            data: n > 0
              ? `${n} duplicate file${n === 1 ? "" : "s"} found. Say "delete duplicates confirm" to trash them (undo-able).`
              : "No duplicates to delete.",
          };
        }
        return { ok: true, data: await deleteDuplicates("", pattern) };
      }
      const report = await findDuplicates("", pattern);
      return { ok: true, data: describeDupReport(report) };
    }

    // list [path]
    const listM = a.match(/^(?:list|ls|show|browse|what.s in|explore)?\s*(.*)$/i);
    if (/^(list|ls|show|browse|explore)/i.test(text) || text === "") {
      const m = a.match(/(?:in|inside|of|from)\s+(.+)$/i);
      const path = m ? m[1].replace(/["']/g, "").trim() : "";
      const { entries } = await listDir(path);
      return { ok: true, data: fmt(entries, path) };
    }

    // undo delete
    if (/\b(undo|restore)\b/.test(text)) {
      return { ok: true, data: await restoreLastDeleted() };
    }

    // search <term>
    const searchM = a.match(/^(?:search|find)\s+(?:for\s+)?["']?(.+?)["']?$/i);
    if (searchM) {
      const term = searchM[1].toLowerCase();
      const { entries } = await listDir("");
      const hits = entries.filter((e) => e.name.toLowerCase().includes(term));
      return {
        ok: true,
        data: hits.length
          ? `Found: ${hits.map((h) => h.name).join(", ")}`
          : `No matches for "${term}" in the workspace root.`,
      };
    }

    // rename/move <a> to <b>
    const renM = a.match(/^(?:rename|move)\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?$/i);
    if (renM) {
      const from = renM[1].replace(/[.,;!?]+$/, "").trim();
      const to = renM[2].replace(/[.,;!?]+$/, "").trim();
      if (/^move/i.test(a) && !to.includes("/")) {
        return { ok: true, data: await movePath(from, to) };
      }
      return { ok: true, data: await renamePath(from, to) };
    }

    // mkdir <path>
    const mkM = a.match(/^(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\s+["']?(.+?)["']?$/i);
    if (mkM) return { ok: true, data: await makeDir(mkM[1].replace(/["']/g, "").trim()) };

    // write <path> with <text>
    const writeM = a.match(/^(?:write|create|make|new)\s+(?:file\s+)?["']?(.+?)["']?\s+(?:with|containing|saying)\s+["']?(.+?)["']?$/i);
    if (writeM) {
      return {
        ok: true,
        data: await writeFile(writeM[1].replace(/["']/g, "").trim(), writeM[2]),
      };
    }

    // delete <path>
    const delM = a.match(/^(?:delete|remove|trash)\s+["']?(.+?)["']?$/i);
    if (delM) {
      const path = delM[1].replace(/[.,;!?]+$/, "").trim();
      if (path === ".jarvis-trash") {
        return { ok: false, data: "I won't delete the trash folder itself." };
      }
      if (!(await exists(path))) {
        return { ok: false, data: `"${path}" doesn't exist in the workspace.` };
      }
      if (confirmAction && !(await confirmAction("Delete local file", `JARVIS is about to move "${path}" to the undoable trash.`))) {
        return { ok: false, data: "Cancelled — nothing was deleted." };
      }
      return { ok: true, data: await deletePath(path) };
    }

    // read <path>
    const readM = a.match(/^(?:read|open|cat|display)\s+["']?(.+?)["']?$/i);
    if (readM) {
      const path = readM[1].replace(/[.,;!?]+$/, "").trim();
      const content = await readFile(path);
      return {
        ok: true,
        data:
          content.length > 1200
            ? `${content.slice(0, 1200)}… (truncated)`
            : content,
      };
    }

    // bare path → read
    const content = await readFile(a.replace(/["']/g, ""));
    return { ok: true, data: content.slice(0, 1200) };
  } catch (e) {
    return {
      ok: false,
      data: e instanceof Error ? e.message : "File operation failed.",
    };
  }
}
