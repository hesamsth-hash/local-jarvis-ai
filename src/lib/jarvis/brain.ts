// Local intent brain — a deterministic, offline NLU that maps natural language
// to tools. No cloud, no API keys: everything runs on-device.

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
import type { ChatMessage } from "./types";

export interface BrainResult {
  reply: string;
  intent: string;
  tool?: string;
  ok: boolean;
  refreshFs?: boolean;
  refreshHistory?: boolean;
  navigate?: string;
}

export interface BrainDeps {
  speak: (text: string) => Promise<void>;
  connected: boolean;
  connectFolder: () => Promise<boolean>;
}

const HELP_TEXT = `Here's what I can do, all locally:
• "connect folder" — pick a workspace folder on your machine
• "list files" / "open <path>" — browse directories
• "read <file>" / "write <file> with <text>" — read & create files
• "rename <a> to <b>" · "move <a> to <dir>" · "delete <path>" — with trash + undo
• "search <term>" — find matching file names
• "speak <text>" · "say hello" — voice via Kokoro TTS
• "start listening" / "stop listening" — Whisper speech-to-text
• "undo delete" — restore the last trashed item
• "time", "date", "status", "help" — quick answers`;

function stripQuotes(s: string) {
  return s.replace(/^["']|["']$/g, "").trim();
}

function cleanPath(s: string) {
  return stripQuotes(s).replace(/[.,;!?]+$/, "");
}

export async function runBrain(
  input: string,
  deps: BrainDeps,
): Promise<BrainResult> {
  const raw = input.trim();
  const text = raw.toLowerCase();

  // ---------- connection ----------
  if (/^(connect|open|mount|choose|select)\s+(a\s+)?(folder|directory|workspace)/.test(text) || text === "connect folder") {
    if (!deps.connected) {
      const ok = await deps.connectFolder();
      return {
        reply: ok
          ? "Workspace connected. All file operations now run locally on your device."
          : "No folder was selected — nothing changed.",
        intent: "fs.connect",
        tool: "fs-tools",
        ok,
        refreshFs: ok,
      };
    }
    return {
      reply: "A workspace is already connected.",
      intent: "fs.connect",
      tool: "fs-tools",
      ok: true,
    };
  }

  // ---------- help ----------
  if (/^(help|what can you do|commands|capabilities)/.test(text)) {
    return { reply: HELP_TEXT, intent: "help", ok: true };
  }

  // ---------- status ----------
  if (/^(status|system status|report|diagnostics)/.test(text)) {
    const conn = deps.connected ? "connected" : "not connected";
    return {
      reply: `All systems nominal. Voice engines: Kokoro TTS and Whisper STT loaded locally. Workspace ${conn}. No data leaves this device.`,
      intent: "status",
      ok: true,
    };
  }

  // ---------- time / date ----------
  if (/\b(time|clock)\b/.test(text) && text.length < 30) {
    return {
      reply: `It is ${new Date().toLocaleTimeString()}.`,
      intent: "time",
      ok: true,
    };
  }
  if (/\b(date|day|today)\b/.test(text) && text.length < 30) {
    return {
      reply: `Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`,
      intent: "date",
      ok: true,
    };
  }

  // ---------- greeting ----------
  if (/^(hi|hello|hey|jarvis|good (morning|afternoon|evening))\b/.test(text) && text.length < 40) {
    return {
      reply: "At your service. All systems are running locally — how can I help?",
      intent: "greet",
      ok: true,
    };
  }

  // ---------- voice controls ----------
  if (/^stop (listening|mic|microphone)/.test(text)) {
    return { reply: "Voice input paused.", intent: "stt.stop", ok: true, navigate: "stop-listening" };
  }
  if (/^(start|begin) (listening|mic|microphone|voice)/.test(text)) {
    return { reply: "Listening.", intent: "stt.start", ok: true, navigate: "start-listening" };
  }

  // ---------- TTS ----------
  const sayMatch = raw.match(/^(?:say|speak|read out|announce)\s+["“]?(.+?)["”]?$/i);
  if (sayMatch) {
    return { reply: sayMatch[1], intent: "tts.speak", tool: "kokoro-tts", ok: true };
  }

  // ---------- undo ----------
  if (/\b(undo|restore)\b.*\b(delet|trash|remov)/.test(text) || /^undo$/.test(text)) {
    if (!deps.connected) return needConnection("undo a delete");
    const reply = await restoreLastDeleted();
    return { reply, intent: "fs.undo", tool: "fs-tools", ok: true, refreshFs: true };
  }

  // ---------- search ----------
  const searchMatch = text.match(/^(?:search|find|look for)\s+(?:for\s+)?["']?(.+?)["']?$/);
  if (searchMatch) {
    if (!deps.connected) return needConnection("search files");
    const term = searchMatch[1];
    const { entries } = await listDir("");
    const hits = entries.filter((e) => e.name.toLowerCase().includes(term));
    return {
      reply: hits.length
        ? `Found ${hits.length} match${hits.length === 1 ? "" : "es"} in the workspace root: ${hits.map((h) => h.name).join(", ")}.`
        : `No matches for "${term}" in the workspace root.`,
      intent: "fs.search",
      tool: "fs-tools",
      ok: true,
      refreshFs: true,
    };
  }

  // ---------- delete ----------
  const delMatch = text.match(/^(?:delete|remove|trash)\s+["']?(.+?)["']?$/);
  if (delMatch) {
    if (!deps.connected) return needConnection("delete a file");
    const path = cleanPath(delMatch[1]);
    if (path === ".jarvis-trash") {
      return { reply: "I won't delete the trash folder itself.", intent: "fs.delete", ok: false };
    }
    if (!(await exists(path))) {
      return { reply: `"${path}" doesn't exist in the workspace.`, intent: "fs.delete", ok: false };
    }
    const reply = await deletePath(path);
    return { reply, intent: "fs.delete", tool: "fs-tools", ok: true, refreshFs: true };
  }

  // ---------- rename ----------
  const renMatch = raw.match(/^(?:rename|move)\s+["']?(.+?)["']?\s+(?:to|as|into)\s+["']?(.+?)["']?$/i);
  if (renMatch) {
    if (!deps.connected) return needConnection("rename or move items");
    const from = cleanPath(renMatch[1]);
    const to = cleanPath(renMatch[2]);
    const isMove = /^(move)/i.test(raw.trim());
    let reply: string;
    if (isMove && !to.includes("/")) {
      reply = await movePath(from, to);
    } else {
      reply = await renamePath(from, to);
    }
    return { reply, intent: isMove ? "fs.move" : "fs.rename", tool: "fs-tools", ok: true, refreshFs: true };
  }

  // ---------- mkdir ----------
  const mkdirMatch = text.match(/^(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\s+["']?(.+?)["']?$/);
  if (mkdirMatch) {
    if (!deps.connected) return needConnection("create folders");
    const path = cleanPath(mkdirMatch[1]);
    const reply = await makeDir(path);
    return { reply, intent: "fs.mkdir", tool: "fs-tools", ok: true, refreshFs: true };
  }

  // ---------- write ----------
  const writeMatch = raw.match(/^(?:write|create|make|new)\s+(?:file\s+)?["']?(.+?)["']?\s+(?:with|containing|saying)\s+["']?(.+?)["']?$/i);
  if (writeMatch) {
    if (!deps.connected) return needConnection("write files");
    const path = cleanPath(writeMatch[1]);
    const content = writeMatch[2];
    const reply = await writeFile(path, content);
    return { reply, intent: "fs.write", tool: "fs-tools", ok: true, refreshFs: true };
  }

  // ---------- read ----------
  const readMatch = text.match(/^(?:read|open|show|cat|display)\s+["']?(.+?)["']?$/);
  if (readMatch) {
    if (!deps.connected) return needConnection("read files");
    const path = cleanPath(readMatch[1]);
    if (path === "" || path === "files" || path === "folder" || path === "workspace") {
      const { entries } = await listDir("");
      return {
        reply: entries.length
          ? `Workspace root contains ${entries.length} items: ${entries.map((e) => (e.kind === "directory" ? `${e.name}/` : e.name)).join(", ")}.`
          : "The workspace root is empty.",
        intent: "fs.list",
        tool: "fs-tools",
        ok: true,
        refreshFs: true,
      };
    }
    try {
      const content = await readFile(path);
      return {
        reply: content.length > 600 ? `${content.slice(0, 600)}… (truncated)` : content,
        intent: "fs.read",
        tool: "fs-tools",
        ok: true,
      };
    } catch {
      return { reply: `I couldn't read "${path}".`, intent: "fs.read", ok: false };
    }
  }

  // ---------- list ----------
  if (/\b(list|show|browse|what.s in|explore)\b/.test(text)) {
    if (!deps.connected) return needConnection("list your files");
    const m = text.match(/(?:in|inside|of|from)\s+["']?(.+?)["']?$/);
    const path = m ? cleanPath(m[1]) : "";
    const { entries } = await listDir(path);
    return {
      reply: entries.length
        ? `${path || "Workspace root"} has ${entries.length} items: ${entries
            .slice(0, 12)
            .map((e) => (e.kind === "directory" ? `${e.name}/` : e.name))
            .join(", ")}${entries.length > 12 ? `, and ${entries.length - 12} more` : ""}.`
        : `${path || "Workspace root"} is empty.`,
      intent: "fs.list",
      tool: "fs-tools",
      ok: true,
      refreshFs: true,
    };
  }

  // ---------- fallback ----------
  return {
    reply: `I run fully offline, so my skills are focused: filesystem tools, voice in/out, and system answers. Try "help" for the full command list — or ask me to "connect folder" to get started.`,
    intent: "unknown",
    ok: true,
  };
}

function needConnection(action: string): BrainResult {
  return {
    reply: `To ${action}, first connect a local workspace folder — say "connect folder".`,
    intent: "fs.connect-needed",
    ok: false,
  };
}

/** Convert a chat log into a compact transcript (kept for future local context use). */
export function transcriptOf(messages: ChatMessage[], max = 12): string {
  return messages
    .slice(-max)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
}
