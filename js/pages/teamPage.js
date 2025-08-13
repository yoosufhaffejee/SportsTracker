import { readData, pushData, updateData, deleteData } from '../firebase.js';
import { setupTheme, initAuthUI } from '../shared/bootstrap.js';

function qs(name){ return new URLSearchParams(location.search).get(name); }

setupTheme();
initAuthUI({ onAuthed: user => init(user) });

async function init(user){
  const sport = qs('sport');
  const code = (qs('code')||'').toUpperCase();
  const teamId = qs('team');
  const backLink = document.getElementById('backLink'); if (backLink && sport && code) backLink.href = `tournament.html?sport=${encodeURIComponent(sport)}&code=${encodeURIComponent(code)}`;
  if (!code || !teamId){ document.getElementById('teamTitle').textContent='Missing params'; return; }
  let tournament = await readData(`/tournaments/${code}`).catch(()=>null);
  if (!tournament){ document.getElementById('teamTitle').textContent='Tournament not found'; return; }
  const team = (tournament.teams||{})[teamId];
  if (!team){ document.getElementById('teamTitle').textContent='Team not found'; return; }
  const isAdmin = tournament.admin === user.uid;
  const isCaptain = team.captain === user.uid;
  const canManage = isAdmin || isCaptain;

  const titleEl = document.getElementById('teamTitle');
  titleEl.textContent = team.name || 'Team';
  document.getElementById('teamSub').textContent = `${sport||tournament.config?.sport||''} • ${code}`;
  const metaDiv = document.getElementById('teamMeta');
  metaDiv.innerHTML = `<span>Team ID: ${teamId}</span>${team.group?`<span>Group: ${team.group}</span>`:''}${team.captain?`<span>Captain: ${team.captain===user.uid?'You':team.captain}</span>`:''}`;

  const form = document.getElementById('teamPlayerForm');
  const nameCombo = document.getElementById('tpNameCombo');
  // Surname removed; full name captured in combo input
  const ageInput = document.getElementById('tpAge');
  const contactInput = document.getElementById('tpContact');
  const submitBtn = document.getElementById('tpSubmitBtn');
  const clearBtn = document.getElementById('tpClearBtn');
  const msgEl = document.getElementById('tpMsg');
  const listEl = document.getElementById('teamPlayersList');
  const datalist = document.getElementById('localPlayersList');

  if (!canManage){
    form?.classList.add('hidden');
  }

  async function loadLocalPlayers(){
    if (!datalist) return {};
    datalist.innerHTML='';
    const local = await readData(`/users/${user.uid}/players`).catch(()=>({}));
    Object.entries(local||{}).forEach(([pid,p])=>{ const opt=document.createElement('option'); opt.value = `${p.name||''} ${p.surname||''}`.trim(); opt.dataset.pid = pid; datalist.appendChild(opt); });
    return local||{};
  }
  let localPlayersCache = await loadLocalPlayers();

  function resetForm(){
  const idInput = document.getElementById('tpId'); if (idInput) idInput.value='';
  if (nameCombo) nameCombo.value='';
  if (ageInput) ageInput.value='';
  if (contactInput) contactInput.value='';
  submitBtn.textContent='Save';
  clearBtn.classList.add('hidden');
  msgEl.textContent='';
  }
  clearBtn?.addEventListener('click', resetForm);

  nameCombo?.addEventListener('change', ()=>{
    const val = nameCombo.value.trim().toLowerCase();
    const match = Object.values(localPlayersCache).find(p=> `${(p.name||'').toLowerCase()} ${(p.surname||'').toLowerCase()}`.trim() === val);
    if (match){ ageInput.value = match.age||''; contactInput.value = match.contact||''; }
  });

  async function refresh(){
    tournament = await readData(`/tournaments/${code}`).catch(()=>tournament);
    const tPlayers = (((tournament.teamPlayers||{})[teamId])||{});
    listEl.innerHTML='';
    const entries = Object.entries(tPlayers);
    if (!entries.length) listEl.innerHTML = '<li class="muted">No players yet</li>';
    entries.sort((a,b)=> ((a[1].name||'').localeCompare(b[1].name||'')) );
    for (const [pid,p] of entries){
      const li=document.createElement('li');
      const left=document.createElement('span'); left.textContent = `${p.name||''}${p.surname? ' '+p.surname:''}`.trim(); li.appendChild(left);
      const actions=document.createElement('span'); actions.style.display='flex'; actions.style.gap='.4rem';
      if (canManage){
        const edit=document.createElement('button'); edit.type='button'; edit.className='icon-btn primary'; edit.innerHTML='✎'; edit.title='Edit';
  edit.addEventListener('click', ()=>{ form.tpId.value=pid; nameCombo.value=`${p.name||''}${p.surname? ' '+p.surname:''}`.trim(); ageInput.value=p.age||''; contactInput.value=p.contact||''; submitBtn.textContent='Save'; clearBtn.classList.remove('hidden'); msgEl.textContent='Editing'; window.scrollTo({top:0,behavior:'smooth'}); });
        const del=document.createElement('button'); del.type='button'; del.className='icon-btn danger'; del.innerHTML='🗑'; del.title='Delete';
        del.addEventListener('click', async ()=>{ if(!confirm('Delete player?')) return; await deleteData(`/tournaments/${code}/teamPlayers/${teamId}/${pid}`); refresh(); });
        actions.append(edit, del);
      }
      li.appendChild(actions); listEl.appendChild(li);
    }
  }

  form?.addEventListener('submit', async (e)=>{
    e.preventDefault(); if (!canManage) return;
    const name = (nameCombo.value||'').trim();
  if (!name){ msgEl.textContent='Name required'; return; }
  if (!contactInput.value.trim()){ msgEl.textContent='Contact number required'; return; }
  // Split full name into name + surname for backward compatibility
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts.shift()||'';
  const surname = parts.join(' ');
    const age = ageInput.value ? Number(ageInput.value) : null;
    const contact = contactInput.value.trim() || null;
  const idInput = document.getElementById('tpId');
  const id = idInput ? idInput.value : '';
  const payload = { name: first, surname, age, contact, updatedAt: Date.now(), createdBy: user.uid };
  if (!id){ await pushData(`/tournaments/${code}/teamPlayers/${teamId}`, { ...payload, createdAt: Date.now() }); msgEl.textContent='Added'; }
  else { await updateData(`/tournaments/${code}/teamPlayers/${teamId}/${id}`, payload); msgEl.textContent='Updated'; }
    resetForm(); refresh();
  });

  refresh();
}
