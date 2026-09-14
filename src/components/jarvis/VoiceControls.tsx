import {
  Activity,
  Download,
  Headphones,
  Mic,
  Palette,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  friendlyLabel,
  listAudioInputs,
  listAudioOutputs,
  realDevices,
} from "@/lib/jarvis/audio-devices";
import { ACCENTS, applyAccent, loadAccent } from "@/lib/jarvis/theme";
import { VoiceModeControls } from "./VoiceModeControls";
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
  // voice modes
  wakeSupported: boolean;
  wakeWord: boolean;
  handsFree: boolean;
  onWakeWord: (on: boolean) => void;
  onHandsFree: (on: boolean) => void;
  // audio devices (speakers + mic, Windows-settings style)
  audioOutput: string | null;
  audioInput: string | null;
  voiceVolume: number;
  onAudioOutputChange: (id: string | null) => void;
  onAudioInputChange: (id: string | null) => void;
  onVolumeChange: (v: number) => void;
  onTestAudio: () => void;
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
  wakeSupported,
  wakeWord,
  handsFree,
  onWakeWord,
  onHandsFree,
  audioOutput,
  audioInput,
  voiceVolume,
  onAudioOutputChange,
  onAudioInputChange,
  onVolumeChange,
  onTestAudio,
}: VoiceControlsProps) {
  const anyLoading = engines.tts === "loading" || engines.stt === "loading";
  const bothReady = engines.tts === "ready" && engines.stt === "ready";
  const [accent, setAccent] = useState(loadAccent);

  // device lists — labels only populate once mic permission has been granted
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [micUnlocked, setMicUnlocked] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [o, i] = await Promise.all([listAudioOutputs(), listAudioInputs()]);
      if (!alive) return;
      setOutputs(o);
      setInputs(i);
    };
    void refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [micUnlocked]);

  // unlock device labels: browsers hide them until mic permission is granted
  const unlockMicLabels = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      // denied — pickers still work with generic labels
    }
    setMicUnlocked(true);
  };

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

      {/* Audio devices — like the Windows sound settings, inside JARVIS */}
      <div className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Headphones className="size-3.5" />
          Sound devices
        </p>
        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">
            Speak out of (headphones, speakers, HDMI…)
          </p>
          <Select
            value={audioOutput ?? "__default__"}
            onValueChange={(v) =>
              onAudioOutputChange(v === "__default__" ? null : v)
            }
          >
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__" className="text-xs">
                System default
              </SelectItem>
              {realDevices(outputs).map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">
                  {friendlyLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">
            Listen through (microphone)
          </p>
          <Select
            value={audioInput ?? "__default__"}
            onValueChange={(v) =>
              onAudioInputChange(v === "__default__" ? null : v)
            }
          >
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__" className="text-xs">
                System default
              </SelectItem>
              {realDevices(inputs).map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">
                  {friendlyLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {inputs.every((d) => !d.label) && (
            <button
              className="mt-1 text-[10px] text-primary underline-offset-2 hover:underline"
              onClick={() => void unlockMicLabels()}
            >
              Show real mic names (asks mic access once)
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Volume2 className="size-3.5 shrink-0 text-muted-foreground" />
          <Slider
            value={[voiceVolume]}
            onValueChange={(vals: number[]) => onVolumeChange(vals[0] ?? voiceVolume)}
            min={0.1}
            max={1}
            step={0.05}
            className="flex-1"
          />
          <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {Math.round(voiceVolume * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1.5 text-xs"
            onClick={onTestAudio}
          >
            <Volume2 className="size-3" />
            Test voice
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Re-scan devices (or just plug in and the list updates itself)"
            className="h-7 w-7 p-0"
            onClick={() => void unlockMicLabels()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Picks stick after restart. Plug headphones in and out — the list follows,
          and "use headphones" works by voice.
        </p>
      </div>

      <VoiceModeControls
        wakeSupported={wakeSupported}
        wakeOn={wakeWord}
        handsFreeOn={handsFree}
        onWake={onWakeWord}
        onHandsFree={onHandsFree}
      />

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

      {/* Accent color — recolors the whole HUD instantly */}
      <div className="space-y-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Palette className="size-3.5" />
          Accent
        </p>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              title={a.label}
              aria-label={`Accent: ${a.label}`}
              onClick={() => {
                setAccent(a);
                applyAccent(a);
              }}
              className={cn(
                "size-7 rounded-full ring-2 transition-transform hover:scale-110",
                accent.id === a.id ? "ring-foreground/70" : "ring-transparent",
              )}
              style={{
                background: `radial-gradient(circle at 35% 30%, oklch(0.9 0.08 ${a.hue}), oklch(0.55 0.16 ${a.hue}))`,
                boxShadow: `0 0 10px oklch(0.7 0.14 ${a.hue} / 0.5)`,
              }}
            />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {accent.label} — recolors panels, orb and glow everywhere.
        </p>
      </div>
    </div>
  );
}
