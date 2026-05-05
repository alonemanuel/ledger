import { ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, FX } from './data.ts';
import type { Account, Snapshot, IncomeRow, ExpenseRow } from '../types.ts';
// Database loader — fetches the user's ledger from the API (backed by Neon
// Postgres) and populates window.FinanceData in place.
//
// Uses Google Identity Services for authentication. The access token is sent
// as a Bearer token to /api/* endpoints, which verify it with Google and
// auto-register the user.

// db-loader module
const CLIENT_ID = '524822374717-jun05s52km4co3h1b838r3qsip0850aa.apps.googleusercontent.com';
const SCOPES = 'email profile';
const TOKEN_KEY = 'ledger_db_token_v1';
const CONSENTED_KEY = 'ledger_db_consented_v1';

interface TokenClient {
  callback: (response: OAuthResponse) => void;
  error_callback: (err: { type?: string; message?: string }) => void;
  requestAccessToken: (opts: { prompt: string }) => void;
}

interface OAuthResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}

interface BuiltData {
  accounts: Account[];
  snapshots: Snapshot[];
  income: IncomeRow[];
  expenses: ExpenseRow[];
  fxFull: Record<string, number>;
  fxCurrent: number;
}

let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;

// ── GIS helpers ────────────────────────────────────────────────
function waitFor(predicate: () => unknown, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Timed out waiting for library to load'));
      setTimeout(check, 50);
    })();
  });
}

async function ensureGisInited(): Promise<void> {
  if (tokenClient) return;
  await waitFor(() => window.google?.accounts?.oauth2);
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
  });
}

function loadCachedToken(): boolean {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return false;
    const { token, expiresAt } = JSON.parse(raw);
    if (token && expiresAt > Date.now() + 30_000) {
      accessToken = token;
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

function clearCachedToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  accessToken = null;
}

function hasConsented(): boolean {
  return localStorage.getItem(CONSENTED_KEY) === '1';
}

function saveToken(response: OAuthResponse): void {
  accessToken = response.access_token!;
  const expiresAt = Date.now() + ((response.expires_in ?? 3600) - 60) * 1000;
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: accessToken, expiresAt }));
  localStorage.setItem(CONSENTED_KEY, '1');
}

function requestSignIn({ silent = false } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('Sign-in not ready — Google Identity library not loaded yet'));
      return;
    }
    tokenClient.callback = (response: OAuthResponse) => {
      if (response.error) {
        reject(new Error(silent ? 'SILENT_FAILED' : `OAuth error: ${response.error}`));
        return;
      }
      if (!response.access_token) {
        reject(new Error(silent ? 'SILENT_FAILED' : 'No access token received'));
        return;
      }
      saveToken(response);
      resolve();
    };
    tokenClient.error_callback = (err: { type?: string; message?: string }) => {
      const t = err?.type || '';
      if (silent) { reject(new Error('SILENT_FAILED')); return; }
      if (t === 'popup_failed_to_open') reject(new Error('POPUP_BLOCKED'));
      else if (t === 'popup_closed') reject(new Error('POPUP_CLOSED'));
      else reject(new Error(`OAuth error: ${err?.message || t || 'unknown'}`));
    };
    tokenClient.requestAccessToken({ prompt: silent ? '' : 'select_account' });
  });
}

