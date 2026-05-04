// Helpers — money, FX, derivations, chart primitives.

const _FD = window.FinanceData;
const FX_H = _FD.FX;
// alias the data arrays without redeclaring (data.js already has them as top-level consts)

// ── FORMATTING ──────────────────────────────────────────────────────────────
const fmtILS = (n, opts = {}) => {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1000) {
    if (abs >= 1_000_000) return `${sign}₪${(abs/1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}₪${(abs/1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  }
  return `${sign}₪${abs.toLocaleString('en-IL', { maximumFractionDigits: 0 })}`;
};
const fmtUSD = (n, opts = {}) => {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1000) {
    if (abs >= 1_000_000) return `${sign}$${(abs/1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs/1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  }
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};
const fmtPct = (n, d=1) => (n == null || isNaN(n)) ? '—' : `${(n*100).toFixed(d)}%`;
const fmtSigned = (n, fn = fmtILS) => (n >= 0 ? '+' : '') + fn(n);

// ── FX CONVERSION ──────────────────────────────────────────────────────────
const toILS = (amount, currency, ym) => {
  if (currency === 'ILS') return amount;
  const rate = ym ? FX_H.rateFor(ym) : FX_H.current;
  return amount * rate;
};

// ── DATES ──────────────────────────────────────────────────────────────────
const monthsRange = () => {
  const out = [];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2024 && m < 5) continue;
      if (y === 2026 && m > 5) continue;
      out.push(`${y}-${String(m).padStart(2,'0')}`);
    }
  }
  return out;
};
const ALL_MONTHS = monthsRange();
const LATEST = ALL_MONTHS[ALL_MONTHS.length - 1];
const last12 = ALL_MONTHS.slice(-12);
const last24 = ALL_MONTHS.slice(-24);

const fmtMonth = (ym, opts = {}) => {
  const [y, m] = ym.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (opts.short) return names[+m - 1];
  return `${names[+m - 1]} '${y.slice(2)}`;
};

// ── DERIVATIONS ────────────────────────────────────────────────────────────
const accountById = (id) => ACCOUNTS.find(a => a.id === id);

// snapshot map by account — rebuilt from SNAPSHOTS, can be refreshed after data loads
const snapshotMap = {};
function rebuildDerivations() {
  for (const k in snapshotMap) delete snapshotMap[k];
  SNAPSHOTS.forEach(s => {
    if (!snapshotMap[s.accountId]) snapshotMap[s.accountId] = {};
    snapshotMap[s.accountId][s.ym] = s.balance;
  });
}
rebuildDerivations();

const balanceILS = (accountId, ym) => {
  const acc = accountById(accountId);
  const native = snapshotMap[accountId]?.[ym] || 0;
  return toILS(native, acc.currency, ym);
};

// net worth at a given month
const netWorthAt = (ym, filter = () => true) => {
  return ACCOUNTS.filter(filter).reduce((sum, acc) => sum + balanceILS(acc.id, ym), 0);
};

const netWorthSeries = (months = ALL_MONTHS, filter = () => true) =>
  months.map(ym => ({ ym, value: netWorthAt(ym, filter) }));

// income aggregations
const incomeInMonth = (ym) =>
  INCOME.filter(i => i.ym === ym).reduce((s, i) => s + toILS(i.amount, i.currency, i.ym), 0);

const incomeByTypeMonth = (ym) => {
  const out = {};
  INCOME.filter(i => i.ym === ym).forEach(i => {
    out[i.type] = (out[i.type] || 0) + toILS(i.amount, i.currency, i.ym);
  });
  return out;
};

const expenseInMonth = (ym) =>
  EXPENSES.filter(e => e.ym === ym).reduce((s, e) => s + toILS(e.amount, e.currency, e.ym), 0);

const expenseByCategoryMonth = (ym) => {
  const out = {};
  EXPENSES.filter(e => e.ym === ym).forEach(e => {
    const k = e.category || 'uncategorized';
    out[k] = (out[k] || 0) + toILS(e.amount, e.currency, e.ym);
  });
  return out;
};

