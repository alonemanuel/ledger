// POST /api/expenses — batch create expenses.

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
        INSERT INTO expenses (user_id, date, account_id, amount_native, currency, amount_ils, fx_rate,
                              category, subcategory, merchant, description, source_doc,
                              billing_date, external_ref_id)
        VALUES (${uid}, ${r.date}, ${r.account_id}, ${r.amount_native}, ${r.currency || 'ILS'},
                ${r.amount_ils}, ${r.fx_rate || 1}, ${r.category || null}, ${r.subcategory || null},
                ${r.merchant}, ${r.description || null}, ${r.source_doc || null},
                ${r.billing_date || null}, ${r.external_ref_id || null})
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
