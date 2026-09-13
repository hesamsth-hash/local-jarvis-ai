import { useEffect, useRef } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  FileText,
  Sparkles,
  Terminal,
  User,
  XCircle,
} from "lucide-react";
import type { ChatMessage } from "@/lib/jarvis/types";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  messages: ChatMessage[];
  busy: boolean;
}

function IntentChip({ label }: { label: string }) {
  return (
    <span className="hud-chip inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[10px] font-medium">
      <Sparkles className="size-3" />
      {label}
    </span>
  );
}

export function ChatPanel({ messages, busy }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {messages.map((m) => {
          const isUser = m.role === "user";
          const isSystem = m.role === "system";
          return (
            <div
              key={m.id}
              className={cn(
                "flex gap-3",
                isUser ? "flex-row-reverse" : "flex-row",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm ring-1",
                  isUser
                    ? "border-amber-400/40 bg-amber-400/10 text-amber-500 ring-amber-400/30"
                    : "hud-chip",
                )}
              >
                {isUser ? (
                  <User className="size-3.5" />
                ) : (
                  <Bot className="size-3.5" />
                )}
              </span>
              <div
                className={cn(
                  "max-w-[85%] space-y-1.5",
                  isUser && "flex flex-col items-end",
                )}
              >
                <div
                  className={cn(
                    "rounded-sm px-3.5 py-2.5 text-sm leading-relaxed",
                    isUser
                      ? "border border-amber-400/30 bg-amber-400/10 text-amber-800 dark:text-amber-200"
                      : isSystem
                        ? "border border-border bg-muted/60 font-mono text-xs text-muted-foreground"
                        : "border-l-2 border-primary/70 bg-primary/[0.06] text-foreground/95",
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
                {isSystem && m.tool && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Terminal className="size-3" />
                    {m.tool}
                  </span>
                )}
                {!isUser && !isSystem && m.intent && (
                  <IntentChip label={m.intent} />
                )}
                {!isUser && m.ok === false && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-destructive">
                    <XCircle className="size-3" />
                    failed
                  </span>
                )}
                {!isUser && m.ok === true && m.tool && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-emerald-500">
                    <CheckCircle2 className="size-3" />
                    {m.tool}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex gap-3">
            <span className="hud-chip mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm">
              <Bot className="size-3.5" />
            </span>
            <div className="rounded-sm border-l-2 border-primary/70 bg-primary/[0.06] px-3.5 py-2.5">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="eq-bar block size-1.5 rounded-full bg-primary"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
                <span className="ml-2 inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-wider text-primary/70">
                  <ChevronRight className="size-3" />
                  processing
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length === 0 && !busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileText className="size-5 text-primary/50" />
            <p className="font-mono text-xs">// transcript will appear here</p>
          </div>
        </div>
      )}
    </div>
  );
}
