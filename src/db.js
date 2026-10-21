import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir    = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '..', 'data');

function loadDb() {
  const load = (name, def) => {
    try { return JSON.parse(readFileSync(join(DATA_DIR, `${name}.json`), 'utf-8')); }
    catch { return def; }
  };
  return {
    cards:         load('cards', []),
    users:         load('users', []),
    user_cards:    load('user_cards', []),
    market_prices: load('market_prices', {}),
    friends:       load('friends', { list: [], fetched_at: null }),
  };
}

export const db = loadDb();

export function save(name) {
  writeFileSync(join(DATA_DIR, `${name}.json`), JSON.stringify(db[name]));
}

export function allCards() {
  const userMap   = new Map(db.users.map(u => [u.id, u]));
  const cardUsers = new Map();
  for (const uc of db.user_cards) {
    if (!cardUsers.has(uc.card_id)) cardUsers.set(uc.card_id, []);
    cardUsers.get(uc.card_id).push({ user_id: uc.user_id, tags: uc.tags ?? ['no-tag'] });
  }

  const rows = [];
  for (const card of db.cards) {
    const price   = db.market_prices[card.id] ?? null;
    const userIds = cardUsers.get(card.id) ?? [];
    const base    = {
      id:              card.id,
      wikipedia_title: card.wikipedia_title,
      rarity:          card.rarity,
      category:        card.category ?? null,
      avg_price:       price?.by_rarity?.[card.rarity] ?? price?.avg_price ?? null,
    };
    if (userIds.length === 0) {
      rows.push({ ...base, user_id: null, username: null, tags: null });
    } else {
      for (const { user_id: uid, tags } of userIds) {
        const user = userMap.get(uid);
        rows.push({ ...base, user_id: uid, username: user?.username ?? null, tags });
      }
    }
  }
  return rows;
}

const NUM_COLS = new Set(['avg_price']);

export function sortRows(rows, order) {
  const [col, dir] = (order ?? 'rarity.asc').split('.');
  return rows.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (NUM_COLS.has(col)) return dir === 'desc' ? vb - va : va - vb;
    va = String(va).toLowerCase();
    vb = String(vb).toLowerCase();
    return dir === 'desc' ? (va < vb ? 1 : va > vb ? -1 : 0) : (va < vb ? -1 : va > vb ? 1 : 0);
  });
}

export function parseSummary(summary) {
  if (!summary) return null;
  const result = {};
  for (const [rarity, val] of Object.entries(summary)) {
    if (val?.average != null) result[rarity] = val.average;
  }
  return Object.keys(result).length > 0 ? result : null;
}
