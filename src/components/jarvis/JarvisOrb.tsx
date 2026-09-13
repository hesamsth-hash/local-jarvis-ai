import { motion } from "framer-motion";
import { Mic, MicOff } from "lucide-react";
import type { VoiceState } from "@/lib/jarvis/types";
import { cn } from "@/lib/utils";

interface JarvisOrbProps {
  state: VoiceState;
  enginesReady: boolean;
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

export function JarvisOrb({
  state,
  enginesReady,
  onToggleListen,
  className,
}: JarvisOrbProps) {
  const listening = state === "listening";
  const speaking = state === "speaking";
  const thinking = state === "thinking";

  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="relative size-44 sm:size-52">
        {/* HUD tick ring */}
        <svg
          viewBox="0 0 200 200"
          className="orb-ring-slow absolute inset-0 size-full"
          aria-hidden
        >
          <circle
            cx="100"
            cy="100"
            r="97"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 7"
            className="text-primary/45"
          />
        </svg>
        {/* HUD arc segments — three thick, fast arcs */}
        <svg
          viewBox="0 0 200 200"
          className="orb-ring-reverse absolute inset-0 size-full"
          aria-hidden
        >
          <circle
            cx="100"
            cy="100"
            r="88"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="120 432"
            className={cn(
              "text-primary/70 transition-colors",
              listening && "text-primary",
            )}
          />
          <circle
            cx="100"
            cy="100"
            r="88"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="50 502"
            transform="rotate(150 100 100)"
            className={cn(
              "text-primary/45 transition-colors",
              listening && "text-primary/80",
            )}
          />
          <circle
            cx="100"
            cy="100"
            r="80"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="24 479"
            transform="rotate(230 100 100)"
            className="text-primary/35"
          />
        </svg>

        {/* halo */}
        <motion.div
          className={cn(
            "absolute -inset-6 rounded-full",
            listening ? "bg-primary/25 blur-2xl" : "bg-primary/10 blur-2xl",
          )}
          animate={{
            opacity: listening ? [0.4, 0.75, 0.4] : 0.22,
            scale: listening ? [0.9, 1.08, 0.9] : 1,
          }}
          transition={{
            duration: listening ? 1.1 : 4,
            repeat: listening ? Infinity : 0,
            ease: "easeInOut",
          }}
        />

        {/* core */}
        <button
          type="button"
          aria-label="Toggle voice listening"
          onClick={onToggleListen}
          className="absolute inset-5 flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <motion.div
            className="orb-core relative flex size-full items-center justify-center rounded-full"
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
            {/* reactor coils + spokes — movie-style */}
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 size-full"
              aria-hidden
            >
              {/* concentric coils */}
              {[34, 41, 47].map((r) => (
                <circle
                  key={r}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke="white"
                  strokeWidth={r === 41 ? "1.2" : "0.8"}
                  strokeDasharray={r === 41 ? "3 9" : "1.5 7"}
                  opacity={r === 47 ? 0.35 : 0.55}
                />
              ))}
              {/* radial spokes (the copper winding look) */}
              {Array.from({ length: 10 }, (_, i) => {
                const a = (i * 36 * Math.PI) / 180;
                return (
                  <line
                    key={i}
                    x1={50 + 30 * Math.cos(a)}
                    y1={50 + 30 * Math.sin(a)}
                    x2={50 + 46 * Math.cos(a)}
                    y2={50 + 46 * Math.sin(a)}
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    opacity="0.4"
                  />
                );
              })}
              {/* hot core glow */}
              <circle cx="50" cy="50" r="17" fill="white" opacity="0.25" />
              <circle cx="42" cy="42" r="5" fill="white" opacity="0.7" />
            </svg>

            {/* equalizer bars when speaking */}
            {speaking && (
              <div className="flex items-center gap-1.5">
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
                  "flex size-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors",
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
            listening ? "text-primary text-glow" : "text-muted-foreground",
          )}
        >
          {STATE_LABEL[state]}
        </span>
        <span className="text-xs text-muted-foreground/80">
          {enginesReady ? STATE_HINT[state] : "Loading local engines…"}
        </span>
      </div>
    </div>
  );
}
