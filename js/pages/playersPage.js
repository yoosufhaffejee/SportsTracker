import { initAuth } from '../auth.js';
import { initPlayerManager } from '../ui/playerManager.js';
import { setupTheme, initAuthUI } from '../shared/bootstrap.js';

setupTheme();
initAuthUI({ requireAuth: true, onAuthed: user => initPlayerManager(user) });

// Year
document.addEventListener('DOMContentLoaded', () => {
  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
});
