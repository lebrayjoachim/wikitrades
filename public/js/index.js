let sortCol = 'rarity', sortDir = 'asc';
let searchTimer = null;
let visibleRows = [];
let currentData = [];

async function loadCards() {
  const q       = document.getElementById('search').value.trim();
  const checked = [...document.querySelectorAll('#rarities input:checked')].map(i => i.value);
  const params  = new URLSearchParams({ order: `${sortCol}.${sortDir}` });
  if (q)              params.set('q', q);
  if (checked.length) params.set('r', checked.join(','));

  const res  = await fetch(`/api/cards?${params}`);
  const data = await res.json();

  document.getElementById('err').textContent = data.error ?? '';
  if (data.error) return;

  currentData = data;
  rebuildTagFilters(data);
  renderTable(data);
  document.getElementById('count').textContent = `${data.length} carte(s)`;
}

function rebuildTagFilters(rows) {
  const allTags = new Set(['no-tag']);
  for (const r of rows) {
    if (r.tags) r.tags.forEach(t => allTags.add(t));
  }

  const container = document.getElementById('tag-filters');
  const prevState = new Map([...container.querySelectorAll('input')].map(i => [i.value, i.checked]));

  container.innerHTML = [...allTags].map(tag => {
    const checked = prevState.has(tag) ? prevState.get(tag) : true;
    return `<label><input type="checkbox" value="${esc(tag)}"${checked ? ' checked' : ''}>${esc(tag)}</label>`;
  }).join('');

  container.querySelectorAll('input').forEach(cb =>
    cb.addEventListener('change', () => renderTable(currentData))
  );
}

function renderTable(rows) {
  const showAll    = document.getElementById('show-all').checked;
  const checkedTags = new Set([...document.querySelectorAll('#tag-filters input:checked')].map(i => i.value));

  if (!showAll) rows = rows.filter(r => r.username != null);
  if (checkedTags.size > 0) {
    rows = rows.filter(r => {
      const tags = r.tags ?? ['no-tag'];
      return tags.some(t => checkedTags.has(t));
    });
  }
  visibleRows = rows;

  document.getElementById('tbody').innerHTML = rows.map(r => `
    <tr>
      <td><span class="rar">${esc(r.rarity)}</span></td>
      <td>${esc(r.wikipedia_title)}</td>
      <td>${esc(r.category ?? '')}</td>
      <td>${esc(r.username ?? '—')}</td>
      <td>${r.avg_price != null ? r.avg_price : '—'}</td>
      <td>${r.tags ? r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ') : '—'}</td>
    </tr>`).join('');
}

// Tri sur clic colonne
document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    sortDir = (sortCol === col && sortDir === 'asc') ? 'desc' : 'asc';
    sortCol = col;
    document.querySelectorAll('th').forEach(t => t.classList.remove('asc', 'desc'));
    th.classList.add(sortDir);
    loadCards();
  });
});

// Filtres rareté
document.querySelectorAll('#rarities input').forEach(cb => {
  cb.addEventListener('change', loadCards);
});

// Toggle cartes non possédées
document.getElementById('show-all').addEventListener('change', loadCards);

// Recherche avec debounce 300ms
document.getElementById('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadCards, 300);
});

// Sync mes cartes
document.getElementById('sync-me-btn').addEventListener('click', async () => {
  const btn      = document.getElementById('sync-me-btn');
  const progress = document.getElementById('progress');
  btn.disabled   = true;
  progress.innerHTML = '';

  const meRes = await fetch('/api/me');
  const me    = await meRes.json();

  const el = document.createElement('span');
  el.className   = 'pi';
  el.textContent = `${me.username}`;
  progress.appendChild(el);

  const sr = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friendId: me.id, username: me.username }),
  });
  const result = await sr.json();

  if (result.error) {
    el.className   = 'pi error';
    el.textContent = `${me.username} — ${result.error}`;
  } else if (result.skipped) {
    el.className   = 'pi';
    el.textContent = `${me.username} — cache (1j)`;
  } else {
    el.className   = 'pi done';
    el.textContent = `${me.username} (${result.synced}) — ${result.api_calls} call${result.api_calls !== 1 ? 's' : ''} WikiMasters`;
  }

  btn.disabled = false;
  loadCards();
});

// Sync séquentielle amis
document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn      = document.getElementById('sync-btn');
  const progress = document.getElementById('progress');
  btn.disabled   = true;
  progress.innerHTML = '';

  const fr = await fetch('/api/friends');
  const frData = await fr.json();
  if (frData.error) {
    progress.innerHTML = `<span class="pi error">Erreur amis : ${esc(frData.error)}</span>`;
    btn.disabled = false;
    return;
  }
  const friends = frData.friends;

  for (const friend of friends) {
    const el = document.createElement('span');
    el.className   = 'pi';
    el.textContent = `${friend.username}`;
    progress.appendChild(el);

    const sr = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId: friend.id, username: friend.username }),
    });
    const result = await sr.json();

    if (result.error) {
      el.className   = 'pi error';
      el.textContent = `${friend.username} — ${result.error}`;
    } else if (result.skipped) {
      el.className   = 'pi';
      el.textContent = `${friend.username} — cache (1j)`;
    } else {
      el.className   = 'pi done';
      el.textContent = `${friend.username} (${result.synced}) — ${result.api_calls} call${result.api_calls !== 1 ? 's' : ''} WikiMasters`;
    }
  }

  btn.disabled = false;
  loadCards();
});

