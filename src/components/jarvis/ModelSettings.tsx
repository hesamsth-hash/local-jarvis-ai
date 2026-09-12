import { useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronRight,
  Loader2,
  PlugZap,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listModels,
  PRESETS,
  testConnection,
  type LlmConfig,
  type ModelInfo,
} from "@/lib/jarvis/llm";
import { cn } from "@/lib/utils";

interface ModelSettingsProps {
  config: LlmConfig;
  status: "untested" | "testing" | "online" | "offline";
  models: ModelInfo[];
  onChange: (cfg: LlmConfig) => void;
  onTest: () => void;
}

export function ModelSettings({
  config,
  status,
  models,
  onChange,
  onTest,
}: ModelSettingsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const preset =
    PRESETS.find((p) => p.id === config.presetId) ??
    PRESETS.find((p) => p.provider === config.provider && !p.cloud) ??
    PRESETS[0];

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    onChange({ ...config, provider: p.provider, url: p.url, model: "", presetId: p.id });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <BrainCircuit className="size-3.5" />
            Local LLM brain
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Route requests through your own model server — Ollama, KoboldCpp,
            LM Studio or llama.cpp.
          </p>
        </div>
        <Button
          size="sm"
          variant={config.enabled ? "default" : "outline"}
          className={cn(
            "h-7 shrink-0 rounded-full px-3 text-xs",
            !config.enabled && "text-muted-foreground",
          )}
          onClick={() => onChange({ ...config, enabled: !config.enabled })}
        >
          {config.enabled ? "On" : "Off"}
        </Button>
      </div>

      {/* Preset chips */}
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className={cn(
              "rounded-xl border px-3 py-2 text-left transition-colors",
              config.provider === p.provider
                ? "border-primary/40 bg-primary/10"
                : "border-border bg-card hover:bg-muted/60",
            )}
          >
            <p className="text-xs font-medium">{p.label}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {p.url.replace("http://", "")}
            </p>
          </button>
        ))}
      </div>

      {/* URL + test */}
      <div className="flex items-center gap-2">
        <Input
          value={config.url}
          onChange={(e) => onChange({ ...config, url: e.target.value })}
          placeholder="http://localhost:11434"
          className="h-9 font-mono text-xs"
          spellCheck={false}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-9 shrink-0 gap-1.5 text-xs"
          onClick={onTest}
          disabled={status === "testing"}
        >
          {status === "testing" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : status === "online" ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : status === "offline" ? (
            <X className="size-3.5 text-destructive" />
          ) : (
            <PlugZap className="size-3.5" />
          )}
          {status === "online" ? "Online" : "Test"}
        </Button>
      </div>
      {/* Cloud API key (Fireworks / Groq / OpenRouter) */}
      {preset?.cloud && !preset.keyless && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">API key</p>
          <Input
            type="password"
            value={config.apiKey ?? ""}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
            placeholder="paste your key — stored on this device only"
            className="h-9 font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            {preset.hint}. Requests go straight from this device to the provider —
            the key never touches any server of ours.
          </p>
        </div>
      )}
      {preset?.keyless && (
        <div className="rounded-lg bg-emerald-500/10 p-2.5 text-[11px] leading-snug text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400">
          ✨ Keyless — no account, no key, zero setup. Hit Test and pick a model.
          Free community service: occasionally rate-limited or busy.
        </div>
      )}
      {preset && !preset.cloud && (
        <p className="font-mono text-[10px] text-muted-foreground">
          setup: {preset.hint}
        </p>
      )}

      {/* Model picker */}
      {status === "online" && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Model</p>
          {models.length > 0 ? (
            <Select
              value={config.model}
              onValueChange={(v) => onChange({ ...config, model: v })}
            >
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="Pick a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.id}
                    {m.size ? ` · ${m.size}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={config.model}
              onChange={(e) => onChange({ ...config, model: e.target.value })}
              placeholder="model name (e.g. llama3.2)"
              className="h-9 font-mono text-xs"
              spellCheck={false}
            />
          )}
          {models.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
              onClick={onTest}
            >
              <RefreshCw className="size-3" />
              refresh list
            </Button>
          )}
        </div>
      )}

      {/* Vision model — powers See & Act */}
      {status === "online" && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            Vision model{" "}
            <span className="font-normal text-muted-foreground">
              (for See &amp; Act — optional)
            </span>
          </p>
          {models.length > 0 ? (
            <Select
              value={config.visionModel || "none"}
              onValueChange={(v) =>
                onChange({ ...config, visionModel: v === "none" ? "" : v })
              }
            >
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="None — See & Act off" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  None — See &amp; Act off
                </SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.id}
                    {m.size ? ` · ${m.size}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={config.visionModel ?? ""}
              onChange={(e) => onChange({ ...config, visionModel: e.target.value })}
              placeholder="vision model (e.g. llava, llama3.2-vision) — blank to disable"
              className="h-9 font-mono text-xs"
              spellCheck={false}
            />
          )}
          <p className="text-[10px] leading-snug text-muted-foreground">
            A vision-capable model (Ollama: <span className="font-mono">ollama pull llava</span> or{" "}
            <span className="font-mono">llama3.2-vision</span>) lets JARVIS look at screenshots
            and click, drag or draw on what it finds.
          </p>
        </div>
      )}

      {status === "offline" && (
        <div className="rounded-lg bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
          {preset?.cloud && !preset.keyless && !config.apiKey?.trim()
            ? "Paste your API key first, then hit Test."
            : "Couldn't reach the server. Is it running? If it's on another machine, make sure CORS is allowed (e.g. OLLAMA_ORIGINS=*). For cloud presets, check the key is valid — keyless services can also be temporarily busy."}
        </div>
      )}

      {/* Advanced */}
      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvanced((s) => !s)}
      >
        <ChevronRight
          className={cn("size-3 transition-transform", showAdvanced && "rotate-90")}
        />
        How routing works
      </button>
      {showAdvanced && (
        <p className="rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
          With the brain on, your request goes to the local model with the tool
          registry. The model picks a tool (search, weather, files, capture…),
          the console executes it on-device, and the result is fed back for a
          final spoken answer — up to 3 hops. If the brain is off or the server
          is down, the offline intent brain handles commands instead. OS-level
          actions (volume, mouse control) are honestly refused: a browser tab
          can't touch those.
        </p>
      )}
    </div>
  );
}
