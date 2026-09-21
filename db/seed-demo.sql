INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (1, 'ava@demo.chartavia', 'Ava Sinclair', 'client', '1d0a5c4f132e7b927dc45df6a589f9e0', '53e5d8570badc6c6fab48b899b1d7617f532c68fedbf143474aa8187fbe96f42', 'free', NULL, NULL);
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (2, 'ben@demo.chartavia', 'Ben Okafor', 'client', '1abea4a16805a7be9bd54ff7e41988e0', '29bb53751ef152ee472bd8ee19a5d2a3eb8f3ef1f1baa6d5a5eaa2cad99cfac0', 'plus', NULL, NULL);
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (3, 'meridian@demo.chartavia', 'Meridian Charter Ops', 'operator', '6f82f7481c7f34f0ccd9396c6be41fac', '9a06fcbf4da94bd7158e77d65933004a9753cae2eb52a90680da7f3baac2d4b8', 'pro', 3, 'admin');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (4, 'dana@demo.chartavia', 'Dana Reyes', 'operator', '28db953bdbbb1c415b90a3a77f6a6008', '3efef561a486c7ff62616b92a411b5e329c63109443d6651c1c30dcc8d1686b6', 'free', 3, 'member');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (5, 'bluewing@demo.chartavia', 'Bluewing Charters', 'operator', 'fd027bea82ff6855bee11cfa97cf319e', 'd4f9fffa699f7a8db4b98286c4d858bb6a1d1e2198fa8f3a18ce6d66d78f017e', 'free', 5, 'admin');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (11, 'northline@demo.chartavia', 'Northline Air Charter', 'operator', '617cdc852220d68c880d1bff0aa0e30d', 'b946c1482a58867deda9b5a1c97096ec845a65bdab6d3e6833340394e39d00f7', 'free', 11, 'admin');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (10, 'staff@demo.chartavia', 'Chartavia Concierge', 'client', '8ec5f8bf08fd4daf20d5c4e361b20db1', '560c8e64e0df4335ea11ecef75a0d045287b890f6906028024e96413218c14a0', 'free', NULL, NULL);
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (6, 'mkt-priya@demo.chartavia', 'Priya Nair', 'client', 'x', 'x', 'free');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (7, 'mkt-luc@demo.chartavia', 'Luc Moreau', 'client', 'x', 'x', 'free');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (8, 'mkt-omar@demo.chartavia', 'Omar Haddad', 'client', 'x', 'x', 'free');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (9, 'mkt-elena@demo.chartavia', 'Elena Vasquez', 'client', 'x', 'x', 'free');
UPDATE users SET is_staff = 1 WHERE id = 10;
INSERT INTO concierge_requests (user_id, name, email, topic, request_id, message, status, created_at) SELECT 1, 'Ava Sinclair', 'ava@demo.chartavia', 'trip', 'RQ-2601', 'We are six adults plus two dogs, Teterboro to Aspen on the 21st. Is a super-mid enough for the bags and ski gear, or should I ask for a heavy?', 'new', datetime('now', '-2 hours') WHERE NOT EXISTS (SELECT 1 FROM concierge_requests);
INSERT INTO concierge_requests (user_id, name, email, phone, topic, message, status, note, created_at) SELECT 5, 'Bluewing Charters', 'bluewing@demo.chartavia', '561 555 0142', 'operator', 'Our D085 was reissued last week with two new tails. What is the fastest way to get them verified so we can quote with them?', 'open', 'Asked them to upload the new D085; re-run the FAA check after.', datetime('now', '-1 day') WHERE (SELECT COUNT(*) FROM concierge_requests) = 1;

-- Demo certificates in the FAA tables: quoting requires the certificate to be
-- on the Part 135 list and each offered aircraft to be on that certificate.
INSERT OR IGNORE INTO faa135_operators (dsgn, name) VALUES
  ('MJGA085K', 'Meridian Jet Group'), ('BLWA221K', 'Bluewing Charters'), ('NRLA417K', 'Northline Air Charter');
INSERT OR IGNORE INTO faa135_aircraft (dsgn, tail, mms) VALUES
  ('MJGA085K', 'N502QS', NULL), ('MJGA085K', 'N510JK', NULL), ('BLWA221K', 'N1KE', NULL);

