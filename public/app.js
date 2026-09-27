const API = '';
let state = {
  token: localStorage.getItem('token') || null,
  trainer: JSON.parse(localStorage.getItem('trainer') || 'null'),
  tab: 'home',
  clients: [],
  sessions: [],
  transactions: [],
  packages: [],
  summary: { completedSessions: 0, totalRevenue: 0 },
  calDate: new Date(),
  selectedDay: null,
  expandedClientId: null,
  sheet: null, // { type: 'session'|'client'|'transaction'|'package', data }
  authMode: 'login',
  authError: '',
  loading: false,
};

const $app = document.getElementById('app');

function fmtMoney(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
}
function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  let body;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) {
    if (res.status === 401) doLogout();
    throw new Error((body && body.error) || 'Request failed');
  }
  return body;
}

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

// ---------- Data loading ----------

async function loadAll() {
  setState({ loading: true });
  try {
    const [clients, sessions, transactions, packages, summary] = await Promise.all([
      api('/api/clients'),
      api('/api/sessions'),
      api('/api/transactions'),
      api('/api/packages'),
      api('/api/summary'),
    ]);
    setState({ clients, sessions, transactions, packages, summary, loading: false });
  } catch (e) {
    setState({ loading: false });
  }
}

// ---------- Client stats: remaining sessions + weekly frequency ----------

function clientPackages(clientId) {
  return state.packages.filter(p => p.client_id === clientId);
}

function clientRemainingSessions(clientId) {
  const pkgs = clientPackages(clientId);
  if (!pkgs.length) return null;
  return pkgs.reduce((sum, p) => sum + Math.max(0, p.total_sessions - p.used_sessions), 0);
}

function clientFrequency(clientId) {
  const completed = state.sessions
    .filter(s => s.client_id === clientId && s.status === 'completed')
    .sort((a, b) => a.session_date.localeCompare(b.session_date));
  if (!completed.length) return null;
  const first = new Date(completed[0].session_date + 'T00:00:00');
  const now = new Date();
  const days = Math.max(1, (now - first) / (1000 * 60 * 60 * 24));
  const weeks = Math.max(1, days / 7);
  return completed.length / weeks;
}

async function refreshSummary() {
  const summary = await api('/api/summary').catch(() => state.summary);
  setState({ summary });
}

// ---------- Auth ----------

function doLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('trainer');
  state.token = null;
  state.trainer = null;
  render();
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  const password = form.password.value;
  const name = form.name ? form.name.value.trim() : '';

  try {
    setState({ authError: '' });
    const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = state.authMode === 'login' ? { email, password } : { name, email, password };
    const data = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem('token', data.token);
    localStorage.setItem('trainer', JSON.stringify(data.trainer));
    state.token = data.token;
    state.trainer = data.trainer;
    render();
    loadAll();
  } catch (err) {
    setState({ authError: err.message });
  }
}

// ---------- Render: Auth screen ----------

function renderAuth() {
  const isLogin = state.authMode === 'login';
  $app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <h1>Session Tracker</h1>
        <p class="tagline">${isLogin ? 'Log in to your account' : 'Create your trainer account'}</p>
        <form id="auth-form">
          ${!isLogin ? `
          <div class="field">
            <label>Your name</label>
            <input name="name" type="text" required autocomplete="name" />
          </div>` : ''}
          <div class="field">
            <label>Email</label>
            <input name="email" type="email" required autocomplete="email" />
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="password" required autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="6" />
          </div>
          ${state.authError ? `<div class="error-msg">${escapeHtml(state.authError)}</div>` : ''}
          <button class="btn btn-primary btn-block" type="submit">${isLogin ? 'Log In' : 'Create Account'}</button>
        </form>
        <div class="switch-row">
          ${isLogin ? "Don't have an account?" : 'Already have an account?'}
          <button class="link-btn" id="switch-auth">${isLogin ? 'Sign up' : 'Log in'}</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
  document.getElementById('switch-auth').addEventListener('click', () => {
    setState({ authMode: isLogin ? 'register' : 'login', authError: '' });
  });
}

