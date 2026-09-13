import { Headphones, Mic, Radio, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VoiceModeControlsProps {
  wakeSupported: boolean;
  wakeOn: boolean;
  handsFreeOn: boolean;
  onWake: (on: boolean) => void;
  onHandsFree: (on: boolean) => void;
}

function ModeRow({
  icon,
  title,
  desc,
  active,
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
            active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium">{title}</p>
          <p className="text-[10px] leading-snug text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant={active ? "default" : "outline"}
        className={cn(
          "h-7 shrink-0 rounded-full px-3 text-xs",
          !active && "text-muted-foreground",
        )}
        disabled={disabled}
        onClick={onToggle}
      >
        {active ? "On" : "Off"}
      </Button>
    </div>
  );
}

export function VoiceModeControls({
  wakeSupported,
  wakeOn,
  handsFreeOn,
  onWake,
  onHandsFree,
}: VoiceModeControlsProps) {
  return (
    <div className="space-y-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Radio className="size-3.5" />
        Voice mode
      </p>
      <ModeRow
        icon={<Mic className="size-3.5" />}
        title='Wake word — "Hey Jarvis"'
        desc={
          wakeSupported
            ? 'Always listening for the name; the next sentence becomes your command.'
            : "Not available in this webview — use push-to-talk."
        }
        active={wakeOn}
        disabled={!wakeSupported}
        onToggle={() => onWake(!wakeOn)}
      />
      <ModeRow
        icon={<Repeat className="size-3.5" />}
        title="Hands-free conversation"
        desc="After each reply, she listens again automatically — talk back and forth without touching anything."
        active={handsFreeOn}
        onToggle={() => onHandsFree(!handsFreeOn)}
      />
      {handsFreeOn && (
        <p className="flex items-center gap-1.5 rounded-md bg-primary/5 px-2.5 py-2 text-[10px] text-muted-foreground ring-1 ring-inset ring-primary/15">
          <Headphones className="size-3 shrink-0 text-primary" />
          Say "Jarvis" first, then your command. She re-arms after each answer.
        </p>
      )}
    </div>
  );
}
