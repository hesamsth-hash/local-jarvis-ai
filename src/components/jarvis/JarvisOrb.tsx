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
        {/* outer rotating rings */}
        <div
          className={cn(
            "orb-ring orb-ring-slow absolute inset-0 rounded-full",
            listening && "border-primary/80",
          )}
        />
        <div
          className={cn(
            "orb-ring-reverse absolute inset-3 rounded-full",
            listening && "border-primary/70",
          )}
        />
        {/* halo */}
        <motion.div
          className={cn(
            "absolute -inset-6 rounded-full",
            listening && "bg-primary/20 blur-2xl",
          )}
          animate={{
            opacity: listening ? [0.35, 0.7, 0.35] : 0.18,
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
            listening ? "text-primary" : "text-muted-foreground",
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
