import { Activity, Download, Mic, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { VOICES } from "@/lib/jarvis/kokoro-tts";
import type { EngineLoadState } from "@/lib/jarvis/types";
import { cn } from "@/lib/utils";

interface VoiceControlsProps {
  engines: EngineLoadState;
  voice: string;
  speed: number;
  autoSpeak: boolean;
  onVoiceChange: (v: string) => void;
  onSpeedChange: (v: number) => void;
  onAutoSpeakChange: (v: boolean) => void;
  onDownload: () => void;
}

function EngineRow({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status: EngineLoadState["tts"];
}) {
  const color =
    status === "ready"
      ? "text-emerald-600 dark:text-emerald-400"
      : status === "loading"
        ? "text-amber-600 dark:text-amber-400"
        : status === "error"
          ? "text-destructive"
          : "text-muted-foreground";
  const dot =
    status === "ready"
      ? "bg-emerald-500"
      : status === "loading"
        ? "bg-amber-500 animate-pulse"
        : status === "error"
          ? "bg-destructive"
          : "bg-muted-foreground/40";
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {detail}
        </p>
      </div>
      <span className="flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", dot)} />
        <span className={cn("font-mono text-[10px] uppercase", color)}>
          {status}
        </span>
      </span>
    </div>
  );
}

export function VoiceControls({
  engines,
  voice,
  speed,
  autoSpeak,
  onVoiceChange,
  onSpeedChange,
  onAutoSpeakChange,
  onDownload,
}: VoiceControlsProps) {
  const anyLoading = engines.tts === "loading" || engines.stt === "loading";
  const bothReady = engines.tts === "ready" && engines.stt === "ready";

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Activity className="size-3.5" />
          Local engines
        </p>
        <EngineRow
          label="Kokoro TTS"
          detail="kokoro-82m · q8 · wasm"
          status={engines.tts}
        />
        <EngineRow
          label="Whisper STT"
          detail="whisper-base · q8 · wasm"
          status={engines.stt}
        />
      </div>

      {!bothReady && (
        <div className="rounded-xl bg-primary/5 p-3 ring-1 ring-primary/20">
          {anyLoading ? (
            <>
              {engines.progress && (
                <div className="space-y-1.5">
                  <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span className="max-w-[70%] truncate">
                      {engines.progress.file}
                    </span>
                    <span>{Math.round(engines.progress.progress)}%</span>
                  </div>
                  <Progress
                    value={engines.progress.progress}
                    className="h-1.5"
                  />
                </div>
              )}
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                Downloading the neural models (~40 MB, one time). They're cached
                in your browser and run on this device afterwards.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-medium">
                One-time setup: download the local engines
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Kokoro (voice) + Whisper (ears), ~40 MB total. Stored in your
                browser — no cloud is used at runtime.
              </p>
              <Button
                size="sm"
                className="mt-2.5 w-full gap-2"
                onClick={onDownload}
              >
                <Download className="size-3.5" />
                Download engines
              </Button>
              {engines.error && (
                <p className="mt-2 text-[11px] text-destructive">
                  {engines.error}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Volume2 className="size-3.5" />
          Voice
        </p>
        <Select value={voice} onValueChange={onVoiceChange}>
          <SelectTrigger className="w-full text-xs">
            <SelectValue placeholder="Kokoro voice" />
          </SelectTrigger>
          <SelectContent>
            {VOICES.map((v) => (
              <SelectItem key={v.id} value={v.id} className="text-xs">
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
            speed {speed.toFixed(2)}×
          </span>
          <Slider
            value={[speed]}
            onValueChange={(vals: number[]) => onSpeedChange(vals[0] ?? speed)}
            min={0.6}
            max={1.6}
            step={0.05}
            className="flex-1"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
        <div>
          <p className="text-xs font-medium">Speak replies aloud</p>
          <p className="text-[10px] text-muted-foreground">
            Auto voice for every answer
          </p>
        </div>
        <Button
          size="sm"
          variant={autoSpeak ? "default" : "outline"}
          className={cn(
            "h-7 gap-1.5 rounded-full px-3 text-xs",
            !autoSpeak && "text-muted-foreground",
          )}
          onClick={() => onAutoSpeakChange(!autoSpeak)}
        >
          <Mic className="size-3" />
          {autoSpeak ? "On" : "Off"}
        </Button>
      </div>
    </div>
  );
}
