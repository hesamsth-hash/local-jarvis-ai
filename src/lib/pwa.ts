// PWA plumbing: icons, service worker, install prompt.

import { toPng } from "./app-icon";

const SW_SOURCE = `
const CACHE = "jarvis-v1";
const CORE = ["/", "/index.html"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (Convex, models, fonts)
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.destination === "document" || req.destination === "script" || req.destination === "style")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        req.destination === "document"
          ? caches.match("/index.html")
          : caches.match(req)
      )
  );
});
`;

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

  // 2. Register the offline shell service worker
  if ("serviceWorker" in navigator) {
    const blob = new Blob([SW_SOURCE], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    navigator.serviceWorker.register(url).catch(() => {
      // SW is progressive enhancement; ignore failures (e.g. dev iframe)
    });
  }
}
