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

// Public spectate (read-only) handler (tabbed rich view)
const spectateForm = document.getElementById('spectateForm');
const spectatorView = document.getElementById('spectatorView');
const spectateTitle = document.getElementById('spectateTitle');
const spectateSub = document.getElementById('spectateSub');
const spectateMeta = document.getElementById('spectateMeta');
const spectateTeams = document.getElementById('spectateTeams');
const spectateStandings = document.getElementById('spectateStandings');
const spectateFixtures = document.getElementById('spectateFixtures');
const spectateGoals = document.getElementById('spectateGoals');
const spectateAssists = document.getElementById('spectateAssists');
const spectateDetails = document.getElementById('spectateDetails');
const spectateBack = document.getElementById('spectateBack');
const spectateTabs = document.getElementById('spectateTabs');

spectateBack?.addEventListener('click', () => spectatorView?.classList.add('hidden'));

function activateSpectateTab(name){
  document.querySelectorAll('#spectateTabs .tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('#spectatorView .tab-panel').forEach(p=>p.classList.toggle('active', p.id === 'tab-'+name));
}
spectateTabs?.addEventListener('click', (e)=>{
  const el = e.target.closest('.tab');
  if (!el) return;
  activateSpectateTab(el.dataset.tab);
});

function computeStandings(t){
  const table = {};
  const matches = Object.values(t.matches||{});
  const teamMeta = t.teams || {};
  for (const m of matches){
    const { teamA, teamB, scores } = m || {}; if (!teamA || !teamB) continue;
    // Skip if either team is pending (approved === false) or rejected
    const aMeta = Object.values(teamMeta).find(tm=> tm.name===teamA);
    const bMeta = Object.values(teamMeta).find(tm=> tm.name===teamB);
    if ((aMeta && (aMeta.approved === false || aMeta.rejected)) || (bMeta && (bMeta.approved === false || bMeta.rejected))) continue;
    if (!table[teamA]) table[teamA] = { team: teamA, gp:0,w:0,d:0,l:0,gf:0,ga:0,pts:0 };
    if (!table[teamB]) table[teamB] = { team: teamB, gp:0,w:0,d:0,l:0,gf:0,ga:0,pts:0 };
    if (scores && typeof scores.a === 'number' && typeof scores.b === 'number'){
      const a = scores.a, b = scores.b;
      table[teamA].gp++; table[teamB].gp++;
      table[teamA].gf += a; table[teamA].ga += b;
      table[teamB].gf += b; table[teamB].ga += a;
      if (a===b){ table[teamA].d++; table[teamB].d++; table[teamA].pts++; table[teamB].pts++; }
      else if (a>b){ table[teamA].w++; table[teamB].l++; table[teamA].pts+=3; }
      else { table[teamB].w++; table[teamA].l++; table[teamB].pts+=3; }
    }
  }
  return Object.values(table).sort((a,b)=> b.pts - a.pts || (b.gf-b.ga)-(a.gf-a.ga) || b.gf - a.gf || a.team.localeCompare(b.team));
}

function aggregateStats(t){
  const goals = {}; const assists = {};
  for (const m of Object.values(t.matches||{})){
    if (!m.scores) continue;
    const { aPlayers = [], bPlayers = [] } = m.scores;
    for (const rec of [...aPlayers, ...bPlayers]){
      if (!rec || !rec.player) continue;
      if (rec.goals){ goals[rec.player] = (goals[rec.player]||0)+rec.goals; }
      if (rec.assists){ assists[rec.player] = (assists[rec.player]||0)+rec.assists; }
    }
  }
  const goalsArr = Object.entries(goals).map(([p,v])=>({ player:p, v })).sort((a,b)=> b.v - a.v || a.player.localeCompare(b.player));
  const assistsArr = Object.entries(assists).map(([p,v])=>({ player:p, v })).sort((a,b)=> b.v - a.v || a.player.localeCompare(b.player));
  return { goalsArr, assistsArr };
}

function groupFixtures(t){
  const groups = {};
  const teamMeta = t.teams || {};
  for (const [mid, m] of Object.entries(t.matches||{})){
    const aMeta = Object.values(teamMeta).find(tm=> tm.name===m.teamA);
    const bMeta = Object.values(teamMeta).find(tm=> tm.name===m.teamB);
    if ((aMeta && (aMeta.approved === false || aMeta.rejected)) || (bMeta && (bMeta.approved === false || bMeta.rejected))) continue;
    const r = m.round || m.encounter || 'Other';
    if (!groups[r]) groups[r] = [];
    groups[r].push({ id: mid, ...m });
  }
  const orderedKeys = Object.keys(groups).sort((a,b)=>{
    const na = parseInt(a.replace(/[^0-9]/g,''))||0;
    const nb = parseInt(b.replace(/[^0-9]/g,''))||0;
    return na-nb || a.localeCompare(b);
  });
  return orderedKeys.map(k=>({ round:k, matches: groups[k] }));
}

spectateForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = (document.getElementById('spectateCode').value || '').trim().toUpperCase();
  if (!code) return;
  const t = await readData(`/tournaments/${code}`).catch(()=>null);
  if (!t || (t.config && t.config.isPublic === false)) {
    alert('Tournament not found or not public');
    return;
  }
  spectateTitle.textContent = t.name ? `${t.name} (${code})` : `Tournament ${code}`;
  spectateSub.textContent = t.config?.sport || '';
  spectateMeta.innerHTML = '';
  if (t.config?.createdAt) {
    const span = document.createElement('span'); span.textContent = new Date(t.config.createdAt).toLocaleDateString(); spectateMeta.appendChild(span);
  }
  if (t.config?.format){ const span = document.createElement('span'); span.textContent = t.config.format; spectateMeta.appendChild(span); }
  spectatorView?.classList.remove('hidden');
  activateSpectateTab('spteams');

  // Teams (approved only if approval concept used)
  spectateTeams.innerHTML = '';
  const teams = Object.values(t.teams||{}).filter(tm=> tm.approved !== false && !tm.rejected);
  if (!teams.length) spectateTeams.innerHTML = '<li class="muted">No teams yet</li>';
  for (const tm of teams){
    const li = document.createElement('li');
    li.textContent = tm.name || 'Team';
    spectateTeams.appendChild(li);
  }

  // Standings
  const standingsData = computeStandings(t);
  const tbody = spectateStandings?.querySelector('tbody');
  if (tbody){
    tbody.innerHTML = '';
    if (!standingsData.length) tbody.innerHTML = '<tr><td colspan="9" class="muted">No matches yet</td></tr>';
    for (const row of standingsData){
      const tr = document.createElement('tr');
      const gd = row.gf - row.ga;
      tr.innerHTML = `<td>${row.team}</td><td>${row.gp}</td><td>${row.w}</td><td>${row.d}</td><td>${row.l}</td><td>${row.gf}</td><td>${row.ga}</td><td>${gd}</td><td>${row.pts}</td>`;
      tbody.appendChild(tr);
    }
  }

  // Stats (goals/assists)
  const { goalsArr, assistsArr } = aggregateStats(t);
  spectateGoals.querySelector('tbody').innerHTML = goalsArr.length ? goalsArr.map(g=>`<tr><td>${g.player}</td><td>${g.v}</td></tr>`).join('') : '<tr><td class="muted">No data</td></tr>';
  spectateAssists.querySelector('tbody').innerHTML = assistsArr.length ? assistsArr.map(g=>`<tr><td>${g.player}</td><td>${g.v}</td></tr>`).join('') : '<tr><td class="muted">No data</td></tr>';

  // Fixtures grouped
  spectateFixtures.innerHTML = '';
  const groups = groupFixtures(t);
  if (!groups.length) spectateFixtures.innerHTML = '<div class="muted">No fixtures yet</div>';
  for (const g of groups){
    const wrap = document.createElement('div');
    wrap.className = 'fixture-group';
    wrap.innerHTML = `<h5>${g.round}</h5>`;
    for (const m of g.matches){
      const card = document.createElement('div');
      card.className = 'card';
      const score = (m.scores && typeof m.scores.a==='number' && typeof m.scores.b==='number') ? `${m.scores.a}-${m.scores.b}` : 'TBD';
      card.innerHTML = `<strong>${m.teamA||'Team A'}</strong> vs <strong>${m.teamB||'Team B'}</strong> <div class="muted">${score}</div>`;
      wrap.appendChild(card);
    }
    spectateFixtures.appendChild(wrap);
  }

  // Details / Info
  spectateDetails.innerHTML = '';
  const dl = document.createElement('div');
  dl.className = 'details-list';
  const lines = [];
  if (t.config?.rules) lines.push(`<div><strong>Rules:</strong> ${t.config.rules}</div>`);
  if (t.config?.contact) lines.push(`<div><strong>Contact:</strong> ${t.config.contact}</div>`);
  if (t.config?.description) lines.push(`<div><strong>Description:</strong> ${t.config.description}</div>`);
  if (!lines.length) lines.push('<div class="muted">No additional details</div>');
  dl.innerHTML = lines.join('');
  spectateDetails.appendChild(dl);
});
