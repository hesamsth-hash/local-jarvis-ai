import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AudioLines,
  BrainCircuit,
  Cpu,
  Download,
  FolderOpen,
  History,
  Puzzle,
  Send,
  ShieldCheck,
  Square,
  Terminal,
  HardDrive,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ChatPanel } from "@/components/jarvis/ChatPanel";
import { FileDeck } from "@/components/jarvis/FileDeck";
import { JarvisOrb } from "@/components/jarvis/JarvisOrb";
import { MediaViewer } from "@/components/jarvis/MediaViewer";
import { ModelSettings } from "@/components/jarvis/ModelSettings";
import { PluginBay } from "@/components/jarvis/PluginBay";
import { VoiceControls } from "@/components/jarvis/VoiceControls";
import { useJarvis } from "@/components/jarvis/useJarvis";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { isDesktop, onDesktopStats, type DesktopSystemInfo } from "@/lib/jarvis/desktop-bridge";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const jarvis = useJarvis();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { canInstall, install, standalone } = usePwaInstall();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [booting, setBooting] = useState(!isDesktop());
  const [sysInfo, setSysInfo] = useState<DesktopSystemInfo | null>(null);

  // Live CPU/RAM from the native bridge (desktop + rooted Android stream every 2s).
  useEffect(() => {
    if (!isDesktop()) return;
    return onDesktopStats((info) => setSysInfo(info));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      jarvis.submit();
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="bg-grid scanlines relative flex min-h-screen flex-col bg-background text-foreground">
      <div className="aurora" />

      {/* Boot sequence — pure overlay, native builds start instantly */}
      <AnimatePresence>
        {booting && (
          <motion.div
            key="boot"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background"
          >
            <div className="relative h-24 w-72 overflow-hidden">
              <div className="boot-scan" />
              <p className="glitch-flicker font-display text-3xl font-bold tracking-[0.18em] text-primary text-glow">
                J.A.R.V.I.S
              </p>
            </div>
            <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
              <p>&gt; NEURAL CORE .......... ONLINE</p>
              <p>&gt; VOICE ENGINES ........ STANDBY</p>
              <p>&gt; {isAndroidLabel()}</p>
              <p className="text-primary">
                &gt; {BOOT_LINES[Math.floor(Math.random() * BOOT_LINES.length)]}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top HUD bar */}
      <header className="relative z-10 border-b border-primary/20 bg-background/70 backdrop-blur">
        <div className="hud-line absolute inset-x-0 bottom-0" />
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="hud-chip flex size-9 items-center justify-center rounded-md">
              <Cpu className="size-4" />
            </span>
            <div className="leading-tight">
              <p className="glitch-flicker font-display text-sm font-bold tracking-[0.22em] text-primary text-glow">
                J.A.R.V.I.S
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                local console
              </p>
            </div>
            {/* brain status chip */}
            <span
              className={cn(
                "ml-2 hidden items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 sm:flex",
                jarvis.llmStatus === "online" && jarvis.llm.enabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 ring-emerald-500/30"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              <BrainCircuit className="size-3" />
              {jarvis.llmStatus === "online" && jarvis.llm.enabled
                ? jarvis.llm.model || "llm online"
                : "offline brain"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canInstall && !standalone && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-md border-primary/30 px-3 font-mono text-xs uppercase tracking-wider text-primary hover:bg-primary/10"
                onClick={() => void install()}
              >
                <Download className="size-3.5" />
                Install
              </Button>
            )}
            {/* Native builds have no cloud account — no account UI at all. */}
            {!isDesktop() && (
              <>
                {user?.name || user?.email ? (
                  <span className="hidden truncate rounded-md border-border bg-muted px-3 py-1 font-mono text-xs text-muted-foreground sm:block">
                    {user?.name ?? user?.email}
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md border-primary/30 px-3 font-mono text-xs uppercase tracking-wider text-primary hover:bg-primary/10"
                  onClick={handleSignOut}
                >
                  Sign out
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Left column */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="hud-panel flex flex-col items-center gap-4 rounded-md px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex flex-col gap-1 text-center sm:items-start sm:text-left">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary/80">
                // system online
              </p>
              <h1 className="font-display text-xl font-semibold tracking-wide sm:text-2xl">
                {greeting()}, {user?.name?.split(" ")[0] ?? "Sir"}
              </h1>
              <p className="max-w-md text-sm text-muted-foreground">{pick(TAGLINES)}</p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <HudChip icon={ShieldCheck} label="Privacy" value="100% local" />
                <HudChip
                  icon={HardDrive}
                  label="Workspace"
                  value={jarvis.rootLabel ?? "not connected"}
                />
                <HudChip
                  icon={Terminal}
                  label="Commands"
                  value={
                    jarvis.commandCount == null ? "—" : String(jarvis.commandCount)
                  }
                />
                <HudChip
                  icon={Activity}
                  label="Machine"
                  value={machineChip(sysInfo)}
                />
              </div>
            </div>
            <JarvisOrb
              state={jarvis.voiceState}
              enginesReady={
                jarvis.engines.tts === "ready" || jarvis.engines.stt === "ready"
              }
              onToggleListen={jarvis.toggleListening}
              className="shrink-0"
            />
          </div>

          {/* Chat card */}
          <div className="hud-panel flex min-h-[380px] flex-1 flex-col overflow-hidden rounded-md">
            <div className="flex items-center justify-between border-b border-primary/15 px-4 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                transcript
              </p>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-primary/70">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                </span>
                live feed
              </span>
            </div>
            <ChatPanel messages={jarvis.messages} busy={jarvis.busy} />

            <div className="border-t border-primary/15 p-3 sm:p-4">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={inputRef}
                  value={jarvis.input}
                  onChange={(e) => jarvis.setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='Type a command — "weather in Berlin", "search fusion energy", "remind me in 20 minutes to stretch"…'
                  className="min-h-11 flex-1 resize-none rounded-md border-primary/25 font-mono text-sm placeholder:text-muted-foreground/60 focus-visible:ring-primary/40"
                  rows={1}
                  disabled={jarvis.busy}
                />
                {jarvis.voiceState === "listening" ? (
                  <Button
                    className="h-11 w-11 shrink-0 rounded-md"
                    onClick={jarvis.toggleListening}
                    aria-label="Stop recording"
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    className="h-11 w-11 shrink-0 rounded-md border-primary/30 text-primary hover:bg-primary/10"
                    variant="outline"
                    onClick={jarvis.toggleListening}
                    aria-label="Start voice input"
                  >
                    <AudioLines className="size-4" />
                  </Button>
                )}
                <Button
                  className="h-11 w-11 shrink-0 rounded-md"
                  onClick={jarvis.submit}
                  disabled={jarvis.busy || !jarvis.input.trim()}
                  aria-label="Send"
                >
                  <Send className="size-4" />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {[
                  "weather in Tokyo",
                  "search fusion energy",
                  "screen",
                  "remind me in 10 minutes to stretch",
                  "list files",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => void jarvis.process(s, "text")}
                    className="rounded-sm border border-primary/20 bg-primary/5 px-2.5 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Right column */}
        <aside className="flex min-w-0 flex-col gap-4">
          <Tabs defaultValue="voice" className="hud-panel rounded-md">
            <TabsList className="mx-3 mt-3 grid h-auto w-auto grid-cols-4 rounded-md border border-primary/15 bg-muted/40">
              <TabsTrigger
                value="voice"
                className="gap-1 px-2 font-mono text-[11px] uppercase tracking-wider data-[state=active]:text-primary"
              >
                <Volume2 className="size-3.5" />
                Voice
              </TabsTrigger>
              <TabsTrigger
                value="brain"
                className="gap-1 px-2 font-mono text-[11px] uppercase tracking-wider data-[state=active]:text-primary"
              >
                <BrainCircuit className="size-3.5" />
                Brain
              </TabsTrigger>
              <TabsTrigger
                value="tools"
                className="gap-1 px-2 font-mono text-[11px] uppercase tracking-wider data-[state=active]:text-primary"
              >
                <Puzzle className="size-3.5" />
                Tools
              </TabsTrigger>
              <TabsTrigger
                value="files"
                className="gap-1 px-2 font-mono text-[11px] uppercase tracking-wider data-[state=active]:text-primary"
              >
                <FolderOpen className="size-3.5" />
                Files
              </TabsTrigger>
            </TabsList>
            <TabsContent value="voice" className="px-0 pb-3">
              <VoiceControls
                engines={jarvis.engines}
                voice={jarvis.voice}
                speed={jarvis.speed}
                autoSpeak={jarvis.autoSpeak}
                onVoiceChange={jarvis.setVoice}
                onSpeedChange={jarvis.setSpeed}
                onAutoSpeakChange={jarvis.setAutoSpeak}
                onDownload={jarvis.loadEngines}
              />
            </TabsContent>
            <TabsContent value="brain" className="px-0 pb-3">
              <ModelSettings
                config={jarvis.llm}
                status={jarvis.llmStatus}
                models={jarvis.models}
                onChange={jarvis.setLlm}
                onTest={() => void jarvis.handleTestLlm()}
              />
            </TabsContent>
            <TabsContent value="tools" className="max-h-[520px] overflow-y-auto px-0 pb-3">
              <AutostartToggle />
              <PluginBay
                disabledTools={jarvis.disabledTools}
                onToggleTool={jarvis.toggleTool}
                plugins={jarvis.plugins}
                onRemovePlugin={jarvis.uninstallPlugin}
              />
            </TabsContent>
            <TabsContent value="files" className="h-[420px] px-0 pb-3">
              <FileDeck
                connected={jarvis.connected}
                rootLabel={jarvis.rootLabel}
                path={jarvis.fsPath}
                entries={jarvis.fsEntries}
                loading={jarvis.fsLoading}
                needsReconnect={
                  jarvis.connected && jarvis.savedPermission !== "granted"
                }
                onConnect={() => void jarvis.connectFolder()}
                onReconnect={() => void jarvis.resumeAccess()}
                onDisconnect={() => void jarvis.disconnectFolder()}
                onRefresh={() => void jarvis.refreshFs(jarvis.fsPath)}
                onOpen={jarvis.openEntry}
              />
            </TabsContent>
          </Tabs>

          {/* History card */}
          <div className="hud-panel rounded-md">
            <div className="flex items-center gap-2 border-b border-primary/15 px-4 py-3">
              <History className="size-4 text-primary" />
              <p className="font-mono text-[11px] uppercase tracking-[0.25em]">
                Command log
              </p>
            </div>
            <ScrollArea className="h-56">
              <div className="space-y-1 p-2">
                {(jarvis.history ?? []).length === 0 && (
                  <p className="p-4 text-center font-mono text-xs text-muted-foreground">
                    No commands executed yet.
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {(jarvis.history ?? []).map((h) => (
                    <motion.div
                      key={h._id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2.5 rounded-sm px-2.5 py-2 transition-colors hover:bg-primary/5"
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          h.ok
                            ? "bg-emerald-500 shadow-[0_0_6px_theme(colors.emerald.500)]"
                            : "bg-destructive shadow-[0_0_6px_theme(colors.red.500)]",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs">{h.input}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {h.intent ?? "—"} · {h.inputMode} ·{" "}
                          {new Date(h.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </ScrollArea>
          </div>
        </aside>
      </main>

      {/* Media viewer overlay */}
      <MediaViewer
        stream={jarvis.media?.stream ?? null}
        kind={jarvis.media?.kind ?? null}
        label={jarvis.media?.kind === "screen" ? "Screen share" : "Webcam"}
        onClose={jarvis.closeMedia}
      />
    </div>
  );
}

// Windows auto-start — strictly opt-in, default OFF. Browser/PWA builds never show it.
function AutostartToggle() {
  const [enabled, setEnabled] = useState(false);
  const [available] = useState(() => isDesktop());

  useEffect(() => {
    if (!available) return;
    void (async () => {
      try {
        const mod = await import("@tauri-apps/plugin-autostart");
        setEnabled(await mod.isEnabled());
      } catch {
        // desktop webview without the plugin — hide silently
      }
    })();
  }, [available]);

  if (!available) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-primary/15 px-4 py-3">
      <div>
        <p className="text-xs font-medium">Start with Windows</p>
        <p className="font-mono text-[10px] text-muted-foreground">
          Launch JARVIS automatically at sign-in (off by default).
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 rounded-md border-primary/30 px-3 font-mono text-[10px] uppercase tracking-wider text-primary hover:bg-primary/10"
        onClick={() => {
          void (async () => {
            try {
              const mod = await import("@tauri-apps/plugin-autostart");
              if (enabled) await mod.disable();
              else await mod.enable();
              setEnabled(!enabled);
            } catch {
              // ignore
            }
          })();
        }}
      >
        {enabled ? "On" : "Off"}
      </Button>
    </div>
  );
}

function HudChip({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="hud-chip flex items-center gap-2.5 rounded-sm px-3 py-2">
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0 leading-tight">
        <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">
          {label}
        </p>
        <p className="truncate font-mono text-xs font-medium">{value}</p>
      </div>
    </div>
  );
}

// Live machine chip: real CPU/RAM when the native bridge streams, estimates otherwise.
function machineChip(info: DesktopSystemInfo | null): string {
  if (info) {
    const ramPct = info.total_memory_gb
      ? Math.round((info.used_memory_gb / info.total_memory_gb) * 100)
      : 0;
    return `CPU ${info.cpu_usage_percent.toFixed(0)}% · RAM ${ramPct}%`;
  }
  const cores = navigator.hardwareConcurrency ?? 0;
  return cores ? `${cores} cores` : "local";
}

function isAndroidLabel() {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
    ? "ROOT BRIDGE · ARMED"
    : "OS LINK · STANDBY";
}

// Small system-flavored boot lines — never suit/armor references.
const BOOT_LINES = [
  "Diagnostics complete — no anomalies.",
  "All subsystems responding normally.",
  "Local core synchronized. Standing by.",
  "Interfaces calibrated. Awaiting input.",
  "Systems nominal. Good to have you back.",
  "Cache verified. Voice and hearing online.",
];

// Rotating greeting openers (time-aware pick, randomized per visit).
const GREETINGS: Record<string, string[]> = {
  morning: ["Good morning", "Morning", "Rise and shine"],
  afternoon: ["Good afternoon", "Afternoon", "Welcome back"],
  evening: ["Good evening", "Evening", "Working late"],
  night: ["Burning the midnight oil", "Late shift", "Still up"],
};

// Rotating subtitle lines under the greeting.
const TAGLINES = [
  "Voice, brain, and tools — all running on this device.",
  "Keyless brain online. Your data stays put.",
  "Listening, thinking, acting — locally.",
  "No cloud in the loop unless you ask for one.",
  "Every tool on this panel runs on-device.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function greeting() {
  const h = new Date().getHours();
  const key = h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : h < 22 ? "evening" : "night";
  return pick(GREETINGS[key]!);
}
