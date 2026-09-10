// Mic recorder — captures Float32 PCM from the default input device.

export interface RecordingResult {
  audio: Float32Array;
  sampleRate: number;
}

export interface RecorderHandle {
  stop: () => RecordingResult;
}

type LegacyProcessor = ScriptProcessorNode & {
  onaudioprocess: ((e: AudioProcessingEvent) => void) | null;
};

export async function startRecorder(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1) as LegacyProcessor;
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    stop: () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      const sampleRate = ctx.sampleRate;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return { audio: merged, sampleRate };
    },
  };
}

/** Resample arbitrary-rate audio to 16 kHz mono for Whisper. */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return input;
  const ratio = fromRate / 16000;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const low = Math.floor(srcIdx);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIdx - low;
    out[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return out;
}
