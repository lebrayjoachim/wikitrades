import { db, save, parseSummary } from '../db.js';
import { withConcurrency } from '../utils.js';
import { SITE_URL } from '../auth.js';

function pushCard(card) {
  if (db.cards.find(c => c.id === card.id)) return;
  db.cards.push({
    id:              card.id,
    wikipedia_title: card.wikipedia_title,
    rarity:          card.rarity,
    category:        card.category    ?? null,
  });
}

function emitDeals(cardId, auctions, send, all = false) {
  const byRarity = db.market_prices[cardId]?.by_rarity;
  if (!all && !byRarity) return;
  for (const a of auctions) {
    const rarity = a.snapshot_rarity ?? a.card.rarity;
    const avg    = byRarity?.[rarity] ?? null;
    const delta  = avg != null ? avg - a.effective_bid : null;
    if (!all && (avg == null || a.effective_bid >= avg)) continue;
    send({
      auction_id:      a.id,
      card_id:         cardId,
      wikipedia_title: a.card.wikipedia_title,
      rarity,
      effective_bid:   a.effective_bid,
      avg_price:       avg,
      delta,
      pct:             avg != null ? Math.round(a.effective_bid / avg * 100) : null,
      end_at:          a.end_at,
      seller:          a.seller?.username ?? '—',
    });
  }
}

async function handleStream(req, res, ctx) {
  const { cookie, url } = ctx;
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  let apiCalls = 0, saved = 0;
  try {
    const pages = Math.max(1, parseInt(url.searchParams.get('pages') ?? '1'));
    const from  = Math.max(1, parseInt(url.searchParams.get('from')  ?? '1'));
    const q     = url.searchParams.get('q')?.trim() ?? '';

    const allAuctions = [];
    for (let page = from; page < from + pages; page++) {
      const params = new URLSearchParams({ page, limit: 50, sort: 'ending_soon' });
      if (q) params.set('q', q);
      const r = await fetch(
        `${SITE_URL}/api/marketplace?${params}`,
        { headers: { cookie } }
      );
      apiCalls++;
      if (!r.ok) break;
      const data     = await r.json();
      const auctions = data.auctions ?? [];
      allAuctions.push(...auctions.filter(a => a.status === 'active'));
      if (auctions.length < 50) break;
    }

    const auctionsByCard = new Map();
    for (const auction of allAuctions) {
      if (!auctionsByCard.has(auction.card_id)) auctionsByCard.set(auction.card_id, []);
      auctionsByCard.get(auction.card_id).push(auction);
    }

    const all = !!q;

    // Phase 1 : cartes déjà en cache → émission immédiate
    const unknown = [];
    for (const [cardId, auctions] of auctionsByCard) {
      if (db.market_prices[cardId]?.by_rarity) {
        saved++;
        emitDeals(cardId, auctions, send, all);
      } else {
        unknown.push([cardId, auctions]);
      }
    }

    // Phase 2 : cartes inconnues → 5 fetches en parallèle
    await withConcurrency(unknown, 5, async ([cardId, auctions]) => {
      pushCard(auctions[0].card);
      const pr = await fetch(
        `${SITE_URL}/api/marketplace/cards/${cardId}/sales?scope=summary`,
        { headers: { cookie } }
      );
      apiCalls++;
      if (pr.ok) {
        const prData   = await pr.json();
        const byRarity = parseSummary(prData.summary);
        if (byRarity) db.market_prices[cardId] = { by_rarity: byRarity, synced_at: new Date().toISOString() };
      }
      emitDeals(cardId, auctions, send, all);
    });

    save('cards');
    save('market_prices');
  } catch (err) {
    send({ error: err.message });
  }

  send({ done: true, api_calls: apiCalls, saved });
  res.end();
}

async function handleWarmup(req, res, ctx) {
  const { cookie } = ctx;
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { pages = 1, from = 3 } = body ? JSON.parse(body) : {};
      const maxPages  = Math.max(1, parseInt(pages));
      const startPage = Math.max(1, parseInt(from));

      let apiCalls = 0;
      const allAuctions = [];
      for (let page = startPage; page < startPage + maxPages; page++) {
        const r = await fetch(
          `${SITE_URL}/api/marketplace?page=${page}&limit=50&sort=ending_soon&mine=1`,
          { headers: { cookie } }
        );
        apiCalls++;
        if (!r.ok) break;
        const data     = await r.json();
        const auctions = data.auctions ?? [];
        allAuctions.push(...auctions.filter(a => a.status === 'active'));
        if (auctions.length < 50) break;
      }

      const seen    = new Set();
      const unknown = [];
      for (const auction of allAuctions) {
        if (seen.has(auction.card_id)) continue;
        seen.add(auction.card_id);
        if (!db.market_prices[auction.card_id]?.by_rarity) unknown.push(auction);
      }

      const saved = seen.size - unknown.length;
      let fetched = 0, errors = 0;
      await withConcurrency(unknown, 5, async (auction) => {
        pushCard(auction.card);
        const pr = await fetch(
          `${SITE_URL}/api/marketplace/cards/${auction.card_id}/sales?scope=summary`,
          { headers: { cookie } }
        );
        apiCalls++;
        if (!pr.ok) { errors++; return; }
        const prData   = await pr.json();
        const byRarity = parseSummary(prData.summary);
        if (byRarity) {
          db.market_prices[auction.card_id] = { by_rarity: byRarity, synced_at: new Date().toISOString() };
          fetched++;
        }
      });

      save('cards');
      save('market_prices');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ fetched, skipped: seen.size - unknown.length, errors, api_calls: apiCalls, saved }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

export async function handle(req, res, ctx) {
  if (ctx.url.pathname === '/api/deals/warmup') return handleWarmup(req, res, ctx);
  return handleStream(req, res, ctx);
}
