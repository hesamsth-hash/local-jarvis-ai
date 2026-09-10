// Kokoro TTS engine — 82M-param text-to-speech running 100% locally via WASM.
// The library and model are lazy-loaded on demand (first "Download engines"
// click or first command), keeping the app's first paint fast.

import type { LoadedProgress } from "./types";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

type KokoroInstance = Awaited<
  ReturnType<typeof import("kokoro-js").KokoroTTS.from_pretrained>
>;

// Minimal structural type — kokoro-js bundles its own copy of transformers,
// so we avoid cross-package nominal type mismatches.
interface RawAudioLike {
  toBlob(): Blob;
}

export interface VoiceOption {
  id: string;
  label: string;
}

export const VOICES: VoiceOption[] = [
  { id: "af_heart", label: "Heart · US female" },
  { id: "af_bella", label: "Bella · US female" },
  { id: "am_michael", label: "Michael · US male" },
  { id: "am_fenrir", label: "Fenrir · US male" },
  { id: "am_puck", label: "Puck · US male" },
  { id: "bf_emma", label: "Emma · UK female" },
  { id: "bm_george", label: "George · UK male" },
];

export interface SpeakHandle {
  stop: () => void;
}

class TtsEngine {
  private tts: KokoroInstance | null = null;
  private loading: Promise<KokoroInstance> | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  onStateChange: ((speaking: boolean) => void) | null = null;

  get ready() {
    return this.tts !== null;
  }

  load(
    onProgress?: (p: LoadedProgress) => void,
    onDone?: () => void,
    onError?: (e: string) => void,
  ): Promise<KokoroInstance> {
    if (this.tts) return Promise.resolve(this.tts);
    if (this.loading) return this.loading;
    this.loading = import("kokoro-js")
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: "q8",
          device: "wasm",
          progress_callback: (p: {
            status?: string;
            file?: string;
            progress?: number;
          }) => {
            if (p.status === "progress" && p.file) {
              onProgress?.({ file: p.file, progress: p.progress ?? 0 });
            }
          },
        }),
      )
      .then((t) => {
        this.tts = t;
        onDone?.();
        return t;
      })
      .catch((e: unknown) => {
        this.loading = null;
        onError?.(e instanceof Error ? e.message : "Failed to load TTS model");
        throw e;
      });
    return this.loading;
  }

  async speak(
    text: string,
    voice: string,
    speed: number,
  ): Promise<SpeakHandle | null> {
    if (!this.tts) return null;
    const clipped = text.length > 900 ? `${text.slice(0, 900)}…` : text;
    try {
      const audio = (await this.tts.generate(clipped, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        voice: voice as any,
        speed,
      })) as unknown as RawAudioLike;
      const blob = audio.toBlob();
      if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = URL.createObjectURL(blob);
      const el = new Audio(this.currentUrl);
      this.currentAudio = el;
      el.onended = () => {
        this.currentAudio = null;
        this.onStateChange?.(false);
      };
      this.onStateChange?.(true);
      await el.play();
      return {
        stop: () => {
          el.pause();
          this.currentAudio = null;
          this.onStateChange?.(false);
        },
      };
    } catch (e) {
      console.error("TTS speak failed:", e);
      this.onStateChange?.(false);
      return null;
    }
  }

  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
      this.onStateChange?.(false);
    }
  }
}

export const ttsEngine = new TtsEngine();
