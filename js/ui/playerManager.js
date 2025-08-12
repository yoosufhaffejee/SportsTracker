import { getPlayersPath, readData, pushData, updateData, deleteData } from '../firebase.js';

export function initPlayerManager(user) {
  if (!user) return;
  const list = document.getElementById('playerList');
  const form = document.getElementById('playerForm');
  const msg = document.getElementById('playerFormMsg');
  const resetBtn = document.getElementById('resetPlayerForm');

  function setForm(p = {}, id = '') {
    form.id.value = id || '';
    form.name.value = p.name || '';
    form.surname.value = p.surname || '';
    form.age.value = p.age || '';
    form.contact.value = p.contact || '';
    msg.textContent = '';
  }

  async function refresh() {
    const players = await readData(getPlayersPath(user.uid)).catch(() => ({}));
    // list
  if (!list) return;
  list.innerHTML = '';
    const items = Object.entries(players || {});
    if (!items.length) list.innerHTML = '<li class="muted">No players yet</li>';
    for (const [id, p] of items) {
      const li = document.createElement('li');
      const title = document.createElement('span');
      title.textContent = `${p.name || ''} ${p.surname || ''}`.trim();
      title.style.cursor = 'pointer';
      title.addEventListener('click', () => setForm(p, id));
      const actions = document.createElement('span');
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        await deleteData(`${getPlayersPath(user.uid)}/${id}`);
        refresh();
      });
      actions.appendChild(del);
      li.appendChild(title);
      li.appendChild(actions);
      list.appendChild(li);
    }
  // player dropdown removed from Players page; sport views populate their own selectors
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.id.value;
    const data = {
      name: form.name.value.trim(),
      surname: form.surname.value.trim(),
      age: form.age.value ? Number(form.age.value) : null,
      contact: form.contact.value.trim() || null,
    };
    if (!data.name || !data.surname) {
      msg.textContent = 'Name and Surname are required.';
      return;
    }
    if (!id) {
      // Uniqueness: name + surname combination (case-insensitive)
      const existing = await readData(getPlayersPath(user.uid)).catch(() => ({}));
      const clash = Object.values(existing || {}).find(p => (
        (p?.name || '').trim().toLowerCase() === data.name.toLowerCase() &&
        (p?.surname || '').trim().toLowerCase() === data.surname.toLowerCase()
      ));
      if (clash) { msg.textContent = 'A player with that Name + Surname already exists.'; return; }
      await pushData(getPlayersPath(user.uid), { ...data, createdAt: Date.now() });
      msg.textContent = 'Saved!';
    } else {
      await updateData(`${getPlayersPath(user.uid)}/${id}`, { ...data, updatedAt: Date.now() });
      msg.textContent = 'Updated!';
    }
    form.reset();
    refresh();
  });

  resetBtn?.addEventListener('click', () => { form.reset(); setForm(); });

  refresh();
}
