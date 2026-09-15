import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  addRoot,
  backendActive,
  clearSavedRoot,
  hasRoot,
  listDir,
  listRoots,
  pickRootFolder,
  removeRoot,
  requestRootAccess,
  restoreRoot,
  setBackend,
  setActiveRoot,
  type RootPermission,
} from "@/lib/jarvis/fs-tools";
import { androidFs, androidFsSupported } from "@/lib/jarvis/android-fs";
import { startWakeWord, wakeWordSupported, type WakeHandle } from "@/lib/jarvis/wake-word";
import { runBrain, type BrainResult } from "@/lib/jarvis/brain";
import { ttsEngine } from "@/lib/jarvis/kokoro-tts";
import {
  findHeadphones,
  listAudioInputs,
  loadAudioPrefs,
  realDevices,
  saveAudioPrefs,
} from "@/lib/jarvis/audio-devices";
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
import {
  listPlugins,
  removePlugin,
  setPluginNotifier,
  syncPluginTools,
  type PluginSpec,
} from "@/lib/jarvis/plugins";
import { isAndroid, isDesktop } from "@/lib/jarvis/desktop-bridge";
import {
  addReminder,
  clearTranscript,
  dueReminders,
  inMs,
  loadTranscript,
  logActivity,
  markReminderFired,
  pendingReminders,
  resumeSummary,
  saveTranscript,
  stampSeen,
} from "@/lib/jarvis/memory";
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
const VOICE_KEY = "jarvis.voice.v1";

/** Voice settings that survive restarts (speed, autoSpeak…). */
interface VoicePrefs {
  voice?: string;
  speed?: number;
  autoSpeak?: boolean;
}

function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    return raw ? (JSON.parse(raw) as VoicePrefs) : {};
  } catch {
    return {};
  }
}

