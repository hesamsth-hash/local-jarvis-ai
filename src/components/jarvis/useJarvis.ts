import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  clearSavedRoot,
  hasRoot,
  listDir,
  pickRootFolder,
  requestRootAccess,
  restoreRoot,
  setRoot,
  type RootPermission,
} from "@/lib/jarvis/fs-tools";
import { runBrain, type BrainResult } from "@/lib/jarvis/brain";
import { ttsEngine } from "@/lib/jarvis/kokoro-tts";
import { sttEngine } from "@/lib/jarvis/whisper-stt";
import {
  resampleTo16k,
  startRecorder,
  type RecorderHandle,
} from "@/lib/jarvis/recorder";
import {
  DEFAULT_LLM_CONFIG,
  listModels,
  testConnection,
  type LlmConfig,
  type ModelInfo,
} from "@/lib/jarvis/llm";
import type { ToolContext, ToolResult } from "@/lib/jarvis/tools";
import { isDesktop } from "@/lib/jarvis/desktop-bridge";
import type {
  ChatMessage,
  EngineLoadState,
  FsEntryView,
  VoiceState,
} from "@/lib/jarvis/types";

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const LLM_KEY = "jarvis.llm.config.v1";

export function useJarvis() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "jarvis",
      content:
        'JARVIS online. First click "Download engines" in the Voice tab (~40 MB, cached after that). For the full brain — web search, weather, code review, screen capture — connect a local LLM in the Brain tab (Ollama / KoboldCpp / LM Studio). Say "help" anytime.',
      createdAt: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("offline");
  const [busy, setBusy] = useState(false);
  const [engines, setEngines] = useState<EngineLoadState>({
    tts: "idle",
    stt: "idle",
    progress: null,
    error: null,
  });
  const [voice, setVoice] = useState("af_heart");
  const [speed, setSpeed] = useState(1);
  const [autoSpeak, setAutoSpeak] = useState(true);

  // LLM / brain
  const [llm, setLlm] = useState<LlmConfig>(() => {
    try {
      const raw = localStorage.getItem(LLM_KEY);
      return raw ? { ...DEFAULT_LLM_CONFIG, ...(JSON.parse(raw) as LlmConfig) } : DEFAULT_LLM_CONFIG;
    } catch {
      return DEFAULT_LLM_CONFIG;
    }
  });
  const [llmStatus, setLlmStatus] = useState<
    "untested" | "testing" | "online" | "offline"
  >("untested");
  const [models, setModels] = useState<ModelInfo[]>([]);

  // Tools
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [media, setMedia] = useState<{
    stream: MediaStream;
    kind: "screen" | "camera";
  } | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);

  // Filesystem
  const [connected, setConnected] = useState(hasRoot());
  const [rootLabel, setRootLabel] = useState<string | null>(null);
  const [fsPath, setFsPath] = useState("");
  const [fsEntries, setFsEntries] = useState<FsEntryView[]>([]);
  const [fsLoading, setFsLoading] = useState(false);

  const recorderRef = useRef<RecorderHandle | null>(null);
  const speakHandleRef = useRef<{ stop: () => void } | null>(null);
  const disabledRef = useRef(disabledTools);
  disabledRef.current = disabledTools;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const llmRef = useRef(llm);
  llmRef.current = llm;

  const logCommand = useMutation(api.jarvis.logCommand);
  const history = useQuery(api.jarvis.recentCommands, { limit: 12 });
  const commandCount = useQuery(api.jarvis.commandCount);

  const pushMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev.slice(-80), m]);
  }, []);

  // persist LLM config
  useEffect(() => {
    try {
      localStorage.setItem(LLM_KEY, JSON.stringify(llm));
    } catch {
      // ignore
    }
  }, [llm]);

  // ---------- engine loading ----------
  const loadEngines = useCallback(() => {
    setEngines((prev) => ({ ...prev, error: null }));
    ttsEngine.onStateChange = (speaking) =>
      setVoiceState((s) =>
        speaking ? "speaking" : s === "speaking" ? "offline" : s,
      );
    ttsEngine
      .load(
        (p) => setEngines((e) => ({ ...e, progress: p, tts: "loading" })),
        () => setEngines((e) => ({ ...e, tts: "ready", progress: null })),
        (err) => setEngines((e) => ({ ...e, tts: "error", error: err })),
      )
      .catch(() => undefined);
    sttEngine
      .load(
        (p) => setEngines((e) => ({ ...e, progress: p, stt: "loading" })),
        () => setEngines((e) => ({ ...e, stt: "ready", progress: null })),
        (err) => setEngines((e) => ({ ...e, stt: "error", error: err })),
      )
      .catch(() => undefined);
  }, []);

  // ---------- LLM ----------
  const handleTestLlm = useCallback(
    async (cfg?: LlmConfig) => {
      const target = cfg ?? llmRef.current;
      setLlmStatus("testing");
      try {
        const online = await testConnection(target);
        setLlmStatus(online ? "online" : "offline");
        if (online) {
          const list = await listModels(target).catch(() => []);
          setModels(list);
          if (list.length > 0 && !target.model) {
            setLlm((c) => (c.model ? c : { ...c, model: list[0]!.id }));
          }
        }
      } catch {
        setLlmStatus("offline");
      }
    },
    [],
  );

  // auto-test on mount if enabled
  useEffect(() => {
    if (llm.enabled) void handleTestLlm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- filesystem ----------
  const refreshFs = useCallback(async (path = "") => {
    if (!hasRoot()) {
      setConnected(false);
      setRootLabel(null);
      setFsEntries([]);
      return;
    }
    setFsLoading(true);
    try {
      const { entries } = await listDir(path);
      setFsEntries(entries);
      setFsPath(path);
    } catch {
      setFsEntries([]);
    } finally {
      setFsLoading(false);
    }
  }, []);

  const connectFolder = useCallback(async () => {
    const handle = await pickRootFolder();
    if (!handle) return false;
    setRoot(handle);
    setConnected(true);
    setSavedPermission("granted");
    setRootLabel(handle.name);
    await refreshFs("");
    return true;
  }, [refreshFs]);

  const disconnectFolder = useCallback(async () => {
    await clearSavedRoot();
    setConnected(false);
    setSavedPermission("none");
    setRootLabel(null);
    setFsEntries([]);
    setFsPath("");
  }, []);

  useEffect(() => {
    if (connected) void refreshFs("");
  }, [connected, refreshFs]);

  // Re-attach a previously granted folder after a page reload.
  const [savedPermission, setSavedPermission] = useState<RootPermission>("none");
  const resumeAccess = useCallback(async () => {
    const ok = await requestRootAccess();
    if (ok) {
      setConnected(true);
      setSavedPermission("granted");
      await refreshFs("");
      pushMessage({
        id: uid(),
        role: "system",
        content: "Workspace access restored — file tools are live again.",
        createdAt: Date.now(),
      });
    }
    return ok;
  }, [refreshFs, pushMessage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const perm = await restoreRoot();
      if (cancelled) return;
      setSavedPermission(perm);
      if (perm === "granted") {
        setConnected(true);
        // name comes from the handle
        const mod = await import("@/lib/jarvis/fs-tools");
        setRootLabel(mod.rootName());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- notifications ----------
  const notify = useCallback((title: string, body?: string) => {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      } else if (Notification.permission !== "denied") {
        void Notification.requestPermission().then((p) => {
          if (p === "granted") new Notification(title, { body });
        });
      }
    }
    pushMessage({
      id: uid(),
      role: "system",
      content: body ? `${title} — ${body}` : title,
      createdAt: Date.now(),
    });
  }, [pushMessage]);

  // ---------- capture ----------
  const capture = useCallback(async (kind: "screen" | "camera") => {
    try {
      const stream =
        kind === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true })
          : await navigator.mediaDevices.getUserMedia({ video: true });
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      mediaRef.current = stream;
      setMedia({ stream, kind });
      // auto-stop when user ends sharing from the browser bar
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        setMedia(null);
        mediaRef.current = null;
      });
      return {
        ok: true,
        data:
          kind === "screen"
            ? "Screen share started — it's live in the viewer (bottom-right)."
            : "Webcam started — it's live in the viewer (bottom-right).",
      } satisfies ToolResult;
    } catch {
      return {
        ok: false,
        data: "Capture was cancelled or permission denied.",
      } satisfies ToolResult;
    }
  }, []);

  // ---------- speech ----------
  const speak = useCallback(
    async (text: string) => {
      if (
        !ttsEngine.ready ||
        disabledRef.current.includes("kokoro-tts")
      ) {
        return;
      }
      speakHandleRef.current?.stop();
      const handle = await ttsEngine.speak(text, voice, speed);
      speakHandleRef.current = handle;
    },
    [voice, speed],
  );

  const stopSpeaking = useCallback(() => {
    speakHandleRef.current?.stop();
    ttsEngine.stop();
  }, []);

  // ---------- tool context ----------
  const openExternal = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const toolCtx = useCallback(
    (process: (text: string, mode: "text" | "voice") => Promise<void>): ToolContext => ({
      sub: async (action, arg = ""): Promise<ToolResult> => {
        const a = arg.trim();
        switch (action) {
          // ----- YouTube -----
          case "youtube": {
            const q = a.replace(/^(search|play|music)\s+/i, "");
            const url = /music/i.test(a)
              ? `https://music.youtube.com/search?q=${encodeURIComponent(q)}`
              : `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
            if (/^play/i.test(a)) {
              openExternal(url);
              return { ok: true, data: `Searching YouTube for "${q}" — pick a video and it'll play.` };
            }
            openExternal(url);
            return { ok: true, data: `YouTube results for "${q}" opened in a new tab.` };
          }
          // ----- Browser -----
          case "browser": {
            const m = a.match(/^(open|google|maps)\s+(.+)/i);
            if (!m) return { ok: false, data: "Try: open <url>, google <query>, maps <query>." };
            const [, cmd, target] = m;
            if (/google/i.test(cmd)) {
              openExternal(`https://www.google.com/search?q=${encodeURIComponent(target)}`);
              return { ok: true, data: `Google search opened for "${target}".` };
            }
            if (/maps/i.test(cmd)) {
              openExternal(`https://www.google.com/maps/search/${encodeURIComponent(target)}`);
              return { ok: true, data: `Google Maps opened for "${target}".` };
            }
            const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
            openExternal(url);
            return { ok: true, data: `Opened ${url}.` };
          }
          // ----- Open app / URL schemes -----
          case "openapp": {
            const schemes: Record<string, string> = {
              vscode: "vscode://", "visual studio code": "vscode://",
              spotify: "spotify:", discord: "discord://",
              slack: "slack://", zoom: "zoomus://", telegram: "tg://",
              notion: "notion://", figma: "figma://", steam: "steam://open/main",
              mail: "mailto:", email: "mailto:", calendar: "webcal://",
            };
            if (/^https?:\/\//i.test(a)) {
              openExternal(a);
              return { ok: true, data: `Opened ${a}.` };
            }
            const key = a.toLowerCase();
            const scheme = schemes[key];
            if (scheme) {
              window.location.href = scheme;
              return { ok: true, data: `Launched ${a} via its URL scheme (if installed).` };
            }
            return {
              ok: false,
              data: `I don't have a URL scheme for "${a}". Try: ${Object.keys(schemes).slice(0, 8).join(", ")}, or open <full-url>.`,
            };
          }
          // ----- Filesystem -----
          case "fs": {
            const mod = await import("@/lib/jarvis/brain-fs");
            return mod.runFsAction(a, () => connectedRef.current);
          }
          // ----- Code helper / dev agent -----
          case "code": {
            const mod = await import("@/lib/jarvis/brain-fs");
            const read = await mod.runFsAction(`read ${a}`, () => connectedRef.current);
            if (!read.ok) return read;
            return {
              ok: true,
              data: `Content of ${a} (for review):\n${read.data.slice(0, 1500)}`,
            };
          }
          case "dev": {
            const mod = await import("@/lib/jarvis/brain-fs");
            const listing = await mod.runFsAction("list", () => connectedRef.current);
            if (!listing.ok) return listing;
            return {
              ok: true,
              data: `Workspace scan:\n${listing.data}\nAsk me to "read <file>" or "code review <file>" for depth.`,
            };
          }
          // ----- Send message -----
          case "send": {
            const m = a.match(/^(email|whatsapp|sms)\s+(.+)/i);
            if (!m) return { ok: false, data: "Try: email <address> about <text>, whatsapp <text>, sms <text>." };
            const [, cmd, rest] = m;
            if (/email/i.test(cmd)) {
              const parts = rest.match(/^(.*?)\s+about\s+(.+)$/i);
              const to = parts ? parts[1] : "";
              const bodyMsg = parts ? parts[2] : rest;
              openExternal(
                `mailto:${to}?subject=${encodeURIComponent("Sent via JARVIS")}&body=${encodeURIComponent(bodyMsg)}`,
              );
              return { ok: true, data: `Draft email to ${to || "your default client"} opened.` };
            }
            if (/whatsapp/i.test(cmd)) {
              openExternal(`https://wa.me/?text=${encodeURIComponent(rest)}`);
              return { ok: true, data: "WhatsApp share opened." };
            }
            openExternal(`sms:?&body=${encodeURIComponent(rest)}`);
            return { ok: true, data: "SMS draft opened." };
          }
          // ----- Reminder / check-in -----
          case "remind":
          case "checkin": {
            const m = a.match(/^(?:in\s+)?(\d+)\s*(?:minutes?|mins?|m)?\s*(.+)?$/i);
            if (!m) return { ok: false, data: 'Try: "<minutes> <message>", e.g. "20 stretch your legs".' };
            const mins = Math.max(1, parseInt(m[1]!, 10));
            const msg = (m[2] ?? "Check-in").trim();
            const kind = action === "remind" ? "Reminder" : "Check-in";
            setTimeout(() => notify(`${kind}: ${msg}`, `Scheduled ${mins} min ago`), mins * 60000);
            return {
              ok: true,
              data: `${kind} set: "${msg}" in ${mins} minute${mins === 1 ? "" : "s"} (keeps working while this tab is open).`,
            };
          }
          // ----- Flights -----
          case "flights": {
            const m = a.match(/^(.+?)\s+to\s+(.+)$/i);
            if (!m) return { ok: false, data: 'Try: "<from> to <to>", e.g. "Berlin to Tokyo".' };
            const [, from, to] = m;
            openExternal(
              `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${from} to ${to}`)}`,
            );
            return { ok: true, data: `Flight search opened: ${from} → ${to}.` };
          }
          // ----- Games -----
          case "games": {
            if (/epic/i.test(a)) {
              openExternal("https://store.epicgames.com/en-US/download");
              return { ok: true, data: "Epic Games launcher/download page opened." };
            }
            openExternal("steam://open/downloads");
            return { ok: true, data: "Steam downloads page opened via the Steam client (if installed)." };
          }
          // ----- Background monitor -----
          case "monitor": {
            const topic = a.trim();
            if (!topic) return { ok: false, data: "Give me a topic to watch." };
            setInterval(async () => {
              const r = await fetch(
                `https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_html=1`,
              ).then((x) => x.json()).catch(() => null);
              const d = r as { AbstractText?: string; Heading?: string } | null;
              if (d?.AbstractText) {
                notify(`Watch: ${d.Heading ?? topic}`, d.AbstractText.slice(0, 140));
              }
            }, 10 * 60000);
            return {
              ok: true,
              data: `Now watching "${topic}" — I'll check every 10 minutes and notify you on updates (while this tab is open).`,
            };
          }
          default:
            return { ok: false, data: `Unknown sub-action "${action}".` };
        }
      },
      capture,
      notify,
      connectFolder,
      connected: connectedRef.current,
      desktop: isDesktop(),
      llm: llmRef.current,
    }),
    [capture, notify, connectFolder, openExternal],
  );

  // ---------- message handling ----------
  const process = useCallback(
    async (raw: string, mode: "text" | "voice") => {
      const text = raw.trim();
      if (!text || busy) return;
      setBusy(true);
      setVoiceState("thinking");
      pushMessage({ id: uid(), role: "user", content: text, createdAt: Date.now() });
      try {
        const ctx = toolCtx(process);
        const llmReady = llmRef.current.enabled && llmStatus === "online";
        const result: BrainResult = await runBrain(text, {
          speak,
          connected: connectedRef.current,
          connectFolder,
          toolCtx: ctx,
          llm: llmRef.current,
          llmReady,
        });
        pushMessage({
          id: uid(),
          role: "jarvis",
          content: result.reply,
          createdAt: Date.now(),
          intent: result.intent,
          tool: result.tool,
          ok: result.ok,
        });
        void logCommand({
          input: text,
          inputMode: mode,
          intent: result.intent,
          toolName: result.tool,
          response: result.reply.slice(0, 500),
          ok: result.ok,
          createdAt: Date.now(),
        }).catch(() => undefined);
        if (result.refreshFs) await refreshFs(fsPath);
        if (result.navigate === "stop-listening") stopRecording();
        if (result.navigate === "start-listening") void beginListening();
        if (autoSpeak && !disabledRef.current.includes("kokoro-tts")) {
          await speak(result.reply);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        pushMessage({
          id: uid(),
          role: "jarvis",
          content: msg,
          createdAt: Date.now(),
          ok: false,
        });
      } finally {
        setBusy(false);
        setVoiceState((s) => (s === "thinking" ? "offline" : s));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, speak, connectFolder, refreshFs, fsPath, autoSpeak, logCommand, toolCtx, llmStatus],
  );

  // ---------- voice input ----------
  const beginListening = useCallback(async () => {
    if (recorderRef.current || busy) return;
    try {
      if (!sttEngine.ready) {
        setEngines((e) => ({ ...e, stt: "loading" }));
        await sttEngine.load(
          (p) => setEngines((e2) => ({ ...e2, progress: p, stt: "loading" })),
          () => setEngines((e2) => ({ ...e2, stt: "ready", progress: null })),
          (err) => setEngines((e2) => ({ ...e2, stt: "error", error: err })),
        );
      }
      recorderRef.current = await startRecorder();
      setVoiceState("listening");
    } catch {
      setVoiceState("offline");
      pushMessage({
        id: uid(),
        role: "system",
        content: "Microphone access was denied. Voice input is unavailable.",
        createdAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pushMessage]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    const { audio, sampleRate } = rec.stop();
    setVoiceState("offline");
    if (audio.length < sampleRate) return; // < 1s — ignore
    setBusy(true);
    setVoiceState("thinking");
    sttEngine
      .transcribe(resampleTo16k(audio, sampleRate))
      .then((text) => {
        if (text) void process(text, "voice");
      })
      .catch(() => {
        pushMessage({
          id: uid(),
          role: "system",
          content: "Transcription failed. Please try again.",
          createdAt: Date.now(),
        });
      })
      .finally(() => {
        setBusy(false);
        setVoiceState("offline");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process, pushMessage]);

  const toggleListening = useCallback(() => {
    if (recorderRef.current) {
      stopRecording();
    } else {
      void beginListening();
    }
  }, [stopRecording, beginListening]);

  const toggleTool = useCallback((id: string) => {
    setDisabledTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }, []);

  const openEntry = useCallback(
    (entry: FsEntryView) => {
      if (entry.kind === "directory") {
        const next = entry.name.startsWith("/") ? entry.name.slice(1) : entry.name;
        void refreshFs(next);
      } else {
        void process(`read ${entry.name}`, "text");
      }
    },
    [refreshFs, process],
  );

  const closeMedia = useCallback(() => {
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    setMedia(null);
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      ttsEngine.stop();
      mediaRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const submit = useCallback(() => {
    const text = input;
    setInput("");
    void process(text, "text");
  }, [input, process]);

  return {
    messages, input, setInput, submit, busy, voiceState,
    engines, loadEngines,
    voice, setVoice, speed, setSpeed, autoSpeak, setAutoSpeak,
    connected, rootLabel, fsPath, fsEntries, fsLoading,
    connectFolder, refreshFs, openEntry, resumeAccess, savedPermission, disconnectFolder,
    toggleListening, stopSpeaking, process,
    history, commandCount,
    // llm / brain
    llm, setLlm, llmStatus, models, handleTestLlm,
    // tools
    disabledTools, toggleTool,
    media, closeMedia,
  };
}
