// JARVIS app icon — orb core + ring, dark tile background.
// Used as the source SVG; PNGs at 192/512 are generated from this.

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#12162a"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#6366f1" stroke-width="6" stroke-dasharray="10 14" opacity="0.9"/>
  <circle cx="256" cy="256" r="180" fill="none" stroke="#38bdf8" stroke-width="4" stroke-dasharray="3 12" opacity="0.7"/>
  <circle cx="256" cy="256" r="96" fill="#4f46e5"/>
  <circle cx="256" cy="256" r="96" fill="url(#g)"/>
  <defs>
    <radialGradient id="g" cx="0.38" cy="0.32" r="1">
      <stop offset="0" stop-color="#a5b4fc"/>
      <stop offset="0.45" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#312e81"/>
    </radialGradient>
  </defs>
  <circle cx="222" cy="216" r="28" fill="#e0e7ff" opacity="0.85"/>
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
