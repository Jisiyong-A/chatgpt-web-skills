/**
 * SQLite schema (spec §43). Node's built-in node:sqlite (DatabaseSync).
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  hermes_session_id TEXT PRIMARY KEY,
  web_thread_id TEXT NOT NULL DEFAULT '',
  web_thread_url TEXT NOT NULL DEFAULT '',
  history_hash TEXT NOT NULL DEFAULT '',
  prev_history TEXT NOT NULL DEFAULT '',
  generation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL UNIQUE,
  hermes_session_id TEXT NOT NULL DEFAULT '',
  web_thread_id TEXT NOT NULL DEFAULT '',
  prompt_hash TEXT NOT NULL DEFAULT '',
  prompt_text TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  response_hash TEXT NOT NULL DEFAULT '',
  response_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_state ON requests(state);
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(hermes_session_id);
CREATE INDEX IF NOT EXISTS idx_requests_unfinished ON requests(state, created_at);

CREATE TABLE IF NOT EXISTS ui_rules (
  rule_id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  ui_fingerprint TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ui_fingerprints (
  fingerprint_id TEXT PRIMARY KEY,
  fingerprint_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS healing_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
`;
