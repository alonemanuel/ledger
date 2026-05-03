// Google Drive loader — fetches CSVs from the user's Drive folder, parses,
// and populates window.FinanceData in place.
//
// Pre-requisites:
//   - Google Identity Services library loaded (https://accounts.google.com/gsi/client)
//   - PapaParse loaded (CSV parsing)
//   - data/data.js loaded (declares ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES as
//     mutable top-level consts so we can populate them in place)

(function () {
  const CLIENT_ID  = '524822374717-jun05s52km4co3h1b838r3qsip0850aa.apps.googleusercontent.com';
  const FOLDER_ID  = '1x3REt2-XYd73s1wH61MFRBPbs94e1NJN';
  const SCOPES     = 'https://www.googleapis.com/auth/drive.readonly';
  const TOKEN_KEY  = 'ledger_drive_token';
  const FILE_NAMES = ['accounts.csv', 'snapshots.csv', 'income.csv', 'expenses.csv'];

  let tokenClient = null;
  let accessToken = null;

  // ── auth ───────────────────────────────────────────────────────────
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
      callback: () => {}, // overridden per-request
    });
  }

  function loadCachedToken() {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
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
    sessionStorage.removeItem(TOKEN_KEY);
    accessToken = null;
  }

  async function requestSignIn() {
    await ensureGisInited();
    return new Promise((resolve, reject) => {
      tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(`OAuth error: ${response.error}`));
          return;
        }
        if (!response.access_token) {
          reject(new Error('No access token received'));
          return;
        }
        accessToken = response.access_token;
        const expiresAt = Date.now() + (response.expires_in - 60) * 1000;
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: accessToken, expiresAt }));
        resolve();
      };
      tokenClient.requestAccessToken();
    });
  }

  // ── drive api ──────────────────────────────────────────────────────
  async function listFolderFiles() {
    const q = encodeURIComponent(`'${FOLDER_ID}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&pageSize=100`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) { clearCachedToken(); throw new Error('AUTH_EXPIRED'); }
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    return json.files || [];
  }

  async function downloadFile(fileId) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) { clearCachedToken(); throw new Error('AUTH_EXPIRED'); }
    if (!res.ok) throw new Error(`Download ${fileId} failed: ${res.status}`);
    return await res.text();
  }

  function parseCsv(text) {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (result.errors?.length) {
      console.warn('CSV parse warnings:', result.errors.slice(0, 3));
    }
    return result.data;
  }

  // ── transform CSV rows → FinanceData shape ─────────────────────────
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

  function buildFromCsvs({ accountsRaw, snapshotsRaw, incomeRaw, expensesRaw }) {
    // accounts
    const accounts = accountsRaw.map(a => ({
      id: a.account_id,
      owner: a.owner,
      provider: a.provider,
      name: a.nickname.includes(' - ') ? a.nickname.split(' - ').slice(1).join(' - ') : a.nickname,
      type: a.type,
      currency: (a.currency || 'NIS').replace('NIS', 'ILS'),
      status: a.status,
    }));

    // snapshots — forward-fill across ALL_MONTHS per account
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

    // FX rates
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

    // income — spread annual aggregates
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

    // expenses
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

  // ── populate FinanceData in place (mutate, don't reassign) ──────────
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
    const files = await listFolderFiles();
    const byName = Object.fromEntries(files.map(f => [f.name, f]));
    const missing = FILE_NAMES.filter(n => !byName[n]);
    if (missing.length) throw new Error(`Missing CSV files in Drive folder: ${missing.join(', ')}`);

    const [accCsv, snapCsv, incCsv, expCsv] = await Promise.all(
      FILE_NAMES.map(n => downloadFile(byName[n].id))
    );

    const built = buildFromCsvs({
      accountsRaw:  parseCsv(accCsv),
      snapshotsRaw: parseCsv(snapCsv),
      incomeRaw:    parseCsv(incCsv),
      expensesRaw:  parseCsv(expCsv),
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
        if (e.message === 'AUTH_EXPIRED') {
          // fall through to sign-in
        } else {
          throw e;
        }
      }
    }
    await requestSignIn();
    return await fetchAndPopulate();
  }

  function signOut() {
    if (accessToken && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(accessToken, () => {});
    }
    clearCachedToken();
  }

  async function loadDemoData() {
    const src = await fetch('data/data.example.js').then(r => r.text());
    // Run in a local scope so its `const` declarations don't clash with
    // the already-declared globals from data.js.
    new Function(src)();
    // window.FinanceData now points to the example object, but the global
    // ACCOUNTS/SNAPSHOTS/INCOME/EXPENSES/FX consts (which helpers.js uses
    // for all Fin.* calls) are still empty. Reuse populateFinanceData to
    // mutate them in place and rebuild snapshotMap.
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

  window.DriveLoader = {
    bootstrap,
    signOut,
    isSignedIn: () => !!accessToken,
    fetchAndPopulate,
    requestSignIn,
    loadCachedToken,
    loadDemoData,
  };
})();