// passive income types
const PASSIVE_TYPES = ['dividend','interest','capital_gain_realized','employer_pension_contribution','employer_study_fund_contribution'];
const passiveInMonth = (ym, types = PASSIVE_TYPES) =>
  INCOME.filter(i => i.ym === ym && types.includes(i.type))
        .reduce((s, i) => s + toILS(i.amount, i.currency, i.ym), 0);

// type → group rollup at latest month
const groupedAssets = (ym = LATEST, filter = () => true) => {
  const out = {};
  GROUP_ORDER.forEach(g => out[g] = 0);
  ACCOUNTS.filter(filter).forEach(acc => {
    const g = TYPE_GROUP[acc.type];
    if (g) out[g] = (out[g] || 0) + balanceILS(acc.id, ym);
  });
  return out;
};

// owner split
const byOwner = (ym = LATEST) => {
  const out = { Alon: 0, Amit: 0 };
  ACCOUNTS.forEach(acc => {
    out[acc.owner] += balanceILS(acc.id, ym);
  });
  return out;
};

// currency split (in ILS-equivalent)
const byCurrency = (ym = LATEST) => {
  const out = { ILS: 0, USD: 0 };
  ACCOUNTS.forEach(acc => {
    out[acc.currency] += balanceILS(acc.id, ym);
  });
  return out;
};

// recent activity feed (income + expense + snapshot deltas)
const recentActivity = (limit = 12) => {
  const events = [];
  // recent expenses
  EXPENSES.slice(-180).forEach(e => {
    events.push({
      kind: 'expense', date: e.date, ym: e.ym,
      label: e.merchant, sub: e.category || 'uncategorized',
      amount: -toILS(e.amount, e.currency, e.ym),
      owner: e.owner,
    });
  });
  // recent income (last 3 months only — synthetic dates)
  INCOME.filter(i => last24.slice(-3).includes(i.ym)).forEach(i => {
    events.push({
      kind: 'income', date: `${i.ym}-${i.type === 'salary' ? '28' : '15'}`, ym: i.ym,
      label: i.source, sub: i.type.replace(/_/g, ' '),
      amount: toILS(i.amount, i.currency, i.ym),
      owner: i.owner,
    });
  });
  events.sort((a, b) => b.date.localeCompare(a.date));
  return events.slice(0, limit);
};

// account historical series (in ILS)
const accountSeries = (accountId, months = ALL_MONTHS) =>
  months.map(ym => ({ ym, value: balanceILS(accountId, ym), native: snapshotMap[accountId]?.[ym] || 0 }));

// account avg balance over a window (for yield)
const avgBalance = (accountId, months) => {
  const vals = months.map(ym => balanceILS(accountId, ym));
  return vals.reduce((s, v) => s + v, 0) / vals.length;
};

// passive earnings per account — derive from income rows where source matches account name OR pension contribs
const passivePerAccount = (months = last12) => {
  const out = {};
  ACCOUNTS.forEach(acc => out[acc.id] = 0);
  INCOME.filter(i => months.includes(i.ym)).forEach(i => {
    if (!PASSIVE_TYPES.includes(i.type)) return;
    const ils = toILS(i.amount, i.currency, i.ym);
    // match by source
    if (i.source === 'IBKR') {
      const acc = ACCOUNTS.find(a => a.provider === 'IBKR' && a.owner === i.owner);
      if (acc) out[acc.id] += ils;
    } else if (i.source === 'Discount MM') {
      out['discount-mm-alon'] += ils;
    } else if (i.source === 'Leumi MM') {
      out['leumi-mm-amit'] += ils;
    } else if (i.type === 'employer_pension_contribution') {
      const acc = ACCOUNTS.find(a => a.type === 'pension_comprehensive' && a.owner === i.owner && a.status === 'active');
      if (acc) out[acc.id] += ils;
    } else if (i.type === 'employer_study_fund_contribution') {
      const acc = ACCOUNTS.find(a => a.type === 'study_fund' && a.owner === i.owner);
      if (acc) out[acc.id] += ils;
    }
  });
  return out;
};