// ── API calls ──────────────────────────────────────────────────
async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  if (!accessToken) throw new Error('Not signed in');
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers as Record<string, string>),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401) {
    clearCachedToken();
    throw new Error('AUTH_EXPIRED');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── transform API response → FinanceData shape ────────────────
// The API returns raw DB rows. We apply the same business logic as
// the Sheets loader: snapshot dedup/forward-fill, FX interpolation,
// income annual-spread, expense owner resolution.

const ALL_MONTHS: string[] = (() => {
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;
  const out: string[] = [];
  for (let y = 2024; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2024 && m < 5) continue;
      if (y === endYear && m > endMonth) continue;
      out.push(`${y}-${String(m).padStart(2, '0')}`);
    }
  }
  return out;
})();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFromApiData({ accounts: acctRows, snapshots: snapRows, income: incRows, expenses: expRows, fx_rates: fxRatesMap }: any): BuiltData {
  const accounts: Account[] = acctRows.map((a: any) => ({
    id: a.id,
    owner: a.owner,
    provider: a.provider,
    name: a.nickname.includes(' - ') ? a.nickname.split(' - ').slice(1).join(' - ') : a.nickname,
    type: a.type,
    currency: (a.currency || 'ILS').replace('NIS', 'ILS'),
    status: a.status,
  }));

  // Snapshot dedup + forward-fill
  const perAcct: Record<string, { date: string; ym: string; balance: number }[]> = {};
  snapRows.forEach((s: any) => {
    const date = s.date || '';
    if (!perAcct[s.account_id]) perAcct[s.account_id] = [];
    perAcct[s.account_id].push({ date, ym: date.slice(0, 7), balance: parseFloat(s.balance_native) });
  });
  const snapshots: Snapshot[] = [];
  accounts.forEach(acc => {
    const list = (perAcct[acc.id] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return;
    const firstYm = list[0].ym;
    const dict: Record<string, number> = {};
    list.forEach(item => { dict[item.ym] = item.balance; });
    let last: number | null = null;
    ALL_MONTHS.forEach(ym => {
      if (ym < firstYm) return;
      if (dict[ym] !== undefined) last = dict[ym];
      if (last !== null) snapshots.push({ accountId: acc.id, ym, balance: Math.round(last) });
    });
  });

  // FX rates — use DB fx_rates table, with forward-fill
  const fxByMonth: Record<string, number> = {};
  for (const [ym, rate] of Object.entries(fxRatesMap || {})) {
    fxByMonth[ym] = parseFloat(rate as string);
  }
  // Also extract from USD snapshots as fallback
  snapRows.forEach((s: any) => {
    if ((s.currency === 'USD') && s.fx_rate) {
      const r = parseFloat(s.fx_rate);
      if (r > 0) fxByMonth[(s.date || '').slice(0, 7)] = r;
    }
  });
  let lastRate = 3.20;
  const fxFull: Record<string, number> = {};
  ALL_MONTHS.forEach(ym => {
    if (fxByMonth[ym]) lastRate = fxByMonth[ym];
    fxFull[ym] = lastRate;
  });
  const fxCurrent = fxByMonth[ALL_MONTHS[ALL_MONTHS.length - 1]] || lastRate;

  // Income with annual-spread
  const SOURCE_OWNER: Record<string, string> = { MongooseNet: 'Alon', ImagenAI: 'Alon', Bezalel: 'Alon', IBKR: 'Alon' };
  const income: IncomeRow[] = [];
  incRows.forEach((r: any) => {
    const src: string = r.source;
    const typ: string = r.type;
    const owner = SOURCE_OWNER[src] || 'Alon';
    const amt = parseFloat(r.gross_native);
    const cur = ((r.currency || 'ILS') as string).replace('NIS', 'ILS') as 'ILS' | 'USD';
    const dateStr: string = r.date || '';
    const ym = dateStr.slice(0, 7);
    const isAnnual = dateStr.endsWith('-12-31') &&
      ['salary', 'employer_pension_contribution', 'employer_study_fund_contribution'].includes(typ);
    if (isAnnual) {
      const year = ym.slice(0, 4);
      let months: string[];
      if (src === 'MongooseNet') months = Array.from({ length: 11 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
      else if (src === 'ImagenAI') months = [`${year}-11`, `${year}-12`];
      else if (src === 'Bezalel') months = [`${year}-06`];
      else months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
      const per = amt / months.length;
      months.forEach(mym => income.push({
        ym: mym, owner, type: typ, amount: Math.round(per), currency: cur, source: src,
      }));
    } else {
      income.push({ ym, owner, type: typ, amount: Math.round(amt * 100) / 100, currency: cur, source: src });
    }
  });

  // Expenses
  const acctOwner = Object.fromEntries(accounts.map(a => [a.id, a.owner]));
  const expenses: ExpenseRow[] = expRows.map((r: any, i: number) => {
    const amtNative = parseFloat(r.amount_native) || 0;
    const amtIls = parseFloat(r.amount_ils) || amtNative;
    const cur = ((r.currency || 'ILS') as string).replace('NIS', 'ILS');
    return {
      id: r.id || i + 1,
      date: r.date,
      billing_date: r.billing_date || null,
      ym: (r.date || '').slice(0, 7),
      owner: acctOwner[r.account_id] || 'Alon',
      account: r.account_id,
      merchant: r.merchant,
      category: r.category || null,
      amount: amtIls,
      purchase_amount: amtNative,
      purchase_currency: cur,
      currency: 'ILS',
      external_ref_id: r.external_ref_id || null,
      created_at: r.created_at || null,
      source_doc: r.source_doc || null,
    };
  });

  return { accounts, snapshots, income, expenses, fxFull, fxCurrent };
}

function populateFinanceData(built: BuiltData): void {
  ACCOUNTS.length = 0; ACCOUNTS.push(...built.accounts);
  SNAPSHOTS.length = 0; SNAPSHOTS.push(...built.snapshots);
  INCOME.length = 0; INCOME.push(...built.income);
  EXPENSES.length = 0; EXPENSES.push(...built.expenses);
  Object.keys(FX.byMonth).forEach(k => delete FX.byMonth[k]);
  Object.assign(FX.byMonth, built.fxFull);
  FX.current = built.fxCurrent;
  FX.setOn = new Date().toISOString().slice(0, 10);
  if (window.Fin?.rebuildDerivations) window.Fin.rebuildDerivations();
}

// ── public API ─────────────────────────────────────────────────
async function fetchAndPopulate() {
  const data = await apiFetch('/api/data');
  const built = buildFromApiData(data);
  populateFinanceData(built);
  return {
    accounts: built.accounts.length,
    snapshots: built.snapshots.length,
    income: built.income.length,
    expenses: built.expenses.length,
  };
}

async function bootstrap() {
  if (loadCachedToken()) {
    try {
      return await fetchAndPopulate();
    } catch (e: any) {
      if (e.message !== 'AUTH_EXPIRED') throw e;
    }
  }
  if (hasConsented()) {
    try {
      await requestSignIn({ silent: true });
      return await fetchAndPopulate();
    } catch (e: any) {
      if (e.message !== 'SILENT_FAILED' && e.message !== 'AUTH_EXPIRED') throw e;
    }
  }
  throw new Error('NEEDS_SIGNIN');
}

function signOut(): void {
  if (accessToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  clearCachedToken();
  localStorage.removeItem(CONSENTED_KEY);
}

async function loadDemoData(): Promise<void> {
  const src = window.__LEDGER_DEMO_SOURCE__
    || await fetch('data/data.example.js').then(r => {
      if (!r.ok) throw new Error(`Demo data not available (${r.status})`);
      return r.text();
    });
  new Function(src)();
  const ex = window.FinanceData;
  populateFinanceData({
    accounts: ex.ACCOUNTS,
    snapshots: ex.SNAPSHOTS,
    income: ex.INCOME,
    expenses: ex.EXPENSES,
    fxFull: ex.FX.byMonth,
    fxCurrent: ex.FX.current,
  });
}

async function appendRows(tab: string, rows: unknown[]): Promise<{ appended: number }> {
  if (!rows?.length) return { appended: 0 };
  const result = await apiFetch(`/api/${tab}`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
  return { appended: result.inserted || 0 };
}

function getCurrentToken(): string | null { return accessToken; }

window.DbLoader = {
  init: ensureGisInited,
  bootstrap,
  signOut,
  requestSignIn,
  loadDemoData,
  fetchAndPopulate,
  appendRows,
  getCurrentToken,
};
