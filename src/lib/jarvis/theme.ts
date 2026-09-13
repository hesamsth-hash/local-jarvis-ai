// Accent theming + performance mode for the JARVIS HUD.
//
// The entire console palette hangs off one CSS variable (--accent-h, a hue in
// OKLCH space). Switching the accent = setting one variable on :root —
// instant, no re-render, no flash.
//
// perf-lite is enabled automatically on phones and low-core devices: it
// drops the scanline overlay, one aurora blob, and the title glitch — the
// effects that showed up as stutter on mid-range Android webviews.

const ACCENT_KEY = "jarvis.accent.v1";

export interface AccentOption {
  id: string;
  label: string;
  hue: number;
}

export const ACCENTS: AccentOption[] = [
  { id: "cyan", label: "Arc Reactor", hue: 205 },
  { id: "teal", label: "Stealth", hue: 175 },
  { id: "gold", label: "Hot-Rod", hue: 85 },
  { id: "crimson", label: "Mark VII", hue: 25 },
  { id: "violet", label: "Vision", hue: 300 },
];

export function loadAccent(): AccentOption {
  try {
    const id = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]!;
  } catch {
    return ACCENTS[0]!;
  }
}

export function applyAccent(accent: AccentOption): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent.id);
  } catch {
    // storage unavailable — still apply for this session
  }
  document.documentElement.style.setProperty("--accent-h", String(accent.hue));
}

/**
 * Low-power detection → adds the `perf-lite` class to <html>.
 * Phones (userAgent), coarse pointers (touch-first) and low-core CPUs are
 * the devices where the full effects caused visible stutter.
 */
export function enablePerfLiteIfNeeded(): void {
  try {
    const ua = navigator.userAgent;
    const isPhone =
      /android|iphone|ipad|ipod|mobile/i.test(ua) ||
      (navigator.maxTouchPoints > 1 && /Mac/.test(ua)); // iPadOS pretends to be Mac
    const lowCores =
      typeof navigator.hardwareConcurrency === "number" &&
      navigator.hardwareConcurrency > 0 &&
      navigator.hardwareConcurrency <= 4;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (isPhone || lowCores || prefersReduced) {
      document.documentElement.classList.add("perf-lite");
    }
  } catch {
    // never let theming break boot
  }
}

/** Called once at boot, before first paint of the console. */
export function initTheme(): void {
  applyAccent(loadAccent());
  enablePerfLiteIfNeeded();
}
