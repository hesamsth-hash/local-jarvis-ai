import { AnimatePresence, motion } from "framer-motion";
import {
  AudioLines,
  BrainCircuit,
  Cpu,
  Download,
  FolderOpen,
  History,
  Puzzle,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ChatPanel } from "@/components/jarvis/ChatPanel";
import { FileDeck } from "@/components/jarvis/FileDeck";
import { JarvisOrb } from "@/components/jarvis/JarvisOrb";
import { MediaViewer } from "@/components/jarvis/MediaViewer";
import { ModelSettings } from "@/components/jarvis/ModelSettings";
import { PluginBay } from "@/components/jarvis/PluginBay";
import { SystemStrip } from "@/components/jarvis/SystemStrip";
import { VoiceControls } from "@/components/jarvis/VoiceControls";
import { useJarvis } from "@/components/jarvis/useJarvis";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const jarvis = useJarvis();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { canInstall, install, standalone } = usePwaInstall();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
    <div className="bg-grid relative flex min-h-screen flex-col bg-background text-foreground">
      <div className="aurora" />

      {/* Top bar */}
      <header className="relative z-10 border-b border-border/70 bg-background/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Cpu className="size-4.5" />
            </span>
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold">JARVIS</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                local console
              </p>
            </div>
            {/* brain status chip */}
            <span
              className={cn(
                "ml-2 hidden items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase ring-1 sm:flex",
                jarvis.llmStatus === "online" && jarvis.llm.enabled
                  ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground ring-border",
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
                className="h-8 gap-1.5 rounded-full px-3 text-xs"
                onClick={() => void install()}
              >
                <Download className="size-3.5" />
                Install app
              </Button>
            )}
            {user?.name || user?.email ? (
              <span className="hidden truncate rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground sm:block">
                {user?.name ?? user?.email}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              onClick={handleSignOut}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Left column */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="glass-panel soft-card flex flex-col items-center gap-4 rounded-2xl px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex flex-col gap-1 text-center sm:items-start sm:text-left">
              <h1 className="font-display text-xl font-semibold sm:text-2xl">
                Good {greeting()}, {user?.name?.split(" ")[0] ?? "Sir"}
              </h1>
              <p className="max-w-md text-sm text-muted-foreground">
                Voice, brain, and tools — all running on this device.
              </p>
              <SystemStrip
                className="mt-2 justify-center sm:justify-start"
                commandCount={jarvis.commandCount ?? null}
                workspaceName={jarvis.rootLabel}
              />
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
          <div className="soft-card flex min-h-[380px] flex-1 flex-col overflow-hidden rounded-2xl">
            <ChatPanel messages={jarvis.messages} busy={jarvis.busy} />

            <div className="border-t border-border/70 p-3 sm:p-4">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={inputRef}
                  value={jarvis.input}
                  onChange={(e) => jarvis.setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='Type a command — "weather in Berlin", "search fusion energy", "remind me in 20 minutes to stretch"…'
                  className="min-h-11 flex-1 resize-none rounded-xl text-sm"
                  rows={1}
                  disabled={jarvis.busy}
                />
                {jarvis.voiceState === "listening" ? (
                  <Button
                    className="h-11 w-11 shrink-0 rounded-xl p-0"
                    onClick={jarvis.toggleListening}
                    aria-label="Stop recording"
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    className="h-11 w-11 shrink-0 rounded-xl p-0"
                    variant="outline"
                    onClick={jarvis.toggleListening}
                    aria-label="Start voice input"
                  >
                    <AudioLines className="size-4" />
                  </Button>
                )}
                <Button
                  className="h-11 w-11 shrink-0 rounded-xl p-0"
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
                    className="rounded-full bg-muted px-2.5 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
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
          <Tabs defaultValue="voice" className="soft-card rounded-2xl">
            <TabsList className="mx-3 mt-3 grid h-auto w-auto grid-cols-4">
              <TabsTrigger value="voice" className="gap-1 px-2 text-xs">
                <Volume2 className="size-3.5" />
                Voice
              </TabsTrigger>
              <TabsTrigger value="brain" className="gap-1 px-2 text-xs">
                <BrainCircuit className="size-3.5" />
                Brain
              </TabsTrigger>
              <TabsTrigger value="tools" className="gap-1 px-2 text-xs">
                <Puzzle className="size-3.5" />
                Tools
              </TabsTrigger>
              <TabsTrigger value="files" className="gap-1 px-2 text-xs">
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
          <div className="soft-card rounded-2xl">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <History className="size-4 text-primary" />
              <p className="text-sm font-medium">Command history</p>
            </div>
            <ScrollArea className="h-56">
              <div className="space-y-1 p-2">
                {(jarvis.history ?? []).length === 0 && (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    Commands you run are logged here (stored in your account).
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {(jarvis.history ?? []).map((h) => (
                    <motion.div
                      key={h._id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          "mt-1 size-1.5 shrink-0 rounded-full",
                          h.ok ? "bg-emerald-500" : "bg-destructive",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">{h.input}</p>
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

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
