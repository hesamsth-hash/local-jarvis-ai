import { Camera, MonitorUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MediaViewerProps {
  stream: MediaStream | null;
  kind: "screen" | "camera" | null;
  label: string | null;
  onClose: () => void;
}

export function MediaViewer({
  stream,
  kind,
  label,
  onClose,
}: MediaViewerProps) {
  if (!stream || !kind) return null;
  const Icon = kind === "screen" ? MonitorUp : Camera;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-medium">
          <Icon className="size-3.5 text-primary" />
          {label ?? (kind === "screen" ? "Screen share" : "Webcam")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          aria-label="Close viewer"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <video
        autoPlay
        muted
        playsInline
        ref={(el) => {
          if (el && el.srcObject !== stream) el.srcObject = stream;
        }}
        className={cn("aspect-video w-full bg-black", kind === "screen" && "object-contain")}
      />
    </div>
  );
}
