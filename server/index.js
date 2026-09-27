require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const path = require('path');

const db = require('./db');
const { signToken, requireAuth } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- AUTH ----------

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM trainers WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const password_hash = bcrypt.hashSync(password, 10);
  const booking_token = nanoid(12);
  const info = db.prepare(
    'INSERT INTO trainers (name, email, password_hash, booking_token) VALUES (?, ?, ?, ?)'
  ).run(name, email.toLowerCase(), password_hash, booking_token);

  const trainer = { id: info.lastInsertRowid, name, email: email.toLowerCase() };
  res.json({ token: signToken(trainer), trainer });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const row = db.prepare('SELECT * FROM trainers WHERE email = ?').get(email.toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const trainer = { id: row.id, name: row.name, email: row.email };
  res.json({ token: signToken(trainer), trainer });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, name, email, booking_token FROM trainers WHERE id = ?').get(req.trainer.id);
  res.json({ trainer: row });
});

// ---------- CLIENTS ----------

app.get('/api/clients', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM clients WHERE trainer_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE'
  ).all(req.trainer.id);
  res.json(rows);
});

app.post('/api/clients', requireAuth, (req, res) => {
  const { name, phone, email, notes, default_rate } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare(
    'INSERT INTO clients (trainer_id, name, phone, email, notes, default_rate) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.trainer.id, name, phone || null, email || null, notes || null, default_rate || null);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  res.json(client);
});

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND trainer_id = ?').get(req.params.id, req.trainer.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const { name, phone, email, notes, default_rate } = req.body || {};
  db.prepare(
    'UPDATE clients SET name = ?, phone = ?, email = ?, notes = ?, default_rate = ? WHERE id = ?'
  ).run(
    name ?? client.name,
    phone ?? client.phone,
    email ?? client.email,
    notes ?? client.notes,
    default_rate ?? client.default_rate,
    client.id
  );
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id));
});

app.delete('/api/clients/:id', requireAuth, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND trainer_id = ?').get(req.params.id, req.trainer.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  db.prepare('UPDATE clients SET archived = 1 WHERE id = ?').run(client.id);
  res.json({ ok: true });
});

// ---------- PACKAGES ----------

