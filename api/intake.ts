// Intake endpoint — receives content (text/image/pdf/csv) from the dashboard's
// Intake tab, calls Claude to extract structured rows, returns them.
//
// STEP 2 of the rollout: this is a STUB. It returns hardcoded rows so the
// frontend (Intake tab) can be built end-to-end against a stable contract
// without burning Anthropic tokens or coupling routing failures to LLM
// failures. The real Claude call lands in step 5.

import type { VercelRequest, VercelResponse } from '@vercel/node';

type IntakeKind = 'text' | 'image' | 'pdf' | 'csv';

type IntakeRequest = {
  kind: IntakeKind;
  content: string;          // text or base64
  mediaType?: string;       // for images
  sheetId?: string;         // forwarded by the browser (cached after first fetch)
  schema?: unknown;         // headers + sample rows per tab
  accounts?: { id: string; nickname: string; type: string; currency: string }[];
  googleToken?: string;     // forwarded for tokeninfo verification (step 7)
};

type ExtractedSnapshot = {
  account_id: string;
  date: string;             // YYYY-MM-DD
  balance_native: number;
  currency: string;
  fx_rate?: number;
};

type ExtractedIncome = {
  source: string;
  type: string;
  date: string;
  gross_native: number;
  currency: string;
};

type ExtractedExpense = {
  account_id: string;
  date: string;
  merchant: string;
  category: string | null;
  amount_native: number;
  currency: string;
};

type IntakeResponse = {
  snapshots: ExtractedSnapshot[];
  income: ExtractedIncome[];
  expenses: ExtractedExpense[];
  rejected?: { reason: string; row: unknown }[];
  stub?: true;              // present while the endpoint is a stub
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const body = (req.body ?? {}) as Partial<IntakeRequest>;
  if (!body.kind || typeof body.content !== 'string') {
    res.status(400).json({ error: 'bad_request', detail: 'kind and content are required' });
    return;
  }

  // STUB: return one fake expense regardless of input. Lets the frontend
  // verify the full pipeline (POST → response → append to Sheet → re-render)
  // before any LLM call lands.
  const today = new Date().toISOString().slice(0, 10);
  const firstAccountId = body.accounts?.[0]?.id ?? 'unknown_account';
  const stubResponse: IntakeResponse = {
    snapshots: [],
    income: [],
    expenses: [
      {
        account_id: firstAccountId,
        date: today,
        merchant: 'STUB — replace with real Claude extraction',
        category: 'other',
        amount_native: 0,
        currency: 'ILS',
      },
    ],
    stub: true,
  };

  res.status(200).json(stubResponse);
}
