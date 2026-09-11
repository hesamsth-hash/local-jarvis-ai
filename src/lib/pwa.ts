// PWA plumbing: icons, service worker, install prompt.

import { toPng } from "./app-icon";

export function initPwa(): void {
  if (typeof window === "undefined") return;

  // 1. Generate icons at runtime and swap in a data-URI manifest
  void (async () => {
    try {
      const [i192, i512, iMask] = await Promise.all([
        toPng(192),
        toPng(512),
        toPng(512),
      ]);
      const manifest = {
        name: "JARVIS Local Console",
        short_name: "JARVIS",
        description:
          "Offline voice assistant with Kokoro TTS, Whisper STT, a local LLM brain (Ollama/KoboldCpp), and real file tools — all on-device.",
        id: "/",
        start_url: "/dashboard",
        scope: "/",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
        background_color: "#12162a",
        theme_color: "#12162a",
        categories: ["utilities", "productivity"],
        icons: [
          { src: i192, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: i512, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: iMask, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      };
      const blob = new Blob([JSON.stringify(manifest)], {
        type: "application/manifest+json",
      });
      const url = URL.createObjectURL(blob);
      let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "manifest";
        document.head.appendChild(link);
      }
      link.href = url;
    } catch {
      // icons are cosmetic; ignore failures
    }
  })();

  // 2. Offline shell service worker — production only. The dev server serves
  // unbundled modules whose URLs change on every re-optimization; caching them
  // breaks lazy route imports ("Failed to fetch dynamically imported module").
  // In dev, instead unregister anything a previous session registered and
  // drop our cache (never touches the transformers.js model caches).
  if ("serviceWorker" in navigator) {
    if (import.meta.env.DEV) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .then(() => ("caches" in window ? caches.delete("jarvis-v1") : undefined))
        .catch(() => {});
    } else {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW is progressive enhancement; ignore failures (e.g. dev iframe)
      });
    }
  }
}
