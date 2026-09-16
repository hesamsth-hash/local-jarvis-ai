// Sidecar STT — when the Python sidecar (desktop-python/sidecar.py) is
// running on localhost it serves higher-quality faster-whisper transcription;
// the console uses it transparently and falls back to the in-browser Whisper
// engine when the sidecar is down. Localhost-only; Android never sees it.

const SIDECAR_BASE = "http://127.0.0.1:8791";

let availableCache: { value: boolean; at: number } | null = null;
const CACHE_MS = 15_000;

/** Probe /health (cheap) — cached 15s so sends never feel slow. */
export async function sidecarAvailable(): Promise<boolean> {
  const now = Date.now();
  if (availableCache && now - availableCache.at < CACHE_MS) {
    return availableCache.value;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(`${SIDECAR_BASE}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    const ok = res.ok;
    availableCache = { value: ok, at: now };
    return ok;
  } catch {
    availableCache = { value: false, at: now };
    return false;
  }
}

export interface SidecarInfo {
  model: string;
  tts: boolean;
}

export async function sidecarInfo(): Promise<SidecarInfo | null> {
  if (!(await sidecarAvailable())) return null;
  try {
    const res = await fetch(`${SIDECAR_BASE}/health`);
    const j = (await res.json()) as { model?: string; tts?: boolean };
    return { model: j.model ?? "unknown", tts: j.tts === true };
  } catch {
    return null;
  }
}

/** Send raw audio (wav/webm bytes) to the sidecar; returns trimmed text. */
export async function sidecarTranscribe(
  bytes: Blob | Uint8Array,
): Promise<string> {
  const form = new FormData();
  form.append("audio", new Blob([bytes as BlobPart]), "audio.wav");
  const res = await fetch(`${SIDECAR_BASE}/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      (detail as { error?: string } | null)?.error ?? `Sidecar ${res.status}`,
    );
  }
  const j = (await res.json()) as { text?: string };
  return (j.text ?? "").trim();
}

/** Minimal 16-bit PCM WAV encoder (mono). */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}
