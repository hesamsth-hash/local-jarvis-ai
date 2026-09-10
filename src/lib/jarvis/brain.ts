// Local intent brain — two tiers:
//  1. Offline deterministic intents (always available, instant)
//  2. Local LLM + tool registry (Ollama / Kobold / LM Studio) when connected

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
import {
  executeTool,
  toolsForLlm,
  type ToolContext,
  type ToolResult,
} from "./tools";
import {
  llmChat,
  planToolCall,
  parseToolCall,
  type LlmConfig,
} from "./llm";
import type { ChatMessage } from "./types";

export interface BrainResult {
  reply: string;
  intent: string;
  tool?: string;
  ok: boolean;
  refreshFs?: boolean;
  refreshHistory?: boolean;
  navigate?: string;
  /** Set when a tool returned a media stream (screen / camera). */
  media?: MediaStream;
}

export interface BrainDeps {
  speak: (text: string) => Promise<void>;
  connected: boolean;
  connectFolder: () => Promise<boolean>;
  toolCtx: ToolContext;
  llm: LlmConfig;
  llmReady: boolean;
}

const HELP_TEXT = `Here's what I can do, all locally:

Offline (no LLM needed):
• "connect folder" — pick a workspace folder on your machine
• "list files" / "read <file>" / "write <file> with <text>" — file tools
• "rename <a> to <b>" · "move <a> to <dir>" · "delete <path>" · "undo delete"
• "speak <text>" — Kokoro voice · "start/stop listening" — Whisper
• "time", "date", "status", "help"

With a local LLM connected (Ollama / Kobold / LM Studio) you also get:
• Web search, weather, YouTube & browser control
• System monitor, screen & camera capture, app launching
• Code review, developer agent, file processing
• Reminders, messages, flights, game launchers, background monitors, check-ins

Connect one in the Brain tab → I'll route your requests through your own model.`;

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

  // ---------- always-offline intents ----------
  if (
    /^(connect|open|mount|choose|select)\s+(a\s+)?(folder|directory|workspace)/.test(text) ||
    text === "connect folder"
  ) {
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

  if (/^(help|what can you do|commands|capabilities)/.test(text)) {
    return { reply: HELP_TEXT, intent: "help", ok: true };
  }

  if (/^(status|system status|report|diagnostics)/.test(text)) {
    const conn = deps.connected ? "connected" : "not connected";
    const brain = deps.llmReady
      ? `local LLM online (${deps.llm.model || "default model"})`
      : "offline intent mode";
    return {
      reply: `All systems nominal. Brain: ${brain}. Engines: Kokoro TTS + Whisper STT local. Workspace ${conn}. No data leaves this device.`,
      intent: "status",
      ok: true,
    };
  }

  if (/\b(time|clock)\b/.test(text) && text.length < 30) {
    return { reply: `It is ${new Date().toLocaleTimeString()}.`, intent: "time", ok: true };
  }
  if (/\b(date|day|today)\b/.test(text) && text.length < 30) {
    return {
      reply: `Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`,
      intent: "date",
      ok: true,
    };
  }

  if (/^(hi|hello|hey|jarvis|good (morning|afternoon|evening))\b/.test(text) && text.length < 40) {
    return {
      reply: "At your service. All systems are running locally — how can I help?",
      intent: "greet",
      ok: true,
    };
  }

  if (/^stop (listening|mic|microphone)/.test(text)) {
    return { reply: "Voice input paused.", intent: "stt.stop", ok: true, navigate: "stop-listening" };
  }
  if (/^(start|begin) (listening|mic|microphone|voice)/.test(text)) {
    return { reply: "Listening.", intent: "stt.start", ok: true, navigate: "start-listening" };
  }

  const sayMatch = raw.match(/^(?:say|speak|read out|announce)\s+["“]?(.+?)["”]?$/i);
  if (sayMatch) {
    return { reply: sayMatch[1], intent: "tts.speak", tool: "kokoro-tts", ok: true };
  }

  // ---------- LLM + tool registry tier ----------
  if (deps.llmReady) {
    try {
      const result = await runLlmTurn(raw, deps);
      if (result) return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "LLM request failed";
      return {
        reply: `Local model error: ${msg}. Check that the server is running and the model is loaded — falling back to offline intents.`,
        intent: "llm.error",
        ok: false,
      };
    }
  }

  // ---------- offline file intents (fallback tier) ----------
  if (/\b(undo|restore)\b.*\b(delet|trash|remov)/.test(text) || /^undo$/.test(text)) {
    if (!deps.connected) return needConnection("undo a delete");
    const reply = await restoreLastDeleted();
    return { reply, intent: "fs.undo", tool: "fs-tools", ok: true, refreshFs: true };
  }

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
    return {
      reply,
      intent: isMove ? "fs.move" : "fs.rename",
      tool: "fs-tools",
      ok: true,
      refreshFs: true,
    };
  }

  const mkdirMatch = text.match(/^(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\s+["']?(.+?)["']?$/);
  if (mkdirMatch) {
    if (!deps.connected) return needConnection("create folders");
    const reply = await makeDir(cleanPath(mkdirMatch[1]));
    return { reply, intent: "fs.mkdir", tool: "fs-tools", ok: true, refreshFs: true };
  }

  const writeMatch = raw.match(/^(?:write|create|make|new)\s+(?:file\s+)?["']?(.+?)["']?\s+(?:with|containing|saying)\s+["']?(.+?)["']?$/i);
  if (writeMatch) {
    if (!deps.connected) return needConnection("write files");
    const reply = await writeFile(cleanPath(writeMatch[1]), writeMatch[2]);
    return { reply, intent: "fs.write", tool: "fs-tools", ok: true, refreshFs: true };
  }

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
    reply: deps.llmReady
      ? "I couldn't map that to a tool. Try naming the capability, e.g. \"weather in Berlin\", \"search quantum computing\", \"screen\", or \"remind me in 20 minutes to stretch\"."
      : 'I\'m in offline intent mode right now — try "help" for my skills, or connect a local LLM in the Brain tab (Ollama / Kobold / LM Studio) to unlock search, weather, code review and more.',
    intent: "unknown",
    ok: true,
  };
}

// ================= LLM turn loop =================

async function runLlmTurn(
  raw: string,
  deps: BrainDeps,
): Promise<BrainResult | null> {
  const { llm, toolCtx } = deps;
  const specs = toolsForLlm();

  // hop 1: which tool?
  const plan = await planToolCall(llm, raw, specs);
  if (!plan) {
    // plain chat — no tool needed
    const answer = await llmChat(llm, [
      {
        role: "system",
        content:
          "You are JARVIS, a local personal assistant on the user's machine. Be concise and helpful. You have no tools in this turn.",
      },
      { role: "user", content: raw },
    ]);
    return { reply: answer, intent: "llm.chat", tool: "local-llm", ok: true };
  }

  // execute up to 3 tool hops
  let last: ToolResult = { ok: false, data: "no result" };
  let usedTool = plan.tool;
  let userText = raw;
  for (let hop = 0; hop < 3; hop++) {
    last = await executeTool(plan.tool, String(plan.args["arg"] ?? plan.args["0"] ?? stringifyArgs(plan.args)), toolCtx);
    // feed the result back; the model may want another tool
    const follow = await llmChat(llm, [
      {
        role: "system",
        content:
          'You are JARVIS. You asked for a tool call and received its result. If the task is complete, answer the user concisely in plain text. If you need one more tool, reply with exactly {"tool":"<id>","args":{...}}.',
      },
      { role: "user", content: userText },
      { role: "assistant", content: `{"tool":"${plan.tool}","args":${JSON.stringify(plan.args)}}` },
      { role: "user", content: `[TOOL_RESULT ok=${last.ok}] ${last.data}` },
    ], { maxTokens: 350 });
    const next = parseToolCall(follow);
    if (!next) {
      return {
        reply: follow,
        intent: `llm.tool:${plan.tool}`,
        tool: usedTool,
        ok: last.ok,
        media: last.media,
      };
    }
    // model requested another hop
    usedTool = next.tool;
    userText = follow;
    plan.tool = next.tool;
    plan.args = next.args;
    // tools that returned media should stop after follow-up
    if (last.media) {
      return {
        reply: `${last.data}`,
        intent: `llm.tool:${usedTool}`,
        tool: usedTool,
        ok: last.ok,
        media: last.media,
      };
    }
  }

  return {
    reply: last.data,
    intent: `llm.tool:${usedTool}`,
    tool: usedTool,
    ok: last.ok,
    media: last.media,
  };
}

function stringifyArgs(args: Record<string, unknown>): string {
  const values = Object.values(args).filter((v) => typeof v === "string");
  if (values.length > 0) return values.join(" ");
  const first = Object.values(args)[0];
  return first === undefined ? "" : String(first);
}

function needConnection(action: string): BrainResult {
  return {
    reply: `To ${action}, first connect a local workspace folder — say "connect folder".`,
    intent: "fs.connect-needed",
    ok: false,
  };
}

/** Convert a chat log into a compact transcript (kept for future context use). */
export function transcriptOf(messages: ChatMessage[], max = 12): string {
  return messages
    .slice(-max)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
}
