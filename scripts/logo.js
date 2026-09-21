// The Chartavia logo as data: the jet tile and the hand-built monoline
// wordmark. build-icons.js rasterizes it and pack.js inlines it in the app
// bundle; the static pages carry a pasted copy of the same markup.
// The wordmark is stroked paths, not text, so it never depends on a font.
const BLUE = '#2E6BE6', SKY = '#A8C4F4', NAVY = '#16233B';
const r2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------- jet
// Drawn nose-up in a 512 box (left half; the right half is mirrored), then
// rotated 45deg so it climbs out to the upper right.
const WING = [[238, 232], [70, 338], [70, 366], [238, 312]];
const STAB = [[250, 410], [170, 452], [170, 470], [252, 448]];
const ENGINE = { x: 188, y: 338, w: 30, h: 76 };
const FUSELAGE = {
  start: [256, 40],
  segs: [
    ['C', [276, 70], [282, 118], [282, 166]], ['L', [282, 398]],
    ['C', [282, 432], [268, 456], [256, 470]], ['C', [244, 456], [230, 432], [230, 398]],
    ['L', [230, 166]], ['C', [230, 118], [236, 70], [256, 40]],
  ],
};
const JET_SCALE = 1.04, JET_PIVOT = [256, 262];
const JET_TRANSFORM = `rotate(45 256 256) translate(256 256) scale(${JET_SCALE}) translate(${-JET_PIVOT[0]} ${-JET_PIVOT[1]})`;
const TILE_RADIUS = 116;

// JET_TRANSFORM applied to one point, for the rasterizer.
function placeJet([x, y]) {
  const px = (x - JET_PIVOT[0]) * JET_SCALE, py = (y - JET_PIVOT[1]) * JET_SCALE;
  return [256 + (px - py) * Math.SQRT1_2, 256 + (px + py) * Math.SQRT1_2];
}

const pts = (poly) => poly.map((p) => p.join(',')).join(' ');
const fuselagePath = () => `M${FUSELAGE.start.join(',')} ` + FUSELAGE.segs
  .map(([c, ...p]) => c + p.map((q) => q.join(',')).join(' ')).join(' ') + ' Z';

function jetMarkup(body = '#fff', engines = SKY) {
  const half = `<polygon points="${pts(WING)}" fill="${body}"/>`
    + `<rect x="${ENGINE.x}" y="${ENGINE.y}" width="${ENGINE.w}" height="${ENGINE.h}" rx="${ENGINE.w / 2}" fill="${engines}"/>`
    + `<polygon points="${pts(STAB)}" fill="${body}"/>`;
  return `<g transform="${JET_TRANSFORM}"><g>${half}</g><g transform="translate(512 0) scale(-1 1)">${half}</g>`
    + `<path d="${fuselagePath()}" fill="${body}"/></g>`;
}

// App-icon tile. No ids inside, so it can be inlined any number of times.
function tileSvg(size, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" role="img" aria-label="Chartavia"${extra}>`
    + `<rect width="512" height="512" rx="${TILE_RADIUS}" fill="${BLUE}"/>${jetMarkup()}</svg>`;
}

// Jet alone, for placing on a page background.
function jetSvg(size, body = BLUE, engines = SKY, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" aria-hidden="true"${extra}>${jetMarkup(body, engines)}</svg>`;
}

// -------------------------------------------------------------- wordmark
const STROKE = 14, GAP = 24;
const KERN = { HA: -4, AR: -6, RT: -6, TA: -18, AV: -22, VI: -8, IA: -8 };
function glyphs() {
  const p = STROKE / 2, top = p, bot = 100 - p;
  const r = 50 - p, a = (40 * Math.PI) / 180;
  const cx = 50 + r * Math.cos(a), cdy = r * Math.sin(a);
  const aw = 90, ax = aw / 2, bar = 70, lx = ax - (ax - p) * ((bar - top) / (bot - top));
  const rj = 56, rb = (rj - top) / 2;
  return {
    C: { w: cx + p, d: [`M${r2(cx)},${r2(50 - cdy)} A${r},${r} 0 1 0 ${r2(cx)},${r2(50 + cdy)}`] },
    H: { w: 80, d: [`M${p},${top} V${bot}`, `M${80 - p},${top} V${bot}`, `M${p},50 H${80 - p}`] },
    A: { w: aw, d: [`M${p},${bot} L${ax},${top} L${aw - p},${bot}`, `M${r2(lx)},${bar} H${r2(aw - lx)}`] },
    R: { w: 78, d: [`M${p},${bot} V${top} H42 A${rb},${rb} 0 0 1 42,${rj} H${p}`, `M36,${rj} L${78 - p},${bot}`] },
    T: { w: 82, d: [`M${p},${top} H${82 - p}`, `M41,${top} V${bot}`] },
    V: { w: 90, d: [`M${p},${top} L45,${bot} L${90 - p},${top}`] },
    I: { w: STROKE, d: [`M${p},${top} V${bot}`] },
  };
}
function wordmarkGeometry() {
  const G = glyphs(), text = 'CHARTAVIA';
  let x = 0, inner = '';
  [...text].forEach((ch, i) => {
    if (i) x += GAP + (KERN[text[i - 1] + ch] || 0);
    inner += `<g transform="translate(${r2(x)} 0)">` + G[ch].d.map((d) => `<path d="${d}"/>`).join('') + '</g>';
    x += G[ch].w;
  });
  return { width: r2(x), inner };
}

// Cap height in px; color defaults to the surrounding CSS color.
function wordmarkSvg(height, color = 'currentColor', extra = '') {
  const { width, inner } = wordmarkGeometry();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100" width="${r2((width / 100) * height)}" height="${height}" role="img" aria-label="Chartavia"${extra}>`
    + `<g fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;
}

// Tile + wordmark side by side as one standalone file.
function lockupSvg(color = NAVY) {
  const { width, inner } = wordmarkGeometry();
  const tile = 148, gap = 44, scale = 0.78;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(tile + gap + width * scale)} ${tile}" role="img" aria-label="Chartavia">`
    + `<g transform="scale(${tile / 512})"><rect width="512" height="512" rx="${TILE_RADIUS}" fill="${BLUE}"/>${jetMarkup()}</g>`
    + `<g transform="translate(${tile + gap} ${r2((tile - 100 * scale) / 2)}) scale(${scale})" fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;
}

module.exports = {
  BLUE, SKY, NAVY, WING, STAB, ENGINE, FUSELAGE, TILE_RADIUS, placeJet,
  tileSvg, jetSvg, wordmarkSvg, lockupSvg,
};
