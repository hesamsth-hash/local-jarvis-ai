// Generates src-tauri/icons/*.png + icon.ico from the JARVIS SVG source.
// Run once: bun scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svgPath = path.join(root, "scripts", "jarvis-icon.svg");
const outDir = path.join(root, "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(svgPath);

async function png(size, name) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(path.join(outDir, name));
  console.log(`✓ ${name} (${size}x${size})`);
}

await png(32, "32x32.png");
await png(128, "128x128.png");
await png(256, "128x128@2x.png");
await png(512, "icon.png");

// Minimal ICO wrapping the 256px PNG (PNG-in-ICO is supported since Vista).
const png256 = readFileSync(path.join(outDir, "128x128@2x.png"));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // width 256 → 0
entry.writeUInt8(0, 1); // height 256 → 0
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png256.length, 8); // data size
entry.writeUInt32LE(22, 12); // data offset (6 + 16)
writeFileSync(
  path.join(outDir, "icon.ico"),
  Buffer.concat([header, entry, png256]),
);
console.log("✓ icon.ico (256px PNG-embedded)");
