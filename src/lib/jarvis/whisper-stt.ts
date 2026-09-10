// Whisper STT engine — speech recognition running locally via transformers.js.
// The library and model are lazy-loaded on demand.

import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { LoadedProgress } from "./types";

const MODEL_ID = "onnx-community/whisper-base";

class SttEngine {
  private asr: AutomaticSpeechRecognitionPipeline | null = null;
  private loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

  get ready() {
    return this.asr !== null;
  }

  load(
    onProgress?: (p: LoadedProgress) => void,
    onDone?: () => void,
    onError?: (e: string) => void,
  ): Promise<AutomaticSpeechRecognitionPipeline> {
    if (this.asr) return Promise.resolve(this.asr);
    if (this.loading) return this.loading;
    this.loading = import("@huggingface/transformers")
      .then(({ pipeline }) =>
        pipeline("automatic-speech-recognition", MODEL_ID, {
          dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
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
      .then((p) => {
        this.asr = p;
        onDone?.();
        return p;
      })
      .catch((e: unknown) => {
        this.loading = null;
        onError?.(e instanceof Error ? e.message : "Failed to load STT model");
        throw e;
      });
    return this.loading;
  }

  async transcribe(audio: Float32Array): Promise<string> {
    if (!this.asr) throw new Error("STT engine not loaded");
    const out = await this.asr(audio, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (out as { text?: string }).text ?? "";
    return text.trim();
  }
}

export const sttEngine = new SttEngine();
