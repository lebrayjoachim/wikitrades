let deals = [];

function timeLeft(isoDate) {
  const diff = new Date(isoDate) - Date.now();
  if (diff <= 0) return 'Terminée';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}min`;
  return `${Math.floor(h / 24)}j ${h % 24}h`;
}

function dealRow(d) {
  const left       = timeLeft(d.end_at);
  const soon       = new Date(d.end_at) - Date.now() < 30 * 60000;
  const deltaStr   = d.delta != null ? (d.delta >= 0 ? `+${d.delta}` : `${d.delta}`) : '—';
  const deltaClass = d.delta != null && d.delta < 0 ? 'delta-bad' : 'delta';
  return `<tr>
    <td><span class="rar">${esc(d.rarity)}</span></td>
    <td>${esc(d.wikipedia_title)}</td>
    <td>${esc(d.seller)}</td>
    <td>${d.effective_bid}</td>
    <td>${d.avg_price ?? '—'}</td>
    <td class="${deltaClass}">${deltaStr}</td>
    <td class="pct">${d.pct != null ? d.pct + '%' : '—'}</td>
    <td class="${soon ? 'end-soon' : ''}">${esc(left)}</td>
  </tr>`;
}

document.getElementById('warmup-btn').addEventListener('click', async () => {
  const btn    = document.getElementById('warmup-btn');
  const status = document.getElementById('status');
  const pages  = parseInt(document.getElementById('pages-input').value) || 1;
  const from   = parseInt(document.getElementById('from-input').value)  || 3;

  btn.disabled       = true;
  status.textContent = 'Préchauffage…';

  try {
    const res  = await fetch('/api/deals/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages, from }),
    });
    const data = await res.json();
    if (data.error) {
      status.textContent = `Erreur : ${data.error}`;
    } else {
      const callsInfo = `${data.api_calls} call${data.api_calls !== 1 ? 's' : ''} WikiMasters · ${data.saved} économisé${data.saved !== 1 ? 's' : ''}`;
      status.textContent = `Préchauffé — ${data.fetched} prix récupérés, ${data.skipped} déjà en cache${data.errors ? `, ${data.errors} erreur(s)` : ''} — ${callsInfo}`;
    }
  } catch (err) {
    status.textContent = `Erreur : ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('sort-btn').addEventListener('click', () => {
  deals.sort((a, b) => b.delta - a.delta);
  document.getElementById('tbody').innerHTML = deals.map(dealRow).join('');
});

document.getElementById('search-btn').addEventListener('click', async () => {
  const btn     = document.getElementById('search-btn');
  const sortBtn = document.getElementById('sort-btn');
  const status  = document.getElementById('status');
  const errEl   = document.getElementById('err');
  const tbody   = document.getElementById('tbody');
  const pages   = parseInt(document.getElementById('pages-input').value) || 1;
  const from    = parseInt(document.getElementById('from-input').value)  || 1;
  const q       = document.getElementById('q-input').value.trim();

  btn.disabled          = true;
  sortBtn.style.display = 'none';
  status.textContent    = 'Chargement…';
  errEl.textContent     = '';
  tbody.innerHTML       = '';
  deals                 = [];

  document.getElementById('table').style.display       = '';
  document.getElementById('placeholder').style.display = 'none';

  try {
    const params = new URLSearchParams({ pages, from });
    if (q) params.set('q', q);
    const res     = await fetch(`/api/deals?${params}`);
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const event of events) {
        if (!event.startsWith('data: ')) continue;
        const obj = JSON.parse(event.slice(6));

        if (obj.error) {
          errEl.textContent = obj.error;
          continue;
        }
        if (obj.done) {
          if (q) {
            deals.sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
            tbody.innerHTML = deals.map(dealRow).join('');
          }
          const callsInfo = obj.api_calls != null
            ? ` — ${obj.api_calls} call${obj.api_calls !== 1 ? 's' : ''} WikiMasters · ${obj.saved} économisé${obj.saved !== 1 ? 's' : ''}`
            : '';
          status.textContent = `${deals.length} enchère(s) trouvée(s)${callsInfo}`;
          if (deals.length === 0) {
            document.getElementById('table').style.display       = 'none';
            document.getElementById('placeholder').style.display = 'block';
            document.getElementById('placeholder').textContent   = 'Aucun résultat.';
          } else {
            sortBtn.style.display = '';
          }
          continue;
        }

        deals.push(obj);
        if (!q) tbody.insertAdjacentHTML('beforeend', dealRow(obj));
        status.textContent = `${deals.length} trouvé(s)…`;
      }
    }
  } catch (err) {
    errEl.textContent  = err.message;
    status.textContent = '';
  } finally {
    btn.disabled = false;
  }
});
