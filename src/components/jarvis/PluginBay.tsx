import {
  Bot,
  FileClock,
  FilePlus2,
  FileSearch,
  FolderInput,
  FolderOutput,
  HardDrive,
  MessageSquareText,
  Mic,
  Pencil,
  Puzzle,
  Terminal,
  Trash2,
  Undo2,
  Volume2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { ToolDescriptor } from "@/lib/jarvis/types";
import { cn } from "@/lib/utils";

interface PluginBayProps {
  plugins: ToolDescriptor[];
  onToggle: (id: string) => void;
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
};

export function PluginBay({ plugins, onToggle }: PluginBayProps) {
  return (
    <div className="space-y-3 p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Puzzle className="size-3.5" />
        Installed plugins
      </p>
      <div className="space-y-2">
        {plugins.map((p) => {
          const Icon = ICONS[p.icon] ?? Puzzle;
          return (
            <div
              key={p.id}
              className={cn(
                "group flex items-start gap-3 rounded-xl border p-3 transition-colors",
                p.enabled
                  ? "bg-card ring-1 ring-border"
                  : "bg-muted/40 border-transparent opacity-60",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  p.enabled
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{p.name}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {p.description}
                </p>
              </div>
              <Switch
                checked={p.enabled}
                onCheckedChange={() => onToggle(p.id)}
                aria-label={`Toggle ${p.name}`}
              />
            </div>
          );
        })}
      </div>
      <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
        All plugins execute on-device. Disabling one only hides its intent from
        the local router.
      </p>
    </div>
  );
}