-- Meridian: fully verified operator org (badge: FAA 135 verified)
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, cert_faa_name, base_iata, safety_program, d085_name, d085_at, checked_at, updated_at)
VALUES (3, 'Meridian Jet Group', 'MJGA085K', 'Meridian Jet Group', 'TEB', 'ARGUS Platinum', 'meridian-d085.pdf', datetime('now'), datetime('now'), datetime('now'));
INSERT OR IGNORE INTO fleet_aircraft (id, operator_id, tail, model_claim, faa_mfr, faa_model, faa_reg_status, faa_status, on_cert, checked_at)
VALUES (1, 3, 'N502QS', 'Citation Latitude', 'TEXTRON AVIATION INC', '680A', 'Valid', 'verified', 1, datetime('now')),
       (2, 3, 'N510JK', 'Citation Mustang', 'CESSNA', '510', 'Valid', 'verified', 1, datetime('now'));

-- Bluewing: cert + fleet verified, D085 still pending
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, cert_faa_name, base_iata, safety_program, checked_at, updated_at)
VALUES (5, 'Bluewing Charters', 'BLWA221K', 'Bluewing Charters', 'PBI', 'Wyvern Wingman', datetime('now'), datetime('now'));
INSERT OR IGNORE INTO fleet_aircraft (id, operator_id, tail, model_claim, faa_mfr, faa_model, faa_reg_status, faa_status, on_cert, checked_at)
VALUES (3, 5, 'N1KE', 'Gulfstream G650', 'GULFSTREAM AEROSPACE CORP', 'GVI', 'Valid', 'verified', 1, datetime('now'));

-- Northline: certificate matched, no aircraft yet, so quoting is still locked
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, cert_faa_name, base_iata, updated_at)
VALUES (11, 'Northline Air Charter', 'NRLA417K', 'Northline Air Charter', 'BED', datetime('now'));

-- Ava's completed + reviewed trip (gives Meridian a real rating & response time)
INSERT OR IGNORE INTO requests (id, user_id, type, legs, pax, flex_days, cats, budget, needs, addons, notes, accepted_quote_id, trip_status, deposit_amount, deposit_status, created_at)
VALUES ('RQ-2600', 1, 'oneway', '[{"from":"TEB","to":"PBI","date":"2026-07-28","time":"09:30"}]', 6, 1, '["mid"]', '$15–30k', '["Pet on board"]', '["Catering"]', 'Small dog in cabin.', 1, 'completed', 0, 'waived_first', datetime('now','-10 days'));
INSERT OR IGNORE INTO quotes (id, request_id, operator_id, aircraft, price, message, empty_leg, valid_hours, created_at)
VALUES (1, 'RQ-2600', 3, 'N502QS|Citation Latitude', 24500, 'Pet-friendly cabin, catering included.', 0, 48, datetime('now','-10 days','+1 hour'));
INSERT OR IGNORE INTO reviews (request_id, quote_id, operator_org, client_id, stars, text, created_at)
VALUES ('RQ-2600', 1, 3, 1, 5, 'Flawless trip - crew was fantastic with our dog.', datetime('now','-8 days'));

-- Ava's live request with two competing (anonymous) quotes and a chat message
INSERT OR IGNORE INTO requests (id, user_id, type, legs, pax, flex_days, cats, budget, needs, addons, notes, deposit_amount, deposit_status, created_at)
VALUES ('RQ-2601', 1, 'oneway', '[{"from":"TEB","to":"ASE","date":"2026-08-21","time":"08:00"}]', 4, 0, '["light"]', '$15–30k', '[]', '["Ground transport"]', 'Ski trip - gear for four.', 150, 'held', datetime('now','-3 hours'));
INSERT OR IGNORE INTO quotes (id, request_id, operator_id, aircraft, price, message, empty_leg, valid_hours, created_at)
VALUES (2, 'RQ-2601', 3, 'N510JK|Citation Mustang', 13900, 'We can do an 8am wheels-up, gear fits fine.', 0, 48, datetime('now','-2 hours')),
       (3, 'RQ-2601', 5, 'xls', 15800, 'XLS has the baggage space for skis.', 0, 48, datetime('now','-1 hour'));
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
VALUES (3, 3, 'PBI', 'TEB', date('now','+12 days'), '14:00', 'N502QS|Citation Latitude', 9500, 'Repositioning after a charter - deep discount.', datetime('now','-4 hours'));
