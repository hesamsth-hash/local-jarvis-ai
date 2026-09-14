// Audio device registry — lets JARVIS speak through a chosen speaker
// (headphones, HDMI, etc.) and listen through a chosen microphone, exactly
// like the Windows sound settings, but inside the console.
//
// Picks persist on-device; the TTS engine routes audio with `setSinkId`
// (Chromium/WebView2 supports it; other engines just fall back to default).

export const DEFAULT_OUTPUT = "__default__";
export const DEFAULT_INPUT = "__default__";
/** Sentinel for "the headphones, if present". */
export const HEADPHONES_ID = "__headphones__";

function isHeadphoneish(label: string): boolean {
  const l = label.toLowerCase();
  return (
    /\bheadphone|headset|earphone|earbud|airpod|buds\b/.test(l) ||
    /wh-|hyperx|arctis|crusher|solo3|studio3/.test(l)
  );
}

/** All render (speaker) devices; labels populate once the mic is granted once. */
export async function listAudioOutputs(): Promise<MediaDeviceInfo[]> {
  try {
    const all = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
    return all.filter((d) => d.kind === "audiooutput" && d.deviceId);
  } catch {
    return [];
  }
}

/** All capture (microphone) devices. */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  try {
    const all = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
    return all.filter((d) => d.kind === "audioinput" && d.deviceId);
  } catch {
    return [];
  }
}

/**
 * Best-guess the headphones device id from the current list.
 * Returns null if nothing looks like headphones.
 */
export async function findHeadphones(): Promise<MediaDeviceInfo | null> {
  const outs = await listAudioOutputs();
  return (
    outs.find((d) => isHeadphoneish(d.label) && d.deviceId !== "default") ??
    outs.find((d) => isHeadphoneish(d.label)) ??
    null
  );
}

export function friendlyLabel(d: MediaDeviceInfo): string {
  if (d.deviceId === "default") return "Windows default";
  if (d.deviceId === "communications") return "Communications default";
  const label = d.label || `Device ${d.deviceId.slice(0, 6)}`;
  return label.replace(/\s*\(([^)]*built[- ]?in[^)]*)\)\s*$/i, " (built-in)");
}

/** Strip the synthetic "default"/"communications" entries from a picker list. */
export function realDevices(list: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return list.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications");
}

// ---------- persistence ----------

const KEY = "jarvis.audioDevices";

export interface AudioDevicePrefs {
  output?: string | null;
  input?: string | null;
  volume?: number;
}

export function loadAudioPrefs(): AudioDevicePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AudioDevicePrefs) : {};
  } catch {
    return {};
  }
}

export function saveAudioPrefs(prefs: AudioDevicePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

// ---------- routing ----------

/** Route a playing/created <audio> element to a specific output device. */
export function routeElementTo(
  el: HTMLAudioElement,
  deviceId: string | null | undefined,
  volume?: number,
): void {
  try {
    if (typeof volume === "number" && Number.isFinite(volume)) {
      el.volume = Math.min(1, Math.max(0.0001, volume));
    }
    if (deviceId && deviceId !== DEFAULT_OUTPUT && deviceId !== "default") {
      const sink = el as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (typeof sink.setSinkId === "function") {
        // failure here (device unplugged, unsupported) must NEVER kill the
        // speech — the element just stays on the system default.
        sink.setSinkId(deviceId).catch(() => {
          /* fell back to default output */
        });
      }
    }
  } catch {
    // volume/sink quirks must never take down the whole speak()
  }
}
