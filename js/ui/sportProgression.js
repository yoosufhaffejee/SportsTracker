import { getPlayersPath, readData, updateData, pushData } from '../firebase.js';
import { renderRadar } from '../charts.js';

// Attribute sets per sport. Racket share a common base.
const RACKET_ATTRS = ['Serve','Return','Forehand','Backhand','Volley','Footwork','Tactical','Mental'];
const ATTRS_BY_SPORT = {
  soccer: ['Shooting','Passing','Dribbling','Pace','Defending','Physical','Vision','Goalkeeping'],
  volleyball: ['Serving','Passing','Setting','Spiking','Blocking','Defense','Athleticism','Communication'],
  padel: RACKET_ATTRS,
  tennis: RACKET_ATTRS,
  squash: RACKET_ATTRS,
};

export function initSportProgression(user, appConfig) {
  if (!user) return;
  const selector = document.getElementById('sportPlayerSelect');
  const controls = document.getElementById('sportRatingControls');
  const radarCanvas = document.getElementById('sportProgressionRadar');
  const overallEl = document.getElementById('sportOverallScore');
  const table = document.getElementById('sportProgressionTable');
  const sportHubTitle = document.getElementById('sportHubTitle');

  let radar = null;
  let current = { id: null, sport: null, attrs: [] };

  function computeOverall(ratings) {
    const vals = Object.values(ratings || {}).map(v => Number(v) || 0);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  }

  function getAttrsForSport(sportKey) {
    return ATTRS_BY_SPORT[sportKey] || RACKET_ATTRS;
  }

  function getRatingsFromUI() {
    const ratings = {};
    for (const wrap of controls.querySelectorAll('.rating')) {
      const key = wrap.dataset.key;
      const val = Number(wrap.querySelector('input').value);
      ratings[key.toLowerCase()] = val;
    }
    return ratings;
  }

  function renderControls(ratings) {
    controls.innerHTML = '';
    for (const key of current.attrs) {
      const wrap = document.createElement('div');
      wrap.className = 'rating';
      const label = document.createElement('label');
      label.textContent = key;
      const input = document.createElement('input');
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
      input.value = ratings?.[key.toLowerCase()] ?? 50;
      input.addEventListener('input', () => {
        const r = getRatingsFromUI();
        overallEl.textContent = `Overall: ${computeOverall(r)}`;
      });
      const row = document.createElement('div'); row.className = 'inline';
      const minus = document.createElement('button'); minus.type='button'; minus.textContent='-'; minus.addEventListener('click', ()=>{ input.value = Math.max(0, Number(input.value)-1); input.dispatchEvent(new Event('input'));});
      const plus = document.createElement('button'); plus.type='button'; plus.textContent='+'; plus.addEventListener('click', ()=>{ input.value = Math.min(100, Number(input.value)+1); input.dispatchEvent(new Event('input'));});
      row.append(minus, input, plus);
      wrap.append(label, row);
      wrap.dataset.key = key;
      controls.appendChild(wrap);
    }
    const saveRow = document.createElement('div'); saveRow.className = 'row';
    const createBtn = document.createElement('button'); createBtn.type = 'button'; createBtn.textContent = 'Create Snapshot';
    const updateBtn = document.createElement('button'); updateBtn.type = 'button'; updateBtn.textContent = 'Update Snapshot';
    const saveMsg = document.createElement('span'); saveMsg.className = 'muted'; saveMsg.style.marginLeft = '8px';
    saveRow.append(createBtn, updateBtn, saveMsg);
    controls.appendChild(saveRow);
    async function persistSnapshot(merge=false) {
      if (!current.id || !current.sport) return;
      const ratings = getRatingsFromUI();
      const overall = computeOverall(ratings);
      overallEl.textContent = `Overall: ${overall}`;
      const now = Date.now();
      const playerPath = `${getPlayersPath(user.uid)}/${current.id}`;
      // Load existing once so we can deep merge safely
      const player = await readData(playerPath).catch(()=>null) || {};
      const existingProgAll = player.sportProgression || {};
      const existingProgForSport = existingProgAll[current.sport] || {};
      let updatedProgForSport = { ...existingProgForSport };
      if (merge) {
        // Find latest snapshot key and replace its content
        const latest = Object.entries(existingProgForSport).sort((a,b)=> (b[1]?.at||0)-(a[1]?.at||0))[0];
        if (latest) {
          updatedProgForSport[latest[0]] = { ratings, overall, at: now };
        } else {
          const pushRes = await pushData(`${playerPath}/sportProgression/${current.sport}`, { ratings, overall, at: now });
          // push already wrote; fetch key result just for local state
          updatedProgForSport[pushRes.name] = { ratings, overall, at: now };
        }
      } else {
        // New snapshot: use push to avoid key conflicts & invalid chars
        const pushRes = await pushData(`${playerPath}/sportProgression/${current.sport}`, { ratings, overall, at: now });
        updatedProgForSport[pushRes.name] = { ratings, overall, at: now };
      }
      const newSportProgression = { ...existingProgAll, [current.sport]: updatedProgForSport };
      const newSportRatings = { ...(player.sportRatings||{}), [current.sport]: { ratings, overall, updatedAt: now } };
      await updateData(playerPath, {
        sportProgression: newSportProgression,
        sportRatings: newSportRatings,
        updatedAt: now
      });
      saveMsg.textContent = 'Saved!'; setTimeout(()=> saveMsg.textContent = '', 2000);
      renderHistory(current.id, current.sport);
      const labels = current.attrs;
      const data = labels.map(k => ratings[k.toLowerCase()] ?? 0);
      if (radar) { radar.data.labels = labels; radar.data.datasets[0].data = data; radar.update(); }
      else { radar = renderRadar(radarCanvas, labels, data, { label: 'Skill Profile' }); }
    }
    createBtn.addEventListener('click', ()=>persistSnapshot(false));
    updateBtn.addEventListener('click', ()=>persistSnapshot(true));
  }

  async function renderHistory(playerId, sportKey) {
    if (!table) return;
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    const player = await readData(`${getPlayersPath(user.uid)}/${playerId}`).catch(()=>null);
    const prog = player?.sportProgression?.[sportKey] || {};
    const rows = Object.entries(prog).sort((a,b)=> (b[1]?.at||0)-(a[1]?.at||0));
    if (!rows.length) {
      const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan=2; td.className='muted'; td.textContent='No history yet'; tr.appendChild(td); tbody.appendChild(tr); return;
    }
    for (const [date, snap] of rows) {
      const tr = document.createElement('tr');
  const tdD = document.createElement('td');
  // date key may be iso string
  try { tdD.textContent = new Date(snap.at || date).toLocaleString([], {hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short'}); } catch { tdD.textContent = date; }
      const tdO = document.createElement('td'); tdO.textContent = String(snap.overall ?? '');
      tr.style.cursor = 'pointer'; tr.title = 'Load this snapshot';
      tr.addEventListener('click', ()=>{
        const ratings = snap.ratings || {};
        renderControls(ratings);
        overallEl.textContent = `Overall: ${String(snap.overall ?? 0)}`;
        const labels = current.attrs;
        const data = labels.map(k => ratings[k.toLowerCase()] ?? 0);
        if (radar) radar.destroy();
        radar = renderRadar(radarCanvas, labels, data, { label: 'Skill Profile' });
      });
      tr.append(tdD, tdO); tbody.appendChild(tr);
    }
  }

  async function refreshPlayers() {
    selector.innerHTML = '<option value="">Select a player</option>';
    const players = await readData(getPlayersPath(user.uid)).catch(()=>({}));
    for (const [id, p] of Object.entries(players||{})) {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = `${p.name||''} ${p.surname||''}`.trim();
      selector.appendChild(opt);
    }
  }

  // External hook: when sport hub opens, call setSport with the sport key
  async function setSport(sportKey) {
    current.sport = sportKey;
    current.attrs = getAttrsForSport(sportKey);
    await refreshPlayers();
    // Clear UI
    controls.innerHTML = '';
    table.querySelector('tbody').innerHTML = '';
    overallEl.textContent = '';
    if (radar) { radar.destroy(); radar = null; }
  }

  selector?.addEventListener('change', async () => {
    const id = selector.value; if (!id || !current.sport) return;
    current.id = id;
    const player = await readData(`${getPlayersPath(user.uid)}/${id}`).catch(()=>null);
    const ratings = player?.sportRatings?.[current.sport]?.ratings || {};
    renderControls(ratings);
    overallEl.textContent = `Overall: ${computeOverall(ratings)}`;
    const labels = current.attrs;
    const data = labels.map(k => ratings[k.toLowerCase()] ?? 0);
    if (radar) radar.destroy();
    radar = renderRadar(radarCanvas, labels, data, { label: 'Skill Profile' });
    renderHistory(id, current.sport);
  });

  // Expose setter so home.js can pick current sport
  return { setSport };
}