app.get('/api/packages', requireAuth, (req, res) => {
  const { client_id } = req.query;
  let query = 'SELECT * FROM packages WHERE trainer_id = ? AND archived = 0';
  const params = [req.trainer.id];
  if (client_id) { query += ' AND client_id = ?'; params.push(client_id); }
  query += ' ORDER BY purchase_date DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/packages', requireAuth, (req, res) => {
  const { client_id, total_sessions, price, purchase_date, notes } = req.body || {};
  if (!client_id || !total_sessions || !purchase_date) {
    return res.status(400).json({ error: 'client_id, total_sessions, purchase_date required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND trainer_id = ?').get(client_id, req.trainer.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const info = db.prepare(
    `INSERT INTO packages (trainer_id, client_id, total_sessions, price, purchase_date, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(req.trainer.id, client_id, total_sessions, price || null, purchase_date, notes || null);
  res.json(db.prepare('SELECT * FROM packages WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/packages/:id', requireAuth, (req, res) => {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND trainer_id = ?').get(req.params.id, req.trainer.id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  const { total_sessions, price, purchase_date, notes } = req.body || {};
  db.prepare(
    'UPDATE packages SET total_sessions = ?, price = ?, purchase_date = ?, notes = ? WHERE id = ?'
  ).run(
    total_sessions ?? pkg.total_sessions,
    price ?? pkg.price,
    purchase_date ?? pkg.purchase_date,
    notes ?? pkg.notes,
    pkg.id
  );
  res.json(db.prepare('SELECT * FROM packages WHERE id = ?').get(pkg.id));
});

app.delete('/api/packages/:id', requireAuth, (req, res) => {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND trainer_id = ?').get(req.params.id, req.trainer.id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  const inUse = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE package_id = ?').get(pkg.id);
  if (inUse.count > 0) {
    db.prepare('UPDATE packages SET archived = 1 WHERE id = ?').run(pkg.id);
  } else {
    db.prepare('DELETE FROM packages WHERE id = ?').run(pkg.id);
  }
  res.json({ ok: true });
});

// ---------- SESSIONS ----------

app.get('/api/sessions', requireAuth, (req, res) => {
  const { from, to, client_id } = req.query;
  let query = `SELECT s.*, c.name as client_name FROM sessions s
               JOIN clients c ON c.id = s.client_id
               WHERE s.trainer_id = ?`;
  const params = [req.trainer.id];
  if (from) { query += ' AND s.session_date >= ?'; params.push(from); }
  if (to) { query += ' AND s.session_date <= ?'; params.push(to); }
  if (client_id) { query += ' AND s.client_id = ?'; params.push(client_id); }
  query += ' ORDER BY s.session_date DESC, s.start_time DESC';
  res.json(db.prepare(query).all(...params));
});

// A session only "consumes" a package slot while it is completed AND linked to a package.
function packageDelta(status, packageId) {
  return (status === 'completed' && packageId) ? 1 : 0;
}
function adjustPackageUsage(packageId, delta) {
  if (!packageId || !delta) return;
  db.prepare('UPDATE packages SET used_sessions = MAX(0, used_sessions + ?) WHERE id = ?').run(delta, packageId);
}

app.post('/api/sessions', requireAuth, (req, res) => {
  const { client_id, session_date, start_time, duration_minutes, location, status, rate, notes, package_id } = req.body || {};
  if (!client_id || !session_date) return res.status(400).json({ error: 'client_id and session_date required' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND trainer_id = ?').get(client_id, req.trainer.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (package_id) {
    const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND trainer_id = ? AND client_id = ?').get(package_id, req.trainer.id, client_id);
    if (!pkg) return res.status(404).json({ error: 'Package not found for this client' });
  }

  const finalStatus = status || 'completed';
  const info = db.prepare(
    `INSERT INTO sessions (trainer_id, client_id, session_date, start_time, duration_minutes, location, status, source, rate, notes, package_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`
  ).run(
    req.trainer.id, client_id, session_date, start_time || null,
    duration_minutes || 60, location || null, finalStatus,
    rate ?? client.default_rate ?? null, notes || null, package_id || null
  );
  adjustPackageUsage(package_id, packageDelta(finalStatus, package_id));
  res.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/sessions/:id', requireAuth, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND trainer_id = ?').get(req.params.id, req.trainer.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { session_date, start_time, duration_minutes, location, status, rate, notes, package_id } = req.body || {};

  const newStatus = status ?? session.status;
  const newPackageId = package_id !== undefined ? (package_id || null) : session.package_id;

  if (newPackageId) {
    const pkg = db.prepare('SELECT * FROM packages WHERE id = ? AND trainer_id = ?').get(newPackageId, req.trainer.id);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
  }

  // Reverse the old usage, apply the new usage, so edits (status or package change) stay accurate.
  adjustPackageUsage(session.package_id, -packageDelta(session.status, session.package_id));
  adjustPackageUsage(newPackageId, packageDelta(newStatus, newPackageId));

  db.prepare(
    `UPDATE sessions SET session_date = ?, start_time = ?, duration_minutes = ?, location = ?, status = ?, rate = ?, notes = ?, package_id = ? WHERE id = ?`
  ).run(
    session_date ?? session.session_date,
    start_time ?? session.start_time,
    duration_minutes ?? session.duration_minutes,
    location ?? session.location,
    newStatus,
    rate ?? session.rate,
    notes ?? session.notes,
    newPackageId,
    session.id
  );
  res.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id));
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND trainer_id = ?').get(req.params.id, req.trainer.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  adjustPackageUsage(session.package_id, -packageDelta(session.status, session.package_id));
  db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  res.json({ ok: true });
});

// ---------- TRANSACTIONS ----------

app.get('/api/transactions', requireAuth, (req, res) => {
  const { from, to, client_id } = req.query;
  let query = `SELECT t.*, c.name as client_name FROM transactions t
               JOIN clients c ON c.id = t.client_id
               WHERE t.trainer_id = ?`;
  const params = [req.trainer.id];
  if (from) { query += ' AND t.txn_date >= ?'; params.push(from); }
  if (to) { query += ' AND t.txn_date <= ?'; params.push(to); }
  if (client_id) { query += ' AND t.client_id = ?'; params.push(client_id); }
  query += ' ORDER BY t.txn_date DESC, t.id DESC';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/transactions', requireAuth, (req, res) => {
  const { client_id, session_id, amount, method, txn_date, note } = req.body || {};
  if (!client_id || amount == null || !txn_date) {
    return res.status(400).json({ error: 'client_id, amount, txn_date required' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ? AND trainer_id = ?').get(client_id, req.trainer.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const info = db.prepare(
    `INSERT INTO transactions (trainer_id, client_id, session_id, amount, method, txn_date, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(req.trainer.id, client_id, session_id || null, amount, method || 'cash', txn_date, note || null);
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const txn = db.prepare('SELECT * FROM transactions WHERE id = ? AND trainer_id = ?').get(req.params.id, req.trainer.id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  db.prepare('DELETE FROM transactions WHERE id = ?').run(txn.id);
  res.json({ ok: true });
});

// ---------- SUMMARY ----------

app.get('/api/summary', requireAuth, (req, res) => {
  const { from, to } = req.query;
  let sessQuery = `SELECT COUNT(*) as count FROM sessions WHERE trainer_id = ? AND status = 'completed'`;
  let txnQuery = `SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE trainer_id = ?`;
  const sParams = [req.trainer.id];
  const tParams = [req.trainer.id];
  if (from) { sessQuery += ' AND session_date >= ?'; sParams.push(from); txnQuery += ' AND txn_date >= ?'; tParams.push(from); }
  if (to) { sessQuery += ' AND session_date <= ?'; sParams.push(to); txnQuery += ' AND txn_date <= ?'; tParams.push(to); }

  const sessions = db.prepare(sessQuery).get(...sParams);
  const revenue = db.prepare(txnQuery).get(...tParams);
  res.json({ completedSessions: sessions.count, totalRevenue: revenue.total });
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => console.log(`Flexed tracker running on port ${PORT}`));
