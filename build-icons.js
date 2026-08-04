// Renders the Slipstream logo (blue rounded square, two rotated streaks) to
// public/icon-192.png and public/icon-512.png without any image libraries.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (const v of buf) { c ^= v; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Logo geometry in its 120x80 viewBox: two bars rotated -20deg.
const BARS = [
  { x: 38, y: 42, w: 46, h: 6, r: 3, cx: 60, cy: 45, col: [255, 255, 255] },
  { x: 32, y: 52, w: 26, h: 6, r: 3, cx: 45, cy: 55, col: [168, 196, 244] },
];
const ANGLE = (-20 * Math.PI) / 180;
const BLUE = [46, 107, 230];

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const qx = Math.max(x + r - px, px - (x + w - r), 0);
  const qy = Math.max(y + r - py, py - (y + h - r), 0);
  return qx * qx + qy * qy <= r * r;
}

function render(size) {
  const scale = (size * 0.85) / 120; // logo fills ~85% width
  const ox = (size - 120 * scale) / 2;
  const oy = (size - 80 * scale) / 2;
  const corner = size * 0.22;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cos = Math.cos(-ANGLE), sin = Math.sin(-ANGLE);
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const o = y * (1 + size * 4) + 1 + x * 4;
      let rgb = null, a = 0;
      if (inRoundedRect(x + 0.5, y + 0.5, 0, 0, size, size, corner)) { rgb = BLUE; a = 255; }
      if (a) {
        const lx = (x + 0.5 - ox) / scale;
        const ly = (y + 0.5 - oy) / scale;
        for (const b of BARS) {
          const dx = lx - b.cx, dy = ly - b.cy;
          const rx = b.cx + dx * cos - dy * sin;
          const ry = b.cy + dx * sin + dy * cos;
          if (inRoundedRect(rx, ry, b.x, b.y, b.w, b.h, b.r)) rgb = b.col;
        }
      }
      raw[o] = rgb ? rgb[0] : 0;
      raw[o + 1] = rgb ? rgb[1] : 0;
      raw[o + 2] = rgb ? rgb[2] : 0;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const out = path.join(__dirname, '..', 'public', 'icon-' + size + '.png');
  fs.writeFileSync(out, render(size));
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
}
