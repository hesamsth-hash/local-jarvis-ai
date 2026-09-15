import { useCallback, useEffect, useState } from "react";
import { Brain, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { forget, recall, type MemoryEntry } from "@/lib/jarvis/memory";

export function MemoryPanel() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);

  const refresh = useCallback(() => {
    setEntries(recall(query, 50));
  }, [query]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = (entry: MemoryEntry) => {
    forget(entry.text);
    refresh();
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-primary" />
        <div>
          <p className="text-xs font-medium">Long-term memory</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Stored locally and supplied to the configured model when relevant.
          </p>
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search remembered facts…"
          className="h-8 pl-8 font-mono text-xs"
        />
      </div>
      <div className="max-h-[340px] space-y-2 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-primary/20 p-4 text-center font-mono text-[10px] text-muted-foreground">
            {query ? "No local memories match that search." : "Nothing remembered yet. Say: remember that …"}
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="group rounded-md border border-primary/15 bg-primary/[0.03] p-3">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-xs leading-relaxed">{entry.text}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
                  onClick={() => remove(entry)}
                  aria-label={`Forget ${entry.text}`}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className="h-4 px-1.5 py-0 text-[9px]">{entry.kind}</Badge>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
