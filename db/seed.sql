-- Demo marketplace data so a new operator sees an active bid desk.
-- Demo accounts have hash 'x' (not a valid PBKDF2 digest) so they can never log in.
INSERT OR IGNORE INTO users (id, email, name, role, salt, hash) VALUES
  (1, 'demo-ava@slipstream.demo',    'Ava Winters',    'client', 'x', 'x'),
  (2, 'demo-luc@slipstream.demo',    'Luc Moreau',     'client', 'x', 'x'),
  (3, 'demo-omar@slipstream.demo',   'Omar Haddad',    'client', 'x', 'x'),
  (4, 'demo-priya@slipstream.demo',  'Priya Nair',     'client', 'x', 'x');

INSERT OR IGNORE INTO requests (id, user_id, type, legs, pax, flex_days, cats, budget, needs, addons, notes, created_at) VALUES
  ('RQ-2493', 1, 'oneway',
   '[{"from":"VNY","to":"ASE","date":"2026-08-14","time":"08:00"}]',
   4, 0, '["smid"]', '$30–60k', '[]', '["Ground transport"]',
   'Ski gear for four — need ample baggage space.',
   datetime('now', '-2 hours')),
  ('RQ-2492', 2, 'round',
   '[{"from":"LBG","to":"IBZ","date":"2026-08-21","time":"11:00"},{"from":"IBZ","to":"LBG","date":"2026-08-24","time":"18:00"}]',
   8, 1, '["heavy"]', 'Flexible', '[]', '["Catering"]', '',
   datetime('now', '-5 hours')),
  ('RQ-2490', 3, 'oneway',
   '[{"from":"DXB","to":"GVA","date":"2026-09-02","time":"07:30"}]',
   10, 0, '["ulr"]', '$60k+', '["Medical equipment"]', '[]',
   'One passenger travels with portable oxygen concentrator.',
   datetime('now', '-1 day')),
  ('RQ-2488', 4, 'multi',
   '[{"from":"HPN","to":"NAS","date":"2026-09-05","time":"10:00"},{"from":"NAS","to":"OPF","date":"2026-09-08","time":"14:00"}]',
   5, 2, '["mid"]', '$15–30k', '[]', '[]', '',
   datetime('now', '-20 minutes'));
