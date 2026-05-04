// Google Sheets loader — fetches the ledger spreadsheet from the user's Drive
// folder and populates window.FinanceData in place.
//
// The spreadsheet is expected to be named SHEET_NAME inside FOLDER_ID with
// four tabs: accounts, snapshots, income, expenses (matching the original
// CSV schema). Use tools/migrate.html once to create it from existing CSVs.
//
// Pre-requisites:
//   - Google Identity Services library loaded (https://accounts.google.com/gsi/client)
//   - data/data.js loaded (declares ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, FX
//     as mutable top-level consts so we can populate them in place)
//
// Public API mirrors the old DriveLoader so app.jsx Bootstrap doesn't change.
//
// NOTE: PapaParse is no longer required at runtime — Sheets API returns JSON.

(function () {
  const CLIENT_ID  = '524822374717-jun05s52km4co3h1b838r3qsip0850aa.apps.googleusercontent.com';
  const FOLDER_ID  = '1x3REt2-XYd73s1wH61MFRBPbs94e1NJN';
  const SHEET_NAME = 'ledger';
  const SCOPES     = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets';
  // Bumped to _v2 when the spreadsheets scope widened from readonly to
  // read+write — old cached tokens lacked write scope and would silently
  // 403 on append. Bumping the key forces a clean re-auth on first load.
  const TOKEN_KEY  = 'ledger_sheets_token_v2';
  // Durable marker that survives token expiry. Lets us know whether to attempt
  // a silent refresh on load — without it, we skip silent and go straight to
  // the sign-in button so Chrome doesn't show a popup-blocked indicator on
  // fresh origins where Google would have to open a popup anyway.
  const CONSENTED_KEY = 'ledger_sheets_consented_v1';
  const TAB_NAMES  = ['accounts', 'snapshots', 'income', 'expenses'];

  let tokenClient = null;
  let accessToken = null;
  let cachedSheetId = null;
  let cachedHeaders = {};   // { tabName: [...headerStrings] }
  let cachedSamples = {};   // { tabName: [...first ~3 row objects] }

  // ── auth (same shape as drive-loader) ─────────────────────────────
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
    } catch (e) { /* ignore */ }
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
      // Silent mode uses prompt:'' which reuses the existing Google session
      // without showing a popup. Works only if the user is already signed in
      // to Google in this browser and has previously consented to our scopes.
      tokenClient.requestAccessToken({ prompt: silent ? '' : 'select_account' });
    });
  }

  // ── api ──────────────────────────────────────────────────────────
  async function findLedgerSheetId() {
    const q = encodeURIComponent(
      `'${FOLDER_ID}' in parents and trashed=false ` +
      `and mimeType='application/vnd.google-apps.spreadsheet' ` +
      `and name='${SHEET_NAME}'`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) { clearCachedToken(); throw new Error('AUTH_EXPIRED'); }
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    const files = json.files || [];
    if (!files.length) {
      throw new Error(
        `No spreadsheet named "${SHEET_NAME}" in the Drive folder. ` +
        `Run tools/migrate.html once to create it from the existing CSVs.`
      );
    }
    if (files.length > 1) {
      console.warn(`Multiple "${SHEET_NAME}" sheets found; using most recent.`);
      files.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
    }
    return files[0].id;
  }

  async function fetchAllTabs(sheetId) {
    const ranges = TAB_NAMES.map(n => `ranges=${encodeURIComponent(n + '!A:Z')}`).join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${ranges}&majorDimension=ROWS`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) { clearCachedToken(); throw new Error('AUTH_EXPIRED'); }
    if (!res.ok) throw new Error(`Sheets fetch failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    const out = {};
    cachedHeaders = {};
    cachedSamples = {};
    (json.valueRanges || []).forEach((vr, i) => {
      const tabName = TAB_NAMES[i];
      const rows = vr.values || [];
      const headers = rows.length ? rows[0].map(h => String(h || '').trim()) : [];
      const objects = rowsToObjects(rows, headers);
      cachedHeaders[tabName] = headers;
      cachedSamples[tabName] = objects.slice(0, 3);
      out[tabName] = objects;
    });
    return out;
  }

  // Sheets returns arrays-of-arrays. Convert the first row to headers and
  // pad short rows so missing trailing cells become "" — matches PapaParse
  // header-mode behavior so buildFromRows can stay agnostic.
  function rowsToObjects(rows, headersOverride) {
    if (!rows.length) return [];
    const headers = headersOverride || rows[0].map(h => String(h || '').trim());
    return rows.slice(1)
      .filter(r => r.some(cell => String(cell || '').trim() !== ''))
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? String(r[i]) : ''; });
        return obj;
      });
  }

  // ── append (write path) ───────────────────────────────────────────
  // Append rows to a tab. Uses the cached headers (populated by
  // fetchAllTabs) to determine column order, so the row objects can use
  // unordered key/value pairs and any unknown keys are silently ignored.
  // Missing keys become empty cells.
  //
  // valueInputOption=USER_ENTERED so dates/numbers are interpreted by
  // Sheets the same way as if the user typed them.
  async function appendRows(tabName, rows) {
    if (!accessToken) throw new Error('Not signed in');
    if (!TAB_NAMES.includes(tabName)) throw new Error(`Unknown tab: ${tabName}`);
    if (!Array.isArray(rows) || !rows.length) return { appended: 0 };
    const sheetId = cachedSheetId || await findLedgerSheetId();
    cachedSheetId = sheetId;
    let headers = cachedHeaders[tabName];
    if (!headers || !headers.length) {
      // Fallback: fetch just the header row of this tab.
      const r = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName + '!1:1')}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (r.status === 401) { clearCachedToken(); throw new Error('AUTH_EXPIRED'); }
      if (!r.ok) throw new Error(`Header fetch failed: ${r.status}`);
      const j = await r.json();
      headers = (j.values && j.values[0] || []).map(h => String(h || '').trim());
      cachedHeaders[tabName] = headers;
    }
    if (!headers.length) throw new Error(`Tab "${tabName}" has no headers — was the migrator run?`);

    const values = rows.map(row => headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      return typeof v === 'string' ? v : String(v);
    }));

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}` +
      `/values/${encodeURIComponent(tabName + '!A1')}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values, majorDimension: 'ROWS' }),
    });
    if (res.status === 401) { clearCachedToken(); throw new Error('AUTH_EXPIRED'); }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Append to ${tabName} failed: ${res.status} ${text}`);
    }
    return { appended: values.length };
  }

  // ── transform rows → FinanceData shape (ported verbatim from CSV path) ──
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

  function buildFromRows({ accountsRaw, snapshotsRaw, incomeRaw, expensesRaw }) {
    const accounts = accountsRaw.map(a => ({
      id: a.account_id,
      owner: a.owner,
      provider: a.provider,
      name: a.nickname.includes(' - ') ? a.nickname.split(' - ').slice(1).join(' - ') : a.nickname,
      type: a.type,
      currency: (a.currency || 'NIS').replace('NIS', 'ILS'),
      status: a.status,
    }));

    // Bucket raw snapshots by account, keeping the full date (not just ym)
    // so we can pick the most-recent snapshot per month deterministically.
    // Earlier we sorted [ym, balance] tuples with default JS sort (string
    // compare), which made the same-month winner depend on the string order
    // of the balance — i.e. "150000" < "62190.71" lexicographically, so a
    // larger newer balance was silently overwritten by a smaller older one.
    const perAcct = {};
    snapshotsRaw.forEach(s => {
      const date = s.date || '';
      if (!perAcct[s.account_id]) perAcct[s.account_id] = [];
      perAcct[s.account_id].push({ date, ym: date.slice(0, 7), balance: parseFloat(s.balance_native) });
    });
    const snapshots = [];
    accounts.forEach(acc => {
      const list = (perAcct[acc.id] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
      if (!list.length) return;
      const firstYm = list[0].ym;
      // Build ym → balance, with the LATEST date per month winning (the loop
      // is in ascending date order, so later writes overwrite earlier ones).
      const dict = {};
      list.forEach(item => { dict[item.ym] = item.balance; });
      let last = null;
      ALL_MONTHS.forEach(ym => {
        if (ym < firstYm) return;
        if (dict[ym] !== undefined) last = dict[ym];
        if (last !== null) snapshots.push({ accountId: acc.id, ym, balance: Math.round(last) });
      });
    });

    const fxByMonth = {};
    snapshotsRaw.forEach(s => {
      if (s.currency === 'USD') {
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

    const SOURCE_OWNER = { MongooseNet: 'Alon', ImagenAI: 'Alon', Bezalel: 'Alon', IBKR: 'Alon' };
    const income = [];
    incomeRaw.forEach(r => {
      const src = r.source;
      const typ = r.type;
      const owner = SOURCE_OWNER[src] || 'Alon';
      const amt = parseFloat(r.gross_native);
      const cur = (r.currency || 'NIS').replace('NIS', 'ILS');
      const dateStr = r.date || '';
      const ym = dateStr.slice(0, 7);
      const isAnnual = dateStr.endsWith('-12-31') &&
        ['salary','employer_pension_contribution','employer_study_fund_contribution'].includes(typ);
      if (isAnnual) {
        const year = ym.slice(0, 4);
        let months;
        if (src === 'MongooseNet') months = Array.from({length: 11}, (_, i) => `${year}-${String(i+1).padStart(2,'0')}`);
        else if (src === 'ImagenAI') months = [`${year}-11`, `${year}-12`];
        else if (src === 'Bezalel') months = [`${year}-06`];
        else months = Array.from({length: 12}, (_, i) => `${year}-${String(i+1).padStart(2,'0')}`);
        const per = amt / months.length;
        months.forEach(mym => income.push({
          ym: mym, owner, type: typ, amount: Math.round(per), currency: cur, source: src,
        }));
      } else {
        income.push({ ym, owner, type: typ, amount: Math.round(amt * 100) / 100, currency: cur, source: src });
      }
    });

    const acctOwner = Object.fromEntries(accounts.map(a => [a.id, a.owner]));
    // Sheet columns: date, account_id, amount_native, currency, amount_ils,
    // fx_rate, category, subcategory, merchant, description, source_doc,
    // billing_date, external_ref_id, created_at
    const expenses = expensesRaw.map((r, i) => {
      const amtNative = parseFloat(r.amount_native) || 0;
      const amtIls = parseFloat(r.amount_ils) || amtNative;
      const cur = (r.currency || 'ILS').replace('NIS', 'ILS');
      return {
        id: i + 1,
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

  // ── public API ─────────────────────────────────────────────────────
  async function fetchAndPopulate() {
    if (!accessToken) throw new Error('Not signed in');
    const sheetId = await findLedgerSheetId();
    cachedSheetId = sheetId;
    const tabs = await fetchAllTabs(sheetId);
    const missing = TAB_NAMES.filter(n => !tabs[n] || !tabs[n].length);
    if (missing.length) throw new Error(`Empty or missing tabs: ${missing.join(', ')}`);

    const built = buildFromRows({
      accountsRaw:  tabs.accounts,
      snapshotsRaw: tabs.snapshots,
      incomeRaw:    tabs.income,
      expensesRaw:  tabs.expenses,
    });

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
    // Try silent refresh — works without a popup as long as the user is still
    // signed in to Google in this browser and has previously consented. This
    // is what lets the page "stay signed in" for weeks even though Google
    // access tokens themselves only live 1 hour.
    //
    // Skip silent attempt entirely on a fresh origin: without prior consent,
    // Google has to open a popup (which Chrome blocks without a user gesture)
    // and the popup-blocked indicator surfaces in the URL bar. Going straight
    // to the sign-in button keeps that UI clean.
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
      accounts:   ex.ACCOUNTS,
      snapshots:  ex.SNAPSHOTS,
      income:     ex.INCOME,
      expenses:   ex.EXPENSES,
      fxFull:     ex.FX.byMonth,
      fxCurrent:  ex.FX.current,
    });
  }

  window.SheetsLoader = {
    init: ensureGisInited,
    bootstrap,
    signOut,
    isSignedIn: () => !!accessToken,
    fetchAndPopulate,
    requestSignIn,
    loadCachedToken,
    loadDemoData,
    appendRows,
    getSheetId: () => cachedSheetId,
    getCurrentToken: () => accessToken,
    getSheetUrl: () => cachedSheetId
      ? `https://docs.google.com/spreadsheets/d/${cachedSheetId}/edit`
      : null,
    // Schema snapshot: headers + first few sample rows per tab. Sent to the
    // Intake API so Claude can ground extraction in the actual sheet shape
    // without the function having to re-read the Sheet itself.
    getSchemaSnapshot: () => ({
      tabs: TAB_NAMES.map(name => ({
        name,
        headers: cachedHeaders[name] || [],
        samples: cachedSamples[name] || [],
      })),
    }),
  };
})();
