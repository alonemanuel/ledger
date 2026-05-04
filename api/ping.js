// Health check for Vercel Functions routing.
// Used to verify /api/* hits a Function and isn't intercepted by the SPA rewrite.

export default function handler(_req, res) {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
}
