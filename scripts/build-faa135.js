// Parses the FAA "Certificated Aircraft Operators — Legal Part 135 Holders"
// XLSX (unzipped) into db/faa135.sql: operator designators + the aircraft
// authorized on each certificate. This is the public record behind the D085.
// Refresh:
//   curl -A "Mozilla/5.0" -o faa135.xlsx https://www.faa.gov/about/officeorg/headquartersoffices/avs/faa-certificated-aircraft-operators-legal-part-135-holders.xlsx
//   unzip faa135.xlsx -d faa135x && node scripts/build-faa135.js faa135x
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/build-faa135.js <unzipped-xlsx-dir>'); process.exit(1); }

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d));

const sst = fs.readFileSync(path.join(dir, 'xl', 'sharedStrings.xml'), 'utf8');
const strings = [...sst.matchAll(/<si>(?:<t[^>]*>([\s\S]*?)<\/t>|.*?)<\/si>/g)].map((m) => decode(m[1] ?? ''));

const sheetFile = fs.readdirSync(path.join(dir, 'xl', 'worksheets')).find((f) => f.endsWith('.xml'));
const sheet = fs.readFileSync(path.join(dir, 'xl', 'worksheets', sheetFile), 'utf8');

const operators = new Map(); // dsgn -> name
const aircraft = new Map();  // dsgn|tail -> mms
let header = null;
for (const rowM of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
  const cells = {};
  for (const cm of rowM[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="(\w+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?/g)) {
    const col = cm[1];
    let val = cm[3] ?? '';
    if (cm[2] === 's') val = strings[+val] ?? '';
    cells[col] = typeof val === 'string' ? decode(val).trim() : val;
  }
  if (!header) { header = cells; continue; } // first row = CFR/CHDO/DSGN/Name/...
  const part = cells.H || '';        // "121/135" column
  if (part && !part.includes('135')) continue;
  const dsgn = (cells.C || '').toUpperCase();
  const name = cells.D || '';
  const tail = (cells.F || '').toUpperCase();
  const mms = cells.E || '';
  if (!dsgn) continue;
  if (name && !operators.has(dsgn)) operators.set(dsgn, name);
  if (tail) aircraft.set(dsgn + '|' + tail, mms);
}

const esc = (s) => String(s).replace(/'/g, "''");
const lines = [
  'CREATE TABLE IF NOT EXISTS faa135_operators (dsgn TEXT PRIMARY KEY, name TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS faa135_aircraft (dsgn TEXT NOT NULL, tail TEXT NOT NULL, mms TEXT, PRIMARY KEY (dsgn, tail));',
  'DELETE FROM faa135_operators;',
  'DELETE FROM faa135_aircraft;',
];
const ops = [...operators.entries()];
for (let i = 0; i < ops.length; i += 200) {
  lines.push('INSERT INTO faa135_operators (dsgn, name) VALUES ' + ops.slice(i, i + 200).map(([d, n]) => `('${esc(d)}','${esc(n)}')`).join(',') + ';');
}
const acs = [...aircraft.entries()];
for (let i = 0; i < acs.length; i += 200) {
  lines.push('INSERT INTO faa135_aircraft (dsgn, tail, mms) VALUES ' + acs.slice(i, i + 200).map(([k, m]) => {
    const [d, t] = k.split('|');
    return `('${esc(d)}','${esc(t)}','${esc(m)}')`;
  }).join(',') + ';');
}
fs.writeFileSync(path.join(__dirname, '..', 'db', 'faa135.sql'), lines.join('\n'));
console.log('wrote db/faa135.sql:', operators.size, 'Part 135 certificate holders,', aircraft.size, 'authorized aircraft');
