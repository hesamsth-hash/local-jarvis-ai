import { ShieldCheck, Terminal, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

interface SystemStripProps {
  commandCount: number | null;
  workspaceName: string | null;
  className?: string;
}

function Pill({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 ring-1",
        accent
          ? "bg-primary/10 text-primary ring-primary/25"
          : "bg-card text-foreground ring-border",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0 leading-tight">
        <p className="text-[10px] uppercase tracking-wider opacity-70">
          {label}
        </p>
        <p className="truncate font-mono text-xs font-medium">{value}</p>
      </div>
    </div>
  );
}

export function SystemStrip({
  commandCount,
  workspaceName,
  className,
}: SystemStripProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-stretch gap-2",
        className,
      )}
    >
      <Pill
        icon={ShieldCheck}
        label="Privacy"
        value="100% local"
        accent
      />
      <Pill
        icon={HardDrive}
        label="Workspace"
        value={workspaceName ?? "not connected"}
      />
      <Pill
        icon={Terminal}
        label="Commands"
        value={commandCount === null ? "—" : String(commandCount)}
      />
    </div>
  );
}
