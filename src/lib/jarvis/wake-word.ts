// Wake-word spotting + hands-free arming — runs in the browser, no cloud keys.
//
// Uses the Web Speech API (SpeechRecognition) as an always-on listener that
// only watches for "Jarvis". On detection it hands off to the Whisper
// recorder for the actual command (on-device STT). If SpeechRecognition is
// unavailable (some Android WebViews), callers fall back to push-to-talk.

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SRCtor = new () => SpeechRecognitionLike;

function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function wakeWordSupported(): boolean {
  return getCtor() !== null;
}

export interface WakeHandle {
  stop: () => void;
}

/** Matches "jarvis" plus common mis-hearings. */
const WAKE_RE = /\b(jarvis|javis|jervis|jarvic|jarvic)\b/i;

/**
 * Start listening for the wake word. Returns a handle that stops the
 * listener. `onWake` fires once per detection (recognition stops itself;
 * call this again to re-arm after the command completes).
 */
export function startWakeWord(onWake: () => void): WakeHandle | null {
  const Ctor = getCtor();
  if (!Ctor) return null;
  let stopped = false;
  let errors = 0;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const alt = e.results[i]?.[0];
      if (!alt) continue;
      if (WAKE_RE.test(alt.transcript)) {
        stopped = true;
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
        // small delay so the mic is free before the recorder opens
        setTimeout(onWake, 180);
        return;
      }
    }
  };

  rec.onerror = (e) => {
    // "no-speech" and "aborted" are normal in continuous mode — keep going.
    if (e.error === "no-speech" || e.error === "aborted") return;
    errors += 1;
    if (errors >= 4) {
      // mic denied or engine broken — stop retrying
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
  };

  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* can throw if called too soon — next onend retries */
      }
    }
  };

  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop: () => {
      stopped = true;
      try {
        rec.abort();
      } catch {
        /* noop */
      }
    },
  };
}
