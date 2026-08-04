-- Slipstream D1 schema
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client', 'operator')),
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  prefs TEXT NOT NULL DEFAULT '{}',
  plan TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'pro' (operators) | 'plus' (clients); demo billing
  org_id INTEGER,                     -- operators: the team's admin user id (self for admins)
  org_role TEXT,                      -- operators: 'admin' | 'member'
  session_epoch INTEGER NOT NULL DEFAULT 0,  -- bump to invalidate all sessions (password change)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-use codes an operator admin hands out so teammates can join the org.
CREATE TABLE IF NOT EXISTS org_invites (
  code TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_by INTEGER,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,                -- 'RQ-2494'
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('oneway', 'round', 'multi')),
  legs TEXT NOT NULL,                 -- JSON: [{from,to,date,time}]
  pax INTEGER NOT NULL,
  flex_days INTEGER NOT NULL DEFAULT 0,
  cats TEXT NOT NULL DEFAULT '[]',    -- JSON array of category ids
  budget TEXT,
  needs TEXT NOT NULL DEFAULT '[]',   -- JSON array
  addons TEXT NOT NULL DEFAULT '[]',  -- JSON array
  notes TEXT NOT NULL DEFAULT '',
  accepted_quote_id INTEGER,
  trip_status TEXT,                   -- accepted | confirmed | completed | cancelled (once a quote is accepted)
  deposit_amount INTEGER NOT NULL DEFAULT 0,  -- demo: refundable posting deposit, tiered by category
  deposit_status TEXT,                -- held | kept (on accept) | refunded | waived_first | waived_plus
  closed_at TEXT,                     -- client closed ("none of these work") or auto-expired with no quotes
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES requests(id),
  operator_id INTEGER NOT NULL REFERENCES users(id),
  aircraft TEXT NOT NULL,             -- fleet id: p300 | xls | c350 | g450
  price INTEGER NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  empty_leg INTEGER NOT NULL DEFAULT 0,
  valid_hours INTEGER NOT NULL DEFAULT 48,
  contract_type TEXT,              -- 'file' (stored in KV) | 'link' (e.g. DocuSign)
  contract_name TEXT,
  contract_url TEXT,
  contract_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (request_id, operator_id)
);

-- Operator company profile: FAA Part 135 certificate + D085 doc (bytes in KV
-- under d085:<user_id>) + fleet with per-tail FAA registry verification.
CREATE TABLE IF NOT EXISTS operator_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  company TEXT NOT NULL DEFAULT '',
  cert_number TEXT NOT NULL DEFAULT '',   -- FAA air carrier certificate number
  base_iata TEXT NOT NULL DEFAULT '',
  safety_program TEXT,                    -- ARGUS/Wyvern/IS-BAO rating (self-declared)
  cert_doc_name TEXT,                     -- uploaded air carrier certificate (KV cert:<org>)
  cert_doc_at TEXT,
  d085_name TEXT,
  d085_at TEXT,
  checked_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS fleet_aircraft (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id INTEGER NOT NULL REFERENCES users(id),
  tail TEXT NOT NULL,                     -- N-number
  model_claim TEXT NOT NULL DEFAULT '',   -- operator's marketing name, e.g. "Challenger 350"
  faa_mfr TEXT,                           -- from FAA registry
  faa_model TEXT,                         -- FAA type designator, e.g. "BD-100-1A10"
  faa_reg_status TEXT,                    -- registry Status field, e.g. "Valid"
  faa_status TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | found | mismatch | not_found
  checked_at TEXT,
  photo_at TEXT,                          -- aircraft photo uploaded (bytes in KV acphoto:<id>)
  UNIQUE(operator_id, tail)
);

-- Empty-leg board: repositioning flights operators list at a discount.
CREATE TABLE IF NOT EXISTS empty_legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_org INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  aircraft TEXT NOT NULL,             -- 'TAIL|Model' (fleet) or catalog id
  seats INTEGER,
  price INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',  -- open | removed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Post-trip reviews: one per request, left by the traveler after accepting a
-- quote. Aggregated per operator org for the ratings on quote cards.
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  quote_id INTEGER NOT NULL,
  operator_org INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fixed-window auth rate limiting (8/min per key); rows self-clean.
CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL
);

-- Per-user read cursor for each quote conversation (drives unread badges).
CREATE TABLE IF NOT EXISTS chat_reads (
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (quote_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_request ON quotes(request_id);
CREATE INDEX IF NOT EXISTS idx_quotes_operator ON quotes(operator_id);
CREATE INDEX IF NOT EXISTS idx_messages_quote ON messages(quote_id);
