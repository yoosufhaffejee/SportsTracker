// Tournaments logic: create/join, admin approvals, spectator rendering
import { pushData, readData, updateData, writeData, deleteData } from '../firebase.js';

function genCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function createTournament(user, form, sport) {
  const format = form.querySelector('#tFormat').value || 'league';
  const tName = (form.querySelector('#tName')?.value || '').trim();
  const code = genCode();
  const isPublic = !!form.querySelector('#tPublic')?.checked;
  const config = { sport, format, name: tName || code, createdAt: Date.now(), isPublic };
  // Optional encounters (league + groups_knockout + knockout)
  if (['league','groups_knockout','knockout'].includes(format)) {
    const encountersEl = form.querySelector('#tEncounters');
    if (encountersEl) {
      let encounters = parseInt(encountersEl.value, 10);
      if (isNaN(encounters) || encounters < 1) encounters = 1;
      if (encounters > 4) encounters = 4;
      config.encounters = encounters;
    }
  }
  const data = { config, admin: user.uid };
  await writeData(`/tournaments/${code}`, data);
  // Save under user profile
  await writeData(`/users/${user.uid}/tournaments/created/${code}`, { code, sport, format, name: tName || code, createdAt: Date.now() });
  return code;
}

async function submitJoin(code, role, payload, user, sport) {
  if (role === 'captain') {
    // Create a pending team directly under teams
    const res = await pushData(`/tournaments/${code}/teams`, {
      name: payload.teamName,
      createdAt: Date.now(),
      approved: false,
      rejected: false,
      captain: user.uid,
      requesterUid: user.uid,
      requesterName: payload.displayName || 'Captain'
    });
    await writeData(`/users/${user.uid}/tournaments/joined/${code}`, { code, sport, pending: true, requestedAt: Date.now(), teamName: payload.teamName });
    return res?.name;
  }
  // spectator: save under user
  await writeData(`/users/${user.uid}/tournaments/spectating/${code}`, { code, sport, startedAt: Date.now() });
  return null;
}

async function adminLoad(code) {
  const t = await readData(`/tournaments/${code}`).catch(()=>null);
  return t;
}

