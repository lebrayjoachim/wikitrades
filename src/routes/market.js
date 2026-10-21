import { db, save, parseSummary } from '../db.js';
import { SITE_URL } from '../auth.js';

export async function handle(req, res, ctx) {
  const { cookie } = ctx;
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { ids } = JSON.parse(body);
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('Aucun id fourni');

      let synced = 0, errors = 0, apiCalls = 0, saved = 0;
      for (const id of ids) {
        if (db.market_prices[id]?.by_rarity) {
          saved++;
          continue;
        }
        const r = await fetch(
          `${SITE_URL}/api/marketplace/cards/${id}/sales?scope=summary`,
          { headers: { cookie } }
        );
        apiCalls++;
        if (!r.ok) { errors++; continue; }
        const data     = await r.json();
        const byRarity = parseSummary(data.summary);
        if (!byRarity) continue;
        db.market_prices[id] = { by_rarity: byRarity, synced_at: new Date().toISOString() };
        synced++;
      }

      save('market_prices');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ synced, errors, api_calls: apiCalls, saved }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
