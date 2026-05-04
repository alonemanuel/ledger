// Intake endpoint — receives content (text/image/pdf/csv) from the dashboard's
// Intake tab, calls Gemini to extract structured rows, returns them.
//
// Model: gemini-2.5-flash by default. Free tier covers ~1500 req/day with
// vision + PDF support — plenty for personal receipt intake. Override with
// GEMINI_MODEL (e.g. gemini-2.5-pro) if extraction quality drops.
//
// Auth: Gemini API key from process.env.GEMINI_API_KEY (Vercel env var).
// Get one at https://aistudio.google.com/apikey — no card required.
//
// Request body shape:
//   {
//     kind: 'text' | 'image' | 'pdf' | 'csv',
//     content: string,           // text or base64 (depending on kind)
//     mediaType?: string,        // for images
//     sheetId?: string,          // forwarded by the browser
//     schema?: { tabs: [{ name, headers, samples }] },
//     accounts?: [{ id, nickname, type, currency }],
//     categories?: [string],     // valid expense categories
//     googleToken?: string,      // for tokeninfo verification (step 7)
//   }
//
// Response shape:
//   { snapshots: [], income: [], expenses: [], rejected?: [{ reason, row }], usage?: {...} }

import { GoogleGenAI } from '@google/genai';
import { getDb, authenticate } from './_db.js';

const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

// Model fallback chain — try each in order on 503/429. Different models
// don't share load patterns, so when 2.5-flash is overloaded 2.0-flash usually
// isn't. All entries here are free-tier and support vision + PDFs.
// Override via GEMINI_MODELS=model_a,model_b — single GEMINI_MODEL still works
// for backwards compatibility.
const MODELS = (process.env.GEMINI_MODELS
  || process.env.GEMINI_MODEL
  || 'gemini-2.5-flash,gemini-2.0-flash,gemini-2.5-flash-lite'
).split(',').map(s => s.trim()).filter(Boolean);
const MAX_ROWS_PER_TAB = 100;

