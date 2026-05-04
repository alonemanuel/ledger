// POST /api/seed — one-time bulk import of existing data into the DB.
// Accepts the full dataset (accounts, snapshots, income, expenses, fx_rates)
// and inserts it for the authenticated user. Idempotent via ON CONFLICT.

import { getDb, authenticate } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const sql = getDb();
  const uid = user.userId;
  const body = req.body || {};
  const counts = { accounts: 0, snapshots: 0, income: 0, expenses: 0, fx_rates: 0 };

  // Accounts
  for (const a of (body.accounts || [])) {
    try {
      await sql`
        INSERT INTO accounts (user_id, id, owner, provider, nickname, type, currency, status)
        VALUES (${uid}, ${a.id}, ${a.owner}, ${a.provider}, ${a.nickname || a.name || a.id},
                ${a.type}, ${a.currency || 'ILS'}, ${a.status || 'active'})
        ON CONFLICT (user_id, id) DO NOTHING
      `;
      counts.accounts++;
    } catch (e) { console.warn(`[seed] account ${a.id}: ${e.message}`); }
  }

  // FX rates
  for (const [ym, rate] of Object.entries(body.fx_rates || {})) {
    try {
      await sql`
        INSERT INTO fx_rates (user_id, ym, rate)
        VALUES (${uid}, ${ym}, ${rate})
        ON CONFLICT (user_id, ym) DO UPDATE SET rate = EXCLUDED.rate
      `;
      counts.fx_rates++;
    } catch (e) { console.warn(`[seed] fx ${ym}: ${e.message}`); }
  }

  // Snapshots
  for (const s of (body.snapshots || [])) {
    try {
      await sql`
        INSERT INTO snapshots (user_id, account_id, date, balance_native, currency, fx_rate, source_doc)
        VALUES (${uid}, ${s.account_id}, ${s.date}, ${s.balance_native},
                ${s.currency || 'ILS'}, ${s.fx_rate || null}, ${s.source_doc || null})
        ON CONFLICT (user_id, account_id, date) DO UPDATE SET balance_native = EXCLUDED.balance_native
      `;
      counts.snapshots++;
    } catch (e) { console.warn(`[seed] snapshot: ${e.message}`); }
  }

  // Income
  for (const r of (body.income || [])) {
    try {
      await sql`
        INSERT INTO income (user_id, date, source, type, gross_native, currency, source_doc)
        VALUES (${uid}, ${r.date}, ${r.source}, ${r.type}, ${r.gross_native},
                ${r.currency || 'ILS'}, ${r.source_doc || null})
        ON CONFLICT DO NOTHING
      `;
      counts.income++;
    } catch (e) { console.warn(`[seed] income: ${e.message}`); }
  }

  // Expenses
  for (const r of (body.expenses || [])) {
    try {
      await sql`
        INSERT INTO expenses (user_id, date, account_id, amount_native, currency, amount_ils, fx_rate,
                              category, subcategory, merchant, description, source_doc,
                              billing_date, external_ref_id)
        VALUES (${uid}, ${r.date}, ${r.account_id}, ${r.amount_native || r.amount},
                ${r.currency || 'ILS'}, ${r.amount_ils || r.amount}, ${r.fx_rate || 1},
                ${r.category || null}, ${r.subcategory || null}, ${r.merchant},
                ${r.description || null}, ${r.source_doc || null},
                ${r.billing_date || null}, ${r.external_ref_id || null})
        ON CONFLICT DO NOTHING
      `;
      counts.expenses++;
    } catch (e) { console.warn(`[seed] expense: ${e.message}`); }
  }

  console.log(`[seed] done uid=${uid}`, counts);
  res.status(200).json({ ok: true, counts });
}
