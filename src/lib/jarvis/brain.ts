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
  FAILOVER_PRESETS,
  keylessConfig,
  llmChat,
  planToolCall,
  parseToolCall,
  type LlmConfig,
} from "./llm";
import {
  continueReply,
  extractFileName,
  isTrivialCommand,
  logActivity,
  stampSeen,
} from "./memory";
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
  /** Recent conversation so follow-ups ("and in euros?") work. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Called when a failover preset proved alive and was adopted. */
  onBrainAdopted?: (cfg: LlmConfig) => void;
  /** Voice-mode hooks so "wake word on / hands-free on" work by voice too. */
  onWakeWord?: (on: boolean) => void;
  onHandsFree?: (on: boolean) => void;
  /** Sound-device hooks — speakers, mic and volume, Windows-settings style. */
  onAudioOutput?: (id: string | null) => void;
  onAudioInput?: (id: string | null) => void;
  onVolume?: (v: number) => void;
  useHeadphones?: () => Promise<string>;
  /** Switch the active workspace; returns a spoken confirmation or null. */
  switchWorkspace?: (name: string) => Promise<string | null>;
}

const HELP_TEXT = `Here's what I can do, all locally:

Offline (no LLM needed):
• "wake word on" — say "Jarvis" anywhere to get my attention · "hands-free on" — full conversation loop
• "switch workspace <name>" — jump between connected folders
• "connect folder" — pick a workspace folder on your machine
• "list files" / "read <file>" / "write <file> with <text>" — file tools
• "rename <a> to <b>" · "move <a> to <dir>" · "delete <path>" · "undo delete"
• "remember that …" — persistent memory · "what do you remember?" · "forget …"
• "speak <text>" — Kokoro voice · "start/stop listening" — Whisper
• "use headphones" · "speakers" · "set microphone to …" · "volume 40" — sound devices
• "focus 25" — focus timer with a ping when it ends · "export transcript"
• "battery" — device health (real values on rooted Android)
• "bulk rename *.jpg to trip-" — rename all matching files at once
• "zip <folder|file> into <name>.zip" · "unzip <name>.zip [into folder]" · "hash <file>" — archives + checksums
• "find duplicates" / "find duplicates *.jpg" — content-hash duplicate scan · "delete duplicates confirm" reclaims the space
• "continue" — pick up where we left off · "time", "date", "status", "help"

With a brain connected (keyless cloud by default — or your own Ollama / Kobold / LM Studio) you also get:
• Web search, weather, YouTube & browser control
• System monitor, screen & camera capture, app launching
• Code review, developer agent, file processing
• Reminders, messages, flights, game launchers, background monitors, check-ins
• I can BUILD new tools on the fly — if I'm missing a capability, say so and
  I'll write + install a small plugin for it right now ("make me a tool that …")

Connect one in the Brain tab → I'll route your requests through it.`;

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

  // continuity: record what the user is doing (local-only activity log).
  // Filler commands ("bye", "ok", "thanks") don't pollute the log —
  // they used to resurface as "where we left off" on the next launch.
  stampSeen();
  if (!isTrivialCommand(raw)) {
    logActivity("command", `asked: ${raw.slice(0, 120)}`, extractFileName(raw));
  }

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

  // voice-mode intents (work with zero brain)
  if (/wake word/i.test(text) && /\b(on|enable|start|arm)\b/i.test(text)) {
    deps.onWakeWord?.(true);
    return { reply: 'Wake word armed — just say "Jarvis" and I\'ll listen for your command.', intent: "voice.wake", ok: true };
  }
  if (/hands.?free/i.test(text) && /\b(on|enable|start|engage)\b/i.test(text)) {
    deps.onHandsFree?.(true);
    return { reply: "Hands-free engaged. I\'ll re-listen after every reply — just talk.", intent: "voice.handsfree", ok: true };
  }
  if (/(wake word|hands.?free)/i.test(text) && /\b(off|disable|stop)\b/i.test(text)) {
    deps.onHandsFree?.(false);
    deps.onWakeWord?.(false);
    return { reply: "Voice modes off — back to push-to-talk.", intent: "voice.modes", ok: true };
  }
  // sound-device intents ("use headphones", "set microphone", "volume")
  if (/^\s*(test (voice|audio|sound)|say something|audio check)\s*$/i.test(text)) {
    return {
      reply: "Audio check — if you can hear this, we're good, Sir.",
      intent: "audio.test",
      ok: true,
    };
  }
  if (/\b(use|switch to|route (audio|sound) to|send (audio|sound) to)\b/i.test(text) && /headphones?|headset|earphones?|earbuds?/i.test(text)) {
    const r = await deps.useHeadphones?.();
    if (r) return { reply: r, intent: "audio.output", ok: true };
  }
  if (/\b(use|switch to|route (audio|sound) to|send (audio|sound) to)\b/i.test(text) && /\b(speakers?|default|laptop|monitor)\b/i.test(text)) {
    deps.onAudioOutput?.(null);
    return { reply: "Back on the system default speaker.", intent: "audio.output", ok: true };
  }
  const micSet = text.match(/\b(?:mic|microphone)\s+(?:to|→)?\s*(?:the\s+)?(.{2,60})$/i);
  if (/\b(set|use|switch)\b/i.test(text) && /\b(mic|microphone)\b/i.test(text) && micSet && !/default/i.test(micSet[1])) {
    deps.onAudioInput?.("__by_name__:" + micSet[1].trim().replace(/["'.]$/g, ""));
    return { reply: `Microphone set — I'll capture from “${micSet[1].trim()}” when we next listen.`, intent: "audio.input", ok: true };
  }
  if (/\b(set|use|switch)\b/i.test(text) && /\b(mic|microphone)\b/i.test(text) && /default/i.test(text)) {
    deps.onAudioInput?.(null);
    return { reply: "Microphone back on the system default.", intent: "audio.input", ok: true };
  }
  const vol = text.match(/\b(?:volume|voice level)\s*(?:to|at)?\s*(\d{1,3})\s*(?:%|percent)?/i);
  if (vol) {
    const pct = Math.min(100, Math.max(0, Number(vol[1])));
    deps.onVolume?.(pct / 100);
    return { reply: `Voice volume set to ${pct} percent.`, intent: "audio.volume", ok: true };
  }
  // workspace switching (multiple folders / Android storage areas)
  if (/(switch|change)\s+(to\s+)?(workspace|folder|storage)/i.test(text) && !/connect|pick|add/i.test(text)) {
    const r = await deps.switchWorkspace?.(text.replace(/.*(?:workspace|folder|storage)\s*(?:to\s+)?/i, "").replace(/["']/g, "").trim());
    if (r) return { reply: r, intent: "fs.workspace", ok: true };
  }

  if (/^(help|what can you do|commands|capabilities)/.test(text)) {
    return { reply: HELP_TEXT, intent: "help", ok: true };
  }

  if (/^(status|system status|report|diagnostics)/.test(text)) {
    const conn = deps.connected ? "connected" : "not connected";
    const brain = deps.llmReady
      ? `local LLM online (${deps.llm.model || "default model"})`
      : "offline intent mode";
    let health = "";
    try {
      const nav = navigator as Navigator & {
        getBattery?: () => Promise<{ level: number; charging: boolean }>;
      };
      const b = await nav.getBattery?.();
      if (b)
        health = ` Battery ${Math.round(b.level * 100)}%${b.charging ? " (charging)" : ""}.`;
    } catch {
      // ignore
    }
    return {
      reply: `All systems nominal. Brain: ${brain}. Engines: Kokoro TTS + Whisper STT local. Workspace ${conn}.${health} No data leaves this device.`,
      intent: "status",
      ok: true,
    };
  }

  // Focus mode — works fully offline
  if (/^(?:focus|pomodoro)\s*(?:mode\s*)?(?:on\s*)?(?:for\s*)?(\d+)?\s*(?:minutes?|mins?|m)?\s*(?:mode\s*)?$/i.test(text)) {
    const mins = /(?:for\s+)?(\d+)/.exec(text)?.[1];
    const r = await executeTool("focus_mode", mins ?? "25", deps.toolCtx);
    return { reply: r.data, intent: "focus.start", tool: "focus_mode", ok: r.ok };
  }
  if (/(?:focus|pomodoro).*(?:off|stop|cancel|end)/i.test(text) && text.length < 40) {
    return {
      reply: "Focus timer cleared — no ping at the end.",
      intent: "focus.stop",
      ok: true,
    };
  }
  if (/^(?:export|save|download) (?:the )?(?:transcript|chat|conversation|history)\b/.test(text)) {
    const r = await executeTool("transcript_export", "", deps.toolCtx);
    return { reply: r.data, intent: "transcript.export", tool: "transcript_export", ok: r.ok };
  }
  if (/^(?:battery|device health|how much battery|thermal|device temperature)\b/.test(text)) {
    const r = await executeTool("device_health", "", deps.toolCtx);
    return { reply: r.data, intent: "device.health", tool: "device_health", ok: r.ok };
  }
  // Bulk rename — offline, straight on the workspace
  const bulkMatch = raw.match(/^(?:bulk[- ]?rename|rename all|rename every)\s+(?:all\s+)?\*?\.?([a-z0-9]+)?\s*(?:files?\s*)?to\s+["']?(.+?)["']?\s*$/i)
    ?? raw.match(/^(?:bulk[- ]?rename|rename all)\s+replace\s+(.+?)\s+with\s+(.+?)\s*$/i);
  if (bulkMatch) {
    if (!deps.connected) return needConnection("bulk rename files");
    const r = await executeTool("bulk_rename", raw.replace(/^(?:bulk[- ]?rename|rename all|rename every)\s+/i, ""), deps.toolCtx);
    return { reply: r.data, intent: "fs.bulkrename", tool: "bulk_rename", ok: r.ok, refreshFs: true };
  }

  // ---------- archive + duplicate tools (offline, workspace-level) ----------
  if (/^\s*(zip|unzip|extract)\b/i.test(raw) || /^\s*(hash|checksum|sha256?)\s+\S/i.test(raw)) {
    if (!deps.connected) return needConnection("work with archives");
    const r = await executeTool("fs", raw.trim(), deps.toolCtx);
    return { reply: r.data, intent: "fs.archive", tool: "file_controller", ok: r.ok, refreshFs: true };
  }
  if (/\bduplicate/i.test(text)) {
    if (!deps.connected) return needConnection("find duplicates");
    const arg = /\*(?:\.\w+)?/.test(raw) ? raw.match(/\*(?:\.\w+)?/)![0] : "*";
    const del = /\b(delete|remove|clean|trash)\b/i.test(text);
    const confirm = /\bconfirm\b/i.test(text);
    const argStr = del ? `duplicates delete ${arg}${confirm ? " confirm" : ""}` : `duplicates ${arg}`;
    const r = await executeTool("fs", argStr, deps.toolCtx);
    return { reply: r.data, intent: "fs.duplicates", tool: "file_controller", ok: r.ok, refreshFs: del && confirm };
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

  // Closings: short friendly goodbye + stop — nothing more.
  if (
    /^(bye|goodbye|good night|goodnight|see you|see ya|later|that'?s all|nothing else|shut ?down|power (down|off)|stand ?by)\b[\s!.,'"]*$/i.test(
      text,
    ) ||
    /^(ok|okay|alright|cool|nice|great|thanks|thank you|ty)\b[\s!.,'"]*$/i.test(text)
  ) {
    return {
      reply: /night|bye|goodbye|later|see (you|ya)|shut|power|stand/i.test(text)
        ? "Goodbye, Sir. Going to standby — say anything to wake me."
        : "At your service.",
      intent: "session.close",
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

  // ---------- memory (offline, always available) ----------
  const rememberMatch = raw.match(/^(?:remember|note)\s+(?:that\s+)?["“]?(.+?)["”]?$/i);
  if (rememberMatch) {
    const { remember } = await import("./memory");
    const r = remember(rememberMatch[1], "fact");
    return { reply: r.data, intent: "memory.remember", tool: "memory", ok: r.ok };
  }
  if (
    /^(?:what(?:'s| is| do you) (?:in your )?memory|what do you remember|show memory|list memory|your memory)\b/.test(
      text,
    ) ||
    /^memory$/i.test(text)
  ) {
    const { memorySummary } = await import("./memory");
    return { reply: memorySummary(), intent: "memory.list", tool: "memory", ok: true };
  }
  const forgetMatch = raw.match(/^(?:forget|delete from memory|remove from memory)\s+(?:that\s+|about\s+)?["“]?(.+?)["”]?$/i);
  if (forgetMatch) {
    const { forget } = await import("./memory");
    const r = forget(forgetMatch[1]);
    return { reply: r.data, intent: "memory.forget", tool: "memory", ok: r.ok };
  }

  // "continue" / "where were we" — resume the last session's work
  if (
    /^(continue|resume|where were we|carry on|pick up where (we|i) left off|back to (work|it))\b/.test(
      text,
    ) &&
    text.length < 60
  ) {
    return {
      reply: continueReply(),
      intent: "memory.continue",
      tool: "memory",
      ok: true,
      refreshFs: true,
    };
  }

  // ---------- LLM + tool registry tier ----------
  // If the brain fails at request time (keyless service busy, Ollama not
  // running, network down), DON'T stop here — keep the error and fall through
  // to the offline intent tiers below, so JARVIS always answers with the
  // local no-model skills.
  let llmError: string | null = null;
  if (deps.llmReady) {
    try {
      const result = await runLlmTurn(raw, deps);
      if (result) return result;
    } catch (e) {
      llmError = e instanceof Error ? e.message : "LLM request failed";
    }
  }

  // ---------- offline file intents (fallback tier) ----------
  if (/\b(undo|restore)\b.*\b(delet|trash|remov)/.test(text) || /^undo$/.test(text)) {
    if (!deps.connected) return needConnection("undo a delete");
    const reply = await restoreLastDeleted();
    return { reply, intent: "fs.undo", tool: "fs-tools", ok: true, refreshFs: true };
  }

  // ("search X" normally means WEB search via the brain — if the brain just
  // failed, skip file-search so the closing note explains what happened
  // instead of asking for a folder.)
  const searchMatch = text.match(/^(?:search|find|look for)\s+(?:for\s+)?["']?(.+?)["']?$/);
  if (searchMatch && !llmError) {
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
  if (llmError) {
    return {
      reply: `The brain didn't answer (${llmError}) — handled that with my local skills instead. Say "help" for what works with no model; to fix the brain, hit Test in the Brain tab or switch to another one (LLM7.io / Kilo / OVHcloud are all keyless).`,
      intent: "llm.fallback",
      ok: true,
    };
  }
  return {
    reply: deps.llmReady
      ? 'I couldn\'t map that to a tool. Try naming the capability, e.g. "weather in Berlin", "search quantum computing", "screen", or "remind me in 20 minutes to stretch" — or say "make me a tool that …" and I\'ll build one for it.'
      : 'The keyless brain seems unreachable right now (offline, or the free service is busy) — I\'m in local intent mode. Try "help" for what still works, or pick another brain in the Brain tab (LLM7.io, Kilo, OVHcloud — all keyless — or your own Ollama).',
    intent: "unknown",
    ok: true,
  };
}

// ================= LLM turn loop =================

async function runLlmTurn(
  raw: string,
  deps: BrainDeps,
): Promise<BrainResult | null> {
  const { toolCtx } = deps;
  const specs = toolsForLlm();
  const ctxLines = (deps.history ?? [])
    .slice(-10)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 500) }));

  // hop 1: which tool? — with keyless auto-failover: if the active preset is
  // dead/busy, silently try the other keyless ones before giving up.
  let active = deps.llm;
  const tryPlan = (cfg: LlmConfig) => planToolCall(cfg, raw, specs);
  let plan;
  try {
    plan = await tryPlan(active);
  } catch (e) {
    let lastErr = e;
    let rescued = false;
    for (const id of FAILOVER_PRESETS) {
      if (id === active.presetId) continue;
      const alt = keylessConfig(id, active);
      if (!alt) continue;
      try {
        plan = await tryPlan(alt);
        deps.onBrainAdopted?.(alt);
        active = alt;
        rescued = true;
        break;
      } catch (e2) {
        lastErr = e2;
      }
    }
    if (!rescued) throw lastErr;
  }
  if (!plan) {
    // plain chat — no tool needed (with conversation context)
    const answer = await llmChat(active, [
      {
        role: "system",
        content:
          "You are JARVIS, a local personal assistant on the user's machine. Be concise and helpful. You have no tools in this turn.",
      },
      ...ctxLines,
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
    const follow = await llmChat(active, [
      {
        role: "system",
        content:
          'You are JARVIS. You asked for a tool call and received its result. If the task is complete, answer the user concisely in plain text. If you need one more tool, reply with exactly {"tool":"<id>","args":{...}}.',
      },
      ...ctxLines,
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
    reply: `To ${action}, I need a workspace folder. Click "Connect folder" in the Files tab (or say "connect folder"). If you'd already connected one and this is a fresh page load, click "Reconnect" in the Files tab — the browser requires one click to resume access.`,
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
