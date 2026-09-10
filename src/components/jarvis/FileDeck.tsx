import {
  FileText,
  FolderOpen,
  FolderTree,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FsEntryView } from "@/lib/jarvis/types";
import { cn } from "@/lib/utils";

interface FileDeckProps {
  connected: boolean;
  rootLabel: string | null;
  path: string;
  entries: FsEntryView[];
  loading: boolean;
  savedPermission?: string;
  needsReconnect?: boolean;
  onConnect: () => void;
  onReconnect?: () => void;
  onDisconnect?: () => void;
  onRefresh: () => void;
  onOpen: (entry: FsEntryView) => void;
}

function formatSize(size: number | null) {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileDeck({
  connected,
  rootLabel,
  path,
  savedPermission,
  entries,
  loading,
  needsReconnect,
  onConnect,
  onReconnect,
  onDisconnect,
  onRefresh,
  onOpen,
}: FileDeckProps) {
  const crumbs = path ? path.split(/[\\/]+/).filter(Boolean) : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderTree className="size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {connected ? (rootLabel ?? "Workspace") : "No workspace"}
            </p>
            {connected && (
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                /{crumbs.join("/") || ""}
              </p>
            )}
          </div>
        </div>
        {connected && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
            {onDisconnect && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                onClick={onDisconnect}
                aria-label="Disconnect workspace"
              >
                <Unplug className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {connected && needsReconnect && (
        <div className="flex items-center gap-3 bg-amber-500/10 px-4 py-3 ring-1 ring-inset ring-amber-500/25">
          <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Access needs one click to resume</p>
            <p className="text-[11px] text-muted-foreground">
              The browser requires you to re-grant this folder after a reload.
            </p>
          </div>
          <Button size="sm" className="h-7 shrink-0 text-xs" onClick={onReconnect}>
            Reconnect
          </Button>
</div>
      )}

      {!connected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HardDrive className="size-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Connect a local folder</p>
            <p className="text-xs text-muted-foreground">
              Grant access once — file tools then run entirely on this device.
            </p>
          </div>
          <Button size="sm" className="gap-2" onClick={onConnect}>
            <FolderOpen className="size-4" />
            Connect folder
          </Button>
        </div>
      ) : (
        <>
          {crumbs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2 font-mono text-[11px]">
              <button
                className="text-primary hover:underline"
                onClick={() => onOpen({ name: "", kind: "directory", size: null, modified: null })}
              >
                root
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-muted-foreground">/</span>
                  <button
                    className="text-foreground/80 hover:text-primary"
                    onClick={() =>
                      onOpen({
                        name: crumbs.slice(0, i + 1).join("/"),
                        kind: "directory",
                        size: null,
                        modified: null,
                      })
                    }
                  >
                    {c}
                  </button>
                </span>
              ))}
            </div>
          )}
          <ScrollArea className="flex-1">
            <div className="p-2">
              {entries.length === 0 && !loading && (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  This folder is empty.
                </p>
              )}
              {entries.map((e) => (
                <button
                  key={`${e.kind}-${e.name}`}
                  onClick={() => onOpen(e)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-md text-xs",
                      e.kind === "directory"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {e.kind === "directory" ? (
                      <FolderTree className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{e.name}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {e.kind === "file" ? formatSize(e.size) : "folder"}
                      {e.modified
                        ? ` · ${new Date(e.modified).toLocaleDateString()}`
                        : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
