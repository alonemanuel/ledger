// Health check for Vercel Functions routing.
// Used to verify /api/* hits a Function and isn't intercepted by the SPA rewrite.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
}
