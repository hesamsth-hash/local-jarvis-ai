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
 * Includes both remembered facts AND recent activity from earlier sessions.
 * Returns an empty string when there is nothing, so prompts stay clean.
 */
export function memoryPromptBlock(maxEntries = 30): string {
  const entries = load();
  let out = "";
  if (entries.length) {
    const lines = entries
      .slice(0, maxEntries)
      .map((e) => `- ${e.text}`)
      .join("\n");
    out += `\n\nTHINGS YOU REMEMBER ABOUT THE USER (from previous sessions — use naturally, don't list them back unprompted):\n${lines}`;
  }
  out += activityPromptBlock();
  return out;
}

// ================= session continuity (activity log) =================
// Tracks WHAT the user was doing — commands run, files touched, folders
// browsed — so a new session can pick up exactly where the last one ended
// (e.g. half-finished story, the game folder you were organizing).

const ACT_KEY = "jarvis.activity.v1";
const SEEN_KEY = "jarvis.lastseen.v1";
const MAX_ACTIVITY = 100;

export interface ActivityEntry {
  id: string;
  at: number;
  kind: "command" | "file" | "context";
  detail: string;
  path?: string;
}

function loadActivity(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(ACT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is ActivityEntry =>
          !!a &&
          typeof (a as ActivityEntry).detail === "string" &&
          typeof (a as ActivityEntry).at === "number",
      )
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

function saveActivity(entries: ActivityEntry[]): void {
  try {
    localStorage.setItem(ACT_KEY, JSON.stringify(entries.slice(0, MAX_ACTIVITY)));
  } catch {
    // ignore
  }
}

export function logActivity(
  kind: ActivityEntry["kind"],
  detail: string,
  path?: string,
): void {
  const entries = loadActivity();
  // skip exact consecutive duplicates (e.g. repeated identical commands)
  if (entries[0] && entries[0].detail === detail) return;
  entries.unshift({
    id: uid(),
    at: Date.now(),
    kind,
    detail: detail.slice(0, 200),
    path: path?.slice(0, 200),
  });
  saveActivity(entries);
}

export function recentActivity(n = 5): ActivityEntry[] {
  return loadActivity().slice(0, n);
}

export function lastFilePath(): string | null {
  const hit = loadActivity().find((a) => a.path);
  return hit?.path ?? null;
}

/**
 * Stamp "the app is open right now". On the first call of a session it
 * returns how long the app was closed (null on the very first run ever).
 */
export function stampSeen(): number | null {
  let gap: number | null = null;
  try {
    const prev = Number(localStorage.getItem(SEEN_KEY) ?? "");
    if (Number.isFinite(prev) && prev > 0) gap = Math.max(0, Date.now() - prev);
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // storage unavailable — no continuity, but don't crash
  }
  return gap;
}

function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "less than a minute ago";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * "Welcome back" message based on the previous session's activity.
 * Pass the gap returned by stampSeen() (it stamps before this reads).
 * Empty string when there's no history (first run).
 */
export function resumeSummary(gapMs?: number): string {
  const acts = loadActivity();
  if (!acts.length) return "";
  const gap = typeof gapMs === "number" ? ago(gapMs) : "earlier";
  const lines = acts
    .slice(0, 3)
    .map((a) => `• ${a.detail}`)
    .join("\n");
  const file = lastFilePath();
  return `Welcome back — we last spoke ${gap}. Where we left off:\n${lines}${
    file
      ? `\n\nThe last file involved was "${file}" — say "read ${file}" or just "continue" to pick up right there.`
      : `\n\nSay "continue" and I'll pick up where we left off.`
  }`;
}

/** Offline handler for "continue" / "where were we". */
export function continueReply(): string {
  const acts = loadActivity();
  if (!acts.length) {
    return "We're starting fresh — nothing to continue yet. What should we work on?";
  }
  const last = acts[0]!;
  const file = lastFilePath();
  return `Last time, you: ${last.detail}.${
    file
      ? ` The last file involved was "${file}" — say "read ${file}" to pick up where you left off, or tell me what to do with it.`
      : " Tell me what you'd like to do next."
  }`;
}

/** Recent-activity section for the LLM prompt (empty when no history). */
export function activityPromptBlock(maxEntries = 8): string {
  const acts = loadActivity();
  if (!acts.length) return "";
  const lines = acts
    .slice(0, maxEntries)
    .map((a) => `- ${a.detail}`)
    .join("\n");
  return `\n\nRECENT ACTIVITY FROM PREVIOUS SESSIONS (newest first) — when the user says "continue" or "resume", use this plus the file tools to pick up exactly where they left off:\n${lines}`;
}

/** Best-effort file name out of free text (for activity logging). */
export function extractFileName(text: string): string | undefined {
  const m = text.match(/[\w\-. ]*[\w\-.]+\.[a-z0-9]{1,5}\b/i);
  const name = m?.[0]?.trim();
  return name && name.length <= 120 ? name : undefined;
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
