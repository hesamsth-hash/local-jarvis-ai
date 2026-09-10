import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  deletePath,
  hasRoot,
  listDir,
  pickRootFolder,
  renamePath,
  setRoot,
  writeFile,
} from "@/lib/jarvis/fs-tools";
import { runBrain } from "@/lib/jarvis/brain";
import { ttsEngine } from "@/lib/jarvis/kokoro-tts";
import { sttEngine } from "@/lib/jarvis/whisper-stt";
import { resampleTo16k, startRecorder, type RecorderHandle } from "@/lib/jarvis/recorder";
import type {
  ChatMessage,
  EngineLoadState,
  FsEntryView,
  ToolDescriptor,
  VoiceState,
} from "@/lib/jarvis/types";

const DEFAULT_PLUGINS: ToolDescriptor[] = [
  {
    id: "fs-tools",
    name: "fs-tools",
    description: "List, read, write, rename, move and delete local files.",
    icon: "hard-drive",
    enabled: true,
  },
  {
    id: "kokoro-tts",
    name: "kokoro-tts",
    description: "82M-param neural voice, generated on your device.",
    icon: "volume2",
    enabled: true,
  },
  {
    id: "whisper-stt",
    name: "whisper-stt",
    description: "Whisper speech-to-text for hands-free commands.",
    icon: "mic",
    enabled: true,
  },
  {
    id: "system-answers",
    name: "system-answers",
    description: "Time, date, status and help — answered locally.",
    icon: "bot",
    enabled: true,
  },
];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useJarvis() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "jarvis",
      content:
        'JARVIS online. Everything here runs on your device — no cloud, no API keys. First click “Download engines” in the Voice tab to fetch the voice + speech models (~40 MB, cached after that). Then say “connect folder” for local file access, or “help” to see my skills.',
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
  const [plugins, setPlugins] = useState(DEFAULT_PLUGINS);
  const [connected, setConnected] = useState(hasRoot());
  const [rootLabel, setRootLabel] = useState<string | null>(null);
  const [fsPath, setFsPath] = useState("");
  const [fsEntries, setFsEntries] = useState<FsEntryView[]>([]);
  const [fsLoading, setFsLoading] = useState(false);

  const recorderRef = useRef<RecorderHandle | null>(null);
  const speakHandleRef = useRef<{ stop: () => void } | null>(null);
  const pluginsRef = useRef(plugins);
  pluginsRef.current = plugins;

  const logCommand = useMutation(api.jarvis.logCommand);
  const history = useQuery(api.jarvis.recentCommands, { limit: 12 });
  const commandCount = useQuery(api.jarvis.commandCount);

  // ---------- engine loading ----------
  const loadEngines = useCallback(() => {
    setEngines((prev) => ({ ...prev, error: null }));
    ttsEngine.onStateChange = (speaking) =>
      setVoiceState((s) => (speaking ? "speaking" : s === "speaking" ? "offline" : s));
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
    setRootLabel(handle.name);
    await refreshFs("");
    return true;
  }, [refreshFs]);

  useEffect(() => {
    if (connected) {
      void refreshFs("");
    }
  }, [connected, refreshFs]);

  // ---------- speech ----------
  const speak = useCallback(
    async (text: string) => {
      if (!ttsEngine.ready || !pluginsRef.current.find((p) => p.id === "kokoro-tts")?.enabled) {
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

  // ---------- message handling ----------
  const pushMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev.slice(-60), m]);
  }, []);

  const process = useCallback(
    async (raw: string, mode: "text" | "voice") => {
      const text = raw.trim();
      if (!text || busy) return;
      setBusy(true);
      setVoiceState("thinking");
      pushMessage({ id: uid(), role: "user", content: text, createdAt: Date.now() });
      try {
        const result = await runBrain(text, { speak, connected, connectFolder });
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
        if (
          autoSpeak &&
          pluginsRef.current.find((p) => p.id === "kokoro-tts")?.enabled
        ) {
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
    [busy, speak, connected, connectFolder, refreshFs, fsPath, autoSpeak, logCommand],
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
  }, [process, pushMessage]);

  const toggleListening = useCallback(() => {
    if (recorderRef.current) {
      stopRecording();
    } else {
      void beginListening();
    }
  }, [stopRecording, beginListening]);

  const togglePlugin = useCallback((id: string) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  }, []);

  const openEntry = useCallback(
    (entry: FsEntryView) => {
      if (entry.kind === "directory") {
        const next = entry.name.startsWith("/")
          ? entry.name.slice(1)
          : entry.name;
        void refreshFs(next);
      } else {
        void process(`read ${entry.name}`, "text");
      }
    },
    [refreshFs, process],
  );

  // graceful engine cleanup on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      ttsEngine.stop();
    };
  }, []);

  const submit = useCallback(() => {
    const text = input;
    setInput("");
    void process(text, "text");
  }, [input, process]);

  const handleRename = useCallback(
    (from: string, to: string) => renamePath(from, to),
    [],
  );
  const handleDelete = useCallback((path: string) => deletePath(path), []);
  const handleWrite = useCallback(
    (path: string, content: string) => writeFile(path, content),
    [],
  );

  return {
    messages,
    input,
    setInput,
    submit,
    busy,
    voiceState,
    engines,
    loadEngines,
    voice,
    setVoice,
    speed,
    setSpeed,
    autoSpeak,
    setAutoSpeak,
    plugins,
    togglePlugin,
    connected,
    rootLabel,
    fsPath,
    fsEntries,
    fsLoading,
    connectFolder,
    refreshFs,
    openEntry,
    toggleListening,
    stopSpeaking,
    process,
    history,
    commandCount,
    handleRename,
    handleDelete,
    handleWrite,
  };
}
