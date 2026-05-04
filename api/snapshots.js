// POST /api/snapshots — batch create balance snapshots.

import { getDb, authenticate } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const { rows } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) {
    res.status(400).json({ error: 'bad_request', detail: 'rows array required' });
    return;
  }

  const sql = getDb();
  const uid = user.userId;
  const inserted = [];
  const duplicates = [];

  for (const r of rows) {
    try {
      const result = await sql`
        INSERT INTO snapshots (user_id, account_id, date, balance_native, currency, fx_rate, source_doc)
        VALUES (${uid}, ${r.account_id}, ${r.date}, ${r.balance_native},
                ${r.currency || 'ILS'}, ${r.fx_rate || null}, ${r.source_doc || null})
        ON CONFLICT (user_id, account_id, date) DO UPDATE
          SET balance_native = EXCLUDED.balance_native,
              fx_rate = EXCLUDED.fx_rate,
              source_doc = EXCLUDED.source_doc
        RETURNING id
      `;
      inserted.push({ ...r, id: result[0].id });
    } catch (e) {
      duplicates.push({ ...r, error: e.message });
    }
  }

  res.status(200).json({ inserted: inserted.length, duplicates: duplicates.length, rows: inserted });
}
