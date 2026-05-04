// Intake endpoint — receives content (text/image/pdf/csv) from the dashboard's
// Intake tab, calls Claude to extract structured rows, returns them.
//
// Model: claude-opus-4-7 by default (adaptive thinking disabled — bounded
// extraction doesn't need reasoning depth). Override with ANTHROPIC_MODEL.
//
// Auth: Anthropic API key from process.env.ANTHROPIC_API_KEY (Vercel env var).
// Origin allowlist + Google token verification land in step 7.
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

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-7';
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

function buildExtractTool(accountIds, categories) {
  const accountIdSchema = accountIds.length
    ? { type: 'string', enum: accountIds }
    : { type: 'string' };
  const categorySchema = categories.length
    ? { type: ['string', 'null'], enum: [...categories, null] }
    : { type: ['string', 'null'] };

  return {
    name: 'extract_rows',
    description: 'Extract structured ledger rows from the user-provided content.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        snapshots: {
          type: 'array',
          description: 'Account balance snapshots (e.g. from bank or brokerage statements).',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              account_id: accountIdSchema,
              date: { type: 'string', description: 'ISO YYYY-MM-DD' },
              balance_native: { type: 'number' },
              currency: { type: 'string', enum: ['ILS', 'USD'] },
              fx_rate: { type: ['number', 'null'], description: 'USD→ILS rate if currency=USD; null otherwise' },
            },
            required: ['account_id', 'date', 'balance_native', 'currency'],
          },
        },
        income: {
          type: 'array',
          description: 'Income entries (salary, bonus, dividends, etc.).',
          items: {
            type: 'object',
            additionalProperties: false,
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
            additionalProperties: false,
            properties: {
              account_id: accountIdSchema,
              date: { type: 'string', description: 'ISO YYYY-MM-DD' },
              merchant: { type: 'string' },
              category: categorySchema,
              amount_native: { type: 'number', description: 'Positive number; the sign is implied by being in the expenses tab.' },
              currency: { type: 'string', enum: ['ILS', 'USD'] },
            },
            required: ['account_id', 'date', 'merchant', 'amount_native', 'currency'],
          },
        },
      },
      required: ['snapshots', 'income', 'expenses'],
    },
  };
}

function buildUserContent({ kind, content, mediaType }) {
  if (kind === 'text' || kind === 'csv') {
    return [
      { type: 'text', text: 'Extract ledger rows from the following content:' },
      { type: 'text', text: content },
    ];
  }
  if (kind === 'image') {
    return [
      { type: 'text', text: 'Extract ledger rows from this image:' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType || 'image/png',
          data: content,
        },
      },
    ];
  }
  if (kind === 'pdf') {
    return [
      { type: 'text', text: 'Extract ledger rows from this PDF:' },
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: content,
        },
      },
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
      .filter(r => validateRow('expenses', r, ['account_id', 'date', 'merchant', 'amount_native', 'currency']))
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'server_misconfigured',
      detail: 'ANTHROPIC_API_KEY is not set. In Vercel: Project Settings → Environment Variables. Locally: add to .env.local and restart vercel dev.',
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

  const client = new Anthropic({ apiKey });
  const tool = buildExtractTool(accountIds, categories);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: buildSystemPrompt({ schema: body.schema, accounts, categories }),
      tools: [tool],
      tool_choice: { type: 'tool', name: 'extract_rows' },
      messages: [
        {
          role: 'user',
          content: buildUserContent({ kind: body.kind, content: body.content, mediaType: body.mediaType }),
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'rate_limited', detail: e.message });
      return;
    }
    if (e instanceof Anthropic.APIError) {
      res.status(e.status || 502).json({ error: 'anthropic_api_error', status: e.status, detail: e.message });
      return;
    }
    res.status(500).json({ error: 'unexpected', detail: e.message || String(e) });
    return;
  }

  const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'extract_rows');
  if (!toolUse) {
    res.status(502).json({
      error: 'no_tool_use',
      detail: 'Model did not call extract_rows. This should not happen with tool_choice forced.',
      stop_reason: response.stop_reason,
    });
    return;
  }

  const validated = validateAndCap(toolUse.input || {}, accountIds);

  res.status(200).json({
    ...validated,
    usage: {
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens,
    },
    model: response.model,
  });
}
