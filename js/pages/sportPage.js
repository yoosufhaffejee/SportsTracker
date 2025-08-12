import { initAuth } from "../auth.js";
import { initTournaments } from "../ui/tournaments.js";
import { initSportProgression } from "../ui/sportProgression.js";
import { loadConfig, readData, writeData, pushData, updateData, deleteData } from "../firebase.js";
import { initTabs } from "../ui/tabs.js";
import { setupTheme, initAuthUI } from '../shared/bootstrap.js';

// Page bootstrapper shared by sport pages (padel/tennis/soccer/squash/volleyball)
// Contract:
// - Reads sport id from <body data-sport>
// - Requires the following DOM ids to exist on the page:
//   tournamentAccessForm, tAction, tActionCreateFields, tActionJoinFields,
//   tSport, tFormat, tPublic, joinCode, joinRole, teamNameRow, teamName,
//   myTournaments,
//   sportPlayerSelect, sportRatingControls, sportProgressionRadar, sportOverallScore, sportProgressionTable,
//   sportRecentMatches

function getSportFromDOM() {
  const el = document.body;
  const sport = el?.dataset?.sport;
  if (!sport) throw new Error("Missing data-sport on <body>");
  return sport;
}

function setHeaderUser(user) {
  const panel = document.getElementById("userPanel");
  const name = document.getElementById("userName");
  const avatar = document.getElementById("userAvatar");
  if (!panel || !name || !avatar) return;
  if (user) {
    panel.classList.remove("hidden");
    name.textContent = user.displayName || user.email || "";
    avatar.src = user.photoURL || "";
  } else {
    panel.classList.add("hidden");
  }
}

async function renderRecentMatches(uid, sport) {
  const list = document.getElementById("sportRecentMatches");
  if (!list) return;
  list.innerHTML = "<li class='muted'>Loading…</li>";
  try {
    const history = await readData(`/users/${uid}/history`).catch(() => ({}));
    const recent = Object.entries(history || {})
      .filter(([, h]) => (h?.sport || "") === sport)
      .sort((a, b) => (b[1]?.createdAt || 0) - (a[1]?.createdAt || 0))
      .slice(0, 3)
      .map(([, h]) => h);
    if (!recent.length) {
      list.innerHTML = "<li class='muted'>No recent matches</li>";
      return;
    }
    list.innerHTML = "";
    recent.forEach((m) => {
      const li = document.createElement("li");
      li.className = "clickable";
      const dt = m.createdAt ? new Date(m.createdAt) : null;
      const when = dt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : "";
      const title = m.title || m.type || "Match";
      li.textContent = `${when} · ${title}`;
      li.addEventListener("click", () => {
        alert(`${title}\n${when}\n${sport.toUpperCase()}\n${m.note || ""}`);
      });
      list.appendChild(li);
    });
  } catch (e) {
    list.innerHTML = `<li class='muted'>Failed to load: ${e.message}</li>`;
  }
}

async function main() {
  setupTheme();
  document.addEventListener('DOMContentLoaded', initTabs);

  const sport = getSportFromDOM();
  initAuth();
  initAuthUI({ requireAuth: true, onAuthed: async (user) => {
    setHeaderUser(user);

    const appConfig = await loadConfig().catch(() => ({ sports: {} }));
    // Filter config to this sport so dropdown is locked
    const filtered = { ...appConfig, sports: {} };
    if (appConfig.sports?.[sport]) filtered.sports[sport] = appConfig.sports[sport];

  // Tournaments (locked to this sport)
  initTournaments(user, filtered, sport);

  // Friendlies
  initFriendlies(user, sport);

  // Teams
  initTeams(user, sport);

  // Player sport extra info
  initPlayerExtras(user, sport);
    const tSport = document.getElementById("tSport");
    if (tSport) { tSport.value = sport; tSport.disabled = true; }

    // Progression
    const prog = initSportProgression(user, appConfig);
    prog?.setSport?.(sport);

    // Recent matches (limit 3)
  await renderRecentMatches(user.uid, sport);
  }});
}

main().catch((e) => {
  console.error(e);
});

