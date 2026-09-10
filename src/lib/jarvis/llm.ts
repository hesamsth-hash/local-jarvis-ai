// Local LLM bridge — connects the console to on-device model servers.
// Supported: Ollama (native API) and any OpenAI-compatible server
// (KoboldCpp, LM Studio, llama.cpp server, text-generation-webui...).
// Everything stays on the machine: these are localhost HTTP endpoints.

export type LlmProviderKind = "ollama" | "openai-compatible";

export interface LlmConfig {
  enabled: boolean;
  provider: LlmProviderKind;
  url: string; // e.g. http://localhost:11434 (ollama) or http://localhost:5001
  model: string;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  enabled: false,
  provider: "ollama",
  url: "http://localhost:11434",
  model: "",
};

export const PRESETS: {
  id: string;
  label: string;
  provider: LlmProviderKind;
  url: string;
  hint: string;
}[] = [
  {
    id: "ollama",
    label: "Ollama",
    provider: "ollama",
    url: "http://localhost:11434",
    hint: "ollama serve  (default port 11434)",
  },
  {
    id: "koboldcpp",
    label: "KoboldCpp",
    provider: "openai-compatible",
    url: "http://localhost:5001",
    hint: "launch KoboldCpp — OpenAI-compatible API on port 5001",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    provider: "openai-compatible",
    url: "http://localhost:1234",
    hint: "LM Studio → Local Server (port 1234)",
  },
  {
    id: "llamacpp",
    label: "llama.cpp server",
    provider: "openai-compatible",
    url: "http://localhost:8080",
    hint: "llama-server --port 8080",
  },
];

export interface ModelInfo {
  id: string;
  size?: string;
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Ping the configured server; returns true if reachable. */
export async function testConnection(cfg: LlmConfig): Promise<boolean> {
  try {
    if (cfg.provider === "ollama") {
      await fetchJson(`${normalizeUrl(cfg.url)}/api/tags`, undefined, 4000);
    } else {
      await fetchJson(`${normalizeUrl(cfg.url)}/v1/models`, undefined, 4000);
    }
    return true;
  } catch {
    return false;
  }
}

/** List models available on the server. */
export async function listModels(cfg: LlmConfig): Promise<ModelInfo[]> {
  if (cfg.provider === "ollama") {
    const data = await fetchJson(`${normalizeUrl(cfg.url)}/api/tags`);
    const models = (data as { models?: { name: string; size?: number }[] })
      .models ?? [];
    return models.map((m) => ({
      id: m.name,
      size: m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined,
    }));
  }
  const data = await fetchJson(`${normalizeUrl(cfg.url)}/v1/models`);
  const models = (data as { data?: { id: string }[] }).data ?? [];
  return models.map((m) => ({ id: m.id }));
}

const SYSTEM_PROMPT = `You are JARVIS, a local personal assistant running on the user's own machine.
You control tools on the user's device. Be concise and helpful (2-4 sentences unless asked for more).
When a task matches one of your tools, reply with EXACTLY one JSON object and nothing else:
{"tool":"<tool_id>","args":{...}}
Available tools and their args:
{TOOLS}
After the JSON you will receive a tool result as a user message starting with [TOOL_RESULT]; then answer the user in plain text using that result.
If no tool is needed, just answer in plain text.`;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolSpec {
  id: string;
  description: string;
  args?: string; // JSON example of args
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** One completion against the local server. */
export async function llmChat(
  cfg: LlmConfig,
  messages: LlmMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const url = normalizeUrl(cfg.url);
  if (cfg.provider === "ollama") {
    const data = await fetchJson(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.4,
          num_predict: opts.maxTokens ?? 400,
        },
      }),
    }, 120000);
    const content = (data as { message?: { content?: string } }).message
      ?.content;
    if (!content) throw new Error("Empty response from Ollama");
    return content;
  }
  const data = await fetchJson(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model || "local-model",
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 400,
      stream: false,
    }),
  }, 120000);
  const content = (data as {
    choices?: { message?: { content?: string } }[];
  }).choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from local model");
  return content;
}

/** Ask the local LLM to pick a tool for the user's request (or null). */
export async function planToolCall(
  cfg: LlmConfig,
  userMessage: string,
  tools: ToolSpec[],
): Promise<{ tool: string; args: Record<string, unknown> } | null> {
  const spec = tools
    .map(
      (t) =>
        `- ${t.id}: ${t.description}${t.args ? ` (args JSON: ${t.args})` : " (args: {})"}`,
    )
    .join("\n");
  const prompt = SYSTEM_PROMPT.replace("{TOOLS}", spec);
  const reply = await llmChat(cfg, [
    { role: "system", content: prompt },
    { role: "user", content: userMessage },
  ], { temperature: 0, maxTokens: 200 });
  return parseToolCall(reply);
}

/** Parse a {"tool":...,"args":...} JSON object out of a model reply. */
export function parseToolCall(
  reply: string,
): { tool: string; args: Record<string, unknown> } | null {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : reply).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1)) as {
      tool?: unknown;
      args?: unknown;
    };
    if (typeof obj.tool !== "string") return null;
    return {
      tool: obj.tool,
      args:
        obj.args && typeof obj.args === "object"
          ? (obj.args as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}
