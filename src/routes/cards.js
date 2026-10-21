import { allCards, sortRows } from '../db.js';

export async function handle(req, res, ctx) {
  const { url } = ctx;
  try {
    const q     = url.searchParams.get('q')?.trim() ?? '';
    const r     = url.searchParams.get('r')?.split(',').filter(Boolean) ?? [];
    const order = url.searchParams.get('order') ?? 'rarity.asc';

    let rows = allCards();
    if (r.length > 0) rows = rows.filter(row => r.includes(row.rarity));
    if (q) {
      const ql = q.toLowerCase();
      rows = rows.filter(row =>
        row.wikipedia_title?.toLowerCase().includes(ql) ||
        row.category?.toLowerCase().includes(ql) ||
        row.username?.toLowerCase().includes(ql)
      );
    }
    sortRows(rows, order);
    rows = rows.slice(0, 500);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