document.getElementById('sync-friend-btn').addEventListener('click', async () => {
  const panel  = document.getElementById('friend-sync-panel');
  const select = document.getElementById('friend-select');

  panel.style.display = 'flex';

  const res     = await fetch('/api/friends');
  const frData2 = await res.json();

  if (frData2.error) {
    document.getElementById('err').textContent = frData2.error;
    return;
  }

  select.innerHTML = '<option value="">Choisir un ami...</option>';
  frData2.friends.forEach(friend => {
    const option = document.createElement('option');
    option.value            = friend.id;
    option.textContent      = friend.username;
    option.dataset.username = friend.username;
    select.appendChild(option);
  });
});

document.getElementById('friend-sync-confirm').addEventListener('click', async () => {
  const select   = document.getElementById('friend-select');
  const option   = select.options[select.selectedIndex];
  if (!option.value) return;

  const btn      = document.getElementById('friend-sync-confirm');
  const progress = document.getElementById('progress');
  btn.disabled   = true;

  const username = option.dataset.username;
  const friendId = option.value;
  progress.innerHTML = `<span class="pi">Sync ${esc(username)}…</span>`;

  try {
    const sr = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendId, username }),
    });
    const result = await sr.json();
    if (result.error) {
      progress.innerHTML = `<span class="pi error">✗ ${esc(username)} — ${esc(result.error)}</span>`;
    } else if (result.skipped) {
      progress.innerHTML = `<span class="pi">✓ ${esc(username)} — cache (1j)</span>`;
    } else {
      progress.innerHTML = `<span class="pi done">✓ ${esc(username)} (${result.synced}) — ${result.api_calls} call${result.api_calls !== 1 ? 's' : ''} WikiMasters</span>`;
      loadCards();
    }
  } catch (e) {
    progress.innerHTML = `<span class="pi error">✗ Erreur réseau</span>`;
  }

  btn.disabled = false;
});

// Sync prix marché
document.getElementById('sync-prices-btn').addEventListener('click', async () => {
  const btn      = document.getElementById('sync-prices-btn');
  const progress = document.getElementById('progress');
  btn.disabled   = true;

  if (visibleRows.length === 0) {
    progress.innerHTML = '<span class="pi">Aucune carte visible à synchroniser.</span>';
    btn.disabled = false;
    return;
  }

  const withPrice    = visibleRows.filter(r => r.avg_price != null);
  const withoutPrice = visibleRows.filter(r => r.avg_price == null);

  let ids;
  if (withPrice.length > 0) {
    const recalc = confirm(`${withPrice.length} carte(s) ont déjà un prix. Recalculer aussi ?`);
    ids = recalc ? visibleRows.map(r => r.id) : withoutPrice.map(r => r.id);
  } else {
    ids = visibleRows.map(r => r.id);
  }

  if (ids.length === 0) {
    progress.innerHTML = '<span class="pi">Toutes les cartes visibles ont déjà un prix.</span>';
    btn.disabled = false;
    return;
  }

  progress.innerHTML = `<span class="pi">Sync ${ids.length} carte(s) en cours…</span>`;

  const res    = await fetch('/api/market-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const result = await res.json();

  if (result.error) {
    progress.innerHTML = `<span class="pi error">Erreur : ${esc(result.error)}</span>`;
  } else {
    const savedPart = result.saved ? ` · ${result.saved} en cache` : '';
    progress.innerHTML = `<span class="pi done">✓ ${result.synced} carte(s) pricées${savedPart}${result.errors ? ` (${result.errors} erreur(s))` : ''} — ${result.api_calls} call${result.api_calls !== 1 ? 's' : ''} WikiMasters</span>`;
    loadCards();
  }

  btn.disabled = false;
});

// Token popup
const overlay  = document.getElementById('token-overlay');
const tokenBtn = document.getElementById('token-btn');
const closeBtn = document.getElementById('token-close');

const LABELS = {
  username:   'Username',
  email:      'Email',
  sub:        'User ID',
  session_id: 'Session ID',
  role:       'Rôle',
  provider:   'Provider',
  aal:        'AAL',
  iat:        'Émis le',
  exp:        'Expire le',
  expires_in: 'Temps restant',
};

tokenBtn.addEventListener('click', async () => {
  if (overlay.classList.toggle('open')) {
    const data = await fetch('/api/token-info').then(r => r.json());
    const mins = parseInt(data.expires_in);
    const expiryClass = isNaN(mins) ? 'expires-out' : mins < 10 ? 'expires-low' : 'expires-ok';
    document.getElementById('token-tbody').innerHTML = Object.entries(LABELS).map(([k, label]) => {
      const val = data[k] ?? '—';
      const cls = k === 'expires_in' ? ` class="${expiryClass}"` : '';
      return `<tr><td>${label}</td><td${cls}>${esc(String(val))}</td></tr>`;
    }).join('');
  }
});

closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

loadCards();