const VALID_INCOME_TYPES = [
  'salary',
  'bonus',
  'employer_pension_contribution',
  'employer_study_fund_contribution',
  'dividend',
  'interest',
  'reimbursement',
  'gift',
  'capital_gain',
  'other',
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildSystemPrompt({ schema, accounts, categories }) {
  const today = todayIso();
  const accountsBlock = (accounts || [])
    .map(a => `  - ${a.id}  (${a.nickname || a.id}, ${a.type}, ${a.currency})`)
    .join('\n') || '  (no accounts provided)';

  const tabBlocks = (schema?.tabs || []).map(tab => {
    const headers = (tab.headers || []).join(', ');
    const samples = (tab.samples || []).slice(0, 2).map(s => '    ' + JSON.stringify(s)).join('\n');
    return `Tab: ${tab.name}\n  Columns: ${headers || '(no headers)'}\n${samples ? '  Sample rows:\n' + samples : '  (no sample rows)'}`;
  }).join('\n\n');

  return [
    'You extract structured rows from messy input (free text, screenshots, receipts, statements, CSVs) for a personal finance ledger.',
    '',
    `Today's date: ${today}. Resolve relative dates ("yesterday", "last Friday") against this.`,
    '',
    'Output rules:',
    '- ALWAYS call the extract_rows tool. NEVER respond with prose.',
    '- Dates: ISO YYYY-MM-DD only.',
    '- Amounts: plain floats in native currency. No symbols. No thousands separators.',
    '- account_id: must be one of the valid IDs listed below.',
    '- expense category: must be one of the valid categories listed below, or null if uncertain.',
    '- income type: must be one of the listed types, or "other".',
    '- Currency: ILS or USD only. Match what the source shows.',
    '- If unsure about a field, OMIT THE ROW. Do not guess. Better to skip than corrupt the ledger.',
    '- Do NOT invent rows. If the input has nothing relevant, return empty arrays.',
    '- Do NOT extract account creation rows in v1 — only snapshots, income, expenses.',
    '',
    'Date extraction for credit card / bank statements:',
    '- Israeli credit card PDFs have two dates per row: "חיוב לתאריך" (billing/charge date) and "תאריך" (transaction date).',
    '- Use the TRANSACTION date (when the purchase happened) as "date".',
    '- Use the BILLING date (when it appears on the statement) as "billing_date".',
    '- Both must be ISO YYYY-MM-DD. Israeli docs use DD.MM.YYYY — convert carefully.',
    '',
    'Reference IDs:',
    '- Israeli credit card docs have "אסמכתא" (reference number) per transaction. Extract it as "external_ref_id".',
    '',
    'Amounts for expenses:',
    '- "purchase_amount" = the original amount of the transaction (סכום קנייה).',
    '- "purchase_currency" = the currency of the purchase (ILS, USD, EUR, etc.).',
    '- "charge_amount_ils" = what was actually charged in ILS (סכום חיוב בש"ח).',
    '- For domestic ILS transactions, purchase_amount == charge_amount_ils and purchase_currency == ILS.',
    '',
    'Routing guidance:',
    '- A receipt or transaction → expenses.',
    '- A salary slip / employer payment notice / dividend statement → income.',
    '- A bank balance / brokerage portfolio value → snapshots.',
    '- A list with mixed types → split into the right arrays.',
    '',
    'Valid account IDs:',
    accountsBlock,
    '',
    `Valid expense categories: ${(categories || []).join(', ') || '(none provided)'}`,
    `Valid income types: ${VALID_INCOME_TYPES.join(', ')}`,
    '',
    'Sheet schema (existing rows you append to — match these column names):',
    '',
    tabBlocks || '(no schema provided)',
  ].join('\n');
}

// Gemini's function-calling schema is OpenAPI Schema (a JSON Schema subset).
// Notable differences vs. Anthropic: union types like ['number', 'null'] aren't
// supported — use `nullable: true` instead. `additionalProperties` is ignored.
function buildExtractTool(accountIds, categories) {
  const accountIdSchema = accountIds.length
    ? { type: 'string', enum: accountIds }
    : { type: 'string' };
  const categorySchema = categories.length
    ? { type: 'string', enum: categories, nullable: true }
    : { type: 'string', nullable: true };

  return {
    name: 'extract_rows',
    description: 'Extract structured ledger rows from the user-provided content.',
    parameters: {
      type: 'object',
      properties: {
        snapshots: {
          type: 'array',
          description: 'Account balance snapshots (e.g. from bank or brokerage statements).',
          items: {
            type: 'object',
            properties: {
              account_id: accountIdSchema,
              date: { type: 'string', description: 'ISO YYYY-MM-DD' },
              balance_native: { type: 'number' },
              currency: { type: 'string', enum: ['ILS', 'USD'] },
              fx_rate: { type: 'number', nullable: true, description: 'USD→ILS rate if currency=USD; null otherwise' },
            },
            required: ['account_id', 'date', 'balance_native', 'currency'],
          },
        },
        income: {
          type: 'array',
          description: 'Income entries (salary, bonus, dividends, etc.).',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Free-text source name, e.g. "ImagenAI", "IBKR".' },
              type: { type: 'string', enum: VALID_INCOME_TYPES },
              date: { type: 'string', description: 'ISO YYYY-MM-DD' },
              gross_native: { type: 'number' },
              currency: { type: 'string', enum: ['ILS', 'USD'] },
            },
            required: ['source', 'type', 'date', 'gross_native', 'currency'],
          },
        },
        expenses: {
          type: 'array',
          description: 'Expenses, transactions, receipts.',
          items: {
            type: 'object',
            properties: {
              account_id: accountIdSchema,
              date: { type: 'string', description: 'Transaction date (when the purchase happened). ISO YYYY-MM-DD.' },
              billing_date: { type: 'string', nullable: true, description: 'Billing/charge date from statement (חיוב לתאריך). ISO YYYY-MM-DD. Null if not available.' },
              merchant: { type: 'string' },
              category: categorySchema,
              purchase_amount: { type: 'number', description: 'Original purchase amount (סכום קנייה). Positive.' },
              purchase_currency: { type: 'string', description: 'Currency of the purchase (ILS, USD, EUR, etc.).' },
              charge_amount_ils: { type: 'number', description: 'Amount actually charged in ILS (סכום חיוב בש"ח). Positive.' },
              external_ref_id: { type: 'string', nullable: true, description: 'Reference / receipt number (אסמכתא). Null if not available.' },
            },
            required: ['account_id', 'date', 'merchant', 'purchase_amount', 'purchase_currency', 'charge_amount_ils'],
          },
        },
      },
      required: ['snapshots', 'income', 'expenses'],
    },
  };
}

function buildUserParts({ kind, content, mediaType }) {
  if (kind === 'text' || kind === 'csv') {
    return [
      { text: 'Extract ledger rows from the following content:' },
      { text: content },
    ];
  }
  if (kind === 'image') {
    return [
      { text: 'Extract ledger rows from this image:' },
      { inlineData: { mimeType: mediaType || 'image/png', data: content } },
    ];
  }
  if (kind === 'pdf') {
    return [
      { text: 'Extract ledger rows from this PDF:' },
      { inlineData: { mimeType: 'application/pdf', data: content } },
    ];
  }
  throw new Error(`Unsupported kind: ${kind}`);
}

