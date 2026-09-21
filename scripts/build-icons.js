// Renders the Chartavia logo (scripts/logo.js) to the PWA icons, favicon and
// brand files without any image libraries: a small polygon rasterizer with
// 4x4 supersampling and a hand-rolled PNG encoder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const logo = require('./logo');

const root = path.join(__dirname, '..');
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BLUE = hex(logo.BLUE), SKY = hex(logo.SKY), WHITE = [255, 255, 255];

// ------------------------------------------------------------- geometry
const mirror = (poly) => poly.map(([x, y]) => [512 - x, y]);
function capsule({ x, y, w, h }) {
  const r = w / 2, cx = x + r, n = 12, out = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI + (Math.PI * i) / n; out.push([cx + r * Math.cos(a), y + r + r * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = (Math.PI * i) / n; out.push([cx + r * Math.cos(a), y + h - r + r * Math.sin(a)]); }
  return out;
}
function fuselage() {
  const out = [logo.FUSELAGE.start];
  let cur = logo.FUSELAGE.start;
  for (const [cmd, ...p] of logo.FUSELAGE.segs) {
    if (cmd === 'L') out.push(p[0]);
    else {
      const [c1, c2, end] = p;
      for (let i = 1; i <= 20; i++) {
        const t = i / 20, u = 1 - t;
        out.push([0, 1].map((k) => u * u * u * cur[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * end[k]));
      }
    }
    cur = p[p.length - 1];
  }
  return out;
}
// Painter's order, already in tile coordinates.
const JET = [
  [logo.WING, WHITE], [mirror(logo.WING), WHITE],
  [capsule(logo.ENGINE), SKY], [mirror(capsule(logo.ENGINE)), SKY],
  [logo.STAB, WHITE], [mirror(logo.STAB), WHITE],
  [fuselage(), WHITE],
].map(([poly, color]) => ({ color, poly: poly.map(logo.placeJet) }));

function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inRoundedSquare(x, y, size, r) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const qx = Math.max(r - x, x - (size - r), 0), qy = Math.max(r - y, y - (size - r), 0);
  return qx * qx + qy * qy <= r * r;
}

// ------------------------------------------------------------------ png
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

// maskable: full-bleed square with the jet pulled inside Android's safe zone
// (the launcher applies its own mask, so no rounded corners or transparency).
function render(size, { maskable = false } = {}) {
  const SS = 4, k = size / 512, inset = maskable ? 0.7 : 1;
  const shapes = JET.map(({ color, poly }) => {
    const p = poly.map(([x, y]) => [(256 + (x - 256) * inset) * k, (256 + (y - 256) * inset) * k]);
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return { color, poly: p, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (!maskable && !inRoundedSquare(px, py, size, logo.TILE_RADIUS * k)) continue;
          let c = BLUE;
          for (const s of shapes) {
            if (px >= s.x0 && px <= s.x1 && py >= s.y0 && py <= s.y1 && inPoly(s.poly, px, py)) c = s.color;
          }
          r += c[0]; g += c[1]; b += c[2]; hits++;
        }
      }
      const o = y * stride + 1 + x * 4;
      if (hits) { raw[o] = Math.round(r / hits); raw[o + 1] = Math.round(g / hits); raw[o + 2] = Math.round(b / hits); }
      raw[o + 3] = Math.round((hits / (SS * SS)) * 255);
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

// --------------------------------------------------------------- outputs
// Served files live in public/ (Worker) and again at the repo root (Pages).
function served(name, data) {
  for (const dir of ['public', '.']) fs.writeFileSync(path.join(root, dir, name), data);
  console.log('wrote', name, Buffer.byteLength(data), 'bytes');
}
served('icon-32.png', render(32));
served('icon-192.png', render(192));
served('icon-512.png', render(512));
served('icon-maskable-512.png', render(512, { maskable: true }));
served('favicon.svg', logo.tileSvg(512));

// `--brand` also writes the downloadable logo files (main repo only).
if (!process.argv.includes('--brand')) process.exit(0);
const brand = path.join(root, 'brand');
fs.mkdirSync(brand, { recursive: true });
const files = {
  'chartavia-icon.svg': logo.tileSvg(512),
  'chartavia-icon-1024.png': render(1024),
  'chartavia-jet-blue.svg': logo.jetSvg(512, logo.BLUE, logo.SKY),
  'chartavia-jet-white.svg': logo.jetSvg(512, '#FFFFFF', logo.SKY),
  'chartavia-wordmark-navy.svg': logo.wordmarkSvg(100, logo.NAVY),
  'chartavia-wordmark-white.svg': logo.wordmarkSvg(100, '#FFFFFF'),
  'chartavia-lockup.svg': logo.lockupSvg(logo.NAVY),
  'chartavia-lockup-on-dark.svg': logo.lockupSvg('#FFFFFF'),
};
for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(brand, name), data);
console.log('wrote', Object.keys(files).length, 'brand files to', brand);
