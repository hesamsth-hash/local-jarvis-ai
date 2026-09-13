import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  hasRootAccess,
  isAndroid,
  requestRootAccess,
} from "@/lib/jarvis/desktop-bridge";

type RootState =
  | { kind: "checking" }
  | { kind: "granted" }
  | { kind: "denied"; message: string };

/**
 * Android-only card in the Tools tab: shows JARVIS's superuser status and a
 * "Grant root access" button. Pressing it runs `su`, which is exactly what
 * makes KernelSU / Magisk pop their allow-dialog for JARVIS — approve it
 * there and every locked tool (See & Act, taps, launching apps, shell)
 * unlocks immediately, no reinstall needed.
 */
export function RootAccessCard() {
  const [state, setState] = useState<RootState>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const show = isAndroid();

  useEffect(() => {
    if (!show) return;
    let alive = true;
    void hasRootAccess().then((root) => {
      if (alive)
        setState(root ? { kind: "granted" } : { kind: "denied", message: "" });
    });
    return () => {
      alive = false;
    };
  }, [show]);

  if (!show) return null;

  const grant = async () => {
    setBusy(true);
    const r = await requestRootAccess();
    const root = await hasRootAccess();
    setState(root ? { kind: "granted" } : { kind: "denied", message: r.message });
    setBusy(false);
  };

  if (state.kind === "granted") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-transparent bg-card p-3 ring-1 ring-emerald-500/30">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-medium">Root access</p>
            <Badge className="h-4 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[9px] uppercase text-emerald-500">
              granted
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            JARVIS has superuser — See &amp; Act, taps, typing, launching apps
            and shell commands all work on this phone.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-transparent bg-card p-3 ring-1 ring-amber-500/30">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
        {state.kind === "checking" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ShieldX className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-xs font-medium">Root access</p>
          {state.kind === "denied" && (
            <Badge
              variant="outline"
              className="h-4 border-amber-500/40 px-1.5 py-0 text-[9px] uppercase text-amber-500"
            >
              not granted
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          Grant superuser to unlock See &amp; Act, screen taps, typing,
          launching apps and shell on this phone. Your root manager
          (KernelSU / Magisk) will pop up — approve JARVIS there.
        </p>
        {state.kind === "denied" && state.message && (
          <p className="mt-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
            {state.message}
          </p>
        )}
        <Button
          size="sm"
          className="mt-2 h-7 gap-1.5 text-[11px]"
          disabled={busy || state.kind === "checking"}
          onClick={() => void grant()}
        >
          {busy && <Loader2 className="size-3 animate-spin" />}
          {busy ? "Waiting for approval…" : "Grant root access"}
        </Button>
      </div>
    </div>
  );
}
