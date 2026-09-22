// Generates db/seed-demo.sql: switchable demo personas (password: demopass123),
// a fully verified operator org with fleet, marketplace requests, quotes,
// chat, a completed+reviewed trip, and an empty leg — so the demo opens with
// every feature visible. Meridian and Bluewing are approved by staff. Northline
// is the operator in the review queue: its FAA checks pass, one aircraft needs a
// staff clearance (on the reissued D085, not yet in the FAA list) and its safety
// rating awaits confirmation, so the staff persona has all three jobs to do.
// For a fresh database only (messages and empty legs would duplicate on a re-run).
// Load db/schema.sql and db/faa135.sql first; afterwards run
// scripts/seed-demo-docs.js so the documents named here exist in KV.
// Usage: node scripts/seed-demo.js && npx wrangler d1 execute slipstream-demo-db --remote --file db/seed-demo.sql -y
const fs = require('fs');
const path = require('path');
const { subtle } = require('crypto').webcrypto;

const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function hash(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await subtle.importKey('raw', Buffer.from(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return toHex(bits);
}

(async () => {
  const PW = 'demopass123';
  const personas = [
    // [id, email, name, role, plan, org_id, org_role]
    [1, 'ava@demo.chartavia', 'Ava Sinclair', 'client', 'free', null, null],
    [2, 'ben@demo.chartavia', 'Ben Okafor', 'client', 'plus', null, null],
    [3, 'meridian@demo.chartavia', 'Meridian Charter Ops', 'operator', 'pro', 3, "admin"],
    [4, 'dana@demo.chartavia', 'Dana Reyes', 'operator', 'free', 3, "member"],
    [5, 'bluewing@demo.chartavia', 'Bluewing Charters', 'operator', 'free', 5, "admin"],
    [11, 'northline@demo.chartavia', 'Northline Air Charter', 'operator', 'free', 11, "admin"],
    [10, 'staff@demo.chartavia', 'Chartavia Concierge', 'client', 'free', null, null],
  ];
  const marketClients = [
    [6, 'mkt-priya@demo.chartavia', 'Priya Nair'],
    [7, 'mkt-luc@demo.chartavia', 'Luc Moreau'],
    [8, 'mkt-omar@demo.chartavia', 'Omar Haddad'],
    [9, 'mkt-elena@demo.chartavia', 'Elena Vasquez'],
  ];

  const lines = [];
  for (const [id, email, name, role, plan, org, orgRole] of personas) {
    const salt = toHex(require('crypto').randomBytes(16));
    const h = await hash(PW, salt);
    lines.push(`INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (${id}, '${email}', '${name}', '${role}', '${salt}', '${h}', '${plan}', ${org ?? 'NULL'}, ${orgRole ? `'${orgRole}'` : 'NULL'});`);
  }
  for (const [id, email, name] of marketClients) {
    lines.push(`INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (${id}, '${email}', '${name}', 'client', 'x', 'x', 'free');`);
  }

  // Staff persona (id 10) works the concierge desk; two example requests.
  lines.push(`UPDATE users SET is_staff = 1 WHERE id = 10;
INSERT INTO concierge_requests (user_id, name, email, topic, request_id, message, status, created_at) SELECT 1, 'Ava Sinclair', 'ava@demo.chartavia', 'trip', 'RQ-2601', 'We are six adults plus two dogs, Teterboro to Aspen on the 21st. Is a super-mid enough for the bags and ski gear, or should I ask for a heavy?', 'new', datetime('now', '-2 hours') WHERE NOT EXISTS (SELECT 1 FROM concierge_requests);
INSERT INTO concierge_requests (user_id, name, email, phone, topic, message, status, note, created_at) SELECT 5, 'Bluewing Charters', 'bluewing@demo.chartavia', '561 555 0142', 'operator', 'Our D085 was reissued last week with two new tails. What is the fastest way to get them verified so we can quote with them?', 'open', 'Asked them to upload the new D085; re-run the FAA check after.', datetime('now', '-1 day') WHERE (SELECT COUNT(*) FROM concierge_requests) = 1;`);

  lines.push(`
-- Demo certificates in the FAA tables: quoting requires the certificate to be
-- on the Part 135 list and each offered aircraft to be on that certificate.
INSERT OR IGNORE INTO faa135_operators (dsgn, name) VALUES
  ('MJGA085K', 'Meridian Jet Group'), ('BLWA221K', 'Bluewing Charters'), ('NRLA417K', 'Northline Air Charter');
INSERT OR IGNORE INTO faa135_aircraft (dsgn, tail, mms) VALUES
  ('MJGA085K', 'N102CH', NULL), ('MJGA085K', 'N125CD', NULL), ('BLWA221K', 'N1KE', NULL), ('NRLA417K', 'N113BD', NULL);

-- Meridian: fully verified, approved by staff, ARGUS rating confirmed
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, cert_faa_name, base_iata, safety_program, safety_doc_name, safety_doc_at, safety_verified, safety_verified_at, safety_expires,
  cert_doc_name, cert_doc_at, d085_name, d085_at, review_status, review_cert, review_note, reviewed_at, reviewed_by, checked_at, updated_at)
VALUES (3, 'Meridian Jet Group', 'MJGA085K', 'Meridian Jet Group', 'TEB', 'ARGUS Platinum', 'meridian-argus-platinum.pdf', datetime('now', '-1 minute'), 'ARGUS Platinum', datetime('now'), date('now', '+18 months'),
  'meridian-air-carrier-certificate.pdf', datetime('now'), 'meridian-d085.pdf', datetime('now'), 'approved', 'MJGA085K',
  'Spoke with the Director of Operations on the number listed with the FAA.', datetime('now'), 10, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO fleet_aircraft (id, operator_id, tail, model_claim, faa_mfr, faa_model, faa_reg_status, faa_status, on_cert, checked_at)
VALUES (1, 3, 'N102CH', 'Phenom 300E', 'EMBRAER S A', 'EMB-505', 'Valid', 'verified', 1, datetime('now')),
       (2, 3, 'N125CD', 'Citation CJ3+', 'CESSNA', '525B', 'Valid', 'verified', 1, datetime('now'));

-- Bluewing: approved; D085 still pending; declares a rating with no audit
-- certificate behind it, so travelers do not see it
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, cert_faa_name, base_iata, safety_program, review_status, review_cert, reviewed_at, reviewed_by, checked_at, updated_at)
VALUES (5, 'Bluewing Charters', 'BLWA221K', 'Bluewing Charters', 'PBI', 'Wyvern Wingman', 'approved', 'BLWA221K', datetime('now'), 10, datetime('now'), datetime('now'));
INSERT OR IGNORE INTO fleet_aircraft (id, operator_id, tail, model_claim, faa_mfr, faa_model, faa_reg_status, faa_status, on_cert, checked_at)
VALUES (3, 5, 'N1KE', 'Gulfstream G650ER', 'GULFSTREAM AEROSPACE CORP', 'GVI', 'Valid', 'verified', 1, datetime('now'));

-- Northline: both FAA checks pass, waiting for staff. N126TS matches the registry
-- but is not on the certificate in the FAA list (staff can clear it), and the
-- declared rating has an audit certificate on file but is not confirmed yet.
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, cert_faa_name, base_iata, safety_program, safety_doc_name, safety_doc_at,
  cert_doc_name, cert_doc_at, d085_name, d085_at, review_requested_at, checked_at, updated_at)
VALUES (11, 'Northline Air Charter', 'NRLA417K', 'Northline Air Charter', 'BED', 'Wyvern Registered', 'northline-wyvern-registered.pdf', datetime('now'),
  'northline-air-carrier-certificate.pdf', datetime('now'), 'northline-d085-reissued.pdf', datetime('now'), datetime('now', '-2 hours'), datetime('now'), datetime('now'));
INSERT OR IGNORE INTO fleet_aircraft (id, operator_id, tail, model_claim, faa_mfr, faa_model, faa_reg_status, faa_status, on_cert, checked_at)
VALUES (4, 11, 'N113BD', 'PC-12 NG', 'PILATUS AIRCRAFT LTD', 'PC-12/47E', 'Valid', 'verified', 1, datetime('now')),
       (5, 11, 'N126TS', 'PC-12 NG', 'PILATUS AIRCRAFT LTD', 'PC-12/47E', 'Valid', 'verified', 0, datetime('now'));

-- The staff persona (id 10) made the decisions above
INSERT INTO staff_actions (actor_id, org_id, action, detail) SELECT 10, 3, 'approve', 'MJGA085K' WHERE NOT EXISTS (SELECT 1 FROM staff_actions);
INSERT INTO staff_actions (actor_id, org_id, action, detail) SELECT 10, 5, 'approve', 'BLWA221K' WHERE (SELECT COUNT(*) FROM staff_actions) = 1;
INSERT INTO staff_actions (actor_id, org_id, action, detail) SELECT 10, 3, 'confirm_rating', 'ARGUS Platinum until ' || date('now', '+18 months') WHERE (SELECT COUNT(*) FROM staff_actions) = 2;

-- Ava's completed + reviewed trip (gives Meridian a real rating & response time)
INSERT OR IGNORE INTO requests (id, user_id, type, legs, pax, flex_days, cats, budget, needs, addons, notes, accepted_quote_id, trip_status, deposit_amount, deposit_status, created_at)
VALUES ('RQ-2600', 1, 'oneway', '[{"from":"TEB","to":"PBI","date":"2026-07-28","time":"09:30"}]', 6, 1, '["mid"]', '$15–30k', '["Pet on board"]', '["Catering"]', 'Small dog in cabin.', 1, 'completed', 0, 'waived_first', datetime('now','-10 days'));
INSERT OR IGNORE INTO quotes (id, request_id, operator_id, aircraft, price, message, empty_leg, valid_hours, created_at)
VALUES (1, 'RQ-2600', 3, 'N102CH|Phenom 300E', 24500, 'Pet-friendly cabin, catering included.', 0, 48, datetime('now','-10 days','+1 hour'));
INSERT OR IGNORE INTO reviews (request_id, quote_id, operator_org, client_id, stars, text, created_at)
VALUES ('RQ-2600', 1, 3, 1, 5, 'Flawless trip - crew was fantastic with our dog.', datetime('now','-8 days'));

-- Ava's live request with two competing (anonymous) quotes and a chat message
INSERT OR IGNORE INTO requests (id, user_id, type, legs, pax, flex_days, cats, budget, needs, addons, notes, deposit_amount, deposit_status, created_at)
VALUES ('RQ-2601', 1, 'oneway', '[{"from":"TEB","to":"ASE","date":"2026-08-21","time":"08:00"}]', 4, 0, '["light"]', '$15–30k', '[]', '["Ground transport"]', 'Ski trip - gear for four.', 150, 'held', datetime('now','-3 hours'));
INSERT OR IGNORE INTO quotes (id, request_id, operator_id, aircraft, price, message, empty_leg, valid_hours, created_at)
VALUES (2, 'RQ-2601', 3, 'N125CD|Citation CJ3+', 13900, 'We can do an 8am wheels-up, gear fits fine.', 0, 48, datetime('now','-2 hours')),
       (3, 'RQ-2601', 5, 'N1KE|Gulfstream G650ER', 15800, 'Plenty of baggage space for skis.', 0, 48, datetime('now','-1 hour'));
INSERT OR IGNORE INTO messages (quote_id, sender_id, text, created_at)
VALUES (2, 1, 'Can we push wheels-up to 9am?', datetime('now','-90 minutes')),
       (2, 3, 'Absolutely - 9am works.', datetime('now','-80 minutes'));

-- Open marketplace requests from other clients (keeps the bid desk busy)
INSERT OR IGNORE INTO requests (id, user_id, type, legs, pax, flex_days, cats, budget, needs, addons, notes, deposit_amount, deposit_status, created_at) VALUES
('RQ-2602', 6, 'oneway', '[{"from":"VNY","to":"ASE","date":"2026-08-14","time":"08:00"}]', 4, 0, '["smid"]', '$30–60k', '[]', '["Ground transport"]', 'Ski gear for four.', 250, 'held', datetime('now','-2 hours')),
('RQ-2603', 7, 'round', '[{"from":"LBG","to":"IBZ","date":"2026-08-21","time":"11:00"},{"from":"IBZ","to":"LBG","date":"2026-08-24","time":"18:00"}]', 8, 1, '["heavy"]', 'Flexible', '[]', '["Catering"]', '', 500, 'held', datetime('now','-5 hours')),
('RQ-2604', 8, 'oneway', '[{"from":"DXB","to":"GVA","date":"2026-09-02","time":"07:30"}]', 10, 0, '["ulr"]', '$60k+', '["Medical equipment"]', '[]', 'Portable oxygen concentrator on board.', 500, 'held', datetime('now','-1 day')),
('RQ-2605', 9, 'multi', '[{"from":"HPN","to":"NAS","date":"2026-09-05","time":"10:00"},{"from":"NAS","to":"OPF","date":"2026-09-08","time":"14:00"}]', 5, 2, '["mid"]', '$15–30k', '[]', '[]', '', 250, 'held', datetime('now','-25 minutes'));

-- Meridian's empty leg on the board
INSERT OR IGNORE INTO empty_legs (operator_org, created_by, from_code, to_code, date, time, aircraft, price, note, created_at)
VALUES (3, 3, 'PBI', 'TEB', date('now','+12 days'), '14:00', 'N102CH|Phenom 300E', 9500, 'Repositioning after a charter - deep discount.', datetime('now','-4 hours'));
`);

  const out = path.join(__dirname, '..', 'db', 'seed-demo.sql');
  fs.writeFileSync(out, lines.join('\n'));
  console.log('wrote', out, '- personas password:', PW);
})();
