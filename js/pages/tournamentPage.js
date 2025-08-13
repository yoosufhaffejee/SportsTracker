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
              await updateData(`/users/${r.uid}/tournaments/joined/${code}`, { pending:true, approved:false, rejected:false, status:'pending', teamName: name });
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

  teamFormClearBtn?.addEventListener('click', ()=>{ editingTeamId=null; addTeamForm.reset(); teamFormSubmitBtn.textContent='Save'; teamFormClearBtn.classList.add('hidden'); teamAddMsg.textContent=''; });

  addTeamForm?.addEventListener('submit', async (e)=>{
    e.preventDefault(); const name=(teamNameCombo?.value||'').trim(); if(!name) return; const group=(teamGroupInput?.value||'').trim().toUpperCase();
    const matched = Object.entries(personalTeamsCache||{}).find(([id,p])=> (p.name||'').toLowerCase() === name.toLowerCase());
    const base = matched ? { personalTeamId: matched[0] } : {};
  const payload = { name, group, createdAt: Date.now(), approved: true, captain: user.uid, ...base };
    if (editingTeamId) { await updateData(`/tournaments/${code}/teams/${editingTeamId}`, payload); teamAddMsg.textContent='Updated team'; }
    else { await pushData(`/tournaments/${code}/teams`, payload); teamAddMsg.textContent='Added team'; }
    editingTeamId=null; teamFormSubmitBtn.textContent='Save'; teamFormClearBtn.classList.add('hidden'); addTeamForm.reset(); personalTeamsCache = await loadPersonalTeams(); refresh();
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
    const standingsCard = document.querySelector('#tab-standings .card');
    const baseTable = document.getElementById('standingsTable');
    const tbody = baseTable?.querySelector('tbody');
    if (!standingsCard || !baseTable || !tbody) return;
    const teams = Object.fromEntries(Object.entries(t.teams||{}).filter(([id,tm])=> tm.approved && !tm.rejected));
    const matches = t.matches||{};
    // Cleanup any previously injected group tables / summaries
    standingsCard.querySelectorAll('.group-standings-block').forEach(el=> el.remove());
    const eliminationSummary = standingsCard.querySelector('#eliminationSummary'); if (eliminationSummary) eliminationSummary.remove();
    baseTable.classList.remove('hidden');
    tbody.innerHTML='';
    if (cfg.format === 'americano') {
  // Individual cumulative points table (each team represents a single player for Americano; doubles rotation)
      baseTable.classList.add('hidden');
      const existing = standingsCard.querySelector('#americanoStandings'); if (existing) existing.remove();
      const wrap = document.createElement('div'); wrap.id='americanoStandings'; wrap.style.marginTop='.5rem';
      const table = document.createElement('table'); table.style.width='100%';
      table.innerHTML = '<thead><tr><th>Player</th><th>Points</th><th>Played</th></tr></thead><tbody></tbody>';
      const body = table.querySelector('tbody');
      const points = {}; // playerId -> {name, pts, played}
      // Map team id to name (treated as player)
      for (const [tid, tm] of Object.entries(teams)) { points[tid] = { id:tid, name: tm.name||'Player', pts:0, played:0 }; }
      for (const m of Object.values(matches)) {
        if (m.stage !== 'americano' || !m.scores || m.scores.a==null || m.scores.b==null) continue;
  const aPlayers = m.aPlayers||[]; const bPlayers = m.bPlayers||[];
  // Doubles: each side contributes same points to both players on that side
  aPlayers.forEach(pid=>{ if(points[pid]) { points[pid].pts += m.scores.a; points[pid].played +=1; } });
  bPlayers.forEach(pid=>{ if(points[pid]) { points[pid].pts += m.scores.b; points[pid].played +=1; } });
      }
      const rows = Object.values(points).sort((x,y)=> y.pts - x.pts || x.name.localeCompare(y.name));
      if (!rows.length) body.innerHTML='<tr><td colspan="3" class="muted">No data</td></tr>';
      else rows.forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.name}</td><td>${r.pts}</td><td>${r.played}</td>`; body.appendChild(tr); });
      wrap.appendChild(table); standingsCard.appendChild(wrap);
      return;
    }
    if (cfg.format === 'groups_knockout') {
      const byGroup = groupTeams(teams);
      const groupKeys = Object.keys(byGroup).filter(g=> g && g!=='_UNG').sort();
      if (!groupKeys.length) { tbody.innerHTML='<tr><td colspan="9" class="muted">Assign groups to teams to view standings</td></tr>'; }
      else {
        baseTable.classList.add('hidden');
        for (const g of groupKeys) {
          const wrapper = document.createElement('div'); wrapper.className='group-standings-block'; wrapper.style.marginTop='.75rem';
          const h = document.createElement('h5'); h.textContent = `Group ${g}`; wrapper.appendChild(h);
          const table = document.createElement('table'); table.style.width='100%'; table.innerHTML='<thead><tr><th>Team</th><th>GP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody></tbody>';
          const gBody = table.querySelector('tbody');
          const groupMatches = Object.fromEntries(Object.entries(matches).filter(([mid,m])=> m.stage==='group' && m.group===g));
          const standings = calcStandings(groupMatches, byGroup[g]);
          if (!standings.length) gBody.innerHTML='<tr><td colspan="9" class="muted">No data</td></tr>';
          else standings.forEach(row=>{ const gd=row.gf-row.ga; const tr=document.createElement('tr'); tr.innerHTML=`<td>${row.name}</td><td>${row.gp}</td><td>${row.w}</td><td>${row.d}</td><td>${row.l}</td><td>${row.gf}</td><td>${row.ga}</td><td>${gd}</td><td>${row.pts}</td>`; gBody.appendChild(tr); });
          wrapper.appendChild(table); standingsCard.appendChild(wrapper);
        }
      }
      if (Object.values(matches).some(m=> m.stage==='knockout')) {
        const summaryDiv = document.createElement('div'); summaryDiv.id='eliminationSummary'; summaryDiv.style.marginTop='1rem';
        summaryDiv.innerHTML = buildEliminationSummary(teams, matches);
        standingsCard.appendChild(summaryDiv);
      }
    } else if (cfg.format === 'knockout') {
      baseTable.classList.add('hidden');
      const summaryDiv = document.createElement('div'); summaryDiv.id='eliminationSummary'; summaryDiv.style.marginTop='.75rem';
      summaryDiv.innerHTML = buildEliminationSummary(teams, matches) || '<div class="muted">No matches yet</div>';
      standingsCard.appendChild(summaryDiv);
    } else { // league
      const standings = calcStandings(matches, teams);
      if (!standings.length) { tbody.innerHTML='<tr><td colspan="9" class="muted">No data</td></tr>'; }
      else standings.forEach(row=>{ const gd=row.gf-row.ga; const tr=document.createElement('tr'); tr.innerHTML=`<td>${row.name}</td><td>${row.gp}</td><td>${row.w}</td><td>${row.d}</td><td>${row.l}</td><td>${row.gf}</td><td>${row.ga}</td><td>${gd}</td><td>${row.pts}</td>`; tbody.appendChild(tr); });
    }
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
    const advancePerGroup = t?.config?.advancePerGroup;
    const pointsToWin = t?.config?.pointsToWin; // Americano per-game target (not tournament target)
    // Only schedule approved (non-rejected) teams
    const allTeams = Object.entries(t.teams||{})
      .filter(([id,tm])=> tm.approved && !tm.rejected)
      .map(([id,tm])=> ({id, ...tm}));
    if (allTeams.length < 2) { fixturesMsg.textContent='Need at least 2 teams'; return; }
  // Americano (doubles format): supports >=4 individual players.
  // For a group of exactly 4 players, generate the 3 unique pairings (perfect matchings):
  //  (A+B vs C+D), (A+C vs B+D), (A+D vs B+C).
  // Encounters value controls how many cycles of these pairings are produced.
  // For more than 4 players, players are partitioned into blocks of 4 each encounter (after applying a rotating bye if count is odd).
  // Each block of 4 generates the 3 pairings. Leftover players (<4) in a block are ignored that encounter.
  // If (playersAfterBye % 4)!=0 we still form as many full blocks of 4 as possible; remainder get an implicit bye.
    if (format === 'americano') {
      if (!regen && Object.values(t.matches||{}).some(m=> m.stage==='americano')) { fixturesMsg.textContent='Americano fixtures already generated'; return; }
      if (allTeams.length < 4) { fixturesMsg.textContent='Need at least 4 players'; return; }
      const matchesOut = {}; let matchCounter=0;
      const sortedPlayers = [...allTeams].sort((a,b)=> (a.name||'').localeCompare(b.name||''));
      const n = sortedPlayers.length;
      // Option A: when n % 4 == 2 (e.g., 6,10,14) use n+2 rounds, each round has two rest players and exactly one match with remaining 4 selected players.
      if (n % 4 === 2) {
        const roundsPerEncounter = n + 2;
        // Pre-compute rest quota per player (deterministic distribution)
        const totalRestSlots = roundsPerEncounter * 2; // two rests each round
        const baseRest = Math.floor(totalRestSlots / n);
        let remainder = totalRestSlots - baseRest * n;
        const restRemaining = {};
        sortedPlayers.forEach(p=> { restRemaining[p.id] = baseRest + (remainder>0 ? 1:0); if (remainder>0) remainder--; });
        for (let cycle=1; cycle<= (encounters||1); cycle++) {
          // Fresh partnership memory each encounter (as specified)
          const usedPairs = new Set();
          // Pre-compute universe of partner pairs for coverage tracking
          const allPairs = [];
          for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) allPairs.push([sortedPlayers[i].id, sortedPlayers[j].id].sort().join('-'));
          const unusedPairs = new Set(allPairs);
          // Clone restRemaining for each encounter to preserve distribution per encounter (could also carry over, spec chooses per encounter reset)
          const encounterRestRemaining = JSON.parse(JSON.stringify(restRemaining));
          for (let r=0; r<roundsPerEncounter; r++) {
            const roundNum = r+1 + (cycle-1)*roundsPerEncounter;
            // Evaluate all possible rest pairs (players with remaining rest capacity)
            const restCandidates = sortedPlayers.filter(p=> encounterRestRemaining[p.id] > 0);
            let bestChoice = null; // {restA,restB, pairing, score}
            function pairKey(a,b){ return [a.id,b.id].sort().join('-'); }
            for (let i=0;i<restCandidates.length;i++) {
              for (let j=i+1;j<restCandidates.length;j++) {
                const restA = restCandidates[i]; const restB = restCandidates[j];
                const active = sortedPlayers.filter(p=> p.id!==restA.id && p.id!==restB.id);
                if (active.length < 4) continue;
                // Choose 4 of the active players – heuristic: try all 4-combinations but cap (n small for n%4==2 pattern typical)
                function* combinations(arr,k,start=0,acc=[]) {
                  if (acc.length===k) { yield acc.slice(); return; }
                  for (let idx=start; idx< arr.length; idx++) { acc.push(arr[idx]); yield* combinations(arr,k,idx+1,acc); acc.pop(); }
                }
                for (const four of combinations(active,4)) {
                  const [p0,p1,p2,p3] = four;
                  const pairings = [
                    [[p0,p1],[p2,p3]],
                    [[p0,p2],[p1,p3]],
                    [[p0,p3],[p1,p2]]
                  ];
                  pairings.forEach(pr=>{
                    const [[a1,a2],[b1,b2]] = pr;
                    const keys = [pairKey(a1,a2), pairKey(b1,b2)];
                    // Score: primary = number of NEW pairs introduced (higher better), secondary = total restRemaining after assigning (balance), tertiary = minimize repeats
                    const newCount = keys.reduce((acc,k)=> acc + (unusedPairs.has(k)?1:0),0);
                    const repeatPenalty = keys.reduce((acc,k)=> acc + (usedPairs.has(k)?1:0),0);
                    // Potential future balance metric: sum rest remaining after using these rest players
                    const balanceScore = (encounterRestRemaining[restA.id]-1) + (encounterRestRemaining[restB.id]-1);
                    const score = -(newCount*100) + repeatPenalty*10 - balanceScore; // lower better
                    if (!bestChoice || score < bestChoice.score) {
                      bestChoice = { restA, restB, pairing: pr, score, newCount };
                    }
                  });
                }
              }
            }
            if (!bestChoice) {
              // fallback: pick any two with rest remaining
              const fallbackRests = restCandidates.slice(0,2);
              if (fallbackRests.length===2) bestChoice = { restA: fallbackRests[0], restB: fallbackRests[1], pairing: null, score: 9999, newCount:0 };
            }
            if (bestChoice) {
              const {restA, restB, pairing} = bestChoice;
              encounterRestRemaining[restA.id]--; encounterRestRemaining[restB.id]--;
              if (pairing) {
                const [[a1,a2],[b1,b2]] = pairing;
                const pk1 = pairKey(a1,a2), pk2 = pairKey(b1,b2);
                usedPairs.add(pk1); usedPairs.add(pk2); unusedPairs.delete(pk1); unusedPairs.delete(pk2);
                matchesOut[`mA_optA_${Date.now()}_${++matchCounter}`] = {
                  teamA: `${a1.name} / ${a2.name}`,
                  teamB: `${b1.name} / ${b2.name}`,
                  aPlayers:[a1.id,a2.id],
                  bPlayers:[b1.id,b2.id],
                  stage:'americano',
                  createdAt: Date.now(),
                  round: `Round ${roundNum}`,
                  encounter: cycle,
                  pointsToWin: pointsToWin || 16
                };
              }
              matchesOut[`bye_optA_${cycle}_${roundNum}_${restA.id}`] = { bye:true, stage:'americano', encounter: cycle, round:`Round ${roundNum}`, playerId: restA.id, playerName: restA.name, createdAt: Date.now() };
              matchesOut[`bye_optA_${cycle}_${roundNum}_${restB.id}`] = { bye:true, stage:'americano', encounter: cycle, round:`Round ${roundNum}`, playerId: restB.id, playerName: restB.name, createdAt: Date.now() };
            }
          }
        }
        await updateData(`/tournaments/${code}`, { matches: regen? matchesOut : { ...(t.matches||{}), ...matchesOut } });
        fixturesMsg.textContent='Americano fixtures generated';
        refresh(); return;
      }
      const roundsPerEncounter = (n % 2 === 0) ? (n - 1) : n; // circle method
      function rotate(list) {
        // Keep first fixed, rotate tail right by 1
        const fixed = list[0];
        const tail = list.slice(1);
        tail.unshift(tail.pop());
        return [fixed, ...tail];
      }
      for (let cycle=1; cycle<= (encounters||1); cycle++) {
        let playerList = [...sortedPlayers];
        const usedPairs = new Set(); // partnership memory per encounter
        for (let r=0; r<roundsPerEncounter; r++) {
          const roundNum = r+1 + (cycle-1)*roundsPerEncounter;
          let available = [...playerList];
          let byePlayer = null;
          if (n % 2 === 1) { // odd -> pick rotating bye
            byePlayer = available[r % n];
            available = available.filter(p=> p !== byePlayer);
          }
          const roundMatches = [];
          while (available.length >= 4) {
            let found = false;
            // Attempt pair selection minimizing repeats
            for (let i=0; i<available.length && !found; i++) {
              for (let j=i+1; j<available.length && !found; j++) {
                for (let k=0; k<available.length && !found; k++) {
                  if (k===i || k===j) continue;
                  for (let l=k+1; l<available.length; l++) {
                    if (l===i || l===j) continue;
                    const pair1 = [available[i].id, available[j].id].sort().join('-');
                    const pair2 = [available[k].id, available[l].id].sort().join('-');
                    if (!usedPairs.has(pair1) && !usedPairs.has(pair2)) {
                      const a1=available[i], a2=available[j], b1=available[k], b2=available[l];
                      roundMatches.push([[a1,a2],[b1,b2]]);
                      usedPairs.add(pair1); usedPairs.add(pair2);
                      const removeIds = new Set([a1.id,a2.id,b1.id,b2.id]);
                      available = available.filter(p=> !removeIds.has(p.id));
                      found = true; break;
                    }
                  }
                }
              }
            }
            if (!found) {
              // Fallback sequential pairing on first 4
              const [a1,a2,a3,a4] = available;
              roundMatches.push([[a1,a2],[a3,a4]]);
              const removeIds = new Set([a1.id,a2.id,a3.id,a4.id]);
              available = available.filter(p=> !removeIds.has(p.id));
            }
          }
          // Persist matches
          roundMatches.forEach(pairing=>{
            const [[pA1,pA2],[pB1,pB2]] = pairing;
            matchesOut[`mAm_${Date.now()}_${++matchCounter}`] = {
              teamA: `${pA1.name} / ${pA2.name}`,
              teamB: `${pB1.name} / ${pB2.name}`,
              aPlayers:[pA1.id,pA2.id],
              bPlayers:[pB1.id,pB2.id],
              stage:'americano',
              createdAt: Date.now(),
              round: `Round ${roundNum}`,
              encounter: cycle,
              pointsToWin: pointsToWin || 16
            };
          });
          if (byePlayer) {
            matchesOut[`bye_${cycle}_${roundNum}_${byePlayer.id}`] = { bye:true, stage:'americano', encounter: cycle, round: `Round ${roundNum}`, playerId: byePlayer.id, playerName: byePlayer.name, createdAt: Date.now() };
          }
          playerList = rotate(playerList);
        }
      }
      await updateData(`/tournaments/${code}`, { matches: regen? matchesOut : { ...(t.matches||{}), ...matchesOut } });
      fixturesMsg.textContent='Americano fixtures generated';
      refresh(); return;
    }
    // Knockout direct
    if (format === 'knockout') {
      if (!regen && Object.values(t.matches||{}).some(m=> m.stage==='knockout')) { fixturesMsg.textContent='Knockout fixtures already generated'; return; }
      const teamsShuffled = [...allTeams].sort(()=> Math.random()-0.5);
      const n = teamsShuffled.length;
      const roundLabel = knockoutRoundLabel(n);
      const newMatches = {};
      for (let i=0;i<n;i+=2) {
        if (i+1>=n) {
          newMatches[`m${Date.now()}_${i}`] = { teamA: teamsShuffled[i].name, teamAId: teamsShuffled[i].id, bye:true, stage:'knockout', round: roundLabel, roundNumber:1, createdAt: Date.now() };
        } else {
          const a=teamsShuffled[i], b=teamsShuffled[i+1];
          newMatches[`m${Date.now()}_${i}`] = { teamA:a.name, teamB:b.name, teamAId:a.id, teamBId:b.id, stage:'knockout', round: roundLabel, roundNumber:1, createdAt: Date.now() };
        }
      }
      await updateData(`/tournaments/${code}`, { matches: regen? newMatches : { ...(t.matches||{}), ...newMatches } });
      fixturesMsg.textContent='Knockout fixtures generated';
      refresh(); return;
    }
    // Groups + Knockout
    const filteredTeamsObj = Object.fromEntries(allTeams.map(t=> [t.id, t]));
    let grouped = (format === 'groups_knockout') ? groupTeams(filteredTeamsObj) : null;
    if (format === 'groups_knockout') {
      if (allTeams.length < 4) { fixturesMsg.textContent='Need at least 4 teams for groups'; return; }
      const unGrouped = allTeams.filter(ti=> !ti.group);
      if (unGrouped.length) {
        const groupCount = Math.max(2, Math.ceil(allTeams.length / 4));
        const groupNames = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, groupCount).split('');
        let idx=0;
        for (const tm of allTeams) {
          if (!tm.group) {
            const g = groupNames[idx % groupCount]; idx++;
            await updateData(`/tournaments/${code}/teams/${tm.id}`, { group: g });
            tm.group = g;
          }
        }
        t = await readData(`/tournaments/${code}`).catch(()=>t);
        grouped = groupTeams(Object.fromEntries(allTeams.map(tt=> [tt.id, tt])));
      }
      if (advancePerGroup != null) {
        const groupSizes = Object.values(grouped).map(g=> Object.keys(g).length);
        if (groupSizes.some(sz=> advancePerGroup > sz)) { fixturesMsg.textContent='Advance per group exceeds a group size'; return; }
      }
      const hasKnockout = Object.values(t.matches||{}).some(m=> m.stage==='knockout');
      const hasGroupMatches = Object.values(t.matches||{}).some(m=> m.stage==='group');
      if (!hasGroupMatches || regen) {
        const newMatches = {}; let midCounter=0;
        function scheduleGroupPairs(arr, groupName) {
          for (let i=0;i<arr.length;i++) {
            for (let j=i+1;j<arr.length;j++) {
              const a = arr[i]; const b = arr[j];
              for (let k=0;k<encounters;k++) {
                const swap = k % 2 === 1; const home = swap? b: a; const away= swap? a: b;
                newMatches[`m${Date.now()}_${groupName}_${++midCounter}`] = { teamA: home.name, teamB: away.name, teamAId: home.id, teamBId: away.id, createdAt: Date.now(), encounter: k+1, stage:'group', group: groupName };
              }
            }
          }
        }
        for (const [g, groupTeamsObj] of Object.entries(grouped)) {
          const arr = Object.entries(groupTeamsObj).map(([id,tm])=> ({id, ...tm}));
          scheduleGroupPairs(arr, g);
        }
        await updateData(`/tournaments/${code}`, { matches: regen? newMatches : { ...(t.matches||{}), ...newMatches } });
        fixturesMsg.textContent = 'Group fixtures generated';
        refresh(); return;
      }
      if (!hasKnockout) {
        const groupMatches = Object.values(t.matches||{}).filter(m=> m.stage==='group');
        const incomplete = groupMatches.some(m=> !m.scores || m.scores.a==null || m.scores.b==null);
        if (incomplete) { fixturesMsg.textContent='Complete all group matches before knockout'; return; }
        const byGroupFull = {};
        for (const [gid,gTeams] of Object.entries(grouped)) {
          const gm = Object.fromEntries(Object.entries(t.matches||{}).filter(([mid,m])=> m.stage==='group' && m.group===gid));
          byGroupFull[gid] = calcStandings(gm, gTeams);
        }
        const seeds = [];
        const groupOrder = Object.keys(byGroupFull).sort();
        const maxPos = Math.max(...groupOrder.map(g=> byGroupFull[g].length));
        for (let pos=0; pos<maxPos; pos++) {
          for (const g of groupOrder) {
            if (byGroupFull[g][pos]) seeds.push(byGroupFull[g][pos]);
          }
        }
        const adv = advancePerGroup || 1;
        const advanced = seeds.filter((row,idx)=> Math.floor(idx / groupOrder.length) < adv).slice(0, (adv * groupOrder.length));
        const N = advanced.length;
        if (![2,4,8,16,32].includes(N)) { fixturesMsg.textContent='Advanced teams count not bracket-compatible'; return; }
        const roundLabel = knockoutRoundLabel(N);
        const newMatches = {}; let c=0;
        for (let i=0;i<N/2;i++) {
          const a = advanced[i]; const b = advanced[N-1-i];
          newMatches[`m${Date.now()}_KO_${++c}`] = { teamA:a.name, teamB:b.name, teamAId:a.teamId, teamBId:b.teamId, stage:'knockout', round: roundLabel, roundNumber:1, createdAt: Date.now() };
        }
        await updateData(`/tournaments/${code}`, { matches: { ...(t.matches||{}), ...newMatches } });
        fixturesMsg.textContent='Knockout fixtures generated';
        refresh(); return;
      }
    }
    fixturesMsg.textContent='Nothing to generate';
  }

  function renderFixtures() {
    if (!fixturesList) return;
    fixturesList.innerHTML='';
    const matchesRaw = Object.entries(t.matches||{}).sort((a,b)=> (a[1].createdAt||0)-(b[1].createdAt||0));
    if (!matchesRaw.length) { fixturesList.innerHTML='<div class="muted">No fixtures yet</div>'; return; }
    const groupStageMatches = matchesRaw.filter(([mid,m])=> m.stage==='group');
    const knockoutMatches = matchesRaw.filter(([mid,m])=> m.stage==='knockout');
  const americanoMatches = matchesRaw.filter(([mid,m])=> m.stage==='americano');
    if (groupStageMatches.length) {
      const byGroup = {};
      groupStageMatches.forEach(([mid,m])=>{ if(!byGroup[m.group]) byGroup[m.group]=[]; byGroup[m.group].push([mid,m]); });
      Object.keys(byGroup).sort().forEach(g=>{
        const heading = document.createElement('h4'); heading.textContent = `Group ${g}`; heading.style.margin='1rem 0 .5rem'; fixturesList.appendChild(heading);
        byGroup[g].sort((a,b)=> (a[1].encounter||1)-(b[1].encounter||1));
        byGroup[g].forEach(([mid,m])=> fixturesList.appendChild(renderMatchCard(mid,m)) );
      });
    }
    if (knockoutMatches.length) {
      const byRound = {};
      knockoutMatches.forEach(([mid,m])=>{ const rn=m.roundNumber||1; if(!byRound[rn]) byRound[rn]=[]; byRound[rn].push([mid,m]); });
      Object.keys(byRound).map(n=> parseInt(n,10)).sort((a,b)=> a-b).forEach(rn=>{
        const heading = document.createElement('h4'); heading.textContent = byRound[rn][0][1].round || `Round ${rn}`; heading.style.margin='1rem 0 .5rem'; fixturesList.appendChild(heading);
        byRound[rn].forEach(([mid,m])=> fixturesList.appendChild(renderMatchCard(mid,m)) );
      });
    }
    if (americanoMatches.length) {
      // If rounds are defined (5-player or 7-player schedules) group by round and show rest in heading
      const hasRounds = americanoMatches.some(([mid,m])=> !!m.round);
      if (hasRounds) {
        const byRound = {};
        americanoMatches.forEach(([mid,m])=> { const key = m.round || 'Unlabeled'; if(!byRound[key]) byRound[key]=[]; byRound[key].push([mid,m]); });
        // Sort by numeric round if possible
        const roundKeys = Object.keys(byRound).sort((a,b)=>{
          const na = parseInt(a.replace(/[^0-9]/g,''),10); const nb = parseInt(b.replace(/[^0-9]/g,''),10);
          if (!isNaN(na) && !isNaN(nb)) return na-nb; return a.localeCompare(b);
        });
        // Map team ids for restPlayer lookup (5-player schedule embeds restPlayer on each match)
        const teamNameById = Object.fromEntries(Object.entries(t.teams||{}).map(([id,tm])=> [id, tm.name||id]));
        roundKeys.forEach(rk=>{
          const entries = byRound[rk];
          const restNames = new Set();
          entries.forEach(([mid,m])=>{
            if (m.stage==='americano') {
              if (m.bye && m.playerName) restNames.add(m.playerName);
              else if (m.restPlayer) restNames.add(teamNameById[m.restPlayer] || m.restPlayer);
            }
          });
          const heading = document.createElement('h4');
          if (restNames.size) heading.textContent = `${rk} – Rest: ${Array.from(restNames).join(', ')}`; else heading.textContent = rk;
          heading.style.margin='1rem 0 .5rem';
          fixturesList.appendChild(heading);
          entries.forEach(([mid,m])=> { if (!(m.bye && m.stage==='americano')) fixturesList.appendChild(renderMatchCard(mid,m)); });
        });
      } else {
        const heading = document.createElement('h4'); heading.textContent = 'Americano'; heading.style.margin='1rem 0 .5rem'; fixturesList.appendChild(heading);
        americanoMatches.forEach(([mid,m])=> fixturesList.appendChild(renderMatchCard(mid,m)) );
      }
    }
  if (!groupStageMatches.length && !knockoutMatches.length && !americanoMatches.length) {
      const matches = matchesRaw; const pairEncounterCount={}; const rounds={};
      for (const [mid,m] of matches) { const key=[m.teamAId||m.teamA,m.teamBId||m.teamB].sort().join('|'); let encounterNo=m.encounter; if(!encounterNo){ encounterNo=(pairEncounterCount[key]||0)+1; pairEncounterCount[key]=encounterNo;} else { pairEncounterCount[key]=Math.max(pairEncounterCount[key]||0,encounterNo);} if(!rounds[encounterNo]) rounds[encounterNo]=[]; rounds[encounterNo].push([mid,m]); }
      const roundNumbers = Object.keys(rounds).map(n=> parseInt(n,10)).sort((a,b)=> a-b);
      for (const rNum of roundNumbers) { const heading=document.createElement('h4'); heading.textContent=`Round ${rNum}`; heading.style.margin='1rem 0 .5rem'; fixturesList.appendChild(heading); for (const [mid,m] of rounds[rNum]) fixturesList.appendChild(renderMatchCard(mid,m)); }
    }
    const regenBtn = document.getElementById('regenFixturesBtn');
    regenBtn?.classList.toggle('hidden', !isAdmin || !matchesRaw.length);
  }

  function renderMatchCard(mid,m) {
    const card = document.createElement('div'); card.className='card'; card.style.padding='.6rem .75rem';
    if (m.bye && m.stage==='americano') { return document.createComment('rest displayed in heading'); }
    if (m.bye) { card.innerHTML = `<div><strong>${m.teamA}</strong> advances (bye)</div>`; return card; }
    const scoreStr = (m.scores && m.scores.a!=null && m.scores.b!=null) ? `<strong>${m.scores.a}-${m.scores.b}</strong>` : '<span class="muted">TBD</span>';
    const showRoundBadge = !(m.stage==='americano' && m.round); // hide round badge for grouped Americano
    const showEncounter = m.encounter && ((t?.config?.encounters||1) > 1);
    card.innerHTML = `<div style='display:flex; justify-content:space-between; align-items:center; gap:.75rem; flex-wrap:wrap;'>
      <div><strong>${m.teamA}</strong> vs <strong>${m.teamB||''}</strong> ${scoreStr}${showRoundBadge && m.round?` <span class='badge'>${m.round}</span>`:''}${showEncounter?` <span class='badge'>E${m.encounter}</span>`:''}</div>
      <div class='muted' style='font-size:.75rem;'>${m.date ? new Date(m.date).toLocaleDateString():''}</div>
      </div>`;
    if (isAdmin && !m.bye) {
      const edit=document.createElement('button'); edit.type='button'; edit.className='icon-btn primary'; edit.innerHTML='✎'; edit.title='Enter result';
      edit.addEventListener('click', ()=> editMatch(mid,m));
      card.appendChild(edit);
    }
    return card;
  }

  function knockoutRoundLabel(n) { return ({2:'Final',4:'Semi Final',8:'Quarter Final',16:'Round of 16',32:'Round of 32'})[n] || `Round of ${n}`; }

  function buildEliminationSummary(teams, matches) {
    const knockoutMatches = Object.values(matches).filter(m=> m.stage==='knockout' && !m.bye);
    if (!knockoutMatches.length) return '<div class="muted">No knockout matches yet</div>';
    const losers = new Set(); const winners = new Set();
    knockoutMatches.forEach(m=>{ if (m.scores && m.scores.a!=null && m.scores.b!=null) { if (m.scores.a > m.scores.b) { winners.add(m.teamAId); losers.add(m.teamBId); } else if (m.scores.b > m.scores.a) { winners.add(m.teamBId); losers.add(m.teamAId); } } });
    const teamEntries = Object.entries(teams);
    const eliminated = teamEntries.filter(([id])=> losers.has(id));
    const remaining = teamEntries.filter(([id])=> !losers.has(id));
    return `<div><strong>Remaining:</strong> ${remaining.map(([id,tm])=> tm.name).join(', ')||'None'}</div><div style='margin-top:.25rem;'><strong>Eliminated:</strong> ${eliminated.map(([id,tm])=> tm.name).join(', ')||'None'}</div>`;
  }

  function editMatch(mid, m) {
    if (cfg.format === 'americano' || m.stage==='americano') {
      const aScore = prompt(`${m.teamA} points (to ${m.pointsToWin||t.config?.pointsToWin||16})`, m.scores?.a!=null?m.scores.a:''); if (aScore===null) return;
      const bScore = prompt(`${m.teamB} points (to ${m.pointsToWin||t.config?.pointsToWin||16})`, m.scores?.b!=null?m.scores.b:''); if (bScore===null) return;
      const a = parseInt(aScore,10); const b = parseInt(bScore,10);
      if (isNaN(a) || isNaN(b)) { alert('Invalid points'); return; }
      updateData(`/tournaments/${code}/matches/${mid}`, { scores: { a, b }, updatedAt: Date.now() }).then(refresh);
      return;
    }
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
    const rules = (document.getElementById('rulesText').value||'').trim();
    await updateData(`/tournaments/${code}/config`, { rules });
    document.getElementById('detailsMsg').textContent='Saved';
    refresh();
  });

  async function renderDetails() {
    const wrap = document.getElementById('detailsInfo'); if (!wrap) return;
    wrap.innerHTML='';
    const c = t.config||{};
    const lines = [];
    // Fetch admin user profile to show name & email (fallback to id)
    let adminName = ''; let adminEmail = '';
    if (t.admin){
      try {
        const adminProfile = await readData(`/users/${t.admin}/profile`).catch(()=>null);
        if (adminProfile){ adminName = adminProfile.displayName || adminProfile.name || ''; adminEmail = adminProfile.email || ''; }
      } catch(e) { /* ignore */ }
    }
    if (adminName) lines.push(`<div><strong>Admin:</strong> ${adminName}${adminEmail? ' ('+adminEmail+')':''}</div>`);
    else if (t.admin) lines.push(`<div><strong>Admin:</strong> ${t.admin}</div>`);
    if (c.rules) lines.push(`<div style='white-space:pre-wrap;'>${c.rules}</div>`);
    wrap.innerHTML = lines.join('') || '<div class="muted">No details yet</div>';
    const formEl = document.getElementById('detailsForm');
    if (formEl) formEl.hidden = !isAdmin; // ensure enforced each refresh
    if (isAdmin) {
      const rulesEl = document.getElementById('rulesText'); if (rulesEl) rulesEl.value = c.rules||'';
    } else {
      // Clear textarea value for non-admin (avoids accidental exposure if toggled visible via devtools)
      const rulesEl = document.getElementById('rulesText');
      if (rulesEl) {
        rulesEl.value='';
        // Extra safety: hide textarea and its submit button even if form markup changes
        rulesEl.classList.add('hidden');
        const saveBtn = document.querySelector('#detailsForm button[type="submit"]');
        if (saveBtn) saveBtn.classList.add('hidden');
      }
    }
  }

  refresh();
}

main().catch(console.error);
