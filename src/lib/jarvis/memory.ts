// JARVIS memory — a small, local, persistent memory of things worth
// remembering. Everything lives in localStorage on the user's device; nothing
// is uploaded anywhere. Two kinds of entries:
//   • "fact"  — the user told JARVIS something ("remember my laptop is a Legion 5")
//   • "note"  — JARVIS itself chose to note something ("user prefers short answers")
//
// Kept deliberately tiny: a flat list, newest first, capped at 200 entries.
// The LLM gets the most recent ~30 lines injected into its system prompt, so
// it feels like continuity across sessions without any server.

const KEY = "jarvis.memory.v1";
const MAX_ENTRIES = 200;

export interface MemoryEntry {
  id: string;
  text: string;
  kind: "fact" | "note";
  createdAt: number;
}

function load(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is MemoryEntry =>
          !!m &&
          typeof (m as MemoryEntry).text === "string" &&
          typeof (m as MemoryEntry).createdAt === "number",
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function save(entries: MemoryEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    return true;
  } catch {
    return false;
  }
}

function uid() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function remember(
  text: string,
  kind: "fact" | "note" = "fact",
): { ok: boolean; data: string } {
  const t = text.trim();
  if (!t) return { ok: false, data: "Nothing to remember — give me the text." };
  if (t.length > 500) return { ok: false, data: "That's too long to remember (500 char limit)." };
  const entries = load();
  // avoid exact duplicates
  if (entries.some((e) => e.text.toLowerCase() === t.toLowerCase())) {
    return { ok: true, data: `Already remembered: "${t}"` };
  }
  entries.unshift({ id: uid(), text: t, kind, createdAt: Date.now() });
  const ok = save(entries);
  return ok
    ? { ok: true, data: `Remembered: "${t}"` }
    : { ok: false, data: "Memory is full or storage is unavailable." };
}

export function recall(query = "", limit = 10): MemoryEntry[] {
  const entries = load();
  if (!query.trim()) return entries.slice(0, limit);
  const q = query.toLowerCase();
  return entries.filter((e) => e.text.toLowerCase().includes(q)).slice(0, limit);
}

export function forget(query: string): { ok: boolean; data: string } {
  const q = query.trim().toLowerCase();
  if (!q) {
    const n = load().length;
    save([]);
    return { ok: true, data: `Memory wiped — forgot all ${n} entries.` };
  }
  const entries = load();
  const kept = entries.filter((e) => !e.text.toLowerCase().includes(q));
  const removed = entries.length - kept.length;
  if (removed === 0) {
    return { ok: false, data: `Nothing in memory matches "${query}".` };
  }
  save(kept);
  return { ok: true, data: `Forgot ${removed} thing${removed === 1 ? "" : "s"} matching "${query}".` };
}

/**
 * Compact block injected into the LLM system prompt (or shown in /help).
 * Returns an empty string when memory is empty, so prompts stay clean.
 */
export function memoryPromptBlock(maxEntries = 30): string {
  const entries = load();
  if (!entries.length) return "";
  const lines = entries
    .slice(0, maxEntries)
    .map((e) => `- ${e.text}`)
    .join("\n");
  return `\n\nTHINGS YOU REMEMBER ABOUT THE USER (from previous sessions — use naturally, don't list them back unprompted):\n${lines}`;
}

/** Human-readable listing for the chat ("what do you remember?"). */
export function memorySummary(): string {
  const entries = load();
  if (!entries.length) {
    return "My memory is empty. Tell me \"remember that …\" and I'll keep it — stored only on this device.";
  }
  const shown = entries.slice(0, 12);
  const more = entries.length > shown.length ? ` … and ${entries.length - shown.length} more.` : "";
  return `I remember ${entries.length} thing${entries.length === 1 ? "" : "s"} (stored on this device only):\n${shown
    .map((e) => `• ${e.text}`)
    .join("\n")}${more}`;
}
