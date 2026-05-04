// GET /api/data — full data fetch for a user's ledger.
// Replaces the Google Sheets read path.

import { getDb, authenticate } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const sql = getDb();
  const uid = user.userId;

  const [accounts, snapshots, income, expenses, fxRows] = await Promise.all([
    sql`SELECT id, owner, provider, nickname, type, currency, status
        FROM accounts WHERE user_id = ${uid} ORDER BY id`,
    sql`SELECT account_id, date, balance_native, currency, fx_rate, source_doc
        FROM snapshots WHERE user_id = ${uid} ORDER BY date`,
    sql`SELECT date, source, type, gross_native, currency, source_doc
        FROM income WHERE user_id = ${uid} ORDER BY date`,
    sql`SELECT id, date, account_id, amount_native, currency, amount_ils, fx_rate,
               category, subcategory, merchant, description, source_doc,
               billing_date, external_ref_id, created_at, updated_at
        FROM expenses WHERE user_id = ${uid} ORDER BY date`,
    sql`SELECT ym, rate FROM fx_rates WHERE user_id = ${uid} ORDER BY ym`,
  ]);

  const fxRates = {};
  for (const r of fxRows) fxRates[r.ym] = parseFloat(r.rate);

  res.status(200).json({
    accounts,
    snapshots: snapshots.map(r => ({ ...r, date: r.date?.toISOString?.()?.slice(0, 10) || r.date })),
    income: income.map(r => ({ ...r, date: r.date?.toISOString?.()?.slice(0, 10) || r.date })),
    expenses: expenses.map(r => ({
      ...r,
      date: r.date?.toISOString?.()?.slice(0, 10) || r.date,
      billing_date: r.billing_date?.toISOString?.()?.slice(0, 10) || r.billing_date || null,
    })),
    fx_rates: fxRates,
    user: { email: user.email, name: user.name },
  });
}
