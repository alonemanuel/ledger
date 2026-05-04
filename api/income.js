// POST /api/income — batch create income rows.

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
        INSERT INTO income (user_id, date, source, type, gross_native, currency, source_doc)
        VALUES (${uid}, ${r.date}, ${r.source}, ${r.type}, ${r.gross_native},
                ${r.currency || 'ILS'}, ${r.source_doc || null})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (result.length) {
        inserted.push({ ...r, id: result[0].id });
      } else {
        duplicates.push(r);
      }
    } catch (e) {
      duplicates.push({ ...r, error: e.message });
    }
  }

  res.status(200).json({ inserted: inserted.length, duplicates: duplicates.length, rows: inserted });
}