// Drop rows missing required fields and surface them in `rejected` so the
// browser can show a partial-success message. Cap each tab to MAX_ROWS_PER_TAB.
function validateAndCap(extracted, accountIds) {
  const accountSet = new Set(accountIds);
  const rejected = [];

  const validateRow = (tab, row, requiredFields) => {
    for (const field of requiredFields) {
      const v = row[field];
      if (v === undefined || v === null || v === '') {
        rejected.push({ reason: `${tab}: missing ${field}`, row });
        return false;
      }
    }
    if ((tab === 'snapshots' || tab === 'expenses') && accountSet.size && !accountSet.has(row.account_id)) {
      rejected.push({ reason: `${tab}: unknown account_id "${row.account_id}"`, row });
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) {
      rejected.push({ reason: `${tab}: bad date format "${row.date}"`, row });
      return false;
    }
    return true;
  };

  return {
    snapshots: (extracted.snapshots || [])
      .filter(r => validateRow('snapshots', r, ['account_id', 'date', 'balance_native', 'currency']))
      .slice(0, MAX_ROWS_PER_TAB),
    income: (extracted.income || [])
      .filter(r => validateRow('income', r, ['source', 'type', 'date', 'gross_native', 'currency']))
      .slice(0, MAX_ROWS_PER_TAB),
    expenses: (extracted.expenses || [])
      .filter(r => validateRow('expenses', r, ['account_id', 'date', 'merchant', 'purchase_amount', 'purchase_currency', 'charge_amount_ils']))
      .slice(0, MAX_ROWS_PER_TAB),
    rejected,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'server_misconfigured',
      detail: 'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey. In Vercel: Project Settings → Environment Variables. Locally: add to .env.local and restart vercel dev.',
    });
    return;
  }

  const body = req.body || {};
  if (!body.kind || typeof body.content !== 'string') {
    res.status(400).json({ error: 'bad_request', detail: 'kind and content are required' });
    return;
  }

  const accounts = body.accounts || [];
  const accountIds = accounts.map(a => a.id).filter(Boolean);
  const categories = body.categories || [];

  const ai = new GoogleGenAI({ apiKey });
  const tool = buildExtractTool(accountIds, categories);

  // Gemini Flash variants return 503 UNAVAILABLE under load fairly often. We
  // retry briefly within a model, then fall back to the next model in the
  // chain. Different models don't share load, so when 2.5-flash is overloaded
  // 2.0-flash usually isn't.
  const callGemini = (model) => ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: buildUserParts({ kind: body.kind, content: body.content, mediaType: body.mediaType }) }],
    config: {
      systemInstruction: buildSystemPrompt({ schema: body.schema, accounts, categories }),
      tools: [{ functionDeclarations: [tool] }],
      toolConfig: {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['extract_rows'] },
      },
      // Long PDFs/CSVs can produce 100+ rows. Default output limits leave too
      // little budget once thinking tokens are subtracted, silently truncating
      // the function-call args. Bump the cap and disable thinking for this
      // bounded extraction task — the schema is the reasoning, no CoT needed.
      maxOutputTokens: 16384,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const PER_MODEL_RETRY_DELAYS_MS = [800];   // 1 quick retry per model before rotating

  let response;
  let usedModel;
  let lastErr;
  const attempts = [];

  const t0 = Date.now();
  outer: for (const model of MODELS) {
    for (let attempt = 0; attempt <= PER_MODEL_RETRY_DELAYS_MS.length; attempt++) {
      const tStart = Date.now();
      try {
        response = await callGemini(model);
        usedModel = model;
        lastErr = null;
        const ms = Date.now() - tStart;
        attempts.push({ model, attempt, status: 200, ms });
        console.log(`[intake] ${model} attempt=${attempt} ok ${ms}ms`);
        break outer;
      } catch (e) {
        lastErr = e;
        const status = e.status || e.code;
        const retriable = status === 503 || status === 429 || status === 500;
        const ms = Date.now() - tStart;
        attempts.push({ model, attempt, status: status || 'unknown', ms });
        console.warn(`[intake] ${model} attempt=${attempt} ${status || 'err'} ${ms}ms — ${(e.message || '').slice(0, 120)}`);
        if (!retriable) break outer;
        if (attempt === PER_MODEL_RETRY_DELAYS_MS.length) break;   // rotate to next model
        await new Promise(r => setTimeout(r, PER_MODEL_RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  const totalMs = Date.now() - t0;

  if (lastErr) {
    const status = lastErr.status || lastErr.code;
    if (status === 429) {
      res.status(429).json({ error: 'rate_limited', detail: lastErr.message, attempts });
      return;
    }
    if (status && Number.isInteger(status) && status >= 400 && status < 600) {
      res.status(status).json({ error: 'gemini_api_error', status, detail: lastErr.message, attempts });
      return;
    }
    res.status(500).json({ error: 'unexpected', detail: lastErr.message || String(lastErr), attempts });
    return;
  }

  const finishReason = response.candidates?.[0]?.finishReason;
  const truncated = finishReason && finishReason !== 'STOP';

  const fnCall = (response.functionCalls || [])[0];
  if (!fnCall || fnCall.name !== 'extract_rows') {
    res.status(502).json({
      error: 'no_tool_use',
      detail: truncated
        ? `Model output truncated (finishReason=${finishReason}) before completing the function call. Try a smaller input.`
        : 'Model did not call extract_rows. This should not happen with mode=ANY.',
      finish_reason: finishReason,
      attempts,
    });
    return;
  }

  const validated = validateAndCap(fnCall.args || {}, accountIds);

  // Stamp system-level fields on every row: created_at (UTC ISO) and
  // source_doc (filename or origin indicator, passed from the frontend).
  const createdAt = new Date().toISOString();
  const sourceDoc = body.sourceDoc || null;
  const stampRow = (row) => ({ ...row, created_at: createdAt, source_doc: sourceDoc });
  validated.snapshots = validated.snapshots.map(stampRow);
  validated.income = validated.income.map(stampRow);
  validated.expenses = validated.expenses.map(stampRow);

  console.log(`[intake] done model=${usedModel} ${totalMs}ms snapshots=${validated.snapshots.length} income=${validated.income.length} expenses=${validated.expenses.length} rejected=${validated.rejected.length} finish=${finishReason}`);

  // In dryRun mode (review-before-apply), skip DB write — just return rows.
  const dryRun = body.dryRun === true;
  let dbWritten = false;
  const user = req.headers.authorization?.startsWith('Bearer ')
    ? await authenticate(req, { status: () => ({ json: () => {} }) })
    : null;

  if (user && dbUrl && !dryRun) {
    try {
      const sql = getDb();
      const uid = user.userId;
      for (const r of validated.expenses) {
        const pa = parseFloat(r.purchase_amount) || 0;
        const ca = parseFloat(r.charge_amount_ils) || pa;
        const pc = r.purchase_currency || 'ILS';
        const fxRate = (pc !== 'ILS' && pa > 0) ? +(ca / pa).toFixed(4) : 1;
        await sql`
          INSERT INTO expenses (user_id, date, account_id, amount_native, currency, amount_ils, fx_rate,
                                category, merchant, description, source_doc, billing_date, external_ref_id, created_at)
          VALUES (${uid}, ${r.date}, ${r.account_id}, ${pa}, ${pc}, ${ca}, ${fxRate},
                  ${r.category || null}, ${r.merchant}, ${r.description || null},
                  ${r.source_doc || null}, ${r.billing_date || null}, ${r.external_ref_id || null}, ${r.created_at})
          ON CONFLICT DO NOTHING
        `;
      }
      for (const r of validated.snapshots) {
        await sql`
          INSERT INTO snapshots (user_id, account_id, date, balance_native, currency, fx_rate, source_doc, created_at)
          VALUES (${uid}, ${r.account_id}, ${r.date}, ${r.balance_native}, ${r.currency},
                  ${r.fx_rate || null}, ${r.source_doc || null}, ${r.created_at})
          ON CONFLICT (user_id, account_id, date) DO UPDATE SET balance_native = EXCLUDED.balance_native
        `;
      }
      for (const r of validated.income) {
        await sql`
          INSERT INTO income (user_id, date, source, type, gross_native, currency, source_doc, created_at)
          VALUES (${uid}, ${r.date}, ${r.source}, ${r.type}, ${r.gross_native}, ${r.currency || 'ILS'},
                  ${r.source_doc || null}, ${r.created_at})
          ON CONFLICT DO NOTHING
        `;
      }
      dbWritten = true;
      console.log(`[intake] DB write ok uid=${uid}`);
    } catch (e) {
      console.warn(`[intake] DB write failed: ${e.message}`);
    }
  }

  res.status(200).json({
    ...validated,
    truncated: !!truncated,
    finish_reason: finishReason,
    db_written: dbWritten,
    usage: {
      input_tokens: response.usageMetadata?.promptTokenCount,
      output_tokens: response.usageMetadata?.candidatesTokenCount,
      total_tokens: response.usageMetadata?.totalTokenCount,
    },
    model: usedModel,
    attempts,
    total_ms: totalMs,
  });
}