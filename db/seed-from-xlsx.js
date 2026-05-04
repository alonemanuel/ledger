#!/usr/bin/env node
// Seed the Neon DB from a downloaded Google Sheets XLSX export.
// Usage: node db/seed-from-xlsx.js /path/to/ledger.xlsx
//
// Reads .env.local for POSTGRES_URL. Expects the XLSX to have tabs:
// accounts, snapshots, income, expenses (matching the Google Sheet layout).

import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
try {
  const envPath = join(__dirname, '..', '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch (_) {}

const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error('POSTGRES_URL not set'); process.exit(1); }

const xlsxPath = process.argv[2];
if (!xlsxPath) { console.error('Usage: node db/seed-from-xlsx.js <path-to-ledger.xlsx>'); process.exit(1); }

const sql = neon(dbUrl);

// Read XLSX
const wb = XLSX.readFile(xlsxPath, { cellDates: true });
console.log('Tabs found:', wb.SheetNames.join(', '));

function sheetToRows(name) {
  const ws = wb.Sheets[name];
  if (!ws) { console.warn(`Tab "${name}" not found, skipping.`); return []; }
  const rows = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd' });
  console.log(`  ${name}: ${rows.length} rows`);
  return rows;
}

const accountsRaw = sheetToRows('accounts');
const snapshotsRaw = sheetToRows('snapshots');
const incomeRaw = sheetToRows('income');
const expensesRaw = sheetToRows('expenses');

// User email — prompt or use default
const userEmail = process.argv[3] || 'alonemanuel95@gmail.com';

async function run() {
  // Upsert user
  const userRows = await sql`
    INSERT INTO users (email, name)
    VALUES (${userEmail}, ${userEmail.split('@')[0]})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id
  `;
  const uid = userRows[0].id;
  console.log(`User: ${userEmail} (id=${uid})`);

  const counts = { accounts: 0, snapshots: 0, income: 0, expenses: 0, fx_rates: 0 };

  // Accounts
  for (const a of accountsRaw) {
    const id = a.account_id || a.id;
    if (!id) continue;
    try {
      await sql`
        INSERT INTO accounts (user_id, id, owner, provider, nickname, type, currency, status)
        VALUES (${uid}, ${id}, ${a.owner || 'Alon'}, ${a.provider || ''},
                ${a.nickname || id}, ${a.type || 'checking'},
                ${(a.currency || 'ILS').replace('NIS', 'ILS')}, ${a.status || 'active'})
        ON CONFLICT (user_id, id) DO NOTHING
      `;
      counts.accounts++;
    } catch (e) { console.warn(`  account ${id}: ${e.message}`); }
  }
  console.log(`Accounts: ${counts.accounts} inserted`);

  // Snapshots
  for (const s of snapshotsRaw) {
    const acctId = s.account_id;
    const date = s.date;
    const balance = parseFloat(s.balance_native);
    if (!acctId || !date || isNaN(balance)) continue;
    const cur = (s.currency || 'ILS').replace('NIS', 'ILS');
    const fx = s.fx_rate ? parseFloat(s.fx_rate) : null;
    try {
      await sql`
        INSERT INTO snapshots (user_id, account_id, date, balance_native, currency, fx_rate)
        VALUES (${uid}, ${acctId}, ${date}, ${balance}, ${cur}, ${fx || null})
        ON CONFLICT (user_id, account_id, date) DO UPDATE SET balance_native = EXCLUDED.balance_native
      `;
      counts.snapshots++;
    } catch (e) { console.warn(`  snapshot ${acctId} ${date}: ${e.message}`); }
  }
  console.log(`Snapshots: ${counts.snapshots} inserted`);

  // FX rates — extract from USD snapshots
  const fxByMonth = {};
  snapshotsRaw.forEach(s => {
    const cur = (s.currency || '').replace('NIS', 'ILS');
    if (cur === 'USD' && s.fx_rate) {
      const rate = parseFloat(s.fx_rate);
      if (rate > 0) fxByMonth[(s.date || '').slice(0, 7)] = rate;
    }
  });
  for (const [ym, rate] of Object.entries(fxByMonth)) {
    try {
      await sql`
        INSERT INTO fx_rates (user_id, ym, rate) VALUES (${uid}, ${ym}, ${rate})
        ON CONFLICT (user_id, ym) DO UPDATE SET rate = EXCLUDED.rate
      `;
      counts.fx_rates++;
    } catch (e) { console.warn(`  fx ${ym}: ${e.message}`); }
  }
  console.log(`FX rates: ${counts.fx_rates} inserted`);

  // Income
  for (const r of incomeRaw) {
    const date = r.date;
    const gross = parseFloat(r.gross_native);
    if (!date || !r.source || isNaN(gross)) continue;
    try {
      await sql`
        INSERT INTO income (user_id, date, source, type, gross_native, currency, source_doc)
        VALUES (${uid}, ${date}, ${r.source}, ${r.type || 'other'}, ${gross},
                ${(r.currency || 'ILS').replace('NIS', 'ILS')}, ${r.source_doc || null})
        ON CONFLICT DO NOTHING
      `;
      counts.income++;
    } catch (e) { console.warn(`  income ${date} ${r.source}: ${e.message}`); }
  }
  console.log(`Income: ${counts.income} inserted`);

  // Expenses
  for (const r of expensesRaw) {
    const date = r.date;
    const acctId = r.account_id;
    if (!date || !acctId || !r.merchant) continue;
    const amtNative = parseFloat(r.amount_native) || 0;
    const amtIls = parseFloat(r.amount_ils) || amtNative;
    const cur = (r.currency || 'ILS').replace('NIS', 'ILS');
    const fx = r.fx_rate ? parseFloat(r.fx_rate) : (cur !== 'ILS' && amtNative > 0 ? +(amtIls / amtNative).toFixed(4) : 1);
    try {
      await sql`
        INSERT INTO expenses (user_id, date, account_id, amount_native, currency, amount_ils, fx_rate,
                              category, subcategory, merchant, description, source_doc,
                              billing_date, external_ref_id)
        VALUES (${uid}, ${date}, ${acctId}, ${amtNative}, ${cur}, ${amtIls}, ${fx},
                ${r.category || null}, ${r.subcategory || null}, ${r.merchant},
                ${r.description || null}, ${r.source_doc || null},
                ${r.billing_date || null}, ${r.external_ref_id || null})
        ON CONFLICT DO NOTHING
      `;
      counts.expenses++;
    } catch (e) { console.warn(`  expense ${date} ${r.merchant}: ${e.message}`); }
  }
  console.log(`Expenses: ${counts.expenses} inserted`);

  console.log('\nDone!', counts);
}

run().catch(e => { console.error('Seed failed:', e); process.exit(1); });
