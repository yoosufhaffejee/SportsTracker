import { getPlayersPath, readData, updateData } from '../firebase.js';
import { renderRadar } from '../charts.js';

const ATTRS_DEFAULT = ['Shooting','Passing','Dribbling','Pace','Defending','Physical','Goalkeeping'];

export function initPlayerProgression(user, appConfig) {
  if (!user) return;
  const selector = document.getElementById('playerSelect');
  const controls = document.getElementById('ratingControls');
  const radarCanvas = document.getElementById('progressionRadar');
  const overallEl = document.getElementById('overallScore');

  let radar = null;
  let current = { id: null, data: null };

  function getAttrs() {
    const fromCfg = appConfig?.attributes?.coreRatings;
    return Array.isArray(fromCfg) && fromCfg.length ? fromCfg : ATTRS_DEFAULT;
  }

  function computeOverall(ratings) {
    const vals = Object.values(ratings || {}).map(v => Number(v) || 0);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
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
    const attrs = getAttrs();
    for (const key of attrs) {
      const wrap = document.createElement('div');
      wrap.className = 'rating';
      const label = document.createElement('label');
      label.textContent = key;
      const input = document.createElement('input');
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
      input.value = ratings?.[key.toLowerCase()] ?? ratings?.[key] ?? 50;
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
    // Add Save button under controls
  const saveRow = document.createElement('div'); saveRow.className = 'row';
  const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.textContent = 'Create Snapshot';
    const saveMsg = document.createElement('span'); saveMsg.className = 'muted'; saveMsg.style.marginLeft = '8px';
    saveRow.append(saveBtn, saveMsg);
    controls.appendChild(saveRow);

    saveBtn.addEventListener('click', async () => {
      if (!current.id) return;
      const ratings = getRatingsFromUI();
      const overall = computeOverall(ratings);
      overallEl.textContent = `Overall: ${overall}`;
  // Save snapshot under progression/{date}
  const dateKey = new Date().toISOString().slice(0,10); // YYYY-MM-DD
      await updateData(`${getPlayersPath(user.uid)}/${current.id}`, {
        ratings, overall, updatedAt: Date.now(),
        progression: { [dateKey]: { ratings, overall, at: Date.now() } }
      });
      saveMsg.textContent = 'Saved!'; setTimeout(()=> saveMsg.textContent = '', 2000);
      // update chart
      const labels = getAttrs();
      const data = labels.map(k => ratings[k.toLowerCase()] ?? 0);
      if (radar) { radar.data.labels = labels; radar.data.datasets[0].data = data; radar.update(); }
      else { radar = renderRadar(radarCanvas, labels, data, { label: 'Skill Profile' }); }
      // refresh history table
  const player = await readData(`${getPlayersPath(user.uid)}/${current.id}`).catch(()=>null);
      renderHistoryTable(player||{ progression: { [dateKey]: { overall, at: Date.now() } } });
    });
  }

  function renderHistoryTable(player) {
    const table = document.getElementById('progressionTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    const prog = player?.progression || {};
    const rows = Object.entries(prog).sort((a,b)=> (b[1]?.at||0)-(a[1]?.at||0));
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 2; td.className = 'muted'; td.textContent = 'No history yet';
      tr.appendChild(td); tbody.appendChild(tr); return;
    }
    for (const [date, snap] of rows) {
      const tr = document.createElement('tr');
      const tdD = document.createElement('td'); tdD.textContent = date;
      const tdO = document.createElement('td'); tdO.textContent = String(snap.overall ?? '');
      tr.style.cursor = 'pointer';
      tr.title = 'Load this snapshot';
      tr.addEventListener('click', ()=>{
        // Load snapshot into controls and chart
        const ratings = snap.ratings || {};
        renderControls(ratings);
        overallEl.textContent = `Overall: ${String(snap.overall ?? computeOverall(ratings))}`;
        const labels = getAttrs();
        const data = labels.map(k => ratings[k.toLowerCase()] ?? 0);
        if (radar) radar.destroy();
        radar = renderRadar(radarCanvas, labels, data, { label: 'Skill Profile' });
      });
      tr.append(tdD, tdO); tbody.appendChild(tr);
    }
  }

  selector?.addEventListener('change', async () => {
    const id = selector.value;
    if (!id) return;
    const player = await readData(`${getPlayersPath(user.uid)}/${id}`).catch(()=>null);
    current = { id, data: player };
    const ratings = player?.ratings || {};
    renderControls(ratings);
    overallEl.textContent = `Overall: ${computeOverall(ratings)}`;
    const labels = getAttrs();
    const data = labels.map(k => ratings[k.toLowerCase()] ?? 0);
    if (radar) radar.destroy();
    radar = renderRadar(radarCanvas, labels, data, { label: 'Skill Profile' });
    renderHistoryTable(player);
  });
}
