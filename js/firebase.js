// Firebase Realtime Database via REST (fetch)
// databaseURL must be set to your RTDB instance
const firebaseConfig = {
  databaseURL: 'https://sport-stat-tournament-tracker-default-rtdb.europe-west1.firebasedatabase.app',
};

let authToken = null; // Firebase ID token
export function setAuthToken(token) { authToken = token || null; }

export async function loadConfig() {
  // Load static config.json
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('config load failed');
    return await res.json();
  } catch (e) {
    console.warn('Failed to load config.json', e);
    return { sports: {}, attributes: {}, stats: {} };
  }
}

function dbUrl(path) {
  const base = firebaseConfig.databaseURL?.replace(/\/$/, '') || '';
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${p}.json`);
  if (authToken) url.searchParams.set('auth', authToken);
  return url.toString();
}

// Basic CRUD via REST
export async function writeData(path, data) {
  const res = await fetch(dbUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`write failed ${res.status}`);
  return res.json();
}

export async function updateData(path, data) {
  const res = await fetch(dbUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`update failed ${res.status}`);
  return res.json();
}

export async function readData(path, { auth } = {}) {
  // Optional override token for single read
  let url = dbUrl(path);
  if (auth) {
    const u = new URL(url);
    u.searchParams.set('auth', auth);
    url = u.toString();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`read failed ${res.status}`);
  return res.json();
}

export async function pushData(path, data) {
  const res = await fetch(dbUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`push failed ${res.status}`);
  return res.json(); // { name: "-Nxyz..." }
}

export async function deleteData(path) {
  const res = await fetch(dbUrl(path), { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete failed ${res.status}`);
  return res.json();
}

// Polling fallback for onValueChange; for production, consider EventSource or SDK.
export function onValueChange(path, cb, intervalMs = 5000) {
  let timer = null;
  let stopped = false;
  async function poll() {
    if (stopped) return;
    try { const data = await readData(path); cb(data); } catch (e) { /* noop */ }
    timer = setTimeout(poll, intervalMs);
  }
  poll();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export function getUserPath(uid) { return `/users/${uid}`; }
export function getPlayersPath(uid) { return `${getUserPath(uid)}/players`; }
