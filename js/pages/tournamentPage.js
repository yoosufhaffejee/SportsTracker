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
    // Only schedule approved (non-rejected) teams
    const allTeams = Object.entries(t.teams||{})
      .filter(([id,tm])=> tm.approved && !tm.rejected)
      .map(([id,tm])=> ({id, ...tm}));
    if (allTeams.length < 2) { fixturesMsg.textContent='Need at least 2 teams'; return; }
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
    if (!groupStageMatches.length && !knockoutMatches.length) {
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
    if (m.bye) { card.innerHTML = `<div><strong>${m.teamA}</strong> advances (bye)</div>`; return card; }
    const scoreStr = (m.scores && m.scores.a!=null && m.scores.b!=null) ? `<strong>${m.scores.a}-${m.scores.b}</strong>` : '<span class="muted">TBD</span>';
    card.innerHTML = `<div style='display:flex; justify-content:space-between; align-items:center; gap:.75rem; flex-wrap:wrap;'>
      <div><strong>${m.teamA}</strong> vs <strong>${m.teamB||''}</strong> ${scoreStr}</div>
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
      const rulesEl = document.getElementById('rulesText'); if (rulesEl) rulesEl.value='';
    }
  }

  refresh();
}

main().catch(console.error);
