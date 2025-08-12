// Shared bootstrap utilities: theme + auth UI wiring
import { initAuth, onAuthState, renderGSIButton, signOut } from '../auth.js';

export function setupTheme(toggleId = 'themeToggle') {
  const root = document.documentElement;
  function applyTheme(light) {
    if (light) root.classList.add('light'); else root.classList.remove('light');
    localStorage.setItem('theme', light ? 'light' : 'dark');
  }
  const btn = document.getElementById(toggleId);
  const saved = localStorage.getItem('theme');
  applyTheme(saved === 'light');
  btn?.addEventListener('click', () => applyTheme(!root.classList.contains('light')));
}

// Options:
//  requireAuth: redirect to index.html if not signed in (default true)
//  renderButtonId: optional element id to render Google button into
//  onAuthed(user): callback when user present
export function initAuthUI({ requireAuth = true, renderButtonId, onAuthed } = {}) {
  const publicView = document.getElementById('publicView');
  const appContent = document.getElementById('appContent');
  const userPanel = document.getElementById('userPanel');
  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');
  const signOutBtn = document.getElementById('signOutBtn');
  signOutBtn?.addEventListener('click', () => signOut());

  initAuth();
  if (renderButtonId) {
    try { renderGSIButton(renderButtonId); } catch {/* ignore */}
  }

  onAuthState(async (user) => {
    if (requireAuth && !user) {
      if (publicView) { // show gateway
        publicView.classList.remove('hidden');
        appContent?.classList.add('hidden');
      } else {
        window.location.href = './index.html';
      }
      userPanel?.classList.add('hidden');
      return;
    }
    const showApp = !!user;
    publicView?.classList.toggle('hidden', showApp);
    appContent?.classList.toggle('hidden', !showApp);
    if (user) {
      userPanel?.classList.remove('hidden');
      if (userName) userName.textContent = user.displayName || user.email || 'User';
      if (userAvatar && user.photoURL) { userAvatar.src = user.photoURL; userAvatar.alt = user.displayName || 'User avatar'; }
      onAuthed && onAuthed(user);
    } else {
      userPanel?.classList.add('hidden');
    }
  });
}
