// Home: minimalist hub with Sports grid, recent matches, and entry into sport-specific competitions
import { readData } from '../firebase.js';
import { initSportProgression } from './sportProgression.js';

export function initHome(user, appConfig) {
  if (!user) return;

  // Manage players navigation (button in manage card)
  document.getElementById('managePlayersBtn')?.addEventListener('click', () => { location.hash = '/players'; });

  // Sports grid
  const grid = document.getElementById('sportsGrid');
  const sportHub = document.getElementById('sportHub');
  const sportHubTitle = document.getElementById('sportHubTitle');
  const closeSportHub = document.getElementById('closeSportHub');
  const openSportsBtn = document.getElementById('openSports');
  const sportRecent = document.getElementById('sportRecentMatches');

  const sportProg = initSportProgression(user, appConfig);

  function renderSportsGrid() {
    if (!grid) return;
    grid.innerHTML = '';
    const sports = appConfig?.sports || {};
    const icons = { soccer: '⚽', padel: '🥎', tennis: '🎾', squash: '⚫', volleyball: '🏐' };
    for (const [key, meta] of Object.entries(sports)) {
      const div = document.createElement('div');
      div.className = 'sport-tile';
      div.innerHTML = `<div class="sport-icon">${icons[key] || '🏅'}</div><div>${meta.name || key}</div>`;
  div.addEventListener('click', () => { location.hash = `/${key}`; openSport(key, meta); });
      grid.appendChild(div);
    }
  }

  async function openSport(sportKey, meta) {
    sportHubTitle.textContent = meta?.name || sportKey;
    // ensure selects prefilled
    const tSport = document.getElementById('tSport');
    if (tSport) { tSport.value = sportKey; }
  // set progression context for this sport
  sportProg?.setSport?.(sportKey);
    // recent matches for this sport
    if (sportRecent) {
      sportRecent.innerHTML = '';
      const history = await readData(`/users/${user.uid}/history`).catch(()=>({}));
      const filtered = Object.entries(history||{}).filter(([,h]) => (h?.sport||'') === sportKey)
        .sort((a,b)=> (b[1]?.createdAt||0)-(a[1]?.createdAt||0)).slice(0,3);
      if (!filtered.length) sportRecent.innerHTML = '<li class="muted">No matches yet</li>';
      for (const [id, h] of filtered) {
        const li = document.createElement('li');
        const dt = h.createdAt ? new Date(h.createdAt) : null;
        const ts = dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const ds = dt ? dt.toLocaleDateString() : '';
        li.innerHTML = `<span>${ds} ${ts}</span><span class="muted">${h.note || ''}</span>`;
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => openMatchModal(id, h));
        sportRecent.appendChild(li);
      }
    }
    sportHub?.classList.remove('hidden');
    // auto scroll to hub
    sportHub?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  closeSportHub?.addEventListener('click', ()=> {
    sportHub?.classList.add('hidden');
    // If we are on /:sport, close navigates back to root
    if ((location.hash||'').startsWith('#/')) location.hash = '/';
  });

  renderSportsGrid();

  // No global recent list per new minimalist spec

  // Handle external router asking to open a sport
  document.addEventListener('open-sport', (e) => {
    const sportKey = e.detail?.sport; if (!sportKey) return;
    const sports = appConfig?.sports || {}; const meta = sports[sportKey] || { name: sportKey };
    openSport(sportKey, meta);
  });

  // Match details modal
  function openMatchModal(id, match) {
    const modal = document.getElementById('matchDetails');
    const body = document.getElementById('matchDetailsBody');
    const close = document.getElementById('closeMatchDetails');
    const dt = match.createdAt ? new Date(match.createdAt) : null;
    const ts = dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const ds = dt ? dt.toLocaleDateString() : '';
    body.innerHTML = `
      <div class="row"><strong>${match.sport || match.type || 'Match'}</strong></div>
      <div class="row"><span class="muted">${ds} ${ts}</span></div>
      <div class="row"><pre style="white-space: pre-wrap; word-break: break-word;">${JSON.stringify(match, null, 2)}</pre></div>
    `;
    modal?.classList.remove('hidden');
    close?.addEventListener('click', ()=> modal?.classList.add('hidden'), { once: true });
    modal?.addEventListener('click', (e)=>{ if (e.target === modal) modal.classList.add('hidden'); }, { once: true });
  }
}
