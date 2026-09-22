// Uploads clearly-marked SAMPLE PDFs for the demo personas through the app's own
// upload endpoints (documents live in KV, which db/seed-demo.sql cannot fill), so
// every "Open" link in the operator profile and on the staff desk works.
// Usage: node scripts/seed-demo-docs.js [https://slipstream-demo.chandler-850.workers.dev]
const BASE = process.argv[2] || 'https://slipstream-demo.chandler-850.workers.dev';

// A one-page PDF built by hand: no dependencies, valid xref table.
function samplePdf(title, lines) {
  const esc = (t) => String(t).replace(/([\\()])/g, '\\$1');
  const text = ['BT /F1 20 Tf 72 720 Td (' + esc(title) + ') Tj ET']
    .concat(lines.map((l, i) => 'BT /F1 11 Tf 72 ' + (682 - i * 18) + ' Td (' + esc(l) + ') Tj ET')).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + Buffer.byteLength(text) + ' >>\nstream\n' + text + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out);
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
    + offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
    + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

const NOTICE = ['SAMPLE DOCUMENT for the Chartavia demo.', 'Not a real certificate. The operator and its details are fictional.'];
const DOCS = {
  'meridian@demo.chartavia': [
    ['/api/operator/certificate', 'meridian-air-carrier-certificate.pdf', 'Air Carrier Certificate (sample)', ['Meridian Jet Group', 'Certificate MJGA085K']],
    ['/api/operator/d085', 'meridian-d085.pdf', 'OpSpec D085 Aircraft Listing (sample)', ['Meridian Jet Group', 'N102CH  Phenom 300E', 'N125CD  Citation CJ3+']],
    ['/api/operator/safety-doc', 'meridian-argus-platinum.pdf', 'ARGUS Platinum Audit Certificate (sample)', ['Meridian Jet Group']],
  ],
  'northline@demo.chartavia': [
    ['/api/operator/certificate', 'northline-air-carrier-certificate.pdf', 'Air Carrier Certificate (sample)', ['Northline Air Charter', 'Certificate NRLA417K']],
    ['/api/operator/d085', 'northline-d085-reissued.pdf', 'OpSpec D085 Aircraft Listing (sample, reissued)', ['Northline Air Charter', 'N113BD  PC-12 NG', 'N126TS  PC-12 NG  (added on this reissue)']],
    ['/api/operator/safety-doc', 'northline-wyvern-registered.pdf', 'Wyvern Registered Operator Certificate (sample)', ['Northline Air Charter']],
  ],
};

(async () => {
  for (const [email, docs] of Object.entries(DOCS)) {
    const sw = await fetch(BASE + '/api/demo/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const cookie = (sw.headers.get('set-cookie') || '').split(';')[0];
    if (!cookie) throw new Error('could not switch to ' + email + ' (is this the demo deployment?)');
    for (const [path, name, title, lines] of docs) {
      const fd = new FormData();
      fd.append('file', new Blob([samplePdf(title, lines.concat('', NOTICE))], { type: 'application/pdf' }), name);
      const r = await fetch(BASE + path, { method: 'POST', headers: { cookie }, body: fd });
      console.log(email, path, r.status, JSON.stringify(await r.json().catch(() => ({}))));
    }
  }
  // A certificate uploaded after a confirmation reads as a renewal waiting for
  // staff, so the staff persona confirms Meridian's rating against the fresh
  // upload (valid 18 months). Northline's stays unconfirmed: that is its story.
  const sw = await fetch(BASE + '/api/demo/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'staff@demo.chartavia' }) });
  const cookie = (sw.headers.get('set-cookie') || '').split(';')[0];
  const until = new Date();
  until.setUTCMonth(until.getUTCMonth() + 18);
  const r = await fetch(BASE + '/api/staff/operators/3', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action: 'confirm_rating', expires: until.toISOString().slice(0, 10) }),
  });
  console.log('staff confirms Meridian rating until', until.toISOString().slice(0, 10), r.status);
})().catch((e) => { console.error(e); process.exit(1); });