export function useJarvis() {
  // One continuous session: the transcript is loaded from local storage at
  // boot, so JARVIS resumes the conversation instead of opening a new chat.
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadTranscript();
    if (saved.length) return saved;
    return [
      {
        id: "welcome",
        role: "jarvis",
        content:
          'JARVIS online. Voice engines are loading (cached after the first run) and the keyless brain is live — web search, weather, tools, all working right now. Want 100% offline? Connect Ollama / KoboldCpp in the Brain tab. Say "help" anytime.',
        createdAt: Date.now(),
      },
    ];
  });
  const [input, setInput] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("offline");
  const [busy, setBusy] = useState(false);
  const [engines, setEngines] = useState<EngineLoadState>({
    tts: "idle",
    stt: "idle",
    progress: null,
    error: null,
  });
  const [voice, setVoice] = useState(() => loadVoicePrefs().voice ?? "bm_george");
  const [speed, setSpeed] = useState(() => loadVoicePrefs().speed ?? 1);
  const [autoSpeak, setAutoSpeak] = useState(
    () => loadVoicePrefs().autoSpeak ?? true,
  );

  // audio output/input device picks (the "Windows sound settings" of JARVIS)
  const audioPrefsRef = useRef(loadAudioPrefs());
  const [audioOutput, setAudioOutput] = useState<string | null>(
    () => audioPrefsRef.current.output ?? null,
  );
  const [audioInput, setAudioInput] = useState<string | null>(
    () => audioPrefsRef.current.input ?? null,
  );
  const [voiceVolume, setVoiceVolume] = useState<number>(() => {
    const v = audioPrefsRef.current.volume;
    // a saved 0/NaN volume would mute her forever — sanitize at load
    return typeof v === "number" && Number.isFinite(v) && v > 0.01 ? v : 1;
  });
  const audioOutputRef = useRef<string | null>(audioOutput);
  audioOutputRef.current = audioOutput;
  const audioInputRef = useRef<string | null>(audioInput);
  audioInputRef.current = audioInput;
  const voiceVolumeRef = useRef<number>(voiceVolume);
  voiceVolumeRef.current = voiceVolume;

  const changeAudioOutput = useCallback((id: string | null) => {
    setAudioOutput(id);
    audioOutputRef.current = id;
    saveAudioPrefs({
      output: id,
      input: audioInputRef.current,
      volume: voiceVolumeRef.current,
    });
  }, []);

  const changeAudioInput = useCallback((id: string | null) => {
    setAudioInput(id);
    audioInputRef.current = id;
    saveAudioPrefs({
      output: audioOutputRef.current,
      input: id,
      volume: voiceVolumeRef.current,
    });
  }, []);

  const changeVoiceVolume = useCallback((v: number) => {
    setVoiceVolume(v);
    voiceVolumeRef.current = v;
    saveAudioPrefs({
      output: audioOutputRef.current,
      input: audioInputRef.current,
      volume: v,
    });
  }, []);

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
  const [plugins, setPlugins] = useState<PluginSpec[]>([]);
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
  const [workspaces, setWorkspaces] = useState<string[]>([]);

  const recorderRef = useRef<RecorderHandle | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const speakHandleRef = useRef<{ stop: () => void } | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsReadyHintRef = useRef(false);
  const disabledRef = useRef(disabledTools);
  disabledRef.current = disabledTools;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const llmRef = useRef(llm);
  llmRef.current = llm;
  const llmStatusRef = useRef(llmStatus);
  llmStatusRef.current = llmStatus;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const logCommand = useMutation(api.jarvis.logCommand);
  const history = useQuery(api.jarvis.recentCommands, { limit: 12 });
  const commandCount = useQuery(api.jarvis.commandCount);

  const pushMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => {
      // persist the transcript so the next launch continues THIS conversation
      saveTranscript([...prev, m].slice(-200));
      return [...prev.slice(-80), m];
    });
  }, []);

  // persistence is driven from pushMessage; a safety-net effect covers direct
  // setMessages calls (clear + reset path below)
  useEffect(() => {
    saveTranscript(messages);
  }, [messages]);

  // persist LLM config
  useEffect(() => {
    try {
      localStorage.setItem(LLM_KEY, JSON.stringify(llm));
    } catch {
      // ignore
    }
  }, [llm]);

  // Switching brains (preset chip / URL) must not keep the previous server's
  // model list or "online" badge — that's what made the picker look bugged
  // (stale models, test state stuck). Skip the reset when the failover logic
  // adopts a working keyless brain mid-request; it manages its own status.
  const llmEndpointRef = useRef(`${llm.provider}|${llm.url}`);
  const llmAdoptingRef = useRef(false);
  useEffect(() => {
    const key = `${llm.provider}|${llm.url}`;
    if (key === llmEndpointRef.current) return;
    llmEndpointRef.current = key;
    if (llmAdoptingRef.current) {
      llmAdoptingRef.current = false;
      return;
    }
    setModels([]);
    setLlmStatus("untested");
  }, [llm]);

  // persist voice prefs (voice pick + speed + auto-speak survive restarts)
  useEffect(() => {
    try {
      const prefs: VoicePrefs = { voice, speed, autoSpeak };
      localStorage.setItem(VOICE_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [voice, speed, autoSpeak]);

  // ---------- session continuity: welcome-back + briefing ----------
  const bootGapRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (bootGapRef.current === undefined) {
      bootGapRef.current = stampSeen();
      // Fresh start (no restored transcript)? Then the welcome-back recap adds
      // context. With a restored conversation the history is already on
      // screen — only reminders and anything missed while away get posted.
      const fresh =
        messagesRef.current.length <= 1 &&
        messagesRef.current[0]?.id === "welcome";
      const parts: string[] = [];
      if (fresh) {
        const welcome = resumeSummary(bootGapRef.current ?? undefined);
        if (welcome) parts.push(welcome);
      }
      // anything that came due while the app was closed?
      const due = dueReminders();
      if (due.length) {
        const lines = due
          .slice(0, 5)
          .map((r) => {
            markReminderFired(r.id);
            const mins = Math.max(1, Math.round((Date.now() - r.dueAt) / 60000));
            return `• ${r.text} — finished ${mins} min ago`;
          })
          .join("\n");
        parts.push(`Since you were away:\n${lines}`);
      }
      const pending = pendingReminders().slice(0, 3);
      if (pending.length) {
        parts.push(
          `Still on the docket:\n${pending.map((r) => `• ${r.text} (in ${Math.max(1, Math.round((r.dueAt - Date.now()) / 60000))} min)`).join("\n")}`,
        );
      }
      if (parts.length) {
        pushMessage({
          id: uid(),
          role: "system",
          content: parts.join("\n\n"),
          createdAt: Date.now(),
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refreshPlugins = useCallback(() => {
    void listPlugins().then(setPlugins);
  }, []);

  useEffect(() => {
    setPluginNotifier(notify);
    void syncPluginTools().then(refreshPlugins);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Cold start: engines now load on launch — cached after the first download,
  // so voice (and the orb's speaking animation) work without clicking
  // "Download engines" every session. First-ever run downloads in background
  // while the console is already usable.
  useEffect(() => {
    loadEngines();
  }, [loadEngines]);

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

  // Lazy retry: if the brain was unreachable at boot (keyless service busy,
  // Wi-Fi still connecting…), re-test when the user actually sends something —
  // at most once a minute — so a recovered brain is used for THIS message
  // instead of dropping to local mode until a manual re-test.
  const lastBrainProbeRef = useRef(0);
  const ensureBrainProbed = useCallback(async () => {
    const cfg = llmRef.current;
    if (!cfg.enabled) return false;
    if (Date.now() - lastBrainProbeRef.current < 60_000) return false;
    lastBrainProbeRef.current = Date.now();
    const online = await testConnection(cfg).catch(() => false);
    if (online) {
      await handleTestLlm(cfg);
      return true;
    }
    return false;
  }, [handleTestLlm]);

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
    const name = await addRoot(handle);
    setConnected(true);
    setSavedPermission("granted");
    setRootLabel(name);
    setWorkspaces(await listRoots());
    await refreshFs("");
    return true;
  }, [refreshFs]);

  const disconnectFolder = useCallback(async () => {
    const active = rootLabel;
    if (active && workspaces.length > 1) {
      // multiple workspaces: remove just the active one, fall back to another
      await removeRoot(active);
      const rest = await listRoots();
      setWorkspaces(rest);
      if (rest[0]) {
        await setActiveRoot(rest[0]);
        setRootLabel(rest[0]);
        await refreshFs("");
        return;
      }
    } else {
      await clearSavedRoot();
    }
    setConnected(false);
    setSavedPermission("none");
    setRootLabel(null);
    setWorkspaces([]);
    setFsEntries([]);
    setFsPath("");
  }, [refreshFs, rootLabel, workspaces.length]);

  const switchWorkspace = useCallback(
    async (name: string) => {
      const ok = await setActiveRoot(name);
      if (!ok) return;
      setRootLabel(name);
      await refreshFs("");
    },
    [refreshFs],
  );

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
      // Android + root: shell backend replaces the (missing) folder picker.
      if (isAndroid() && androidFsSupported()) {
        setBackend(androidFs);
        setConnected(true);
        setSavedPermission("granted");
        setRootLabel("Device storage (root)");
        await refreshFs("");
        return;
      }
      const perm = await restoreRoot();
      if (cancelled) return;
      setSavedPermission(perm);
      setWorkspaces(await listRoots());
      if (perm === "granted") {
        setConnected(true);
        // name comes from the active handle
        const mod = await import("@/lib/jarvis/fs-tools");
        setRootLabel(mod.rootName());
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ---------- notifications ----------
  // fired on time (app was open) → mark so the boot briefing doesn't repeat it
  const markReminderFiredOnTime = useCallback(() => {
    // the newest due reminder at fire time is ours
    const due = dueReminders();
    if (due.length) markReminderFired(due[due.length - 1]!.id);
  }, []);
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
        // explain the silence once — "Download engines" is the usual fix
        if (!ttsReadyHintRef.current && !ttsEngine.ready) {
          ttsReadyHintRef.current = true;
          pushMessage({
            id: `tts-hint-${Date.now()}`,
            role: "jarvis",
            content:
              "⚠︎ My voice isn't loaded yet — open the Voice tab and tap “Download engines” (one time, ~40 MB).",
            createdAt: Date.now(),
            intent: "tts.hint",
          });
        }
        return;
      }
      speakHandleRef.current?.stop();
      const handle = await ttsEngine.speak(
        text,
        voice,
        speed,
        audioOutputRef.current,
        voiceVolumeRef.current,
      );
      speakHandleRef.current = handle;
      // never silent-fail: a real playback problem becomes a console note
      if (!handle && ttsEngine.lastError) {
        pushMessage({
          id: `tts-err-${Date.now()}`,
          role: "jarvis",
          content: `⚠︎ ${ttsEngine.lastError}`,
          createdAt: Date.now(),
          intent: "tts.error",
          ok: false,
        });
      }
    },
    [voice, speed, pushMessage],
  );

  const stopSpeaking = useCallback(() => {
    speakHandleRef.current?.stop();
    ttsEngine.stop();
  }, []);

  // ---------- confirmation gate (dangerous actions) ----------
  // A real in-app dialog replaces window.confirm — the model's tool call is
  // described by the gate itself ("About to delete X — continue?"), not a
  // scripted string the model is supposed to parrot.
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    detail: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirmAction = useCallback((title: string, detail: string) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ open: true, title, detail, resolve });
    });
  }, []);

  const settleConfirm = useCallback((ok: boolean) => {
    setConfirmState((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  // ---------- tool context ----------
  const openExternal = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const toolCtx = useCallback(
    (process: (text: string, mode: "text" | "voice") => Promise<void>): ToolContext => ({
      sub: async (action, arg = ""): Promise<ToolResult> => {
        const a = arg.trim();
        // continuity: remember which files the user works with
        if (action === "fs" || action === "code" || action === "dev") {
          const file = /(?:read|write|open|rename|delete|save)\s+([\w\-. ]+\.[a-z0-9]{1,5})/i.exec(a)?.[1];
          if (file) logActivity("file", `worked on "${file.trim()}"`, file.trim());
        }
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
            return mod.runFsAction(
              a,
              () => connectedRef.current,
              (title, detail) => toolCtx(process).confirmAction?.(title, detail) ?? Promise.resolve(false),
            );
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
            const m = a.match(/^(?:in\s+)?(\d+)\s*(?:minutes?|mins?|m|h(?:ours?)?)?\s*(.+)?$/i);
            if (!m) return { ok: false, data: 'Try: "<minutes> <message>", e.g. "20 the download should be done".' };
            const n = Math.max(1, parseInt(m[1]!, 10));
            const unit = (m[2] ?? "").toLowerCase();
            const mins = /^h/.test(unit) ? n * 60 : n;
            const msg = (m[3] ?? "Check-in").trim();
            const kind = action === "remind" ? "Reminder" : "Check-in";
            // persistent: survives restarts; boot briefing reports misses
            addReminder(`${kind}: ${msg}`, inMs(mins));
            setTimeout(() => {
              notify(`${kind}: ${msg}`, `Scheduled ${mins} min ago`);
              markReminderFiredOnTime();
            }, mins * 60000);
            return {
              ok: true,
              data: `${kind} set: "${msg}" in ${mins} minute${mins === 1 ? "" : "s"} — persists even if this app restarts; I'll report it next launch if it comes due while I'm closed.`,
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
          // ----- Device health (Android root: battery/temps) -----
          case "health": {
            const { findTool, executeTool } = await import("@/lib/jarvis/tools");
            if (!findTool("device_health"))
              return { ok: false, data: "Device health tool unavailable in this build." };
            // reuse the full context (sub/capture/notify/…) for the tool
            return executeTool("device_health", "", toolCtx(process));
          }
          // ----- Bulk rename -----
          case "bulkrename": {
            const mod = await import("@/lib/jarvis/brain-fs");
            const listing = await mod.runFsAction("list", () => connectedRef.current);
            if (!listing.ok) return listing;
            // args: "*.jpg to trip-" renames every jpg → trip-1.jpg, trip-2.jpg…
            const globM = a.match(/(\*\.[a-z0-9]+)\s+to\s+(.+)$/i);
            // args: "replace IMG_ with trip-" swaps the pattern in place
            const repM = a.match(/replace\s+(.+?)\s+with\s+(.+)$/i);
            if (!globM && !repM)
              return {
                ok: false,
                data: 'Try: "bulk rename *.jpg to trip-" — every matching file becomes trip-1.jpg, trip-2.jpg… (or "replace IMG_ with trip-" to swap the pattern in place).',
              };
            const { listDir, renamePath, exists } = await import("@/lib/jarvis/fs-tools");
            const { entries } = await listDir("");
            const find = repM ? repM[1]!.replace(/["']/g, "").trim() : "";
            const base = (globM ? globM[2] : repM?.[2])!.replace(/["']/g, "").trim();
            let done = 0;
            let n = 1;
            for (const e of entries) {
              if (e.kind !== "file") continue;
              const lower = e.name.toLowerCase();
              let target: string | null = null;
              if (globM) {
                const ext = globM[1]!.slice(1); // ".jpg"
                if (lower.endsWith(ext)) target = `${base}${n}${ext}`;
              } else if (find && lower.includes(find.toLowerCase())) {
                target = e.name.split(find).join(base);
              }
              if (!target || target === e.name) continue;
              if (await exists(target)) continue; // never overwrite
              await renamePath(e.name, target);
              done++;
              n++;
            }
            return {
              ok: done > 0,
              data:
                done > 0
                  ? `Renamed ${done} file${done === 1 ? "" : "s"}. The file deck refreshes now.`
                  : `No files matched that pattern — bulk rename works on the connected workspace's current folder.`,
            };
          }
          // ----- Focus mode (HUD timer) -----
          case "focus": {
            const m = a.match(/(\d+)\s*(?:minutes?|mins?|m)?/i);
            const mins = m ? Math.min(240, Math.max(1, parseInt(m[1]!, 10))) : 25;
            if (focusTimerRef.current) {
              clearInterval(focusTimerRef.current);
              focusTimerRef.current = null;
            }
            const endsAt = Date.now() + mins * 60000;
            const iv = setInterval(() => {
              const left = endsAt - Date.now();
              if (left <= 0) {
                clearInterval(iv);
                focusTimerRef.current = null;
                notify("Focus session complete", `${mins} minutes done — nice work, Sir.`);
              }
            }, 30000);
            focusTimerRef.current = iv;
            return {
              ok: true,
              data: `Focus mode: ${mins} minutes on the clock. I'll ping you when the session ends. Say "focus off" to cancel.`,
            };
          }
          // ----- Transcript export (Markdown download) -----
          case "export": {
            const md = [
              "# JARVIS transcript",
              `_${new Date().toLocaleString()}_`,
              "",
              ...messagesRef.current.map(
                (m) =>
                  `**${m.role === "user" ? "You" : m.role === "jarvis" ? "JARVIS" : "System"}** (${new Date(m.createdAt).toLocaleTimeString()}):\n\n${m.content}\n`,
              ),
            ].join("\n");
            const blob = new Blob([md], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `jarvis-transcript-${new Date().toISOString().slice(0, 10)}.md`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            return { ok: true, data: "Transcript saved as a Markdown download." };
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
      confirmAction,
    }),
    [capture, notify, connectFolder, openExternal, confirmAction],
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
        // was the brain down at boot? give it one quick re-probe first
        const probed =
          llmStatus !== "online" && llmStatus !== "testing"
            ? await ensureBrainProbed()
            : false;
        const ctx = toolCtx(process);
        const llmReady =
          llmRef.current.enabled &&
          (llmStatusRef.current === "online" || probed);
        // conversation context: the restored transcript carries turns from
        // previous sessions too, so the model continues one ongoing chat.
        // Truncated per-message to keep the prompt bounded.
        const history = messagesRef.current
          .filter(
            (m) =>
              (m.role === "user" || m.role === "jarvis") &&
              !m.content.startsWith("JARVIS online"),
          )
          .slice(-20)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content.slice(0, 800),
          }));
        const result: BrainResult = await runBrain(text, {
          speak,
          connected: connectedRef.current,
          connectFolder,
          toolCtx: ctx,
          llm: llmRef.current,
          llmReady,
          history,
          // a failover preset proved alive → adopt it silently
          onBrainAdopted: (cfg) => {
            llmAdoptingRef.current = true; // endpoint effect must not reset status
            setLlm(cfg);
            setLlmStatus("online");
          },
          // voice modes + workspaces, controllable by voice as well
          onWakeWord: enableWakeWord,
          onHandsFree: enableHandsFree,
          onAudioOutput: (id) => changeAudioOutput(id),
          onAudioInput: (id) => {
            // "set microphone to airpods" → resolve the name against the device list
            if (id && id.startsWith("__by_name__:")) {
              const want = id.slice("__by_name__:".length).toLowerCase();
              void listAudioInputs().then((inputs) => {
                const hit = realDevices(inputs).find(
                  (d) =>
                    (d.label || "").toLowerCase().includes(want) ||
                    want.includes((d.label || "").toLowerCase().split(" (")[0]),
                );
                changeAudioInput(hit ? hit.deviceId : null);
              });
            } else {
              changeAudioInput(id);
            }
          },
          onVolume: (v) => changeVoiceVolume(v),
          useHeadphones: switchToHeadphones,
          confirmAction: (title, detail) =>
            ctx.confirmAction?.(title, detail) ?? Promise.resolve(false),
          switchWorkspace: async (name) => {
            const target = workspacesRef.current.find(
              (w) =>
                w.toLowerCase() === name.toLowerCase() ||
                w.toLowerCase().includes(name.toLowerCase()),
            );
            if (!target) {
              const list = workspacesRef.current;
              return list.length
                ? `No workspace named "${name}". Connected: ${list.join(", ")}.`
                : "Only one workspace is connected right now.";
            }
            await switchWorkspace(target);
            return `Switched to the ${target} workspace.`;
          },
        });
        // "new chat" sentinel: wipe the visible conversation (memory, tools
        // and settings stay) and greet on the fresh transcript.
        if (result.reply === "__NEW_CHAT__") {
          const cleared = clearTranscript();
          setMessages([
            {
              id: uid(),
              role: "jarvis",
              content:
                cleared > 0
                  ? `Clean slate — cleared ${cleared} message${cleared === 1 ? "" : "s"}. What's next, Sir?`
                  : "Clean slate. What's next, Sir?",
              createdAt: Date.now(),
              intent: "session.reset",
            },
          ]);
          setBusy(false);
          setVoiceState((s) => (s === "thinking" ? "offline" : s));
          return;
        }
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
          // hands-free: re-arm the wake ears after the spoken reply (give TTS room to finish)
          if (handsFreeRef.current || wakeWordRef.current) {
            setTimeout(() => armWakeListener(), 1200);
          }
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
    if (recorderRef.current || busyRef.current) return;
    try {
      if (!sttEngine.ready) {
        setEngines((e) => ({ ...e, stt: "loading" }));
        await sttEngine.load(
          (p) => setEngines((e2) => ({ ...e2, progress: p, stt: "loading" })),
          () => setEngines((e2) => ({ ...e2, stt: "ready", progress: null })),
          (err) => setEngines((e2) => ({ ...e2, stt: "error", error: err })),
        );
      }
      recorderRef.current = await startRecorder(audioInputRef.current);
      setVoiceState("listening");
    } catch (e) {
      setVoiceState("offline");
      const denied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "SecurityError");
      pushMessage({
        id: uid(),
        role: "system",
        content: denied
          ? "⚠︎ Microphone permission was denied. Open Android Settings → Apps → JARVIS Local Console → Permissions → Microphone → Allow (or tap the mic button again and choose Allow in the pop-up), then try again."
          : "⚠︎ Couldn't open the microphone — unplug/replug it or pick another input in the Voice tab.",
        createdAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushMessage]);

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
        // ears re-arm after the reply is handled (see process → speak)
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

  // ---------- wake word + hands-free ----------
  const [wakeWord, setWakeWord] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const wakeHandleRef = useRef<WakeHandle | null>(null);
  const handsFreeRef = useRef(false);
  handsFreeRef.current = handsFree;
  const rearmRef = useRef<() => void>(() => {});

  const armWakeListener = useCallback(() => {
    wakeHandleRef.current?.stop();
    wakeHandleRef.current = null;
    if (!wakeWordRef.current && !handsFreeRef.current) return;
    if (recorderRef.current) return; // already capturing a command
    wakeHandleRef.current = startWakeWord(() => {
      // wake word detected — capture the command right after it
      void beginListening();
      // safety: if nothing gets recorded, revert to listening for the wake word
      setTimeout(() => {
        if (!recorderRef.current) armWakeListener();
      }, 4000);
    });
  }, [beginListening]);

  const wakeWordRef = useRef(false);
  wakeWordRef.current = wakeWord;
  const workspacesRef = useRef<string[]>([]);
  workspacesRef.current = workspaces;

  const enableWakeWord = useCallback(
    (on: boolean) => {
      wakeWordRef.current = on; // ref first: armWakeListener reads it synchronously
      setWakeWord(on);
      if (!on) {
        wakeHandleRef.current?.stop();
        wakeHandleRef.current = null;
        return;
      }
      armWakeListener();
    },
    [armWakeListener],
  );

  const enableHandsFree = useCallback(
    (on: boolean) => {
      setHandsFree(on);
      handsFreeRef.current = on;
      if (on) {
        // hands-free implies wake word
        setWakeWord(true);
        wakeWordRef.current = true;
        armWakeListener();
      } else if (!wakeWordRef.current) {
        wakeHandleRef.current?.stop();
        wakeHandleRef.current = null;
      }
    },
    [armWakeListener],
  );

  rearmRef.current = () => armWakeListener();

  const toggleTool = useCallback((id: string) => {
    setDisabledTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }, []);

  const uninstallPlugin = useCallback(
    (id: string) => {
      void removePlugin(id).then(refreshPlugins);
    },
    [refreshPlugins],
  );

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

  // ---------- audio devices (speaker / mic picking) ----------
  const switchToHeadphones = useCallback(async (): Promise<string> => {
    const dev = await findHeadphones();
    if (dev) {
      changeAudioOutput(dev.deviceId);
      return `Audio routed to ${dev.label || "headphones"}.`;
    }
    return "I couldn't spot headphones among your output devices — still on the current speaker.";
  }, [changeAudioOutput]);

  return {
    messages, input, setInput, submit, busy, voiceState,
    engines, loadEngines,
    voice, setVoice, speed, setSpeed, autoSpeak, setAutoSpeak,
    // audio devices
    audioOutput, audioInput, voiceVolume,
    changeAudioOutput, changeAudioInput, changeVoiceVolume,
    switchToHeadphones,
    connected, rootLabel, fsPath, fsEntries, fsLoading,
    connectFolder, refreshFs, openEntry, resumeAccess, savedPermission, disconnectFolder,
    toggleListening, stopSpeaking, process,
    wakeWordSupported, wakeWord, enableWakeWord,
    handsFree, enableHandsFree,
    workspaces, switchWorkspace,
    history, commandCount,
    // llm / brain
    llm, setLlm, llmStatus, models, handleTestLlm,
    // tools
    disabledTools, toggleTool,
    plugins, uninstallPlugin,
    media, closeMedia,
    confirmState, settleConfirm,
  };
}
