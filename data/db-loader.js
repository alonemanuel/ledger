// Database loader — fetches the user's ledger from the API (backed by Neon
// Postgres) and populates window.FinanceData in place.
//
// Uses Google Identity Services for authentication (same OAuth popup as the
// Sheets loader). The access token is sent as a Bearer token to /api/*
// endpoints, which verify it with Google and auto-register the user.
//
// Public API matches SheetsLoader so app.jsx Bootstrap can switch with
// minimal changes.

(function () {
  const CLIENT_ID = '524822374717-jun05s52km4co3h1b838r3qsip0850aa.apps.googleusercontent.com';
  const SCOPES = 'email profile';
  const TOKEN_KEY = 'ledger_db_token_v1';
  const CONSENTED_KEY = 'ledger_db_consented_v1';

  let tokenClient = null;
  let accessToken = null;

  // ── GIS helpers ────────────────────────────────────────────────
  function waitFor(predicate, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function check() {
        if (predicate()) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Timed out waiting for library to load'));
        setTimeout(check, 50);
      })();
    });
  }

  async function ensureGisInited() {
    if (tokenClient) return;
    await waitFor(() => window.google?.accounts?.oauth2);
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: () => {},
    });
  }

  function loadCachedToken() {
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

  function clearCachedToken() {
    localStorage.removeItem(TOKEN_KEY);
    accessToken = null;
  }

  function hasConsented() {
    return localStorage.getItem(CONSENTED_KEY) === '1';
  }

  function saveToken(response) {
    accessToken = response.access_token;
    const expiresAt = Date.now() + (response.expires_in - 60) * 1000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: accessToken, expiresAt }));
    localStorage.setItem(CONSENTED_KEY, '1');
  }

  function requestSignIn({ silent = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        reject(new Error('Sign-in not ready — Google Identity library not loaded yet'));
        return;
      }
      tokenClient.callback = (response) => {
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
      tokenClient.error_callback = (err) => {
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
  async function apiFetch(path, opts = {}) {
    if (!accessToken) throw new Error('Not signed in');
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...opts.headers,
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

  const ALL_MONTHS = (() => {
    const out = [];
    for (let y = 2024; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === 2024 && m < 5) continue;
        if (y === 2026 && m > 5) continue;
        out.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }
    return out;
  })();

  function buildFromApiData({ accounts: acctRows, snapshots: snapRows, income: incRows, expenses: expRows, fx_rates: fxRatesMap }) {
    const accounts = acctRows.map(a => ({
      id: a.id,
      owner: a.owner,
      provider: a.provider,
      name: a.nickname.includes(' - ') ? a.nickname.split(' - ').slice(1).join(' - ') : a.nickname,
      type: a.type,
      currency: (a.currency || 'ILS').replace('NIS', 'ILS'),
      status: a.status,
    }));

    // Snapshot dedup + forward-fill (same logic as sheets-loader)
    const perAcct = {};
    snapRows.forEach(s => {
      const date = s.date || '';
      if (!perAcct[s.account_id]) perAcct[s.account_id] = [];
      perAcct[s.account_id].push({ date, ym: date.slice(0, 7), balance: parseFloat(s.balance_native) });
    });
    const snapshots = [];
    accounts.forEach(acc => {
      const list = (perAcct[acc.id] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
      if (!list.length) return;
      const firstYm = list[0].ym;
      const dict = {};
      list.forEach(item => { dict[item.ym] = item.balance; });
      let last = null;
      ALL_MONTHS.forEach(ym => {
        if (ym < firstYm) return;
        if (dict[ym] !== undefined) last = dict[ym];
        if (last !== null) snapshots.push({ accountId: acc.id, ym, balance: Math.round(last) });
      });
    });

    // FX rates — use DB fx_rates table, with forward-fill
    const fxByMonth = {};
    for (const [ym, rate] of Object.entries(fxRatesMap || {})) {
      fxByMonth[ym] = parseFloat(rate);
    }
    // Also extract from USD snapshots as fallback
    snapRows.forEach(s => {
      if ((s.currency === 'USD') && s.fx_rate) {
        const r = parseFloat(s.fx_rate);
        if (r > 0) fxByMonth[(s.date || '').slice(0, 7)] = r;
      }
    });
    let lastRate = 3.20;
    const fxFull = {};
    ALL_MONTHS.forEach(ym => {
      if (fxByMonth[ym]) lastRate = fxByMonth[ym];
      fxFull[ym] = lastRate;
    });
    const fxCurrent = fxByMonth[ALL_MONTHS[ALL_MONTHS.length - 1]] || lastRate;

    // Income with annual-spread
    const SOURCE_OWNER = { MongooseNet: 'Alon', ImagenAI: 'Alon', Bezalel: 'Alon', IBKR: 'Alon' };
    const income = [];
    incRows.forEach(r => {
      const src = r.source;
      const typ = r.type;
      const owner = SOURCE_OWNER[src] || 'Alon';
      const amt = parseFloat(r.gross_native);
      const cur = (r.currency || 'ILS').replace('NIS', 'ILS');
      const dateStr = r.date || '';
      const ym = dateStr.slice(0, 7);
      const isAnnual = dateStr.endsWith('-12-31') &&
        ['salary', 'employer_pension_contribution', 'employer_study_fund_contribution'].includes(typ);
      if (isAnnual) {
        const year = ym.slice(0, 4);
        let months;
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
    const expenses = expRows.map((r, i) => {
      const amtNative = parseFloat(r.amount_native) || 0;
      const amtIls = parseFloat(r.amount_ils) || amtNative;
      const cur = (r.currency || 'ILS').replace('NIS', 'ILS');
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

  function populateFinanceData(built) {
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
      } catch (e) {
        if (e.message !== 'AUTH_EXPIRED') throw e;
      }
    }
    if (hasConsented()) {
      try {
        await requestSignIn({ silent: true });
        return await fetchAndPopulate();
      } catch (e) {
        if (e.message !== 'SILENT_FAILED' && e.message !== 'AUTH_EXPIRED') throw e;
      }
    }
    throw new Error('NEEDS_SIGNIN');
  }

  function signOut() {
    if (accessToken && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    clearCachedToken();
    localStorage.removeItem(CONSENTED_KEY);
  }

  async function loadDemoData() {
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

  async function appendRows(tab, rows) {
    if (!rows?.length) return { appended: 0 };
    const result = await apiFetch(`/api/${tab}`, {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
    return { appended: result.inserted || 0 };
  }

  function getCurrentToken() { return accessToken; }

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
})();