// ---------- Render: shell ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  if (!state.token) return renderAuth();

  const tabs = [
    { id: 'home', icon: '🏠', label: 'Home' },
    { id: 'calendar', icon: '📅', label: 'Calendar' },
    { id: 'clients', icon: '👥', label: 'Clients' },
    { id: 'transactions', icon: '💵', label: 'Payments' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  $app.innerHTML = `
    <div class="topbar">
      <div>
        <h1>${tabTitle(state.tab)}</h1>
      </div>
      <div class="sub">${escapeHtml(state.trainer?.name || '')}</div>
    </div>
    <div class="content" id="content"></div>
    ${state.tab !== 'settings' ? `<button class="fab" id="fab">+</button>` : ''}
    <div class="tabbar">
      ${tabs.map(t => `
        <button class="tab ${state.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
          <span class="icon">${t.icon}</span>
          <span>${t.label}</span>
        </button>`).join('')}
    </div>
    ${state.sheet ? renderSheet() : ''}
  `;

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => setState({ tab: btn.dataset.tab, selectedDay: null }));
  });
  const fab = document.getElementById('fab');
  if (fab) fab.addEventListener('click', () => openFabAction());

  renderContent();
  if (state.sheet) bindSheetEvents();
}

function tabTitle(tab) {
  return {
    home: 'Overview',
    calendar: 'Calendar',
    clients: 'Clients',
    transactions: 'Payments',
    settings: 'Settings',
  }[tab] || '';
}

function openFabAction() {
  if (state.tab === 'clients') setState({ sheet: { type: 'client', data: {} } });
  else if (state.tab === 'transactions') setState({ sheet: { type: 'transaction', data: {} } });
  else setState({ sheet: { type: 'session', data: { session_date: state.selectedDay || todayISO() } } });
}

// ---------- Content renderers ----------

function renderContent() {
  const el = document.getElementById('content');
  if (state.loading) { el.innerHTML = `<div class="empty-state">Loading…</div>`; return; }

  if (state.tab === 'home') el.innerHTML = renderHome();
  else if (state.tab === 'calendar') el.innerHTML = renderCalendar();
  else if (state.tab === 'clients') el.innerHTML = renderClients();
  else if (state.tab === 'transactions') el.innerHTML = renderTransactions();
  else if (state.tab === 'settings') el.innerHTML = renderSettings();

  bindContentEvents();
}

function renderHome() {
  const upcoming = state.sessions
    .filter(s => s.status === 'booked' && s.session_date >= todayISO())
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .slice(0, 6);
  const recent = state.sessions.slice(0, 6);

  return `
    <div class="summary-row">
      <div class="summary-card">
        <div class="num">${state.summary.completedSessions}</div>
        <div class="label">Completed sessions</div>
      </div>
      <div class="summary-card">
        <div class="num">${fmtMoney(state.summary.totalRevenue)}</div>
        <div class="label">Total collected</div>
      </div>
    </div>

    <div class="section-title">Upcoming</div>
    ${upcoming.length ? `<div class="card-list">${upcoming.map(sessionCard).join('')}</div>` : `<div class="empty-state">No upcoming sessions booked. Tap + to add one.</div>`}

    <div class="section-title">Recent activity</div>
    ${recent.length ? `<div class="card-list">${recent.map(sessionCard).join('')}</div>` : `<div class="empty-state">No sessions logged yet.</div>`}
  `;
}

function sessionCard(s) {
  return `
    <div class="card" data-session-id="${s.id}">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(s.client_name)}</div>
          <div class="card-sub">${fmtDate(s.session_date)}${s.start_time ? ' · ' + s.start_time : ''}${s.location ? ' · ' + escapeHtml(s.location) : ''}</div>
          <span class="pill pill-${s.status}">${s.status.replace('_', ' ')}</span>
        </div>
        <div class="card-amount">${s.rate ? fmtMoney(s.rate) : ''}</div>
      </div>
    </div>
  `;
}

