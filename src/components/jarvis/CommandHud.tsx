import { useMemo } from "react";
import type { VoiceState } from "@/lib/jarvis/types";
import { cn } from "@/lib/utils";

interface CommandHudProps {
  state: VoiceState;
  /** 0–100, fed by desktop telemetry (CPU) when available. */
  load?: number | null;
  className?: string;
}

const STATE_TEXT: Record<VoiceState, string> = {
  offline: "STANDBY",
  listening: "MIC LIVE",
  thinking: "PROCESSING",
  speaking: "TALKING",
};

/**
 * Command HUD — the Mark-LVII style targeting/command ring that surrounds the
 * reactor core. Pure SVG so it stays crisp at any size and animates on the GPU
 * (two counter-rotating groups + a blinking tick pair). Sits inside the orb's
 * 3D stage, slightly tilted to feel like a heads-up reticle, not a sticker.
 */
export function CommandHud({ state, load, className }: CommandHudProps) {
  const listening = state === "listening";
  const active = state !== "offline";

  // Tick marks around the full ring — generated once.
  const ticks = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => {
        const a = (i * 6 * Math.PI) / 180;
        const r1 = i % 5 === 0 ? 92 : 96;
        return {
          x1: 100 + r1 * Math.cos(a),
          y1: 100 + r1 * Math.sin(a),
          x2: 100 + 99 * Math.cos(a),
          y2: 100 + 99 * Math.sin(a),
          major: i % 5 === 0,
        };
      }),
    [],
  );

  return (
    <div className={cn("pointer-events-none absolute inset-0", className)} aria-hidden>
      {/* reticle tilt — gives the HUD its heads-up depth */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" style={{ transform: "rotateX(12deg)" }}>
        {/* faint full circle */}
        <circle cx="100" cy="100" r="97" fill="none" stroke="currentColor" strokeWidth="0.6" className="text-primary/25" />

        {/* rotating tick collar */}
        <g className="hud-cmd-ring">
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="currentColor"
              strokeWidth={t.major ? 1.4 : 0.7}
              className={t.major ? "text-primary/60" : "text-primary/30"}
            />
          ))}
        </g>

        {/* counter-rotating command arcs */}
        <g className="hud-cmd-ring-rev">
          <circle
            cx="100" cy="100" r="86" fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="58 482"
            transform="rotate(210 100 100)"
            className="text-primary/80"
          />
          <circle
            cx="100" cy="100" r="86" fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="26 514"
            transform="rotate(30 100 100)"
            className="text-primary/55"
          />
          {/* load sweep — desktop CPU as a HUD arc */}
          {(load ?? 0) > 0 && (
            <circle
              cx="100" cy="100" r="80" fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${Math.max(2, Math.min(95, load! * 2.2))} ${2 * Math.PI * 80}`}
              transform="rotate(-90 100 100)"
              className="text-primary/70 transition-all duration-700"
            />
          )}
        </g>

        {/* blinking target brackets — speed reacts to activity */}
        <g
          className={cn("transition-opacity", !active && "opacity-30")}
          style={{ animation: `hud-blink ${listening ? 0.9 : 1.6}s ease-in-out infinite` }}
        >
          {/* four corner brackets at compass points */}
          {[0, 90, 180, 270].map((deg) => (
            <g key={deg} transform={`rotate(${deg} 100 100)`}>
              {/* bracket = short L shape at the top of the ring */}
              <path
                d="M 100 6 l 7 7 M 100 6 l -7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-primary"
                fill="none"
              />
            </g>
          ))}
        </g>
      </svg>

      {/* status readout — top center, tiny mono text */}
      <div className="absolute inset-x-0 -top-0.5 flex justify-center">
        <span
          className={cn(
            "font-mono text-[9px] uppercase tracking-[0.34em] text-primary/80 transition-colors",
            listening && "text-red-400",
          )}
        >
          {STATE_TEXT[state]}
        </span>
      </div>

      {/* load % readout — bottom center */}
      {load != null && (
        <div className="absolute inset-x-0 -bottom-1 flex justify-center">
          <span className="font-mono text-[9px] tracking-[0.2em] text-primary/60">
            {Math.round(load)}%
          </span>
        </div>
      )}
    </div>
  );
}
