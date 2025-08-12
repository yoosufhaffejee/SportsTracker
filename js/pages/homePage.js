import { loadConfig, readData } from '../firebase.js';
import { setupTheme, initAuthUI } from '../shared/bootstrap.js';

// Shared theme + auth UI
setupTheme();

// Pre-load config BEFORE auth callback may fire to avoid TDZ ReferenceError
const configPromise = loadConfig().catch(() => ({ sports: {} }));

let currentUser = null;
initAuthUI({ requireAuth: false, renderButtonId: 'gsi-button', onAuthed: (u) => { currentUser = u; afterAuth(u); } });

async function afterAuth(user){
  if (!user) return;
  const appConfig = await configPromise;
  const grid = document.getElementById('sportsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const icons = { soccer: '⚽', padel: '🥎', tennis: '🎾', squash: '⚫', volleyball: '🏐' };
  for (const [key, meta] of Object.entries(appConfig.sports || {})) {
    const a = document.createElement('a');
    a.href = `./${key}.html`;
    a.className = 'sport-tile';
    a.innerHTML = `<div class="sport-icon">${icons[key] || '🏅'}</div><div>${meta.name || key}</div>`;
    grid.appendChild(a);
  }
}

// Public spectate (read-only) handler
const spectateForm = document.getElementById('spectateForm');
const spectatorView = document.getElementById('spectatorView');
const spectateTitle = document.getElementById('spectateTitle');
const spectateTeams = document.getElementById('spectateTeams');
const spectateStats = document.getElementById('spectateStats');
const spectateFixtures = document.getElementById('spectateFixtures');
const spectateBack = document.getElementById('spectateBack');

spectateBack?.addEventListener('click', () => spectatorView?.classList.add('hidden'));

spectateForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = (document.getElementById('spectateCode').value || '').trim().toUpperCase();
  if (!code) return;
  const t = await readData(`/tournaments/${code}`).catch(()=>null);
  if (!t || (t.config && t.config.isPublic === false)) {
    alert('Tournament not found or not public');
    return;
  }
  spectateTitle.textContent = `Tournament ${code}`;
  spectatorView?.classList.remove('hidden');
  // Teams
  spectateTeams.innerHTML = '';
  const teams = Object.entries(t.teams || {});
  if (!teams.length) spectateTeams.innerHTML = '<li class="muted">No teams yet</li>';
  for (const [tid, tm] of teams) {
    const li = document.createElement('li');
    li.textContent = tm.name || 'Team';
    spectateTeams.appendChild(li);
  }
  // Simple stats leaderboard placeholder
  spectateStats.innerHTML = '';
  const stats = t.stats || {};
  const entries = Object.entries(stats);
  if (!entries.length) spectateStats.innerHTML = '<li class="muted">No stats yet</li>';
  for (const [pid, s] of entries) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${pid}</span><strong>${s.goals || 0} goals</strong>`;
    spectateStats.appendChild(li);
  }
  // Fixtures
  spectateFixtures.innerHTML = '';
  const matches = Object.entries(t.matches || {});
  if (!matches.length) spectateFixtures.textContent = 'No fixtures yet';
  for (const [mid, m] of matches) {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<strong>${m.teamA || 'Team A'}</strong> vs <strong>${m.teamB || 'Team B'}</strong>
      <div class="muted">${(m.scores && `${m.scores.a||0}-${m.scores.b||0}`) || 'TBD'}</div>`;
    spectateFixtures.appendChild(div);
  }
});
