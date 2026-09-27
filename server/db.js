const { Pool } = require('pg');

// Railway injects DATABASE_URL automatically when a Postgres service is
// attached to the project. Locally, set DATABASE_URL in .env.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL database to this project (or set it in .env locally).');
}

const pool = new Pool({
  connectionString,
  // Railway's internal Postgres connection doesn't need SSL; hosted/external
  // Postgres providers usually do. This covers both without extra config.
  ssl: connectionString && !connectionString.includes('railway.internal')
    ? { rejectUnauthorized: false }
    : false,
});

// Thin shim so the rest of the app can keep the familiar
// db.prepare(sql).get/all/run(...) shape used with better-sqlite3, but
// backed by async Postgres queries under the hood.
//
// - '?' placeholders are converted to Postgres's $1, $2, ... style.
// - INSERT statements automatically get `RETURNING id` appended (unless
//   already present) so `run()` can report `lastInsertRowid`.
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function prepare(sql) {
  const isInsert = /^\s*INSERT INTO/i.test(sql);
  let pgSql = toPgSql(sql.trim());
  if (isInsert && !/RETURNING/i.test(pgSql)) {
    pgSql += ' RETURNING id';
  }
  return {
    async get(...params) {
      const result = await pool.query(pgSql, params);
      return result.rows[0];
    },
    async all(...params) {
      const result = await pool.query(pgSql, params);
      return result.rows;
    },
    async run(...params) {
      const result = await pool.query(pgSql, params);
      return {
        lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined,
        changes: result.rowCount,
      };
    },
  };
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trainers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      booking_token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      trainer_id INTEGER NOT NULL REFERENCES trainers(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      default_rate REAL,
      archived INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,
      trainer_id INTEGER NOT NULL REFERENCES trainers(id),
      client_id INTEGER NOT NULL REFERENCES clients(id),
      total_sessions INTEGER NOT NULL,
      used_sessions INTEGER NOT NULL DEFAULT 0,
      price REAL,
      purchase_date TEXT NOT NULL,
      notes TEXT,
      archived INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      trainer_id INTEGER NOT NULL REFERENCES trainers(id),
      client_id INTEGER NOT NULL REFERENCES clients(id),
      session_date TEXT NOT NULL,
      start_time TEXT,
      duration_minutes INTEGER DEFAULT 60,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'booked',
      source TEXT NOT NULL DEFAULT 'manual',
      rate REAL,
      notes TEXT,
      package_id INTEGER REFERENCES packages(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      trainer_id INTEGER NOT NULL REFERENCES trainers(id),
      client_id INTEGER NOT NULL REFERENCES clients(id),
      session_id INTEGER REFERENCES sessions(id),
      amount REAL NOT NULL,
      method TEXT,
      txn_date TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_trainer_date ON sessions(trainer_id, session_date);
    CREATE INDEX IF NOT EXISTS idx_clients_trainer ON clients(trainer_id);
    CREATE INDEX IF NOT EXISTS idx_txn_trainer_date ON transactions(trainer_id, txn_date);
  `);
}

module.exports = { prepare, init, pool };
