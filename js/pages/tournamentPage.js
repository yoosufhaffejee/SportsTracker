import { readData, writeData, updateData, pushData, deleteData } from '../firebase.js';
import { setupTheme, initAuthUI } from '../shared/bootstrap.js';

function qs(name) { return new URLSearchParams(location.search).get(name); }

// Simple tab init (reusing .tab-row styles)
function initLocalTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab-row .tab'));
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const id = tab.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p=> p.classList.toggle('active', p.id === 'tab-'+id));
  }));
}

function calcStandings(matches, teamsMap) {
  const table = {};
  for (const [tid, tm] of Object.entries(teamsMap)) {
    table[tid] = { teamId: tid, name: tm.name || 'Team', gp:0,w:0,d:0,l:0,gf:0,ga:0,pts:0 };
  }
  for (const [mid, m] of Object.entries(matches||{})) {
    if (!m.scores || m.scores.a==null || m.scores.b==null) continue;
    const a = table[m.teamAId]; const b = table[m.teamBId];
    if (!a || !b) continue;
    a.gp++; b.gp++;
    a.gf += m.scores.a; a.ga += m.scores.b;
    b.gf += m.scores.b; b.ga += m.scores.a;
    if (m.scores.a === m.scores.b) { a.d++; b.d++; a.pts+=1; b.pts+=1; }
    else if (m.scores.a > m.scores.b) { a.w++; b.l++; a.pts+=3; }
    else { b.w++; a.l++; b.pts+=3; }
  }
  return Object.values(table).sort((x,y)=> y.pts - x.pts || (y.gf-y.ga)-(x.gf-x.ga) || y.gf - x.gf || x.name.localeCompare(y.name));
}

function groupTeams(teams) {
  const byGroup = {};
  for (const [tid, tm] of Object.entries(teams||{})) {
    const g = (tm.group||'').trim().toUpperCase();
    if (!byGroup[g||'_UNG']) byGroup[g||'_UNG'] = {};
    byGroup[g||'_UNG'][tid]=tm;
  }
  return byGroup;
}

async function main() {
  setupTheme();
  initAuthUI({ onAuthed: user => init(user) });
  initLocalTabs();
}

