// JARVIS app icon — arc reactor, deep-space navy tile.
// Used as the source SVG; PNGs at 192/512 are generated from this.

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#050a14"/>
  <circle cx="256" cy="256" r="186" fill="none" stroke="#22d3ee" stroke-width="3" stroke-dasharray="3 14" opacity="0.55"/>
  <circle cx="256" cy="256" r="168" fill="none" stroke="#22d3ee" stroke-width="9" stroke-linecap="round" stroke-dasharray="220 835" opacity="0.85"/>
  <circle cx="256" cy="256" r="168" fill="none" stroke="#67e8f9" stroke-width="5" stroke-linecap="round" stroke-dasharray="80 975" transform="rotate(140 256 256)" opacity="0.6"/>
  <circle cx="256" cy="256" r="150" fill="url(#glow)"/>
  <circle cx="256" cy="256" r="118" fill="url(#core)"/>
  <circle cx="256" cy="256" r="88" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="4 12" opacity="0.5"/>
  <circle cx="256" cy="256" r="70" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="2 10" opacity="0.4"/>
  <circle cx="228" cy="218" r="30" fill="#ffffff" opacity="0.9"/>
  <defs>
    <radialGradient id="core" cx="0.38" cy="0.32" r="1">
      <stop offset="0" stop-color="#cffafe"/>
      <stop offset="0.32" stop-color="#67e8f9"/>
      <stop offset="0.65" stop-color="#0ea5e9"/>
      <stop offset="1" stop-color="#0c4a6e"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#22d3ee" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
  </defs>
</svg>`;

function toPng(size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([ICON], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D unavailable");
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export { ICON, toPng };
