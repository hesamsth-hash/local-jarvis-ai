import {
  Bot,
  Camera,
  Code,
  FileClock,
  FilePlus2,
  FileSearch,
  FolderInput,
  FolderOutput,
  Globe,
  HardDrive,
  MessageSquareText,
  Mic,
  Monitor,
  Pencil,
  Plane,
  Puzzle,
  Send,
  Settings2,
  Terminal,
  Trash2,
  Undo2,
  Volume2,
  Youtube,
  Zap,
  Gamepad2,
  Radar,
  BellRing,
  MousePointer2,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES, TOOLS } from "@/lib/jarvis/tools";
import type { PluginSpec } from "@/lib/jarvis/plugins";
import { cn } from "@/lib/utils";

interface PluginBayProps {
  disabledTools: string[];
  onToggleTool: (id: string) => void;
  plugins: PluginSpec[];
  onRemovePlugin: (id: string) => void;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  terminal: Terminal,
  "message-square-text": MessageSquareText,
  volume2: Volume2,
  mic: Mic,
  "hard-drive": HardDrive,
  "folder-input": FolderInput,
  "file-search": FileSearch,
  "file-plus": FilePlus2,
  pencil: Pencil,
  trash: Trash2,
  undo: Undo2,
  "file-clock": FileClock,
  bot: Bot,
  globe: Globe,
  monitor: Monitor,
  folder: HardDrive,
  send: Send,
  zap: Zap,
  camera: Camera,
  code: Code,
  plane: Plane,
  youtube: Youtube,
  gamepad: Gamepad2,
  radar: Radar,
  bell: BellRing,
  mouse: MousePointer2,
  dashboard: LayoutDashboard,
  settings: Settings2,
};

const TOOL_ICONS: Record<string, string> = {
  web_search: "globe",
  weather: "globe",
  youtube: "youtube",
  browser_automation: "monitor",
  system_monitor: "dashboard",
  screen_camera: "camera",
  open_app: "zap",
  computer_settings: "settings",
  computer_control: "mouse",
  desktop_control: "monitor",
  file_controller: "folder",
  file_processor: "file-search",
  code_helper: "code",
  developer_agent: "terminal",
  send_message: "send",
  reminder: "bell",
  flight_finder: "plane",
  game_updater: "gamepad",
  background_monitor: "radar",
  proactive_checkins: "file-clock",
};

export function PluginBay({
  disabledTools,
  onToggleTool,
  plugins,
  onRemovePlugin,
}: PluginBayProps) {
  return (
    <div className="space-y-4 p-4">
      {CATEGORIES.map((cat) => {
        const tools = TOOLS.filter((t) => t.category === cat.id && !t.id.startsWith("plugin."));
        if (tools.length === 0) return null;
        const CatIcon = ICONS[cat.icon] ?? Puzzle;
        return (
          <div key={cat.id}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <CatIcon className="size-3.5" />
              {cat.label}
            </p>
            <div className="space-y-2">
              {tools.map((tool) => {
                const Icon = ICONS[TOOL_ICONS[tool.id] ?? "puzzle"] ?? Puzzle;
                const enabled = !disabledTools.includes(tool.id);
                return (
                  <div
                    key={tool.id}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                      enabled
                        ? "bg-card ring-1 ring-border"
                        : "border-transparent bg-muted/40 opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        enabled
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-xs font-medium">{tool.name}</p>
                        {tool.desktopOnly && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 py-0 text-[9px] uppercase text-muted-foreground"
                          >
                            desktop
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {tool.description}
                      </p>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={() => onToggleTool(tool.id)}
                      aria-label={`Toggle ${tool.name}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {plugins.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5" />
            Installed at runtime
          </p>
          <div className="space-y-2">
            {plugins.map((p) => {
              const tool = TOOLS.find((t) => t.id === `plugin.${p.id}`);
              const enabled = !disabledTools.includes(`plugin.${p.id}`);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                    enabled
                      ? "bg-card ring-1 ring-primary/25"
                      : "border-transparent bg-muted/40 opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Puzzle className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-medium">{p.name}</p>
                      <Badge
                        variant="outline"
                        className="h-4 border-primary/40 px-1.5 py-0 text-[9px] uppercase text-primary"
                      >
                        {p.source === "jarvis" ? "jarvis-built" : "custom"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {p.description}
                    </p>
                    {tool ? (
                      <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">
                        arg: {p.argHint} · tool id: {tool.id}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={() => onToggleTool(`plugin.${p.id}`)}
                    aria-label={`Toggle ${p.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemovePlugin(p.id)}
                    aria-label={`Remove ${p.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Tools marked <span className="font-mono">desktop</span> need a native
        bridge outside the browser — JARVIS will tell you honestly instead of
        pretending. Disabling a tool hides it from the local router. Ask JARVIS
        to "make a tool that …" and it will write + install one here by itself.
      </p>
    </div>
  );
}