// Friendlies logic
function initFriendlies(user, sport) {
  const form = document.getElementById('friendlyForm');
  const list = document.getElementById('friendlyList');
  const msg = document.getElementById('friendlyMsg');
  const teamAInput = document.getElementById('friendlyTeamA');
  const teamBInput = document.getElementById('friendlyTeamB');
  const scoreAInput = document.getElementById('friendlyScoreA');
  const scoreBInput = document.getElementById('friendlyScoreB');
  const submitBtn = document.getElementById('friendlySubmitBtn');
  const clearBtn = document.getElementById('friendlyClearBtn');
  let editingId = null; // current friendly being edited
  if (!form || !list) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); msg.textContent='';
    const a = (teamAInput.value||'').trim();
    const b = (teamBInput.value||'').trim();
    if (!a || !b) { msg.textContent='Teams required'; return; }
    const saRaw = (scoreAInput?.value||'').trim();
    const sbRaw = (scoreBInput?.value||'').trim();
    let sa = null, sb = null;
    if (saRaw!=='' && sbRaw!=='') {
      const pa = parseInt(saRaw,10), pb = parseInt(sbRaw,10);
      if (!isNaN(pa) && !isNaN(pb)) { sa=pa; sb=pb; }
    }
    if (editingId) {
      await updateData(`/users/${user.uid}/friendlies/${sport}/${editingId}`, { teamA:a, teamB:b, scoreA:sa, scoreB:sb, updatedAt: Date.now() });
      msg.textContent='Updated';
    } else {
      const rec = { teamA:a, teamB:b, createdAt: Date.now() };
      if (sa!=null && sb!=null) { rec.scoreA=sa; rec.scoreB=sb; }
      await pushData(`/users/${user.uid}/friendlies/${sport}`, rec);
      msg.textContent='Saved';
    }
    editingId = null;
    submitBtn.textContent = 'Save';
    clearBtn.classList.add('hidden');
    form.reset();
    await renderFriendlies();
  });
  if (clearBtn) {
    clearBtn.addEventListener('click', ()=>{
      form.reset(); editingId=null; msg.textContent=''; submitBtn.textContent='Save'; clearBtn.classList.add('hidden');
    });
  }
  async function renderFriendlies() {
    list.innerHTML = '<li class="muted">Loading…</li>';
    const data = await readData(`/users/${user.uid}/friendlies/${sport}`).catch(()=>({}));
    const entries = Object.entries(data||{})
      .filter(([,f])=> !f?.deleted) // skip soft-deleted legacy
      .sort((a,b)=>b[1].createdAt - a[1].createdAt);
    if (!entries.length) { list.innerHTML='<li class="muted">None yet</li>'; return; }
    list.innerHTML='';
    for (const [id, f] of entries) {
      const li = document.createElement('li');
      const when = f.createdAt? new Date(f.createdAt): null;
      const dateStr = when ? when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
      const resHtml = (f.scoreA!=null && f.scoreB!=null) ? `<strong>${f.scoreA}-${f.scoreB}</strong>` : '<span class="muted">No result</span>';
      const left = document.createElement('div'); left.style.display='flex'; left.style.flexDirection='column'; left.innerHTML = `<strong>${dateStr}</strong><span>${f.teamA} vs ${f.teamB}</span>`;
      const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='.5rem';
      const resultSpan = document.createElement('span'); resultSpan.innerHTML = resHtml;
      const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='icon-btn primary'; editBtn.innerHTML='✎'; editBtn.setAttribute('aria-label','Edit friendly');
      editBtn.addEventListener('click', ()=>{
        editingId = id;
        teamAInput.value = f.teamA || '';
        teamBInput.value = f.teamB || '';
        if (scoreAInput && scoreBInput) {
          scoreAInput.value = (f.scoreA!=null)?f.scoreA:'';
          scoreBInput.value = (f.scoreB!=null)?f.scoreB:'';
        }
        submitBtn.textContent = 'Save';
        clearBtn.classList.remove('hidden');
        teamAInput.focus();
      });
  const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.className='icon-btn danger'; delBtn.innerHTML='🗑'; delBtn.setAttribute('aria-label','Delete friendly');
  delBtn.addEventListener('click', async ()=>{ if (!confirm('Delete friendly?')) return; await deleteData(`/users/${user.uid}/friendlies/${sport}/${id}`); renderFriendlies(); });
  actions.append(resultSpan, editBtn, delBtn);
      li.append(left, actions);
      list.appendChild(li);
    }
  }
  renderFriendlies();
}