async function init(user) {
  const sport = qs('sport');
  const code = (qs('code')||'').toUpperCase();
  const backLink = document.getElementById('backLink'); if (backLink && sport) backLink.href = `${sport}.html`;
  if (!code) { document.getElementById('tTitle').textContent='Missing code'; return; }
  let t = await readData(`/tournaments/${code}`).catch(()=>null);
  if (!t) { document.getElementById('tTitle').textContent='Not found'; return; }
  const isAdmin = t.admin === user.uid;
  const cfg = t.config || {}; const titleEl = document.getElementById('tTitle');
  titleEl.textContent = (cfg.name ? `${cfg.name} (${code})` : `Tournament ${code}`);
  document.getElementById('tSub').textContent = `${cfg.sport || sport || ''} • ${cfg.format || ''}`.trim();
  const cfgDiv = document.getElementById('tConfig');
  const meta = [];
  meta.push(`<span>Encounters: ${cfg.encounters || 1}</span>`);
  if (cfg.createdAt) meta.push(`<span>Created: ${new Date(cfg.createdAt).toLocaleDateString()}</span>`);
  meta.push(`<span>Code: ${code}</span>`);
  cfgDiv.innerHTML = meta.join(' • ');

  // Determine visibility rights (public OR admin OR approved participant)
  let canView = true;
  if (cfg.isPublic === false && !isAdmin) {
    // Need to verify if user is on an approved team
    const userJoined = await readData(`/users/${user.uid}/tournaments/joined/${code}`).catch(()=>null);
    const isApprovedParticipant = !!(userJoined && !userJoined.pending && !userJoined.rejected);
    canView = isApprovedParticipant;
  }

  if (!canView) {
    document.getElementById('tSub').textContent = 'Private tournament – waiting for approval';
    // Hide tab row panels except basic title/config
    document.querySelectorAll('.tab-row, .tab-panel').forEach(el=> el.classList.add('hidden'));
    return; // stop further init
  }

  // Admin vs public panels
  const adminTeamsPanel = document.getElementById('adminTeamsPanel');
  const nonAdminTeamsNotice = document.getElementById('nonAdminTeamsNotice');
  adminTeamsPanel?.classList.toggle('hidden', !isAdmin);
  nonAdminTeamsNotice.hidden = isAdmin;
  document.getElementById('detailsForm').hidden = !isAdmin;

  // Load + render helpers
  async function refresh() {
    t = await readData(`/tournaments/${code}`).catch(()=>t);
    // Migrate legacy joinRequests (pre-unification) so they show up as pending teams
    if (isAdmin && t?.joinRequests) {
      const reqEntries = Object.entries(t.joinRequests||{});
      if (reqEntries.length) {
        const existingTeams = Object.values(t.teams||{}).map(tm=> (tm.name||'').toLowerCase());
        for (const [rid, r] of reqEntries) {
          const name = r.teamName || 'Team';
            // Skip if team with same name already exists
          if (!existingTeams.includes(name.toLowerCase())) {
            await pushData(`/tournaments/${code}/teams`, { name, createdAt: Date.now(), approved:false, rejected:false, captain: r.uid || null, requesterUid: r.uid || null, requesterName: r.displayName || '' });
            if (r.uid) {
              await updateData(`/users/${r.uid}/tournaments/joined/${code}`, { pending:true, teamName: name });
            }
          }
          await deleteData(`/tournaments/${code}/joinRequests/${rid}`);
        }
        // Reload after migration
        t = await readData(`/tournaments/${code}`).catch(()=>t);
      }
    }
    renderTeams();
    renderStandings();
    renderFixtures();
    renderStats();
    renderDetails();
  }

  // Teams CRUD (admin + future captain self-team management)
  const addTeamForm = document.getElementById('addTeamForm');
  const teamNameCombo = document.getElementById('teamNameCombo');
  const teamGroupInput = document.getElementById('teamGroupInput');
  const datalist = document.getElementById('userTeamsList');
  const teamFormSubmitBtn = document.getElementById('teamFormSubmitBtn');
  const teamFormClearBtn = document.getElementById('teamFormClearBtn');
  const teamAddMsg = document.getElementById('teamAddMsg');
  let editingTeamId = null; // tournament team id when editing
  async function loadPersonalTeams() {
    if (!isAdmin) return {};
    const personal = await readData(`/users/${user.uid}/teams/${cfg.sport||sport||'generic'}`).catch(()=>({}));
    if (datalist) {
      datalist.innerHTML='';
      Object.entries(personal||{}).forEach(([pid,p])=>{ const opt=document.createElement('option'); opt.value=p.name||pid; datalist.appendChild(opt); });
    }
    return personal||{};
  }
  let personalTeamsCache = await loadPersonalTeams();

  teamFormClearBtn?.addEventListener('click', ()=>{ editingTeamId=null; addTeamForm.reset(); teamFormSubmitBtn.textContent='Add'; teamFormClearBtn.classList.add('hidden'); teamAddMsg.textContent=''; });

  addTeamForm?.addEventListener('submit', async (e)=>{
    e.preventDefault(); const name=(teamNameCombo?.value||'').trim(); if(!name) return; const group=(teamGroupInput?.value||'').trim().toUpperCase();
    const matched = Object.entries(personalTeamsCache||{}).find(([id,p])=> (p.name||'').toLowerCase() === name.toLowerCase());
    const base = matched ? { personalTeamId: matched[0] } : {};
  const payload = { name, group, createdAt: Date.now(), approved: true, captain: user.uid, ...base };
    if (editingTeamId) { await updateData(`/tournaments/${code}/teams/${editingTeamId}`, payload); teamAddMsg.textContent='Updated team'; }
    else { await pushData(`/tournaments/${code}/teams`, payload); teamAddMsg.textContent='Added team'; }
    editingTeamId=null; teamFormSubmitBtn.textContent='Add'; teamFormClearBtn.classList.add('hidden'); addTeamForm.reset(); personalTeamsCache = await loadPersonalTeams(); refresh();
  });

  function renderTeams() {
    const list = document.getElementById(isAdmin ? 'tTeams' : 'tTeamsPublic'); if(!list) return; list.innerHTML='';
    let teams = Object.entries(t.teams||{});
    if (!isAdmin) teams = teams.filter(([id,tm])=> tm.approved !== false && !tm.rejected);
    teams.sort((a,b)=> (a[1].name||'').localeCompare(b[1].name||''));
    if (!teams.length) { list.innerHTML='<li class="muted">No teams yet</li>'; return; }
    for (const [tid, tm] of teams) {
      if (tm.rejected) continue;
      const li=document.createElement('li');
      const statusBadge = isAdmin && tm.approved !== true ? " <span class='badge'>Pending</span>" : '';
      const left=document.createElement('span'); left.innerHTML=`${tm.name||'Team'}${tm.group?` <span class='badge'>${tm.group}</span>`:''}${statusBadge}`; li.appendChild(left);
      const actions=document.createElement('span'); actions.style.display='flex'; actions.style.gap='.4rem';
      if (isAdmin) {
        if (tm.approved !== true) {
          const approve=document.createElement('button'); approve.type='button'; approve.className='icon-btn success'; approve.innerHTML='✔'; approve.title='Approve';
          approve.addEventListener('click', async ()=>{ await updateData(`/tournaments/${code}/teams/${tid}`, { approved:true }); refresh(); });
          const reject=document.createElement('button'); reject.type='button'; reject.className='icon-btn danger'; reject.innerHTML='✖'; reject.title='Reject';
          reject.addEventListener('click', async ()=>{ if(!confirm('Reject team?')) return; await updateData(`/tournaments/${code}/teams/${tid}`, { rejected:true }); refresh(); });
          actions.append(approve, reject);
        } else {
          const view=document.createElement('button'); view.type='button'; view.className='icon-btn success'; view.innerHTML='👁'; view.title='View team';
          view.addEventListener('click', ()=>{ window.location.href = `team.html?sport=${encodeURIComponent(cfg.sport||sport||'')}&code=${encodeURIComponent(code)}&team=${encodeURIComponent(tid)}`; });
          const edit=document.createElement('button'); edit.type='button'; edit.className='icon-btn primary'; edit.innerHTML='✎'; edit.title='Edit team';
          edit.addEventListener('click', ()=>{ editingTeamId=tid; if(teamNameCombo) teamNameCombo.value=tm.name||''; if(teamGroupInput) teamGroupInput.value=tm.group||''; teamFormSubmitBtn.textContent='Save'; teamFormClearBtn.classList.remove('hidden'); teamAddMsg.textContent='Editing'; window.scrollTo({top:0,behavior:'smooth'}); });
          const del=document.createElement('button'); del.type='button'; del.className='icon-btn danger'; del.innerHTML='🗑'; del.title='Remove';
          del.addEventListener('click', async ()=>{ if(!confirm('Delete team?')) return; await deleteData(`/tournaments/${code}/teams/${tid}`); refresh(); });
          actions.append(view, edit, del);
        }
      } else if (tm.approved) {
        const view=document.createElement('button'); view.type='button'; view.className='icon-btn success'; view.innerHTML='👁'; view.title='View team';
        view.addEventListener('click', ()=>{ window.location.href = `team.html?sport=${encodeURIComponent(cfg.sport||sport||'')}&code=${encodeURIComponent(code)}&team=${encodeURIComponent(tid)}`; });
        actions.append(view);
      }
      li.appendChild(actions); list.appendChild(li);
    }
  }

  // (Join requests removed)

  // Standings (approved teams only)
  function renderStandings() {
    const tbody = document.querySelector('#standingsTable tbody'); if (!tbody) return;
    tbody.innerHTML='';
    const teams = Object.fromEntries(Object.entries(t.teams||{}).filter(([id,tm])=> tm.approved && !tm.rejected));
    const matches = t.matches||{};
    const byGroup = groupTeams(teams);
    const groupSelectWrap = document.getElementById('groupSelectWrap');
    const groupSelect = document.getElementById('standingsGroupSelect');
    // Populate groups if any real grouping
    const groups = Object.keys(byGroup).filter(g=>g && g!=='_UNG');
    groupSelectWrap.hidden = !groups.length || (cfg.format!=='groups_knockout' && cfg.format!=='league');
    if (!groupSelectWrap.hidden) {
      groupSelect.innerHTML='';
      groups.forEach(g=>{ const opt=document.createElement('option'); opt.value=g; opt.textContent=g; groupSelect.appendChild(opt); });
    }
    function doRender(groupKey) {
      const scopeTeams = groupKey ? byGroup[groupKey] : teams;
      const filteredMatches = {};
      for (const [mid,m] of Object.entries(matches)) {
        if (scopeTeams[m.teamAId] && scopeTeams[m.teamBId]) filteredMatches[mid]=m;
      }
      const standings = calcStandings(filteredMatches, scopeTeams);
      tbody.innerHTML='';
      if (!standings.length) { tbody.innerHTML = '<tr><td colspan="9" class="muted">No data</td></tr>'; return; }
      for (const row of standings) {
        const tr=document.createElement('tr');
        const gd = row.gf - row.ga;
        tr.innerHTML = `<td>${row.name}</td><td>${row.gp}</td><td>${row.w}</td><td>${row.d}</td><td>${row.l}</td><td>${row.gf}</td><td>${row.ga}</td><td>${gd}</td><td>${row.pts}</td>`;
        tbody.appendChild(tr);
      }
    }
    if (!groupSelectWrap.hidden) {
      groupSelect.onchange = ()=> doRender(groupSelect.value);
      doRender(groupSelect.value || groups[0]);
    } else doRender(null);
  }

  // Fixtures (generate, list, edit results + stats)
  const fixturesList = document.getElementById('fixturesList');
  const fixturesMsg = document.getElementById('fixturesMsg');
  document.getElementById('generateFixturesBtn')?.addEventListener('click', ()=> generateFixtures(false));
  document.getElementById('regenFixturesBtn')?.addEventListener('click', ()=> generateFixtures(true));

  async function generateFixtures(regen) {
    if (!isAdmin) { alert('Admin only'); return; }
    fixturesMsg.textContent='Generating…';
    t = await readData(`/tournaments/${code}`).catch(()=>t);
    const format = t?.config?.format || cfg.format;
    const encounters = Math.max(1, (t?.config?.encounters || cfg.encounters || 1) * 1);
    // Only schedule approved (non-rejected) teams
    const allTeams = Object.entries(t.teams||{})
      .filter(([id,tm])=> tm.approved && !tm.rejected)
      .map(([id,tm])=> ({id, ...tm}));
    if (allTeams.length < 2) { fixturesMsg.textContent='Need at least 2 teams'; return; }
    const filteredTeamsObj = Object.fromEntries(allTeams.map(t=> [t.id, t]));
    const grouped = (format === 'groups_knockout') ? groupTeams(filteredTeamsObj) : null;
    // Index existing by pair (support legacy without ids)
    const existingIndex = {};
    for (const [mid,m] of Object.entries(t.matches||{})) {
      const aId = m.teamAId || m.teamA; const bId = m.teamBId || m.teamB;
      if (!aId || !bId) continue;
      const key = [aId,bId].sort().join('|');
      existingIndex[key] = (existingIndex[key]||0)+1;
    }
    const newMatches = {}; let midCounter=0;
  function schedulePairs(teamsSubset) {
      for (let i=0;i<teamsSubset.length;i++) {
        for (let j=i+1;j<teamsSubset.length;j++) {
          const a = teamsSubset[i]; const b = teamsSubset[j];
          const key = [a.id,b.id].sort().join('|');
          const have = existingIndex[key] || 0;
          const needed = regen ? encounters : Math.max(0, encounters - have);
          if (needed<=0) continue;
          for (let k=0;k<needed;k++) {
            const iterationIndex = regen ? k : have + k; // total index including existing
            const swap = iterationIndex % 2 === 1; // alternate home/away
            const home = swap ? b : a;
            const away = swap ? a : b;
      newMatches[`m${Date.now()}_${++midCounter}`] = { teamA: home.name, teamB: away.name, teamAId: home.id, teamBId: away.id, createdAt: Date.now(), encounter: iterationIndex + 1 };
          }
        }
      }
    }
    if (grouped) {
      for (const [g, groupTeamsObj] of Object.entries(grouped)) {
        const arr = Object.entries(groupTeamsObj).map(([id,tm])=> ({id, ...tm}));
        schedulePairs(arr);
      }
    } else schedulePairs(allTeams);
    if (!Object.keys(newMatches).length) {
      fixturesMsg.textContent = regen ? 'No teams to schedule' : 'Already at encounters target';
      return;
    }
    if (regen) await updateData(`/tournaments/${code}`, { matches: newMatches });
    else await updateData(`/tournaments/${code}`, { matches: { ...(t.matches||{}), ...newMatches } });
    fixturesMsg.textContent = regen ? 'Fixtures regenerated' : 'Fixtures generated';
    refresh();
  }

  function renderFixtures() {
    if (!fixturesList) return;
    fixturesList.innerHTML='';
    const matches = Object.entries(t.matches||{}).sort((a,b)=> (a[1].createdAt||0)-(b[1].createdAt||0));
    if (!matches.length) { fixturesList.innerHTML='<div class="muted">No fixtures yet</div>'; return; }
    const regenBtn = document.getElementById('regenFixturesBtn');
    regenBtn?.classList.toggle('hidden', !isAdmin || !matches.length);
    // Map pair -> last assigned encounter index if legacy matches lack encounter
    const pairEncounterCount = {};
    // Group matches by encounter (round)
    const rounds = {};
    for (const [mid, m] of matches) {
      const key = [m.teamAId||m.teamA, m.teamBId||m.teamB].sort().join('|');
      let encounterNo = m.encounter;
      if (!encounterNo) {
        encounterNo = (pairEncounterCount[key]||0) + 1;
        pairEncounterCount[key] = encounterNo;
      } else {
        // keep pairEncounterCount in sync in case subsequent legacy ones appear
        pairEncounterCount[key] = Math.max(pairEncounterCount[key]||0, encounterNo);
      }
      if (!rounds[encounterNo]) rounds[encounterNo] = [];
      rounds[encounterNo].push([mid, m]);
    }
    const roundNumbers = Object.keys(rounds).map(n=> parseInt(n,10)).sort((a,b)=> a-b);
    for (const rNum of roundNumbers) {
      // Heading
      const heading = document.createElement('h4'); heading.textContent = `Round ${rNum}`; heading.style.margin = '1rem 0 .5rem';
      fixturesList.appendChild(heading);
      // Round fixtures
      for (const [mid, m] of rounds[rNum]) {
        const card = document.createElement('div'); card.className='card'; card.style.padding='.6rem .75rem';
        const scoreStr = (m.scores && m.scores.a!=null && m.scores.b!=null) ? `<strong>${m.scores.a}-${m.scores.b}</strong>` : '<span class="muted">TBD</span>';
        card.innerHTML = `<div style='display:flex; justify-content:space-between; align-items:center; gap:.75rem; flex-wrap:wrap;'>
          <div><strong>${m.teamA}</strong> vs <strong>${m.teamB}</strong> ${scoreStr}</div>
          <div class='muted' style='font-size:.75rem;'>${m.date ? new Date(m.date).toLocaleDateString():''}</div>
          </div>`;
        if (isAdmin) {
          const edit=document.createElement('button'); edit.type='button'; edit.className='icon-btn primary'; edit.innerHTML='✎'; edit.title='Enter result';
          edit.addEventListener('click', ()=> editMatch(mid,m));
          card.appendChild(edit);
        }
        fixturesList.appendChild(card);
      }
    }
  }

  function editMatch(mid, m) {
    const aScore = prompt(`${m.teamA} score`, m.scores?.a!=null?m.scores.a:''); if (aScore===null) return;
    const bScore = prompt(`${m.teamB} score`, m.scores?.b!=null?m.scores.b:''); if (bScore===null) return;
    const a = parseInt(aScore,10); const b = parseInt(bScore,10);
    if (isNaN(a) || isNaN(b)) { alert('Invalid scores'); return; }
    // Collect players (comma separated) then per-player goals, assists, saves
    const aPlayersRaw = prompt('Team A players involved (comma separated names)', (m.scores?.aPlayers||[]).map(p=>p.name).join(',') || '');
    const bPlayersRaw = prompt('Team B players involved (comma separated names)', (m.scores?.bPlayers||[]).map(p=>p.name).join(',') || '');
    const aPlayerNames = splitList(aPlayersRaw);
    const bPlayerNames = splitList(bPlayersRaw);
    function collectDetails(names, prevPlayers) {
      const list = [];
      for (const name of names) {
        const prev = (prevPlayers||[]).find(p=> p.name===name) || {};
        const gStr = prompt(`Goals for ${name}`, prev.goals!=null?prev.goals: '0'); if (gStr===null) return null;
        const aStr = prompt(`Assists for ${name}`, prev.assists!=null?prev.assists: '0'); if (aStr===null) return null;
        const sStr = prompt(`Saves for ${name}`, prev.saves!=null?prev.saves: '0'); if (sStr===null) return null;
        const goals = parseInt(gStr,10)||0; const assists = parseInt(aStr,10)||0; const saves = parseInt(sStr,10)||0;
        list.push({ name, goals, assists, saves });
      }
      return list;
    }
    const aPlayers = collectDetails(aPlayerNames, m.scores?.aPlayers); if (aPlayers===null) return;
    const bPlayers = collectDetails(bPlayerNames, m.scores?.bPlayers); if (bPlayers===null) return;
    // Legacy arrays for scorers (expand name per goal) for backwards compatibility
    const aScorers = aPlayers.flatMap(p=> Array.from({length:p.goals}, ()=> p.name));
    const bScorers = bPlayers.flatMap(p=> Array.from({length:p.goals}, ()=> p.name));
    // Optional: validate summed goals against entered score; if mismatch ask to adjust
    const sumAGoals = aPlayers.reduce((acc,p)=>acc+p.goals,0);
    const sumBGoals = bPlayers.reduce((acc,p)=>acc+p.goals,0);
    if (sumAGoals !== a || sumBGoals !== b) {
      const adjust = confirm(`Entered scores (${a}-${b}) differ from summed player goals (${sumAGoals}-${sumBGoals}). Use summed goals instead?`);
      if (adjust) { m.scores = m.scores||{}; }
      if (adjust) { m.scores.a = sumAGoals; m.scores.b = sumBGoals; }
    }
    const finalA = (sumAGoals === a || sumAGoals===0) ? a : (confirm('Override Team A score with summed goals?') ? sumAGoals : a);
    const finalB = (sumBGoals === b || sumBGoals===0) ? b : (confirm('Override Team B score with summed goals?') ? sumBGoals : b);
    updateData(`/tournaments/${code}/matches/${mid}`, { scores: { a: finalA, b: finalB, aScorers, bScorers, aPlayers, bPlayers }, updatedAt: Date.now() }).then(refresh);
  }

  function splitList(str) { return (str||'').split(',').map(s=>s.trim()).filter(Boolean); }

  // Stats aggregation (goals, assists placeholder from scorers lists)
  function renderStats() {
    const goalsBody = document.querySelector('#statsGoals tbody'); if (!goalsBody) return;
    const assistsBody = document.querySelector('#statsAssists tbody');
    const savesBody = document.querySelector('#statsSaves tbody');
  const goalsTable = document.getElementById('statsGoals'); if (goalsTable) goalsTable.setAttribute('aria-label','Goals');
  const assistsTable = document.getElementById('statsAssists'); if (assistsTable) assistsTable.setAttribute('aria-label','Assists');
  const savesTable = document.getElementById('statsSaves'); if (savesTable) savesTable.setAttribute('aria-label','Saves');
    goalsBody.innerHTML=assistsBody.innerHTML=savesBody.innerHTML='';
    const aggregate = {}; // name -> {goals,assists,saves}
    for (const [mid,m] of Object.entries(t.matches||{})) {
      const s = m.scores||{};
      if (s.aPlayers || s.bPlayers) {
        (s.aPlayers||[]).forEach(p=>{
          if(!aggregate[p.name]) aggregate[p.name]={goals:0,assists:0,saves:0};
          aggregate[p.name].goals += p.goals||0; aggregate[p.name].assists += p.assists||0; aggregate[p.name].saves += p.saves||0;
        });
        (s.bPlayers||[]).forEach(p=>{
          if(!aggregate[p.name]) aggregate[p.name]={goals:0,assists:0,saves:0};
          aggregate[p.name].goals += p.goals||0; aggregate[p.name].assists += p.assists||0; aggregate[p.name].saves += p.saves||0;
        });
      } else {
        // Legacy fallback: aScorers/bScorers arrays imply 1 goal per occurrence
        (s.aScorers||[]).forEach(n=> { if(!aggregate[n]) aggregate[n]={goals:0,assists:0,saves:0}; aggregate[n].goals +=1; });
        (s.bScorers||[]).forEach(n=> { if(!aggregate[n]) aggregate[n]={goals:0,assists:0,saves:0}; aggregate[n].goals +=1; });
      }
    }
    const goalRows = Object.entries(aggregate).filter(([n,st])=> st.goals>0).sort((a,b)=> b[1].goals - a[1].goals || a[0].localeCompare(b[0]));
    const assistRows = Object.entries(aggregate).filter(([n,st])=> st.assists>0).sort((a,b)=> b[1].assists - a[1].assists || a[0].localeCompare(b[0]));
    const saveRows = Object.entries(aggregate).filter(([n,st])=> st.saves>0).sort((a,b)=> b[1].saves - a[1].saves || a[0].localeCompare(b[0]));
    function ensureEmptyMsg(tableEl, hasData) {
      if (!tableEl) return;
      let msg = tableEl.parentElement.querySelector('.stats-empty-msg');
      if (hasData) {
        tableEl.style.display='table';
        if (msg) msg.remove();
      } else {
        tableEl.style.display='none';
        if (!msg) {
          msg = document.createElement('div'); msg.className='muted stats-empty-msg'; msg.textContent='No data';
          tableEl.parentElement.appendChild(msg);
        }
      }
    }
    if (goalRows.length) goalRows.forEach(([player,st])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${player}</td><td>${st.goals}</td>`; goalsBody.appendChild(tr); });
    if (assistRows.length) assistRows.forEach(([player,st])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${player}</td><td>${st.assists}</td>`; assistsBody.appendChild(tr); });
    if (saveRows.length) saveRows.forEach(([player,st])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${player}</td><td>${st.saves}</td>`; savesBody.appendChild(tr); });
    ensureEmptyMsg(goalsTable, goalRows.length>0);
    ensureEmptyMsg(assistsTable, assistRows.length>0);
    ensureEmptyMsg(savesTable, saveRows.length>0);
  }

  // Details / info
  const detailsForm = document.getElementById('detailsForm');
  detailsForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
  const contact = (document.getElementById('contactEmail').value||'').trim();
  const rules = (document.getElementById('rulesText').value||'').trim();
  let encountersVal = parseInt((document.getElementById('encountersEdit').value||'').trim(),10);
  if (isNaN(encountersVal) || encountersVal < 1) encountersVal = cfg.encounters || 1;
  if (encountersVal > 4) encountersVal = 4;
  await updateData(`/tournaments/${code}/config`, { contact, rules, encounters: encountersVal });
    document.getElementById('detailsMsg').textContent='Saved';
    refresh();
  });

  function renderDetails() {
    const wrap = document.getElementById('detailsInfo'); if (!wrap) return;
    wrap.innerHTML='';
    const c = t.config||{};
    const lines = [];
    if (c.contact) lines.push(`<div><strong>Contact:</strong> ${c.contact}</div>`);
    if (c.rules) lines.push(`<div style='white-space:pre-wrap;'>${c.rules}</div>`);
    lines.push(`<div><strong>Admin:</strong> ${t.admin}</div>`);
    wrap.innerHTML = lines.join('') || '<div class="muted">No details yet</div>';
    if (isAdmin) {
      const contactEl = document.getElementById('contactEmail'); if (contactEl) contactEl.value = c.contact||'';
      const rulesEl = document.getElementById('rulesText'); if (rulesEl) rulesEl.value = c.rules||'';
      const encEl = document.getElementById('encountersEdit'); if (encEl) encEl.value = c.encounters || 1;
    }
  }

  refresh();
}

main().catch(console.error);
