import { db, save } from '../db.js';
import { SITE_URL } from '../auth.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export async function handle(req, res, ctx) {
  const { cookie, userId } = ctx;
  try {
    const cached = db.friends;
    if (cached.fetched_at && Date.now() - new Date(cached.fetched_at) < TTL_MS) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ friends: cached.list, api_calls: 0, saved: 1 }));
      return;
    }

    const r = await fetch(`${SITE_URL}/api/friends`, { headers: { cookie } });
    if (!r.ok) throw new Error(`Erreur /api/friends (${r.status})`);
    const data        = await r.json();
    const friendships = data.friendships ?? [];
    const friends     = friendships
      .filter(f => f.status === 'accepted')
      .map(f => f.requester_id === userId ? f.addressee : f.requester)
      .map(u => ({ id: u.id, username: u.username }));

    db.friends.list       = friends;
    db.friends.fetched_at = new Date().toISOString();
    save('friends');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ friends, api_calls: 1, saved: 0 }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