function renderClients() {
  if (!state.clients.length) return `<div class="empty-state">No clients yet. Tap + to add your first client.</div>`;
  return `<div class="card-list">
    ${state.clients.map(c => {
      const totalSessions = state.sessions.filter(s => s.client_id === c.id && s.status === 'completed').length;
      const remaining = clientRemainingSessions(c.id);
      const freq = clientFrequency(c.id);
      const isOpen = state.expandedClientId === c.id;
      const pkgs = clientPackages(c.id);

      return `
      <div class="card">
        <div class="card-row" data-client-toggle="${c.id}">
          <div>
            <div class="card-title">${escapeHtml(c.name)}</div>
            <div class="card-sub">${totalSessions} completed${c.phone ? ' · ' + escapeHtml(c.phone) : ''}</div>
            <div class="stat-row">
              ${remaining !== null ? `<span class="stat-chip">${remaining} left</span>` : ''}
              ${freq !== null ? `<span class="stat-chip">${freq.toFixed(1)}x/week</span>` : ''}
            </div>
          </div>
          <div class="card-amount">${c.default_rate ? fmtMoney(c.default_rate) : ''}</div>
        </div>
        ${isOpen ? `
        <div class="client-expand">
          <div class="expand-row">
            <button class="link-btn" data-edit-client="${c.id}">Edit client</button>
            <button class="link-btn" data-add-package="${c.id}">+ Add package</button>
          </div>
          ${pkgs.length ? `
          <div class="pkg-list">
            ${pkgs.map(p => `
              <div class="pkg-row" data-package-id="${p.id}">
                <span>${fmtDate(p.purchase_date)} · ${p.total_sessions} sessions${p.price ? ' · ' + fmtMoney(p.price) : ''}</span>
                <span class="pkg-remaining">${Math.max(0, p.total_sessions - p.used_sessions)} left</span>
              </div>
            `).join('')}
          </div>` : `<div class="empty-state" style="padding:12px 0;">No packages yet.</div>`}
        </div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function renderTransactions() {
  if (!state.transactions.length) return `<div class="empty-state">No payments logged yet. Tap + to add one.</div>`;
  return `<div class="card-list">
    ${state.transactions.map(t => `
      <div class="card" data-txn-id="${t.id}">
        <div class="card-row">
          <div>
            <div class="card-title">${escapeHtml(t.client_name)}</div>
            <div class="card-sub">${fmtDate(t.txn_date)} · ${(t.method || '').toUpperCase()}</div>
          </div>
          <div class="card-amount">${fmtMoney(t.amount)}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

function renderSettings() {
  const bookingUrl = `${location.origin}/book/${state.trainer?.booking_token || ''}`;
  return `
    <div class="section-title">Account</div>
    <div class="card">
      <div class="card-title">${escapeHtml(state.trainer?.name || '')}</div>
      <div class="card-sub">${escapeHtml(state.trainer?.email || '')}</div>
    </div>

    <div class="section-title">Your booking link</div>
    <p style="color:var(--muted);font-size:13px;margin-top:-4px;">Share this with clients so they can request a session. (Coming soon — booking requests will appear right in your calendar.)</p>
    <div class="copy-row">${bookingUrl}</div>

    <button class="btn btn-danger btn-block" id="logout-btn" style="margin-top:24px;">Log Out</button>
  `;
}

// ---------- Calendar ----------

function renderCalendar() {
  const d = state.calDate;
  const year = d.getFullYear(), month = d.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const sessionsByDate = {};
  state.sessions.forEach(s => {
    (sessionsByDate[s.session_date] = sessionsByDate[s.session_date] || []).push(s);
  });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(`<div class="cal-cell muted"></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
    const isToday = iso === todayISO();
    const isSelected = iso === state.selectedDay;
    const has = sessionsByDate[iso] && sessionsByDate[iso].length;
    cells.push(`
      <button class="cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-day="${iso}">
        <span>${day}</span>
        ${has ? '<span class="cal-dot"></span>' : ''}
      </button>
    `);
  }

  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const selected = state.selectedDay;
  const daySessions = selected ? (sessionsByDate[selected] || []) : [];

  return `
    <div class="cal-header">
      <button class="cal-nav-btn" id="cal-prev">‹</button>
      <div class="month-label">${monthLabel}</div>
      <button class="cal-nav-btn" id="cal-next">›</button>
    </div>
    <div class="cal-grid">
      ${dow.map(x => `<div class="cal-dow">${x}</div>`).join('')}
      ${cells.join('')}
    </div>
    ${selected ? `
    <div class="day-detail">
      <div class="section-title">${fmtDate(selected)}</div>
      ${daySessions.length ? `<div class="card-list">${daySessions.map(sessionCard).join('')}</div>` : `<div class="empty-state">No sessions this day.</div>`}
    </div>` : ''}
  `;
}

// ---------- Sheets (modals) ----------

function renderSheet() {
  const { type, data } = state.sheet;
  let title = '', body = '';

  if (type === 'client') {
    title = data.id ? 'Edit Client' : 'New Client';
    body = `
      <div class="field"><label>Name</label><input name="name" required value="${escapeHtml(data.name || '')}" /></div>
      <div class="field"><label>Phone (optional)</label><input name="phone" value="${escapeHtml(data.phone || '')}" /></div>
      <div class="field"><label>Email (optional)</label><input name="email" value="${escapeHtml(data.email || '')}" /></div>
      <div class="field"><label>Default rate (₱)</label><input name="default_rate" type="number" value="${data.default_rate || ''}" /></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(data.notes || '')}</textarea></div>
    `;
  } else if (type === 'session') {
    title = data.id ? 'Edit Session' : 'Log Session';
    const pkgsForClient = data.client_id ? clientPackages(Number(data.client_id)) : [];
    body = `
      <div class="field"><label>Client</label>
        <select name="client_id" id="session-client-select" required>
          <option value="">Select client…</option>
          ${state.clients.map(c => `<option value="${c.id}" ${data.client_id == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Date</label><input name="session_date" type="date" required value="${data.session_date || todayISO()}" /></div>
      <div class="field"><label>Time (optional)</label><input name="start_time" type="time" value="${data.start_time || ''}" /></div>
      <div class="field"><label>Status</label>
        <select name="status">
          <option value="completed" ${data.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="booked" ${(!data.status || data.status === 'booked') ? 'selected' : ''}>Booked / Upcoming</option>
          <option value="cancelled" ${data.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          <option value="no_show" ${data.status === 'no_show' ? 'selected' : ''}>No-show</option>
        </select>
      </div>
      <div class="field" id="session-package-field">
        <label>Deduct from package (optional)</label>
        <select name="package_id" id="session-package-select">
          <option value="">None — pay per session</option>
          ${pkgsForClient.map(p => `<option value="${p.id}" ${data.package_id == p.id ? 'selected' : ''}>${fmtDate(p.purchase_date)} · ${Math.max(0, p.total_sessions - p.used_sessions)} left</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Rate (₱)</label><input name="rate" type="number" value="${data.rate || ''}" /></div>
      <div class="field"><label>Location (optional)</label><input name="location" value="${escapeHtml(data.location || '')}" /></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(data.notes || '')}</textarea></div>
    `;
  } else if (type === 'package') {
    title = data.id ? 'Edit Package' : 'Add Package';
    const size = data.total_sessions;
    body = `
      <input type="hidden" name="client_id" value="${data.client_id}" />
      <div class="field"><label>Client</label><input value="${escapeHtml((state.clients.find(c => c.id === data.client_id) || {}).name || '')}" disabled /></div>
      <div class="field">
        <label>Package size</label>
        <div class="size-toggle">
          <button type="button" class="size-btn ${size == 6 ? 'active' : ''}" data-size="6">6 sessions</button>
          <button type="button" class="size-btn ${size == 12 ? 'active' : ''}" data-size="12">12 sessions</button>
          <button type="button" class="size-btn ${size && size != 6 && size != 12 ? 'active' : ''}" data-size="custom">Custom</button>
        </div>
        <input name="total_sessions" id="total-sessions-input" type="number" required
          value="${size || ''}"
          style="margin-top:8px; ${size == 6 || size == 12 ? 'display:none;' : ''}"
          placeholder="Number of sessions" />
      </div>
      <div class="field"><label>Price (₱, optional)</label><input name="price" type="number" value="${data.price || ''}" /></div>
      <div class="field"><label>Purchase date</label><input name="purchase_date" type="date" required value="${data.purchase_date || todayISO()}" /></div>
      <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(data.notes || '')}</textarea></div>
    `;
  } else if (type === 'transaction') {
    title = 'Log Payment';
    body = `
      <div class="field"><label>Client</label>
        <select name="client_id" required>
          <option value="">Select client…</option>
          ${state.clients.map(c => `<option value="${c.id}" ${data.client_id == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Amount (₱)</label><input name="amount" type="number" required value="${data.amount || ''}" /></div>
      <div class="field"><label>Date</label><input name="txn_date" type="date" required value="${data.txn_date || todayISO()}" /></div>
      <div class="field"><label>Method</label>
        <select name="method">
          <option value="cash">Cash</option>
          <option value="gcash">GCash</option>
          <option value="bank">Bank transfer</option>
          <option value="card">Card</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="field"><label>Note</label><textarea name="note">${escapeHtml(data.note || '')}</textarea></div>
    `;
  }

  return `
    <div class="sheet-backdrop" id="sheet-backdrop">
      <div class="sheet" id="sheet-inner">
        <div class="sheet-handle"></div>
        <h2>${title}</h2>
        <form id="sheet-form">
          ${body}
          <div class="sheet-actions">
            ${data.id ? `<button type="button" class="btn btn-danger" id="sheet-delete">Delete</button>` : ''}
            <button type="button" class="btn btn-secondary" id="sheet-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function closeSheet() { setState({ sheet: null }); }

function bindSheetEvents() {
  const backdrop = document.getElementById('sheet-backdrop');
  const inner = document.getElementById('sheet-inner');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSheet(); });
  inner.addEventListener('click', (e) => e.stopPropagation());

  document.getElementById('sheet-cancel').addEventListener('click', closeSheet);

  const delBtn = document.getElementById('sheet-delete');
  if (delBtn) delBtn.addEventListener('click', () => handleSheetDelete());

  document.getElementById('sheet-form').addEventListener('submit', handleSheetSubmit);

  document.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const input = document.getElementById('total-sessions-input');
      if (btn.dataset.size === 'custom') {
        input.style.display = '';
        input.value = '';
        input.focus();
      } else {
        input.style.display = 'none';
        input.value = btn.dataset.size;
      }
    });
  });

  const clientSelect = document.getElementById('session-client-select');
  if (clientSelect) {
    clientSelect.addEventListener('change', (e) => {
      const form = document.getElementById('sheet-form');
      const fd = new FormData(form);
      const updated = Object.fromEntries(fd.entries());
      updated.client_id = e.target.value;
      updated.package_id = '';
      setState({ sheet: { type: 'session', data: { ...state.sheet.data, ...updated } } });
    });
  }
}

async function handleSheetSubmit(e) {
  e.preventDefault();
  const { type, data } = state.sheet;
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());

  try {
    if (type === 'client') {
      if (data.id) await api(`/api/clients/${data.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
    } else if (type === 'session') {
      if (data.id) await api(`/api/sessions/${data.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/sessions', { method: 'POST', body: JSON.stringify(payload) });
    } else if (type === 'transaction') {
      await api('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
    } else if (type === 'package') {
      if (data.id) await api(`/api/packages/${data.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/packages', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeSheet();
    await loadAll();
  } catch (err) {
    alert(err.message);
  }
}

async function handleSheetDelete() {
  const { type, data } = state.sheet;
  if (!confirm('Are you sure?')) return;
  try {
    if (type === 'client') await api(`/api/clients/${data.id}`, { method: 'DELETE' });
    else if (type === 'session') await api(`/api/sessions/${data.id}`, { method: 'DELETE' });
    else if (type === 'transaction') await api(`/api/transactions/${data.id}`, { method: 'DELETE' });
    else if (type === 'package') await api(`/api/packages/${data.id}`, { method: 'DELETE' });
    closeSheet();
    await loadAll();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Content event bindings ----------

function bindContentEvents() {
  document.querySelectorAll('[data-session-id]').forEach(el => {
    el.addEventListener('click', () => {
      const s = state.sessions.find(x => x.id == el.dataset.sessionId);
      if (s) setState({ sheet: { type: 'session', data: { ...s } } });
    });
  });
  document.querySelectorAll('[data-client-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.clientToggle);
      setState({ expandedClientId: state.expandedClientId === id ? null : id });
    });
  });
  document.querySelectorAll('[data-edit-client]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = state.clients.find(x => x.id == el.dataset.editClient);
      if (c) setState({ sheet: { type: 'client', data: { ...c } } });
    });
  });
  document.querySelectorAll('[data-add-package]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const clientId = Number(el.dataset.addPackage);
      setState({ sheet: { type: 'package', data: { client_id: clientId } } });
    });
  });
  document.querySelectorAll('[data-package-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = state.packages.find(x => x.id == el.dataset.packageId);
      if (p) setState({ sheet: { type: 'package', data: { ...p } } });
    });
  });
  document.querySelectorAll('[data-txn-id]').forEach(el => {
    el.addEventListener('click', () => {
      const t = state.transactions.find(x => x.id == el.dataset.txnId);
      if (t) setState({ sheet: { type: 'transaction', data: { ...t } } });
    });
  });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

  const prev = document.getElementById('cal-prev');
  const next = document.getElementById('cal-next');
  if (prev) prev.addEventListener('click', () => {
    const d = new Date(state.calDate);
    d.setMonth(d.getMonth() - 1);
    setState({ calDate: d });
  });
  if (next) next.addEventListener('click', () => {
    const d = new Date(state.calDate);
    d.setMonth(d.getMonth() + 1);
    setState({ calDate: d });
  });
  document.querySelectorAll('[data-day]').forEach(el => {
    el.addEventListener('click', () => {
      const day = el.dataset.day;
      setState({ selectedDay: state.selectedDay === day ? null : day });
    });
  });
}

// ---------- Init ----------

render();
if (state.token) loadAll();

// Register service worker for installability (optional, best-effort)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
