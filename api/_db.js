// Shared Neon client + Google OAuth auth helper.
// Imported by all /api/* endpoints.

import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

export function getDb() {
  if (!dbUrl) throw new Error('POSTGRES_URL not configured');
  return neon(dbUrl);
}

// Verify a Google ID token (from GIS requestAccessToken) and return the
// authenticated user. Auto-creates a user row on first login.
// Returns { userId, email, name } or null if invalid.
const tokenCache = new Map();

export async function authenticate(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', detail: 'Missing Authorization header' });
    return null;
  }

  const token = authHeader.slice(7);

  // Check cache (5 min TTL)
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  // Verify with Google
  let info;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (!r.ok) {
      res.status(401).json({ error: 'unauthorized', detail: 'Invalid or expired token' });
      return null;
    }
    info = await r.json();
  } catch (e) {
    res.status(401).json({ error: 'unauthorized', detail: 'Token verification failed' });
    return null;
  }

  const email = info.email;
  if (!email) {
    res.status(401).json({ error: 'unauthorized', detail: 'Token has no email' });
    return null;
  }

  // Upsert user
  const sql = getDb();
  const rows = await sql`
    INSERT INTO users (email, name)
    VALUES (${email}, ${email.split('@')[0]})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id, email, name
  `;
  const user = { userId: rows[0].id, email: rows[0].email, name: rows[0].name };

  tokenCache.set(token, { user, expiresAt: Date.now() + 5 * 60 * 1000 });

  // Evict stale entries periodically
  if (tokenCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of tokenCache) {
      if (v.expiresAt < now) tokenCache.delete(k);
    }
  }

  return user;
}
