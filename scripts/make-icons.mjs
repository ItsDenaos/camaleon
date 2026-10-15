// Renders the app icon (same design as public/favicon.svg) to PNG, without dependencies.
// Run after changing the logo: node scripts/make-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = [11, 11, 16];
const STOPS = [
  [0, [124, 242, 156]],
  [0.5, [76, 201, 240]],
  [1, [177, 108, 255]],
];

function gradient(t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/**
 * Colour at (x, y) in a 64-unit design space, or null if transparent.
 * maskable: full-bleed background and the mark shrunk into the 80% safe zone.
 */
function shade(x, y, maskable) {
  const s = maskable ? 0.72 : 1;
  const cx = 32;
  const cy = 32;
  const dx = (x - cx) / s;
  const dy = (y - cy) / s;
  const r = Math.hypot(dx, dy);
  if (!maskable) {
    // Rounded square background, corner radius 14.
    const qx = Math.max(Math.abs(x - 32) - 32 + 14, 0);
    const qy = Math.max(Math.abs(y - 32) - 32 + 14, 0);
    if (Math.hypot(qx, qy) > 14) return null;
  }
  const g = gradient((dx + dy + 64) / 128 + 0.0);
  if (Math.abs(r - 19) <= 3.6) return g; // ring
  if (r <= 7.5) return g; // centre dot
  return BG;
}

function render(size, maskable) {
  const ss = 4; // 4×4 supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade(((x + (sx + 0.5) / ss) / size) * 64, ((y + (sy + 0.5) / ss) / size) * 64, maskable);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return encodePng(px, size, size);
}

// --- Minimal PNG encoder (RGBA, filter 0) ---

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = [
  ['icons/icon-192.png', 192, false],
  ['icons/icon-512.png', 512, false],
  ['icons/maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true], // iOS adds its own rounded corners
];
await mkdir(join(root, 'public', 'icons'), { recursive: true });
for (const [file, size, maskable] of out) {
  await writeFile(join(root, 'public', file), render(size, maskable));
  console.log(`✓ public/${file}`);
}