export function initTournaments(user, appConfig, sportFilter) {

  // Unified Create/Join form
  const tForm = document.getElementById('tournamentAccessForm');
  const tMsg = document.getElementById('tournamentAccessMsg');
  const tAction = document.getElementById('tAction');
  const joinRole = document.getElementById('joinRole');
  const teamNameRow = document.getElementById('teamNameRow');
  const joinCode = document.getElementById('joinCode');
  const joinFields = document.getElementById('tActionJoinFields');
  const createFields = document.getElementById('tActionCreateFields');
  const formatSelect = document.getElementById('tFormat');
  const encountersRow = document.getElementById('tEncountersRow');
  const encountersLabel = document.getElementById('tEncountersLabel');
  const tClearBtn = document.getElementById('tAccessClearBtn');
  function syncRequirements() {
    const isJoin = tAction?.value === 'join';
    if (joinFields) joinFields.hidden = !isJoin;
    if (createFields) createFields.hidden = isJoin;
    if (joinCode) joinCode.required = !!isJoin; // only required when joining
    const isCaptain = isJoin && joinRole?.value === 'captain';
    if (teamNameRow) teamNameRow.hidden = !isCaptain;
    const teamNameInput = document.getElementById('teamName');
    if (teamNameInput) {
      teamNameInput.required = !!isCaptain;
      if (!isCaptain) teamNameInput.value = '';
    }
    // Toggle required asterisk visibility (hide when spectator)
    if (teamNameRow) {
      const star = teamNameRow.querySelector('.req');
      if (star) star.style.display = isCaptain ? 'inline' : 'none';
    }
    // Manage required state for create-side fields when hidden to avoid browser validation error
    const tNameInput = document.getElementById('tName');
    if (tNameInput) tNameInput.required = !isJoin; // only required when creating / renaming
    if (formatSelect) formatSelect.required = !isJoin; // format only relevant on create
    // Encounters visibility & label
    if (formatSelect && encountersRow) {
      const fmt = formatSelect.value;
      const show = ['league','groups_knockout','knockout'].includes(fmt) && !isJoin;
      encountersRow.hidden = !show;
      const encountersSelect = document.getElementById('tEncounters');
      if (encountersSelect) encountersSelect.required = show; // only required if visible
      if (show && encountersLabel) {
        encountersLabel.textContent = (fmt === 'league') ? 'Encounters' : 'Group Stage Encounters';
      }
    }
  }
  tAction?.addEventListener('change', syncRequirements);
  joinRole?.addEventListener('change', syncRequirements);
  formatSelect?.addEventListener('change', syncRequirements);
  syncRequirements();
  tForm?.addEventListener('submit', async (e)=>{
    e.preventDefault(); tMsg.textContent = '';
    try {
      if (tAction.value === 'create') {
        // Rename existing?
        if (tForm.dataset.editingCode) {
          const code = tForm.dataset.editingCode;
          const newName = (document.getElementById('tName')?.value || '').trim();
          const newFormat = formatSelect?.value || 'league';
          const updateCfg = {};
          if (newName) updateCfg.name = newName;
          if (newFormat) updateCfg.format = newFormat;
          const pubEl = document.getElementById('tPublic');
          if (pubEl) updateCfg.isPublic = !!pubEl.checked;
          // Encounters (only relevant for certain formats)
          if (['league','groups_knockout','knockout'].includes(newFormat)) {
            const encEl = document.getElementById('tEncounters');
            if (encEl) {
              let val = parseInt(encEl.value, 10);
              if (isNaN(val) || val < 1) val = 1;
              if (val > 4) val = 4;
              updateCfg.encounters = val;
            }
          }
          if (Object.keys(updateCfg).length) {
            await updateData(`/tournaments/${code}/config`, updateCfg);
            await updateData(`/users/${user.uid}/tournaments/created/${code}`, { name: updateCfg.name, format: updateCfg.format });
            tMsg.textContent = 'Updated';
          }
          delete tForm.dataset.editingCode;
          const submitBtn = tForm.querySelector('button[type="submit"]'); if (submitBtn) submitBtn.textContent='Save';
          if (tClearBtn) tClearBtn.classList.remove('hidden');
          await renderUserLists();
        } else {
          const code = await createTournament(user, tForm, sportFilter || 'soccer');
          tMsg.textContent = `Created! Code: ${code}`;
          await renderUserLists();
        }
      } else {
        const code = (document.getElementById('joinCode').value || '').trim().toUpperCase();
        const role = joinRole.value;
  const exists = await readData(`/tournaments/${code}`).catch(()=>null);
        if (!exists) throw new Error('not found');
        if (role === 'captain') {
          const teamName = (document.getElementById('teamName').value || '').trim();
          if (!teamName) { tMsg.textContent = 'Team name required'; return; }
          await submitJoin(code, 'captain', { teamName, uid: user.uid, displayName: user.displayName || user.email || 'Captain' }, user, exists?.config?.sport);
          tMsg.textContent = 'Request submitted for approval';
        } else {
          await submitJoin(code, 'spectator', {}, user, exists?.config?.sport);
          tMsg.textContent = 'Added to My Tournaments as Spectating';
        }
        await renderUserLists();
      }
    } catch (err) {
      tMsg.textContent = 'There was a problem. Check the details and try again.';
    }
  });

  // Clear button resets form state
  tClearBtn?.addEventListener('click', ()=>{
    if (!tForm) return;
    tForm.reset?.();
    delete tForm.dataset.editingCode;
    if (tAction) tAction.value = 'create';
    syncRequirements();
    const submitBtn = tForm.querySelector('button[type="submit"]'); if (submitBtn) submitBtn.textContent='Save';
    tMsg.textContent='';
  });

  // Admin manage
  const manageForm = document.getElementById('manageForm');
  const manageMsg = document.getElementById('manageMsg');
  const joinRequestsList = document.getElementById('joinRequestsList');
  const teamsList = document.getElementById('teamsList');

  async function renderManage(t, code) {
    // Check admin
    if (!t || t.admin !== user.uid) {
      manageMsg.textContent = 'Not admin or tournament not found';
      joinRequestsList.innerHTML = '';
      teamsList.innerHTML = '';
      return;
    }
    manageMsg.textContent = `Managing ${code}`;

    // Migrate legacy joinRequests to pending teams if present
    if (t.joinRequests && Object.keys(t.joinRequests).length) {
      for (const [rid, r] of Object.entries(t.joinRequests)) {
        await pushData(`/tournaments/${code}/teams`, { name: r.teamName, createdAt: Date.now(), approved: false, rejected: false, captain: r.uid || null, requesterUid: r.uid || null, requesterName: r.displayName || '' });
        if (r.uid) {
          await updateData(`/users/${r.uid}/tournaments/joined/${code}`, { pending: true, teamName: r.teamName });
        }
        await deleteData(`/tournaments/${code}/joinRequests/${rid}`);
      }
      // Reload tournament data after migration
      t = await adminLoad(code) || t;
    }
    // Pending teams list replaces join requests
    joinRequestsList.innerHTML = '';
    const pendingTeams = Object.entries(t.teams || {}).filter(([tid, tm])=> tm.approved === false && !tm.rejected);
    if (!pendingTeams.length) joinRequestsList.innerHTML = '<li class="muted">No pending teams</li>';
    for (const [tid, tm] of pendingTeams) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${tm.name || 'Team'}${tm.requesterName ? ' — '+tm.requesterName : ''}</span>`;
      const actions = document.createElement('span');
      const approve = document.createElement('button'); approve.textContent='Approve';
      const reject = document.createElement('button'); reject.textContent='Reject';
      approve.addEventListener('click', async ()=>{
        await updateData(`/tournaments/${code}/teams/${tid}`, { approved: true, approvedAt: Date.now() });
        if (tm.requesterUid) await updateData(`/users/${tm.requesterUid}/tournaments/joined/${code}`, { pending:false, approvedAt: Date.now() });
        const fresh = await adminLoad(code); renderManage(fresh, code);
      });
      reject.addEventListener('click', async ()=>{
        await updateData(`/tournaments/${code}/teams/${tid}`, { rejected:true, rejectedAt: Date.now() });
        if (tm.requesterUid) await updateData(`/users/${tm.requesterUid}/tournaments/joined/${code}`, { pending:false, rejected:true, rejectedAt: Date.now() });
        const fresh = await adminLoad(code); renderManage(fresh, code);
      });
      actions.append(approve, reject);
      li.appendChild(actions);
      joinRequestsList.appendChild(li);
    }

    // Teams
    teamsList.innerHTML = '';
    const teams = Object.entries(t.teams || {}).filter(([tid, tm])=> !tm.rejected);
    if (!teams.length) teamsList.innerHTML = '<li class="muted">No teams yet</li>';
    for (const [tid, tm] of teams) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${tm.name || 'Team'}${tm.approved===false?' <span class="badge">Pending</span>':''}</span>`;
      teamsList.appendChild(li);
    }
  }

  manageForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = (document.getElementById('manageCode').value || '').trim().toUpperCase();
    const t = await adminLoad(code).catch(()=>null);
    renderManage(t, code);
  });

  // Spectator rendering (public view)
  const spectateForm = document.getElementById('spectateForm');
  const spectatorView = document.getElementById('spectatorView');
  const spectateTitle = document.getElementById('spectateTitle');
  const spectateTeams = document.getElementById('spectateTeams');
  const spectateStats = document.getElementById('spectateStats');
  const spectateFixtures = document.getElementById('spectateFixtures');
  const spectateBack = document.getElementById('spectateBack');

  spectateBack?.addEventListener('click', () => {
    spectatorView?.classList.add('hidden');
  });

  spectateForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = (document.getElementById('spectateCode').value || '').trim().toUpperCase();
    if (!code) return;
    const t = await readData(`/tournaments/${code}`).catch(()=>null);
  if (!t) { alert('Tournament not found'); return; }
    if (t.config && t.config.isPublic === false) {
      alert('This tournament is private. Only participants can view it.');
      return;
    }
    // Render
    spectateTitle.textContent = `Tournament ${code}`;
    spectatorView?.classList.remove('hidden');

    // Teams (exclude pending or rejected)
    spectateTeams.innerHTML = '';
    const teams = Object.entries(t.teams || {}).filter(([id, tm])=> tm.approved !== false && !tm.rejected);
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

  // Lists: My tournaments & Spectating
  const myList = document.getElementById('myTournaments');
  async function renderUserLists() {
    if (!myList) return;
    const [created, joined, spectating] = await Promise.all([
      readData(`/users/${user.uid}/tournaments/created`).catch(()=>({})),
      readData(`/users/${user.uid}/tournaments/joined`).catch(()=>({})),
      readData(`/users/${user.uid}/tournaments/spectating`).catch(()=>({})),
    ]);
    // My (created + joined)
    myList.innerHTML = '';
    const mine = { ...(created||{}), ...(joined||{}), ...(spectating||{}) };
  let mineItems = Object.keys(mine);
  // Filter out soft-deleted
  mineItems = mineItems.filter(c => !mine[c]?.deleted);
    if (sportFilter) {
      // Filter by sport; gather codes lacking sport metadata
      const lacking = [];
      const keep = [];
      for (const code of mineItems) {
        const rec = mine[code];
        if (rec && rec.sport) {
          if (rec.sport === sportFilter) keep.push(code);
        } else {
          lacking.push(code);
        }
      }
      if (lacking.length) {
        // Fetch tournaments to determine sport
        const fetched = await Promise.all(lacking.map(async c => {
          const t = await readData(`/tournaments/${c}`).catch(()=>null);
          return [c, t?.config?.sport];
        }));
        for (const [code, sp] of fetched) {
          if (sp === sportFilter) keep.push(code);
        }
      }
      mineItems = keep;
    }
    if (!mineItems.length) myList.innerHTML = '<li class="muted">None yet</li>';
    for (const code of mineItems) {
      const li = document.createElement('li');
      const rec = created?.[code] || joined?.[code] || spectating?.[code] || {};
  let roleLabel;
  if (created?.[code]) roleLabel = 'Admin';
  else if (joined?.[code]) roleLabel = rec.pending ? 'Pending' : 'Participant';
  else roleLabel = 'Spectator';
  const roleBadge = `<span class="badge">${roleLabel}</span>`;
      const nameDisplay = rec.name ? `${rec.name} (${code})` : code;
      const left = document.createElement('span'); left.innerHTML = `${nameDisplay} ${roleBadge}`;
      const actions = document.createElement('span'); actions.style.display='flex'; actions.style.gap='.4rem';
  const viewBtn = document.createElement('button'); viewBtn.type='button'; viewBtn.className='icon-btn success'; viewBtn.innerHTML='👁'; viewBtn.title='View';
  viewBtn.addEventListener('click', (e)=>{ e.stopPropagation(); if (sportFilter) window.location.href = `tournament.html?sport=${encodeURIComponent(sportFilter)}&code=${encodeURIComponent(code)}`; });
      const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='icon-btn primary'; editBtn.innerHTML='✎'; editBtn.title='Rename';
      editBtn.addEventListener('click', async (e)=>{
        e.stopPropagation();
        if (!created?.[code]) { alert('Only admin can edit'); return; }
        const tNameInput = document.getElementById('tName');
        const tAction = document.getElementById('tAction');
        if (tAction) tAction.value = 'create';
        const tActionCreateFields = document.getElementById('tActionCreateFields');
        const tActionJoinFields = document.getElementById('tActionJoinFields');
        if (tActionCreateFields) tActionCreateFields.hidden = false;
        if (tActionJoinFields) tActionJoinFields.hidden = true;
        // Load latest tournament config to prefill format & encounters
        let tConfig = null;
        try {
          const tFull = await readData(`/tournaments/${code}`);
          tConfig = tFull?.config || {};
        } catch {}
  if (tNameInput) tNameInput.value = tConfig?.name || rec.name || '';
        if (formatSelect && tConfig?.format) formatSelect.value = tConfig.format;
        // Prefill encounters if available
        const encInput = document.getElementById('tEncounters');
        if (encInput && (tConfig?.encounters != null)) encInput.value = tConfig.encounters;
  const pubEl = document.getElementById('tPublic'); if (pubEl) pubEl.checked = !!tConfig.isPublic;
        // Re-run requirement logic to reveal encounters row if needed
        syncRequirements();
        const form = document.getElementById('tournamentAccessForm');
        const submitBtn = form?.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.textContent='Save';
        form.dataset.editingCode = code;
        if (tClearBtn) tClearBtn.classList.remove('hidden');
      });
      const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.className='icon-btn danger'; delBtn.innerHTML='🗑'; delBtn.title='Delete (soft)';
      delBtn.addEventListener('click', async (e)=>{
        e.stopPropagation();
        if (!created?.[code]) { alert('Only admin can delete'); return; }
        if (!confirm('Soft-delete this tournament from your list?')) return;
        await updateData(`/users/${user.uid}/tournaments/created/${code}`, { deleted: true, deletedAt: Date.now() });
        await renderUserLists();
      });
      actions.append(viewBtn, editBtn, delBtn);
      li.append(left, actions);
      li.addEventListener('click', ()=>{ if (sportFilter) window.location.href = `tournament.html?sport=${encodeURIComponent(sportFilter)}&code=${encodeURIComponent(code)}`; });
      myList.appendChild(li);
    }
  }

  renderUserLists();
}
