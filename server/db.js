const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH lets us point at a persistent volume in production (e.g. Railway).
// Falls back to a local file for development.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS trainers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  booking_token TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  default_rate REAL,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  session_date TEXT NOT NULL,
  start_time TEXT,
  duration_minutes INTEGER DEFAULT 60,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'booked', -- booked | completed | cancelled | no_show
  source TEXT NOT NULL DEFAULT 'manual', -- manual | client_booking
  rate REAL,
  notes TEXT,
  package_id INTEGER REFERENCES packages(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  total_sessions INTEGER NOT NULL,
  used_sessions INTEGER NOT NULL DEFAULT 0,
  price REAL,
  purchase_date TEXT NOT NULL,
  notes TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id INTEGER NOT NULL REFERENCES trainers(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  session_id INTEGER REFERENCES sessions(id),
  amount REAL NOT NULL,
  method TEXT, -- cash | gcash | bank | card | other
  txn_date TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_trainer_date ON sessions(trainer_id, session_date);
CREATE INDEX IF NOT EXISTS idx_clients_trainer ON clients(trainer_id);
CREATE INDEX IF NOT EXISTS idx_txn_trainer_date ON transactions(trainer_id, txn_date);
`);

module.exports = db;
