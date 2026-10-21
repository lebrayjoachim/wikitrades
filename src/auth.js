import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

export const SITE_URL = 'https://www.wiki-masters.com';

const PROJECT_REF = 'cyrxjeppjqsxxjayfrur';

export function loadEnv() {
  const content = readFileSync(join(__dir, '..', '.env'), 'utf-8');
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return vars;
}

export function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
}

export function parseCookie(raw) {
  const name   = `sb-${PROJECT_REF}-auth-token`;
  const chunks = [];

  // Robuste : on ne garde que les morceaux de la session, peu importe
  // les autres cookies présents autour (ex: header Cookie complet collé).
  for (const seg of raw.split(';')) {
    const trimmed = seg.trim();
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key === name) {
      chunks.push({ order: 0, val });
    } else if (key.startsWith(`${name}.`)) {
      const n = Number(key.slice(name.length + 1));
      chunks.push({ order: Number.isNaN(n) ? 0 : n, val });
    }
  }

  if (chunks.length === 0) {
    throw new Error(`Cookie de session introuvable : aucune entrée "${name}" dans COOKIE.`);
  }

  chunks.sort((a, b) => a.order - b.order);

  const joined  = chunks.map(c => c.val).join('');
  const b64     = joined.startsWith('base64-') ? joined.slice('base64-'.length) : joined;
  const session = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));

  // Cookie reconstruit proprement : uniquement les morceaux de session.
  const cookie = chunks.length === 1
    ? `${name}=${chunks[0].val}`
    : chunks.map(c => `${name}.${c.order}=${c.val}`).join('; ');

  return { cookie, session };
}
