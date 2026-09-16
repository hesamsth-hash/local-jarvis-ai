import { motion } from "framer-motion";
import { Mic, MicOff } from "lucide-react";
import type { VoiceState } from "@/lib/jarvis/types";
import { CommandHud } from "@/components/jarvis/CommandHud";
import { cn } from "@/lib/utils";

interface JarvisOrbProps {
  state: VoiceState;
  enginesReady: boolean;
  /** Live desktop CPU load 0–100, streamed by the native bridge (optional). */
  load?: number | null;
  onToggleListen?: () => void;
  className?: string;
}

const STATE_LABEL: Record<VoiceState, string> = {
  offline: "Standby",
  listening: "Listening",
  thinking: "Processing",
  speaking: "Speaking",
};

const STATE_HINT: Record<VoiceState, string> = {
  offline: "Click the core or type below",
  listening: "Speak now — I'm all ears",
  thinking: "Running local tools…",
  speaking: "Voice output in progress",
};

/**
 * The reactor core — now a 3D gimbal reactor, not a flat 2D disc:
 *  - perspective stage with three counter-rotating tilted coil plates,
 *  - a yawing equator ring for real depth wobble,
 *  - a Mark-LVII command HUD ring around the whole assembly,
 *  - hot red ONLY while the mic is live; thinking/speaking stay reactor cyan.
 */
export function JarvisOrb({
  state,
  enginesReady,
  load = null,
  onToggleListen,
  className,
}: JarvisOrbProps) {
  const listening = state === "listening";
  const speaking = state === "speaking";
  const thinking = state === "thinking";

  return (
    <div className={cn("orb-state-hue flex flex-col items-center gap-4", className)} data-voice={state}>
      <div className="orb-stage relative size-44 sm:size-52">
        {/* halo — hue follows the state (red only when listening) */}
        <motion.div
          className="absolute -inset-6 rounded-full bg-primary/25 blur-2xl"
          style={{
            background: listening
              ? "radial-gradient(circle, oklch(0.64 0.21 12 / 0.5) 0%, transparent 70%)"
              : undefined,
          }}
          animate={{
            opacity: listening ? [0.45, 0.8, 0.45] : 0.22,
            scale: listening ? [0.92, 1.1, 0.92] : 1,
          }}
          transition={{
            duration: listening ? 1.1 : 4,
            repeat: listening ? Infinity : 0,
            ease: "easeInOut",
          }}
        />

        {/* Mark-LVII command HUD ring */}
        <CommandHud state={state} load={load} />

        {/* HUD tick ring (outer, slow) */}
        <svg
          viewBox="0 0 200 200"
          className="orb-ring-slow absolute inset-2 size-[94%]"
          aria-hidden
        >
          <circle
            cx="100" cy="100" r="97" fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 7"
            className="text-primary/45"
          />
        </svg>

        {/* HUD arc segments — three fast arcs */}
        <svg
          viewBox="0 0 200 200"
          className="orb-ring-reverse absolute inset-2 size-[94%]"
          aria-hidden
        >
          <circle
            cx="100" cy="100" r="88" fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="120 432"
            className={cn(
              "text-primary/70 transition-colors",
              listening && "text-red-400/80",
            )}
          />
          <circle
            cx="100" cy="100" r="88" fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="50 502"
            transform="rotate(150 100 100)"
            className={cn(
              "text-primary/45 transition-colors",
              listening && "text-red-400/60",
            )}
          />
          <circle
            cx="100" cy="100" r="80" fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="24 479"
            transform="rotate(230 100 100)"
            className="text-primary/35"
          />
        </svg>

        {/* core — 3D gimbal reactor */}
        <button
          type="button"
          aria-label="Toggle voice listening"
          onClick={onToggleListen}
          className="absolute inset-6 flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <motion.div
            className="orb-gimbal relative size-full"
            animate={{
              scale: thinking
                ? [1, 1.04, 1]
                : listening
                  ? [1, 1.07, 1]
                  : speaking
                    ? [1, 0.97, 1]
                    : 1,
            }}
            transition={{
              duration: thinking ? 0.55 : listening ? 0.9 : 1.4,
              repeat: thinking || listening ? Infinity : 0,
              ease: "easeInOut",
            }}
          >
            {/* glowing core ball */}
            <div className="orb-core absolute inset-2 rounded-full" />

            {/* 3D gimbal plates — three tilted coil rings counter-rotating */}
            <svg
              viewBox="0 0 100 100"
              className="orb-gimbal-a absolute inset-0 size-full"
              aria-hidden
            >
              <circle
                cx="50" cy="50" r="47" fill="none"
                stroke="white"
                strokeWidth="1.6"
                strokeDasharray="4 8"
                opacity="0.5"
              />
            </svg>
            <svg
              viewBox="0 0 100 100"
              className="orb-gimbal-b absolute inset-1 size-[92%]"
              aria-hidden
            >
              <circle
                cx="50" cy="50" r="47" fill="none"
                stroke="white"
                strokeWidth="1.2"
                strokeDasharray="2 9"
                opacity="0.4"
              />
            </svg>
            <svg
              viewBox="0 0 100 100"
              className="orb-gimbal-c absolute inset-3 size-[82%]"
              aria-hidden
            >
              <circle
                cx="50" cy="50" r="47" fill="none"
                stroke="white"
                strokeWidth="0.9"
                strokeDasharray="1.5 10"
                opacity="0.3"
              />
            </svg>

            {/* yawing equator ring — real depth wobble */}
            <svg
              viewBox="0 0 100 100"
              className="orb-gimbal-yaw absolute inset-4 size-[75%]"
              aria-hidden
            >
              <circle
                cx="50" cy="50" r="48" fill="none"
                stroke="white"
                strokeWidth="1.4"
                opacity="0.45"
              />
            </svg>

            {/* hot plasma center + copper spokes (static, on the ball itself) */}
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 size-full"
              aria-hidden
            >
              {Array.from({ length: 10 }, (_, i) => {
                const a = (i * 36 * Math.PI) / 180;
                return (
                  <line
                    key={i}
                    x1={50 + 18 * Math.cos(a)}
                    y1={50 + 18 * Math.sin(a)}
                    x2={50 + 30 * Math.cos(a)}
                    y2={50 + 30 * Math.sin(a)}
                    stroke="white"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    opacity="0.35"
                  />
                );
              })}
              <circle cx="50" cy="50" r="12" fill="white" opacity="0.28" />
              <circle cx="45" cy="45" r="4" fill="white" opacity="0.75" />
            </svg>

            {/* equalizer bars when speaking */}
            {speaking && (
              <div className="relative flex items-center justify-center gap-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="eq-bar block w-1.5 rounded-full bg-white/90"
                    style={{
                      height: 10 + (i % 3) * 10,
                      animationDelay: `${i * 0.12}s`,
                    }}
                  />
                ))}
              </div>
            )}
            {/* mic icon otherwise */}
            {!speaking && (
              <span
                className={cn(
                  "relative flex size-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors",
                  listening && "bg-white/25",
                )}
              >
                {listening ? (
                  <Mic className="size-6" />
                ) : (
                  <MicOff className="size-6 opacity-90" />
                )}
              </span>
            )}
          </motion.div>
        </button>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.3em]",
            listening ? "text-red-400" : "text-primary text-glow",
          )}
        >
          {STATE_LABEL[state]}
          {listening && " · mic live"}
        </span>
        <span className="text-xs text-muted-foreground/80">
          {enginesReady ? STATE_HINT[state] : "Loading local engines…"}
        </span>
      </div>
    </div>
  );
}
