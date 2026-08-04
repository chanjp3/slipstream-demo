INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (1, 'ava@demo.slipstream', 'Ava Sinclair', 'client', '6f2e3b1ad9e70c8dcd4ddb7c70968f5d', '99ea5fd6adbba24dc6c855bacb3a527e9f71e8fc886254c64b71a40449ad438b', 'free', NULL, NULL);
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (2, 'ben@demo.slipstream', 'Ben Okafor', 'client', 'b8f014b61b55b60620627c3a277d82fa', 'a7d8e1e029ea57512cea94a6a8b70d885fdc01d43ea7ef290fcf37b4d05171f4', 'plus', NULL, NULL);
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (3, 'meridian@demo.slipstream', 'Meridian Charter Ops', 'operator', '05d8e3f3085a628054417fad61889d97', '6c040aa5af8a6228da968299ca382a6bba2da02084d50bd757f35442b904758a', 'pro', 3, 'admin');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (4, 'dana@demo.slipstream', 'Dana Reyes', 'operator', '99fd754575124a264c04cd1a4a93332b', 'fca0bea9cec7e94a496d058a9b52c4edfe7c3ecca024455742b2c319699fc857', 'free', 3, 'member');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan, org_id, org_role) VALUES (5, 'bluewing@demo.slipstream', 'Bluewing Charters', 'operator', 'ec721d0eaa5bb5d2bd6729f04ccfd773', '155a863eddee5c4cf31ac262f0003b01ef73636cba92c0c7c70d21a4900ea021', 'free', 5, 'admin');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (6, 'mkt-priya@demo.slipstream', 'Priya Nair', 'client', 'x', 'x', 'free');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (7, 'mkt-luc@demo.slipstream', 'Luc Moreau', 'client', 'x', 'x', 'free');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (8, 'mkt-omar@demo.slipstream', 'Omar Haddad', 'client', 'x', 'x', 'free');
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash, plan) VALUES (9, 'mkt-elena@demo.slipstream', 'Elena Vasquez', 'client', 'x', 'x', 'free');

-- Meridian: fully verified operator org (badge: FAA-checked fleet)
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, base_iata, safety_program, d085_name, d085_at, checked_at, updated_at)
VALUES (3, 'Meridian Jet Group', 'MJGA085K', 'TEB', 'ARGUS Platinum', 'meridian-d085.pdf', datetime('now'), datetime('now'), datetime('now'));
INSERT OR IGNORE INTO fleet_aircraft (id, operator_id, tail, model_claim, faa_mfr, faa_model, faa_reg_status, faa_status, checked_at)
VALUES (1, 3, 'N502QS', 'Citation Latitude', 'TEXTRON AVIATION INC', '680A', 'Valid', 'verified', datetime('now')),
       (2, 3, 'N510JK', 'Citation Mustang', 'CESSNA', '510', 'Valid', 'verified', datetime('now'));

-- Bluewing: cert + fleet verified, D085 still pending
INSERT OR IGNORE INTO operator_profiles (user_id, company, cert_number, base_iata, safety_program, checked_at, updated_at)
VALUES (5, 'Bluewing Charters', 'BLWA221K', 'PBI', 'Wyvern Wingman', datetime('now'), datetime('now'));
INSERT OR IGNORE INTO fleet_aircraft (id, operator_id, tail, model_claim, faa_mfr, faa_model, faa_reg_status, faa_status, checked_at)
VALUES (3, 5, 'N1KE', 'Gulfstream G650', 'GULFSTREAM AEROSPACE CORP', 'GVI', 'Valid', 'verified', datetime('now'));

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
