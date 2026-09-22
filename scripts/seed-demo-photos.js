// Uploads the aircraft illustrations from public/img/aircraft as the demo
// personas' fleet photos, through the app's own endpoint (photos live in KV,
// which db/seed-demo.sql cannot fill). Run after seed-demo.sql on a fresh
// database, or any time the photos need restoring.
// Usage: node scripts/seed-demo-photos.js [https://slipstream-demo.chandler-850.workers.dev]
const fs = require('fs');
const path = require('path');
const BASE = process.argv[2] || 'https://slipstream-demo.chandler-850.workers.dev';
const DIR = path.join(__dirname, '..', 'public', 'img', 'aircraft');

// persona -> [tail, image file]
const PHOTOS = {
  'meridian@demo.chartavia': [['N102CH', 'phenom-300-exterior.webp'], ['N125CD', 'citation-cj3-exterior.webp']],
  'bluewing@demo.chartavia': [['N1KE', 'g650er-exterior.webp']],
  'northline@demo.chartavia': [['N113BD', 'pc-12-ng-exterior.webp'], ['N126TS', 'pc-12-ng-flight.webp']],
};

(async () => {
  for (const [email, list] of Object.entries(PHOTOS)) {
    const sw = await fetch(BASE + '/api/demo/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const cookie = (sw.headers.get('set-cookie') || '').split(';')[0];
    if (!cookie) throw new Error('could not switch to ' + email + ' (is this the demo deployment?)');
    const boot = await fetch(BASE + '/api/bootstrap', { headers: { cookie } }).then((r) => r.json());
    for (const [tail, file] of list) {
      const ac = boot.operatorProfile.fleet.find((a) => a.tail === tail);
      if (!ac) { console.log(email, tail, 'not in fleet, skipped'); continue; }
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(path.join(DIR, file))], { type: 'image/webp' }), file);
      const r = await fetch(BASE + '/api/operator/fleet/' + ac.id + '/photo', { method: 'POST', headers: { cookie }, body: fd });
      console.log(email, tail, '(id ' + ac.id + ')', file, r.status, JSON.stringify(await r.json().catch(() => ({}))));
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
