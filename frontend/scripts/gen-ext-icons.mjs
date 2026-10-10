// gen-ext-icons.mjs — generate simple PNG icons for the NOVA Chrome extension.
// Minimal PNG encoder (RGB, no interlace) using node:zlib, so we don't need any
// native/canvas dependency. Draws a dark tile with a glowing cyan orb.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "extension", "icons");
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function png(width, height, pixelFn) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y, width, height);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Dark rounded-ish tile with a cyan glowing orb in the centre.
function icon(x, y, w) {
  const cx = w / 2;
  const cy = w / 2;
  const d = Math.hypot(x - cx, y - cy) / (w / 2); // 0 centre → 1 edge
  if (d > 0.985) return [5, 7, 15]; // outside the disc → background
  const glow = Math.max(0, 1 - d);
  const core = Math.pow(glow, 2.4);
  return [
    Math.min(255, Math.round(9 + core * 205)),
    Math.min(255, Math.round(14 + core * 233)),
    Math.min(255, Math.round(26 + core * 229)),
  ];
}

for (const size of [16, 48, 128]) {
  const buf = png(size, size, icon);
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, buf);
  console.log("wrote", file, `${buf.length} bytes`);
}
