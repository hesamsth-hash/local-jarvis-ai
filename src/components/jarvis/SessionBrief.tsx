import { motion } from "framer-motion";
import {
  Eye,
  Focus,
  LockKeyhole,
  MemoryStick,
  Mic2,
  Radio,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VoiceState } from "@/lib/jarvis/types";

interface SessionBriefProps {
  voiceState: VoiceState;
  wakeWord: boolean;
  handsFree: boolean;
  workspace: string | null;
  memoryCount: number;
  onCommand: (command: string) => void;
}

const SIGNAL_BARS = [0.3, 0.55, 0.85, 0.45, 0.7, 0.35, 0.6, 0.9, 0.5, 0.75, 0.4, 0.65];

export function SessionBrief({
  voiceState,
  wakeWord,
  handsFree,
  workspace,
  memoryCount,
  onCommand,
}: SessionBriefProps) {
  const signalActive = voiceState === "listening" || voiceState === "speaking";
  const mode = handsFree ? "hands-free" : wakeWord ? "wake word armed" : "push to talk";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1 }}
      className="hud-panel overflow-hidden rounded-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/15 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="hud-chip flex size-8 items-center justify-center rounded-sm">
            <Radio className={cn("size-4", signalActive && "animate-pulse")} />
          </span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-primary">
              session brief
            </p>
            <p className="text-xs text-muted-foreground">
              Continuity, signal, and guardrails are active.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-emerald-500">
          <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]" />
          local session
        </div>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-[1.15fr_1fr] sm:p-4">
        <div className="rounded-sm border border-primary/15 bg-primary/[0.035] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Mic2 className="size-3.5 text-primary" />
                Reactive audio HUD
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {voiceState} · {mode}
              </p>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">16kHz</span>
          </div>
          <div className="mt-4 flex h-8 items-center gap-1" aria-label="Audio activity waveform">
            {SIGNAL_BARS.map((height, index) => (
              <span
                key={index}
                className={cn(
                  "wave-bar block min-w-1 flex-1 rounded-full bg-primary/70",
                  !signalActive && "opacity-35",
                )}
                style={{
                  height: `${Math.max(18, height * 100)}%`,
                  animationDelay: `${index * 0.08}s`,
                  animationPlayState: signalActive ? "running" : "paused",
                }}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatusTile icon={MemoryStick} label="Context" value={`${memoryCount} memories`} />
          <StatusTile icon={LockKeyhole} label="Safety" value="confirm gates" />
          <StatusTile icon={Eye} label="Vision" value="on request" />
          <StatusTile icon={ShieldCheck} label="Workspace" value={workspace ?? "not connected"} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-primary/15 px-3 py-3 sm:px-4">
        <span className="mr-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3 text-primary" />
          ready actions
        </span>
        <QuickAction icon={Focus} label="Focus 25m" onClick={() => onCommand("focus 25")} />
        <QuickAction icon={Eye} label="See screen" onClick={() => onCommand("screen")} />
        <QuickAction icon={MemoryStick} label="Recall memory" onClick={() => onCommand("list memory")} />
      </div>
    </motion.div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-sm border border-border/70 bg-muted/25 px-2.5 py-2">
      <Icon className="size-3.5 text-primary/80" />
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="truncate text-[11px] font-medium">{value}</p>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 rounded-sm border-primary/20 px-2.5 font-mono text-[10px] uppercase tracking-wider hover:border-primary/50 hover:bg-primary/10"
      onClick={onClick}
    >
      <Icon className="size-3" />
      {label}
    </Button>
  );
}
