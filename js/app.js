// Entry point: bootstraps theme, tabs, auth, and initial data wiring
import { initAuth, onAuthState, renderGSIButton, signOut } from './auth.js';
import { initHome } from './ui/home.js';
import { initPlayerManager } from './ui/playerManager.js';
import { loadConfig } from './firebase.js';
import { initTournaments } from './ui/tournaments.js';

// Theme toggle init
const themeToggle = document.getElementById('themeToggle');
const root = document.documentElement;
function applyTheme(light) {
  if (light) root.classList.add('light'); else root.classList.remove('light');
  localStorage.setItem('theme', light ? 'light' : 'dark');
}
(function initTheme() {
  const saved = localStorage.getItem('theme');
  applyTheme(saved === 'light');
  themeToggle?.addEventListener('click', () => {
    const isLight = !root.classList.contains('light');
    applyTheme(isLight);
  });
})();

// Simple hash router: routes -> /, /players, /:sport, /:sport/tournaments
function route() {
  const hash = (location.hash || '#/').slice(1); // '/players' etc
  const segments = hash.split('/').filter(Boolean); // ['players'] or ['soccer','tournaments']
  const homeView = document.getElementById('homeView');
  const playersView = document.getElementById('playersView');
  const sportHub = document.getElementById('sportHub');

  // Reset views
  homeView?.classList.remove('hidden');
  playersView?.classList.add('hidden');
  sportHub?.classList.add('hidden');

  if (segments.length === 0) {
    // '/'
    return;
  }
  if (segments[0] === 'players') {
    playersView?.classList.remove('hidden');
    homeView?.classList.add('hidden');
    return;
  }
  // sport routes
  if (segments.length >= 1) {
    // Open sport hub; home stays visible with hub expanded
    // Trigger opening the sport in home module via custom event
    const sportKey = segments[0];
    document.dispatchEvent(new CustomEvent('open-sport', { detail: { sport: sportKey } }));
    sportHub?.classList.remove('hidden');
    if (segments[1] === 'tournaments') {
      // currently the sportHub already shows tournaments; we could auto-scroll
      document.getElementById('tournamentsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
}
window.addEventListener('hashchange', route);

// Spectator form basic handler stays public view only (tournaments UI lives in sport hub)
const spectateForm = document.getElementById('spectateForm');
const spectateCode = document.getElementById('spectateCode');
spectateForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = spectateCode.value.trim();
  if (!code) return;
  // tournaments module handles spectator rendering; nothing else here
});

// Auth and app gating
const publicView = document.getElementById('publicView');
const appContent = document.getElementById('appContent');
const userPanel = document.getElementById('userPanel');
const userName = document.getElementById('userName');
const userAvatar = document.getElementById('userAvatar');
const signOutBtn = document.getElementById('signOutBtn');

signOutBtn?.addEventListener('click', signOut);

initAuth();
renderGSIButton('gsi-button');

// Load config (sports, attributes)
const configPromise = loadConfig().catch(() => ({ sports: {}, attributes: {}, stats: {} }));

onAuthState(async (user) => {
  const showApp = !!user;
  publicView?.classList.toggle('hidden', showApp);
  appContent?.classList.toggle('hidden', !showApp);
  userPanel?.classList.toggle('hidden', !showApp);

  if (showApp) {
  const appConfig = await configPromise;
    userName.textContent = user.displayName || user.email || 'User';
    if (user.photoURL) {
      userAvatar.src = user.photoURL;
      userAvatar.alt = user.displayName || 'User avatar';
    }
    // init feature panels
    initHome(user, appConfig);
    initPlayerManager(user);
    initTournaments(user, appConfig);
    // initial route
    route();
  }
});

// Global navigation bindings
document.addEventListener('DOMContentLoaded', () => {
  const managePlayersBtn = document.getElementById('managePlayersBtn');
  managePlayersBtn?.addEventListener('click', () => { location.hash = '/players'; });
});
