import { db, save } from '../db.js';
import { SITE_URL } from '../auth.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export async function handle(req, res, ctx) {
  const { cookie } = ctx;
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { friendId, username } = JSON.parse(body);

      const existing = db.users.find(u => u.id === friendId);
      if (existing?.last_synced_at && Date.now() - new Date(existing.last_synced_at) < TTL_MS) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ synced: 0, removed: 0, api_calls: 0, skipped: true }));
        return;
      }

      // 1. Fetch collection WikiMasters paginée par 50
      const allItems = [];
      let apiCalls = 0;
      let page = 0;
      while (true) {
        const gameRes = await fetch(
          `${SITE_URL}/api/profile/${encodeURIComponent(username)}/collection?page=${page}&sort=rarity&stats=0&pending=0`,
          { headers: { cookie } }
        );
        apiCalls++;
        if (!gameRes.ok) throw new Error(`Erreur jeu (${gameRes.status})`);
        const data = await gameRes.json();
        if (data.error) throw new Error(data.error);
        const items = data.collection ?? [];
        allItems.push(...items);
        if (items.length < 50) break;
        page++;
      }

      // 2. Upsert user
      const uIdx = db.users.findIndex(u => u.id === friendId);
      if (uIdx === -1) db.users.push({ id: friendId, username, last_synced_at: new Date().toISOString() });
      else { db.users[uIdx].username = username; db.users[uIdx].last_synced_at = new Date().toISOString(); }
      save('users');

      // 3. Upsert cards
      const existingCardIds = new Set(db.cards.map(c => c.id));
      for (const item of allItems) {
        if (existingCardIds.has(item.card.id)) continue;
        db.cards.push({
          id:              item.card.id,
          wikipedia_title: item.card.wikipedia_title,
          rarity:          item.card.rarity,
          category:        item.card.category    ?? null,
        });
        existingCardIds.add(item.card.id);
      }
      save('cards');

      // 4. Diff cartes actuelles vs nouvelles pour cet ami
      const currentIds = new Set(
        db.user_cards.filter(uc => uc.user_id === friendId).map(uc => uc.card_id)
      );
      const newIds   = new Set(allItems.map(i => i.card.id));
      const toDelete = new Set([...currentIds].filter(id => !newIds.has(id)));

      // 5. Upsert user_cards + suppression des absentes
      db.user_cards = db.user_cards.filter(
        uc => !(uc.user_id === friendId && toDelete.has(uc.card_id))
      );
      for (const item of allItems) {
        const tags = item.tags?.length ? item.tags.map(t => t.name) : ['no-tag'];
        const existing = db.user_cards.find(uc => uc.user_id === friendId && uc.card_id === item.card.id);
        if (existing) existing.tags = tags;
        else db.user_cards.push({ user_id: friendId, card_id: item.card.id, tags });
      }
      save('user_cards');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ synced: allItems.length, removed: toDelete.size, api_calls: apiCalls }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
