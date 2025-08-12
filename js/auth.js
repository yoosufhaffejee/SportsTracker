// Google Sign-In + lightweight session handling
// We avoid full Firebase Auth SDK to keep bundle light; we can swap later.
import { writeData, setAuthToken } from './firebase.js';

let currentUser = null;
const authListeners = new Set();

export function onAuthState(cb) {
  authListeners.add(cb);
  cb(currentUser);
  return () => authListeners.delete(cb);
}

function emitAuth() {
  for (const cb of authListeners) cb(currentUser);
}

// ---- Lightweight Firebase ID token refresh (approx every 50m) ----
let refreshTimer = null;
function scheduleTokenRefresh(refreshToken) {
  if (!refreshToken) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshFirebaseIdToken(refreshToken), 50 * 60 * 1000);
}

async function refreshFirebaseIdToken(refreshToken) {
  const apiKey = window.APP_FIREBASE_API_KEY || '';
  if (!apiKey || !refreshToken) return;
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
    });
    if (!res.ok) throw new Error('refresh failed');
    const json = await res.json();
    if (json.id_token) {
      setAuthToken(json.id_token);
      localStorage.setItem('firebase_id_token', json.id_token);
    }
    if (json.refresh_token) {
      localStorage.setItem('firebase_refresh_token', json.refresh_token);
      scheduleTokenRefresh(json.refresh_token);
    } else {
      scheduleTokenRefresh(refreshToken);
    }
  } catch (e) {
    refreshTimer = setTimeout(() => refreshFirebaseIdToken(refreshToken), 5 * 60 * 1000);
  }
}

export function initAuth() {
  // If you later wire Firebase Auth, sync its user here
  // For now, use GIS ID token to derive a session; store in localStorage
  const saved = localStorage.getItem('gis_profile');
  if (saved) {
    try { currentUser = JSON.parse(saved); } catch {}
  }
  // Restore Firebase ID token & schedule refresh if available
  const storedIdToken = localStorage.getItem('firebase_id_token');
  if (storedIdToken) {
    setAuthToken(storedIdToken);
    const rt = localStorage.getItem('firebase_refresh_token');
    if (rt) scheduleTokenRefresh(rt);
  }
  emitAuth();
}

export function renderGSIButton(elementId) {
  // Requires <script src="https://accounts.google.com/gsi/client" async defer></script>
  const el = document.getElementById(elementId);
  if (!window.google || !window.google.accounts || !el) return;

  const clientId = (window.APP_GIS_CLIENT_ID) || 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleCredentialResponse,
    auto_select: false,
  });
  window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large' });
}

async function handleCredentialResponse(resp) {
  // Parse the JWT to get basic profile
  const idToken = resp.credential;
  const payload = parseJwt(idToken) || {};
  // Exchange Google ID token for a Firebase ID token via REST
  const { firebaseUser, firebaseIdToken, refreshToken } = await signInWithFirebaseUsingGoogle(idToken).catch(() => ({ firebaseUser: null }));
  const user = firebaseUser || {
    uid: payload.sub,
    email: payload.email,
    displayName: payload.name,
    photoURL: payload.picture,
  };
  currentUser = user;
  localStorage.setItem('gis_profile', JSON.stringify(user));
  if (firebaseIdToken) {
    setAuthToken(firebaseIdToken);
    localStorage.setItem('firebase_id_token', firebaseIdToken);
      if (refreshToken) {
        localStorage.setItem('firebase_refresh_token', refreshToken);
        scheduleTokenRefresh(refreshToken);
      }
  } else {
    setAuthToken(null);
  }
  emitAuth();

  // Save user metadata in DB
  try {
    await writeData(`/users/${user.uid}/profile`, {
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('Failed to persist user profile', e);
  }
}

export function signOut() {
  localStorage.removeItem('gis_profile');
  localStorage.removeItem('firebase_id_token');
  localStorage.removeItem('firebase_refresh_token');
  try { window.google?.accounts.id.disableAutoSelect(); } catch {}
  currentUser = null;
  setAuthToken(null);
  emitAuth();
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

async function signInWithFirebaseUsingGoogle(googleIdToken) {
  const apiKey = window.APP_FIREBASE_API_KEY || '';
  if (!apiKey) throw new Error('Missing Firebase apiKey');
  const reqOrigin = (() => {
    try {
      const o = window.location.origin;
      if (!o || o === 'null' || o.startsWith('file:')) return 'http://localhost';
      if (!/^https?:/i.test(o)) return 'http://localhost';
      return o;
    } catch { return 'http://localhost'; }
  })();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: reqOrigin,
      returnIdpCredential: true,
      returnSecureToken: true
    })
  });
  if (!res.ok) throw new Error('signInWithIdp failed');
  const json = await res.json();
  // json contains idToken (Firebase ID token), refreshToken, localId (uid), email, fullName, photoUrl
  const firebaseUser = {
    uid: json.localId,
    email: json.email || null,
    displayName: json.fullName || null,
    photoURL: json.photoUrl || null,
  };
  return { firebaseUser, firebaseIdToken: json.idToken, refreshToken: json.refreshToken };
}
