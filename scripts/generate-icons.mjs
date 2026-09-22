/**
 * Generate CommandLayer extension icons (PNG) with zero external
 * dependencies: a tiny built-in PNG encoder renders a rounded dark tile with
 * a subtle indigo glow and the three-layer glyph (the brand mark).
 *
 * Usage: npm run icons  (writes public/icons/icon{16,32,48,128}.png)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

/* ------------------------- minimal PNG encoder ------------------------- */

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- drawing math ---------------------------- */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mixColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * abx + (py - ay) * aby) / len2);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function sdRhombus(px, py, cx, cy, a, b) {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  const f1 = dx / a + dy / b - 1;
  const f2 = dx / b + dy / a - 1;
  return Math.max(f1, f2) * Math.min(a, b) * 0.5;
}

/* ------------------------------- icon --------------------------------- */

function drawIcon(size) {
  const buffer = Buffer.alloc(size * size * 4);
  const c = size / 2;

  // Tile
  const tileRadius = size * 0.223;
  const bgTop = [24, 27, 34]; // #181B22
  const bgBottom = [9, 11, 15]; // #090B0F

  // Subtle indigo glow, upper right
  const glowColor = [124, 132, 245];
  const glowX = 0.72 * size;
  const glowY = 0.18 * size;
  const glowSigma = size * 0.3;

  // Layer glyph (top diamond + two chevrons)
  const a = size * 0.3; // half width
  const b = size * 0.13; // half height
  const chevronHalfWidth = size * 0.045;
  const topY = c - size * 0.01;
  const midY = c + size * 0.06;
  const botY = c + size * 0.13;
  const topColor = [139, 147, 248]; // #8B93F8
  const midColor = [169, 177, 199]; // #A9B1C7
  const botColor = [108, 116, 136]; // #6C7488

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const i = (y * size + x) * 4;

      const dTile = sdRoundRect(px, py, c, c, c, c, tileRadius);
      const alpha = clamp01(0.5 - dTile);
      if (alpha <= 0) continue;

      let color = mixColor(bgTop, bgBottom, py / size);

      const gd = Math.hypot(px - glowX, py - glowY);
      const g = 0.2 * Math.exp(-(gd * gd) / (2 * glowSigma * glowSigma));
      color = mixColor(color, glowColor, g);

      // Paint bottom-up so the top layer overlaps the chevrons.
      const layers = [
        { y: botY, color: botColor, chevron: true },
        { y: midY, color: midColor, chevron: true },
        { y: topY, color: topColor, chevron: false },
      ];
      for (const layer of layers) {
        let d;
        if (layer.chevron) {
          const halfW = a * 0.92;
          const d1 = distToSegment(px, py, c - halfW, layer.y, c, layer.y + b);
          const d2 = distToSegment(px, py, c, layer.y + b, c + halfW, layer.y);
          d = Math.min(d1, d2) - chevronHalfWidth;
        } else {
          d = sdRhombus(px, py, c, layer.y, a, b);
        }
        const coverage = clamp01(0.5 - d);
        if (coverage > 0) color = mixColor(color, layer.color, coverage);
      }

      // Gentle bottom vignette for depth
      const vignette = 0.06 * clamp01((py / size - 0.7) / 0.3);
      color = mixColor(color, [0, 0, 0], vignette);

      buffer[i] = Math.round(color[0]);
      buffer[i + 1] = Math.round(color[1]);
      buffer[i + 2] = Math.round(color[2]);
      buffer[i + 3] = Math.round(alpha * 255);
    }
  }
  return buffer;
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, drawIcon(size));
  writeFileSync(join(outDir, `icon${size}.png`), png);
  console.log(`wrote icons/icon${size}.png (${png.length} bytes)`);
}