// ── COLORS ─────────────────────────────────────────────────────────────────
// Group colors — muted, harmonious, oklch-based
const GROUP_COLOR = {
  'Cash / Checking': 'oklch(72% 0.07 80)',   // sand
  'Savings':         'oklch(68% 0.09 60)',   // ochre
  'Investments':     'oklch(58% 0.09 35)',   // terracotta
  'Retirement':      'oklch(50% 0.08 250)',  // ink-blue
};

const CATEGORY_COLOR = {
  food:             'oklch(70% 0.10 50)',
  transport:        'oklch(62% 0.08 200)',
  housing:          'oklch(50% 0.08 250)',
  utilities:        'oklch(64% 0.06 230)',
  health:           'oklch(64% 0.10 20)',
  entertainment:    'oklch(60% 0.09 320)',
  travel:           'oklch(70% 0.09 150)',
  shopping:         'oklch(58% 0.09 35)',
  gifts:            'oklch(64% 0.10 350)',
  taxes:            'oklch(40% 0.04 260)',
  savings_transfer: 'oklch(58% 0.06 130)',
  fees:             'oklch(55% 0.02 80)',
  other:            'oklch(60% 0.02 80)',
  uncategorized:    'oklch(48% 0.02 30)',
};

const INCOME_TYPE_COLOR = {
  salary:                              'oklch(50% 0.08 250)',
  bonus:                               'oklch(58% 0.09 35)',
  dividend:                            'oklch(64% 0.10 130)',
  interest:                            'oklch(68% 0.09 80)',
  capital_gain_realized:               'oklch(60% 0.09 200)',
  employer_pension_contribution:       'oklch(45% 0.06 280)',
  employer_study_fund_contribution:    'oklch(60% 0.07 160)',
  refund:                              'oklch(70% 0.06 60)',
  gift:                                'oklch(64% 0.09 350)',
  other:                               'oklch(60% 0.02 80)',
};

const PRETTY_TYPE = {
  salary: 'Salary',
  bonus: 'Bonus',
  dividend: 'Dividends',
  interest: 'Interest',
  capital_gain_realized: 'Realized gains',
  employer_pension_contribution: 'Employer pension',
  employer_study_fund_contribution: 'Employer study fund',
  refund: 'Refund',
  gift: 'Gift',
  other: 'Other',
};

const PRETTY_CAT = {
  food: 'Food', transport: 'Transport', housing: 'Housing', utilities: 'Utilities',
  health: 'Health', entertainment: 'Entertainment', travel: 'Travel', shopping: 'Shopping',
  gifts: 'Gifts', taxes: 'Taxes', savings_transfer: 'Savings transfer', fees: 'Fees',
  other: 'Other', uncategorized: 'Uncategorized',
};

// ── TIME RANGE SLICING ─────────────────────────────────────────────────────
const RANGE_OPTIONS = ['1M', 'MTD', '6M', '1Y', 'YTD', 'MAX'];

function sliceByRange(series, range) {
  if (!series || !series.length) return series;
  const ymOf = s => s.ym || (s.date ? s.date.slice(0, 7) : '');
  const latestYm = ymOf(series[series.length - 1]);
  switch (range) {
    case '1M':  return series.slice(-2);
    case 'MTD': return series.slice(-1);
    case '6M':  return series.slice(-6);
    case '1Y':  return series.slice(-12);
    case 'YTD': {
      const year = latestYm.slice(0, 4);
      return series.filter(s => ymOf(s) >= `${year}-01`);
    }
    case 'MAX':
    default: return series;
  }
}

window.Fin = {
  fmtILS, fmtUSD, fmtPct, fmtSigned, fmtMonth,
  toILS, ALL_MONTHS, LATEST, last12, last24,
  accountById, balanceILS, netWorthAt, netWorthSeries,
  incomeInMonth, incomeByTypeMonth, expenseInMonth, expenseByCategoryMonth,
  passiveInMonth, PASSIVE_TYPES,
  groupedAssets, byOwner, byCurrency,
  recentActivity, accountSeries, avgBalance, passivePerAccount,
  GROUP_COLOR, CATEGORY_COLOR, INCOME_TYPE_COLOR,
  PRETTY_TYPE, PRETTY_CAT,
  rebuildDerivations,
  sliceByRange, RANGE_OPTIONS,
};
