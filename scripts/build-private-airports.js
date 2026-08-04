// Extracts PRIVATE-USE US airports (prior permission required) from the FAA
// NASR fixed-width APT.txt (28-day subscription file) into
// src/private-airports.json. Kept to fields a charter jet could use: paved
// runway >= 3000 ft.
//
// Usage:
//   curl -A "Mozilla/5.0" -o nasr.zip https://nfdc.faa.gov/webContent/28DaySub/28DaySubscription_Effective_<date>.zip
//   unzip nasr.zip APT.txt
//   node scripts/build-private-airports.js <path-to-APT.txt>
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const aptPath = process.argv[2];
if (!aptPath) { console.error('usage: node scripts/build-private-airports.js <APT.txt>'); process.exit(1); }

// 1-based fixed-width offsets from Layout_Data/apt_rf.txt
const cut = (line, pos, len) => line.slice(pos - 1, pos - 1 + len).trim();

const MIN_RUNWAY_FT = 3000;
const airports = new Map(); // site# -> airport
const bestPaved = new Map(); // site# -> longest paved runway ft

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function secondsToDeg(s) {
  // e.g. "90065.0000N" -> seconds of arc + hemisphere
  const m = s.match(/^([\d.]+)([NSEW])$/);
  if (!m) return null;
  const deg = +m[1] / 3600;
  return +(m[2] === 'S' || m[2] === 'W' ? -deg : deg).toFixed(3);
}

const rl = readline.createInterface({ input: fs.createReadStream(aptPath), crlfDelay: Infinity });
rl.on('line', (line) => {
  const rec = line.slice(0, 3);
  if (rec === 'APT') {
    if (cut(line, 15, 13) !== 'AIRPORT') return;      // no heliports/seaplane bases
    if (cut(line, 186, 2) !== 'PR') return;           // private use only
    const lid = cut(line, 28, 4);
    if (!lid) return;
    const lat = secondsToDeg(cut(line, 539, 12));
    const lon = secondsToDeg(cut(line, 566, 12));
    if (lat === null || lon === null) return;
    airports.set(cut(line, 4, 11), {
      lid,
      name: titleCase(cut(line, 134, 50)).slice(0, 40),
      city: titleCase(cut(line, 94, 40)).slice(0, 28),
      state: cut(line, 49, 2),
      lat, lon,
    });
  } else if (rec === 'RWY') {
    const site = cut(line, 4, 11);
    const len = +cut(line, 24, 5);
    const surface = cut(line, 33, 12);
    if (!Number.isFinite(len)) return;
    if (!/^(ASPH|CONC|PEM)/.test(surface)) return;    // paved only
    if (len > (bestPaved.get(site) || 0)) bestPaved.set(site, len);
  }
});
rl.on('close', () => {
  const rows = [];
  for (const [site, a] of airports) {
    const rwy = bestPaved.get(site) || 0;
    if (rwy < MIN_RUNWAY_FT) continue;
    rows.push([a.lid, a.name, a.city + ', ' + a.state, 'US', a.lat, a.lon, rwy]);
  }
  rows.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const out = path.join(__dirname, '..', 'src', 'private-airports.json');
  fs.writeFileSync(out, JSON.stringify(rows));
  console.log('wrote src/private-airports.json:', rows.length, 'private-use (PPR) airports with paved runway >=', MIN_RUNWAY_FT, 'ft');
});
