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
  const SCOPES     = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly';
  const TOKEN_KEY  = 'ledger_sheets_token';
  const TAB_NAMES  = ['accounts', 'snapshots', 'income', 'expenses'];

  let tokenClient = null;
  let accessToken = null;
  let cachedSheetId = null;

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

  function saveToken(response) {
    accessToken = response.access_token;
    const expiresAt = Date.now() + (response.expires_in - 60) * 1000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: accessToken, expiresAt }));
  }

  function requestSignIn() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        reject(new Error('Sign-in not ready — Google Identity library not loaded yet'));
        return;
      }
      tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(`OAuth error: ${response.error}`));
          return;
        }
        if (!response.access_token) {
          reject(new Error('No access token received'));
          return;
        }
        saveToken(response);
        resolve();
      };
      tokenClient.error_callback = (err) => {
        const t = err?.type || '';
        if (t === 'popup_failed_to_open') reject(new Error('POPUP_BLOCKED'));
        else if (t === 'popup_closed') reject(new Error('POPUP_CLOSED'));
        else reject(new Error(`OAuth error: ${err?.message || t || 'unknown'}`));
      };
      tokenClient.requestAccessToken({ prompt: 'select_account' });
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
    (json.valueRanges || []).forEach((vr, i) => {
      out[TAB_NAMES[i]] = rowsToObjects(vr.values || []);
    });
    return out;
  }

  // Sheets returns arrays-of-arrays. Convert the first row to headers and
  // pad short rows so missing trailing cells become "" — matches PapaParse
  // header-mode behavior so buildFromRows can stay agnostic.
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(h => String(h || '').trim());
    return rows.slice(1)
      .filter(r => r.some(cell => String(cell || '').trim() !== ''))
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? String(r[i]) : ''; });
        return obj;
      });
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

    const perAcct = {};
    snapshotsRaw.forEach(s => {
      const ym = (s.date || '').slice(0, 7);
      if (!perAcct[s.account_id]) perAcct[s.account_id] = [];
      perAcct[s.account_id].push([ym, parseFloat(s.balance_native)]);
    });
    const snapshots = [];
    accounts.forEach(acc => {
      const list = (perAcct[acc.id] || []).slice().sort();
      if (!list.length) return;
      const firstYm = list[0][0];
      const dict = Object.fromEntries(list);
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
    const expenses = expensesRaw.map((r, i) => ({
      id: i + 1,
      date: r.date,
      ym: (r.date || '').slice(0, 7),
      owner: acctOwner[r.account_id] || 'Alon',
      account: r.account_id,
      merchant: r.merchant,
      category: r.category || null,
      amount: parseFloat(r.amount_native),
      currency: (r.currency || 'NIS').replace('NIS', 'ILS'),
    }));

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
    throw new Error('NEEDS_SIGNIN');
  }

  function signOut() {
    if (accessToken && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    clearCachedToken();
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
    getSheetUrl: () => cachedSheetId
      ? `https://docs.google.com/spreadsheets/d/${cachedSheetId}/edit`
      : null,
  };
})();
