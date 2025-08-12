import { initAuth } from '../auth.js';
import { setupTheme, initAuthUI } from '../shared/bootstrap.js';
import { readData, pushData, updateData } from '../firebase.js';

setupTheme();

function getParams(){
  const u = new URL(window.location.href);
  return { sport: u.searchParams.get('sport')||'', id: u.searchParams.get('id')||'' };
}

function setHeaderUser(user){
  const panel = document.getElementById('userPanel');
  const name = document.getElementById('userName');
  const avatar = document.getElementById('userAvatar');
  if (!panel||!name||!avatar) return;
  if (user){ panel.classList.remove('hidden'); name.textContent=user.displayName||user.email||''; avatar.src=user.photoURL||''; } else { panel.classList.add('hidden'); }
}

initAuth();
initAuthUI({ requireAuth: true, onAuthed: async (user)=>{ setHeaderUser(user); await main(user); }});

async function main(user){
  const { sport, id } = getParams();
  if (!sport || !id){ alert('Missing team reference'); return; }
  const title = document.getElementById('teamTitle');
  title.textContent = 'Team';
  document.getElementById('teamSub').textContent = sport.toUpperCase();
  await renderPlayers(user, sport, id);
  initPlayerForm(user, sport, id);
}

function initPlayerForm(user, sport, teamId){
  const form = document.getElementById('localTeamPlayerForm');
  const msg = document.getElementById('ltpMsg');
  const idInput = document.getElementById('ltpId');
  const nameInput = document.getElementById('ltpName');
  const ageInput = document.getElementById('ltpAge');
  const contactInput = document.getElementById('ltpContact');
  const submitBtn = document.getElementById('ltpSubmitBtn');
  const clearBtn = document.getElementById('ltpClearBtn');
  const datalistId = 'localPlayersDatalist';
  // Attach datalist dynamically
  if (!document.getElementById(datalistId)){
    const dl = document.createElement('datalist'); dl.id = datalistId; document.body.appendChild(dl); nameInput.setAttribute('list', datalistId);
  }
  async function loadGlobalPlayers(){
    const dl = document.getElementById(datalistId); if (!dl) return {};
    dl.innerHTML='';
    const data = await readData(`/users/${user.uid}/players`).catch(()=>({}));
    Object.entries(data||{}).forEach(([pid,p])=>{ const opt=document.createElement('option'); opt.value=`${p.name||''} ${p.surname||''}`.trim(); opt.dataset.pid=pid; dl.appendChild(opt); });
    return data||{};
  }
  let globalPlayers = {};
  loadGlobalPlayers().then(g=> globalPlayers=g);
  nameInput?.addEventListener('change', ()=>{
    const val = nameInput.value.trim().toLowerCase();
    const match = Object.values(globalPlayers).find(p=> `${(p.name||'').toLowerCase()} ${(p.surname||'').toLowerCase()}`.trim() === val);
    if (match){ if (match.age!=null) ageInput.value = match.age; if (match.contact) contactInput.value = match.contact; }
  });
  if (!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault(); msg.textContent='';
    const full = (nameInput.value||'').trim();
    if (!full){ msg.textContent='Name required'; return; }
    const contact = (contactInput.value||'').trim();
    if (!contact){ msg.textContent='Contact required'; return; }
    const parts = full.split(/\s+/).filter(Boolean);
    const first = parts.shift()||''; const surname = parts.join(' ');
    const age = ageInput.value ? parseInt(ageInput.value,10) : null;
    const editingId = idInput.value || null;
    const payload = { name:first, surname, contact, age, updatedAt: Date.now() };
    if (editingId){
      await updateData(`/users/${user.uid}/teams/${sport}/${teamId}/players/${editingId}`, payload);
      msg.textContent='Updated';
    } else {
      await pushData(`/users/${user.uid}/teams/${sport}/${teamId}/players`, { ...payload, createdAt: Date.now() });
      msg.textContent='Added';
    }
    form.reset(); idInput.value=''; submitBtn.textContent='Add'; clearBtn.classList.add('hidden');
    await renderPlayers(user, sport, teamId);
  });
  clearBtn?.addEventListener('click', ()=>{ form.reset(); idInput.value=''; msg.textContent=''; submitBtn.textContent='Add'; clearBtn.classList.add('hidden'); });
}

async function renderPlayers(user, sport, teamId){
  const list = document.getElementById('localTeamPlayersList');
  if (!list) return; list.innerHTML='<li class="muted">Loading…</li>';
  const data = await readData(`/users/${user.uid}/teams/${sport}/${teamId}/players`).catch(()=>({}));
  const entries = Object.entries(data||{}).filter(([,p])=> !p.deleted).sort((a,b)=> (a[1].name||'').localeCompare(b[1].name||''));
  if (!entries.length){ list.innerHTML='<li class="muted">No players</li>'; return; }
  list.innerHTML='';
  for (const [pid,p] of entries){
  const li = document.createElement('li');
  const fullName = `${p.name||''}${p.surname? ' '+p.surname:''}`.trim();
  const left = document.createElement('span'); left.innerHTML = `<strong>${fullName||'Player'}</strong>${p.age? ' <span class=\"muted\">'+p.age+'</span>':''}`;
    const actions = document.createElement('span'); actions.style.display='flex'; actions.style.gap='.4rem';
    const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='icon-btn primary'; editBtn.innerHTML='✎'; editBtn.setAttribute('aria-label','Edit');
    editBtn.addEventListener('click', ()=>{
      document.getElementById('ltpId').value = pid;
      document.getElementById('ltpName').value = fullName;
      document.getElementById('ltpAge').value = p.age!=null? p.age:'';
      document.getElementById('ltpContact').value = p.contact||'';
      document.getElementById('ltpSubmitBtn').textContent='Update';
      document.getElementById('ltpClearBtn').classList.remove('hidden');
      window.scrollTo({ top:0, behavior:'smooth' });
    });
    const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.className='icon-btn danger'; delBtn.innerHTML='🗑'; delBtn.setAttribute('aria-label','Delete');
    delBtn.addEventListener('click', async ()=>{ if (!confirm('Delete player?')) return; await updateData(`/users/${user.uid}/teams/${sport}/${teamId}/players/${pid}`, { deleted:true, deletedAt: Date.now() }); renderPlayers(user, sport, teamId); });
    actions.append(editBtn, delBtn);
    li.append(left, actions);
    list.appendChild(li);
  }
}
