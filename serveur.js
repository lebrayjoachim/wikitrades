import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

import { loadEnv, decodeJwt, parseCookie } from './src/auth.js';
import { db } from './src/db.js';

import { handle as handleMe      } from './src/routes/me.js';
import { handle as handleFriends } from './src/routes/friends.js';
import { handle as handleSync    } from './src/routes/sync.js';
import { handle as handleCards   } from './src/routes/cards.js';
import { handle as handleMarket  } from './src/routes/market.js';
import { handle as handleDeals   } from './src/routes/deals.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT  = 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'text/javascript',
};

async function main() {
  const { COOKIE } = loadEnv();
  if (!COOKIE) {
    throw new Error('Variable COOKIE absente du .env.');
  }

  const { cookie, session } = parseCookie(COOKIE);
  const claims    = decodeJwt(session.access_token);
  const expiresAt = claims.exp * 1000;
  if (Date.now() > expiresAt) {
    throw new Error(`Cookie expiré depuis ${new Date(expiresAt).toLocaleTimeString()}.`);
  }
  const minutesLeft = Math.round((expiresAt - Date.now()) / 60000);
  const userId      = claims.sub;
  const myUsername  = claims.user_metadata?.username ?? claims.email;
  console.log(`Connecté: ${myUsername} (${userId}) — session valide encore ~${minutesLeft} min`);

  const ctx = { db, cookie, userId, myUsername, claims };

  const server = createServer(async (req, res) => {
    const url      = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // Fichiers statiques
    if (!pathname.startsWith('/api/')) {
      const filePath = pathname === '/'      ? '/index.html'
                     : pathname === '/deals' ? '/deals.html'
                     : pathname;
      const ext  = extname(filePath);
      const mime = MIME[ext];
      if (!mime) { res.writeHead(404); res.end(); return; }
      try {
        const content = readFileSync(join(__dir, 'public', filePath));
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
      } catch {
        res.writeHead(404); res.end();
      }
      return;
    }

    // Routes API
    const routeCtx = { ...ctx, url };
    if (pathname === '/api/me' || pathname === '/api/token-info')       return handleMe(req, res, routeCtx);
    if (pathname === '/api/friends')                                     return handleFriends(req, res, routeCtx);
    if (pathname === '/api/sync'        && req.method === 'POST')        return handleSync(req, res, routeCtx);
    if (pathname === '/api/cards')                                       return handleCards(req, res, routeCtx);
    if (pathname === '/api/market-sync' && req.method === 'POST')        return handleMarket(req, res, routeCtx);
    if (pathname === '/api/deals' || pathname === '/api/deals/warmup')   return handleDeals(req, res, routeCtx);

    res.writeHead(404); res.end();
  });

  server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
}

main().catch(err => { console.error(err.message); process.exit(1); });
