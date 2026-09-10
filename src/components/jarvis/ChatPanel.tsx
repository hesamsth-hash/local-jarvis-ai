import { useEffect, useRef } from "react";
import {
  Bot,
  CheckCircle2,
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
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-medium text-primary ring-1 ring-primary/20">
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
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ring-1",
                  isUser
                    ? "bg-muted text-foreground ring-border"
                    : "bg-primary/10 text-primary ring-primary/20",
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
                    "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    isUser
                      ? "rounded-tr-sm bg-primary text-primary-foreground"
                      : isSystem
                        ? "rounded-tl-sm bg-muted text-muted-foreground"
                        : "rounded-tl-sm bg-card text-card-foreground ring-1 ring-border",
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
                  <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
                    <XCircle className="size-3" />
                    failed
                  </span>
                )}
                {!isUser && m.ok === true && m.tool && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
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
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <Bot className="size-3.5" />
            </span>
            <div className="rounded-2xl rounded-tl-sm bg-card px-3.5 py-2.5 ring-1 ring-border">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="eq-bar block size-1.5 rounded-full bg-primary"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length === 0 && !busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileText className="size-5" />
            <p className="text-xs">Transcript will appear here</p>
          </div>
        </div>
      )}
    </div>
  );
}
