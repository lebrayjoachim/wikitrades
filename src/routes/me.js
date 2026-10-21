export async function handle(req, res, ctx) {
  const { userId, myUsername, claims, url } = ctx;

  if (url.pathname === '/api/me') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: userId, username: myUsername }));
    return;
  }

  // /api/token-info
  const minutesLeft = Math.round((claims.exp * 1000 - Date.now()) / 60000);
  const fmt = (ts) => new Date(ts * 1000).toLocaleString('fr-FR');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    username:   claims.user_metadata?.username ?? claims.email,
    email:      claims.email,
    sub:        claims.sub,
    session_id: claims.session_id,
    role:       claims.role,
    provider:   claims.app_metadata?.provider ?? '—',
    aal:        claims.aal,
    iat:        fmt(claims.iat),
    exp:        fmt(claims.exp),
    expires_in: minutesLeft > 0 ? `~${minutesLeft} min` : 'Expiré',
  }));
}