// Teams logic (simple client-managed teams under a user per sport)
function initTeams(user, sport) {
  const form = document.getElementById('teamForm');
  const list = document.getElementById('teamList');
  const msg = document.getElementById('teamMsg');
  const nameInput = document.getElementById('teamNameInput');
  const editingIdInput = document.getElementById('teamEditingId');
  const submitBtn = document.getElementById('teamSubmitBtn');
  const clearBtn = document.getElementById('teamClearBtn');
  if (!form || !list) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault(); msg.textContent='';
    const name = (nameInput.value||'').trim();
    if (!name) { msg.textContent='Name required'; return; }
    const editingId = editingIdInput.value || null;
    if (editingId) {
      await updateData(`/users/${user.uid}/teams/${sport}/${editingId}`, { name, updatedAt: Date.now() });
      msg.textContent='Updated';
    } else {
      await pushData(`/users/${user.uid}/teams/${sport}`, { name, createdAt: Date.now() });
      msg.textContent='Saved';
    }
    form.reset();
    editingIdInput.value='';
    submitBtn.textContent='Save Team';
    clearBtn.classList.add('hidden');
    renderTeams();
  });
  clearBtn?.addEventListener('click', ()=>{
    form.reset(); editingIdInput.value=''; msg.textContent=''; submitBtn.textContent='Save Team'; clearBtn.classList.add('hidden');
  });
  async function renderTeams() {
    list.innerHTML='<li class="muted">Loading…</li>';
    const data = await readData(`/users/${user.uid}/teams/${sport}`).catch(()=>({}));
    const entries = Object.entries(data||{}).filter(([,t])=> !t.deleted).sort((a,b)=> (a[1].name||'').localeCompare(b[1].name||''));
    if (!entries.length) { list.innerHTML='<li class="muted">None yet</li>'; return; }
    list.innerHTML='';
    for (const [id, t] of entries) {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span'); nameSpan.textContent = t.name;
      const actions = document.createElement('span'); actions.style.display='flex'; actions.style.gap='.4rem';
      const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='icon-btn primary'; editBtn.innerHTML='✎'; editBtn.setAttribute('aria-label','Edit team');
      editBtn.addEventListener('click', ()=>{
        editingIdInput.value = id;
        nameInput.value = t.name || '';
        submitBtn.textContent='Update Team';
        clearBtn.classList.remove('hidden');
        nameInput.focus();
      });
      const viewBtn = document.createElement('button'); viewBtn.type='button'; viewBtn.className='icon-btn success'; viewBtn.innerHTML='👁'; viewBtn.setAttribute('aria-label','View team');
      viewBtn.addEventListener('click', ()=>{
        window.location.href = `./localTeam.html?sport=${encodeURIComponent(sport)}&id=${encodeURIComponent(id)}`;
      });
      const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.className='icon-btn danger'; delBtn.innerHTML='🗑'; delBtn.setAttribute('aria-label','Delete team');
      delBtn.addEventListener('click', async ()=>{ if (!confirm('Delete team?')) return; await updateData(`/users/${user.uid}/teams/${sport}/${id}`, { deleted:true, deletedAt: Date.now() }); renderTeams(); });
      actions.append(editBtn, viewBtn, delBtn);
      li.append(nameSpan, actions);
      list.appendChild(li);
    }
  }
  renderTeams();
}

// Player extra info per sport
function initPlayerExtras(user, sport) {
  const form = document.getElementById('sportPlayerExtraForm');
  const select = document.getElementById('spPlayerSelect');
  const pos = document.getElementById('playerPosition');
  const alt = document.getElementById('playerAltPositions');
  const msg = document.getElementById('playerExtraMsg');
  const list = document.getElementById('playerExtraList');
  if (!form || !select) return;

  async function loadPlayers() {
    // reuse players list under /users/{uid}/players
    const data = await readData(`/users/${user.uid}/players`).catch(()=>({}));
    select.innerHTML='';
    const entries = Object.entries(data||{}).sort((a,b)=> (a[1].name||'').localeCompare(b[1].name||''));
    if (!entries.length) { const opt=document.createElement('option'); opt.textContent='No players'; opt.disabled=true; select.appendChild(opt); return; }
    for (const [pid,p] of entries) {
      const opt = document.createElement('option');
      opt.value=pid; opt.textContent=`${p.name||''} ${p.surname||''}`.trim()||pid;
      select.appendChild(opt);
    }
  }

  async function renderExtras() {
    if (!list) return;
    list.innerHTML='<li class="muted">Loading…</li>';
    const data = await readData(`/users/${user.uid}/playersExtra/${sport}`).catch(()=>({}));
    const entries = Object.entries(data||{});
    if (!entries.length) { list.innerHTML='<li class="muted">None yet</li>'; return; }
    list.innerHTML='';
    for (const [pid, info] of entries) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${pid}</span><span class="muted">${info.position||''} ${(info.altPositions||[]).join(', ')}</span>`;
      list.appendChild(li);
    }
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault(); msg.textContent='';
    const pid = select.value; if (!pid) { msg.textContent='Player required'; return; }
    const position = (pos.value||'').trim();
    const altPositions = (alt.value||'').split(',').map(s=>s.trim()).filter(Boolean);
    await updateData(`/users/${user.uid}/playersExtra/${sport}/${pid}`, { position, altPositions, updatedAt: Date.now() });
    msg.textContent='Saved';
    pos.value=''; alt.value='';
    renderExtras();
  });

  loadPlayers();
  renderExtras();
}
