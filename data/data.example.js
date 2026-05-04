// Synthetic finance data for Alon & Amit
// All amounts in native currency; FX'd to ILS at display time.

const FX = {
  current: 3.2030,
  setOn: '2026-05-03',
  // historical USD/ILS rates by month (rough realistic drift)
  byMonth: {
    '2024-05': 3.71, '2024-06': 3.75, '2024-07': 3.72, '2024-08': 3.65,
    '2024-09': 3.78, '2024-10': 3.82, '2024-11': 3.77, '2024-12': 3.62,
    '2025-01': 3.55, '2025-02': 3.58, '2025-03': 3.52, '2025-04': 3.45,
    '2025-05': 3.48, '2025-06': 3.41, '2025-07': 3.38, '2025-08': 3.35,
    '2025-09': 3.40, '2025-10': 3.33, '2025-11': 3.28, '2025-12': 3.25,
    '2026-01': 3.30, '2026-02': 3.27, '2026-03': 3.23, '2026-04': 3.21,
    '2026-05': 3.2030,
  },
  rateFor(ym) { return this.byMonth[ym] || this.current; },
};

// ── ACCOUNTS ────────────────────────────────────────────────────────────────
const ACCOUNTS = [
  { id: 'hap-checking-alon', owner: 'Alon', provider: 'Hapoalim', name: 'Hapoalim Checking', type: 'checking', currency: 'ILS', status: 'active' },
  { id: 'hap-savings-alon',  owner: 'Alon', provider: 'Hapoalim', name: 'Hapoalim Savings',   type: 'savings',  currency: 'ILS', status: 'active' },
  { id: 'leumi-checking-amit', owner: 'Amit', provider: 'Leumi', name: 'Leumi Checking',     type: 'checking', currency: 'ILS', status: 'active' },
  { id: 'leumi-mm-amit',      owner: 'Amit', provider: 'Leumi', name: 'Leumi Money Market',   type: 'money_market', currency: 'ILS', status: 'active' },
  { id: 'discount-mm-alon',   owner: 'Alon', provider: 'Discount', name: 'Discount MM',       type: 'money_market', currency: 'ILS', status: 'active' },
  { id: 'ibkr-alon',          owner: 'Alon', provider: 'IBKR',     name: 'IBKR Brokerage',   type: 'brokerage', currency: 'USD', status: 'active' },
  { id: 'ibkr-amit',          owner: 'Amit', provider: 'IBKR',     name: 'IBKR Brokerage',   type: 'brokerage', currency: 'USD', status: 'active' },
  { id: 'altshuler-pension-alon', owner: 'Alon', provider: 'Altshuler Shaham', name: 'Pension — Comprehensive', type: 'pension_comprehensive', currency: 'ILS', status: 'active' },
  { id: 'menora-pension-alon',     owner: 'Alon', provider: 'Menora',          name: 'Pension — Supplementary', type: 'pension_supplementary', currency: 'ILS', status: 'inactive' },
  { id: 'altshuler-pension-amit', owner: 'Amit', provider: 'Altshuler Shaham', name: 'Pension — Comprehensive', type: 'pension_comprehensive', currency: 'ILS', status: 'active' },
  { id: 'migdal-provident-alon',  owner: 'Alon', provider: 'Migdal',          name: 'Provident Fund', type: 'provident', currency: 'ILS', status: 'active' },
  { id: 'meitav-study-alon',      owner: 'Alon', provider: 'Meitav Dash',     name: 'Study Fund', type: 'study_fund', currency: 'ILS', status: 'active' },
  { id: 'meitav-study-amit',      owner: 'Amit', provider: 'Meitav Dash',     name: 'Study Fund', type: 'study_fund', currency: 'ILS', status: 'active' },
  { id: 'phoenix-old-alon',       owner: 'Alon', provider: 'Phoenix',         name: 'Old Pension (closed)', type: 'pension_comprehensive', currency: 'ILS', status: 'closed' },
];

// ── SNAPSHOTS ───────────────────────────────────────────────────────────────
// 24 months of monthly snapshots for cash/brokerage; pension annual (interpolated client-side).
function genSnapshots() {
  const months = [];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2024 && m < 5) continue;
      if (y === 2026 && m > 5) continue;
      months.push(`${y}-${String(m).padStart(2,'0')}`);
    }
  }
  // base balances and monthly drift per account (native currency)
  const profiles = {
    'hap-checking-alon':       { base: 24000, drift: 800,   noise: 4000 },
    'hap-savings-alon':        { base: 110000, drift: 1500, noise: 1200 },
    'leumi-checking-amit':     { base: 18000, drift: 600,   noise: 3500 },
    'leumi-mm-amit':           { base: 78000, drift: 1100,  noise: 600 },
    'discount-mm-alon':        { base: 145000, drift: 1800, noise: 800 },
    'ibkr-alon':               { base: 62000, drift: 720,   noise: 2400, growth: 0.012 },
    'ibkr-amit':               { base: 21000, drift: 320,   noise: 900,  growth: 0.011 },
    'altshuler-pension-alon':  { base: 188000, drift: 3400, noise: 200,  growth: 0.006 },
    'menora-pension-alon':     { base: 42000, drift: 0,     noise: 100,  growth: 0.004 },
    'altshuler-pension-amit':  { base: 142000, drift: 2900, noise: 200,  growth: 0.006 },
    'migdal-provident-alon':   { base: 56000, drift: 600,   noise: 200,  growth: 0.005 },
    'meitav-study-alon':       { base: 78000, drift: 1900,  noise: 300,  growth: 0.006 },
    'meitav-study-amit':       { base: 46000, drift: 1400,  noise: 220,  growth: 0.006 },
    'phoenix-old-alon':        { base: 18500, drift: 0,     noise: 0,    growth: 0 },
  };
  const out = [];
  // deterministic pseudo-random
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed/233280; };
  for (const acc of ACCOUNTS) {
    const p = profiles[acc.id]; if (!p) continue;
    let bal = p.base;
    months.forEach((ym, i) => {
      const growth = (p.growth || 0);
      bal = bal * (1 + growth) + p.drift + (rnd() - 0.5) * p.noise;
      if (acc.status === 'closed' && i < months.length - 4) {
        // already closed earlier — keep flat then drop
        bal = p.base;
      }
      if (acc.status === 'closed' && i >= months.length - 4) {
        bal = 0;
      }
      out.push({ accountId: acc.id, ym, balance: Math.max(0, Math.round(bal)) });
    });
  }
  return out;
}

const SNAPSHOTS = genSnapshots();

// ── INCOME ──────────────────────────────────────────────────────────────────
function genIncome() {
  const out = [];
  const months = [];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2024 && m < 5) continue;
      if (y === 2026 && m > 5) continue;
      months.push(`${y}-${String(m).padStart(2,'0')}`);
    }
  }
  let seed = 13;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed/233280; };
  months.forEach((ym, i) => {
    // Alon salary (tech)
    const baseA = 32000 + Math.floor(i * 80);
    out.push({ ym, owner: 'Alon', type: 'salary', amount: baseA, currency: 'ILS', source: 'Employer A' });
    out.push({ ym, owner: 'Alon', type: 'employer_pension_contribution', amount: Math.round(baseA*0.125), currency: 'ILS', source: 'Employer A' });
    out.push({ ym, owner: 'Alon', type: 'employer_study_fund_contribution', amount: Math.round(baseA*0.075), currency: 'ILS', source: 'Employer A' });
    // Amit salary (lower base, later raise)
    const baseB = 18500 + Math.floor(i * 60) + (i > 12 ? 1500 : 0);
    out.push({ ym, owner: 'Amit', type: 'salary', amount: baseB, currency: 'ILS', source: 'Employer B' });
    out.push({ ym, owner: 'Amit', type: 'employer_pension_contribution', amount: Math.round(baseB*0.125), currency: 'ILS', source: 'Employer B' });
    out.push({ ym, owner: 'Amit', type: 'employer_study_fund_contribution', amount: Math.round(baseB*0.075), currency: 'ILS', source: 'Employer B' });
    // Quarterly dividends from IBKR
    const month = parseInt(ym.split('-')[1]);
    if ([3, 6, 9, 12].includes(month)) {
      out.push({ ym, owner: 'Alon', type: 'dividend', amount: 180 + Math.round(rnd()*60), currency: 'USD', source: 'IBKR' });
      out.push({ ym, owner: 'Amit', type: 'dividend', amount: 60 + Math.round(rnd()*30),  currency: 'USD', source: 'IBKR' });
    }
    // Interest on MM
    out.push({ ym, owner: 'Alon', type: 'interest', amount: 480 + Math.round(rnd()*120), currency: 'ILS', source: 'Discount MM' });
    out.push({ ym, owner: 'Amit', type: 'interest', amount: 220 + Math.round(rnd()*80),  currency: 'ILS', source: 'Leumi MM' });
    // Annual bonus in March
    if (month === 3) {
      out.push({ ym, owner: 'Alon', type: 'bonus', amount: 24000 + Math.round(rnd()*8000), currency: 'ILS', source: 'Employer A' });
    }
    // Realized gains occasional
    if (rnd() > 0.85) {
      out.push({ ym, owner: 'Alon', type: 'capital_gain_realized', amount: 400 + Math.round(rnd()*900), currency: 'USD', source: 'IBKR' });
    }
    // Refunds/gifts rare
    if (rnd() > 0.92) {
      out.push({ ym, owner: 'Alon', type: 'refund', amount: 200 + Math.round(rnd()*1200), currency: 'ILS', source: 'Bituach Leumi' });
    }
    if (rnd() > 0.95) {
      out.push({ ym, owner: 'Amit', type: 'gift', amount: 500 + Math.round(rnd()*2500), currency: 'ILS', source: 'Family' });
    }
  });
  return out;
}

const INCOME = genIncome();

// ── EXPENSES ────────────────────────────────────────────────────────────────
const CATEGORIES = ['food','transport','housing','utilities','health','entertainment','travel','shopping','gifts','taxes','savings_transfer','fees','other'];

function genExpenses() {
  const out = [];
  const months = [];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2024 && m < 5) continue;
      if (y === 2026 && m > 5) continue;
      months.push(`${y}-${String(m).padStart(2,'0')}`);
    }
  }
  let seed = 91;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed/233280; };
  const merchants = {
    food: ['Shufersal','Rami Levy','Cofix','Aroma','Tiv Taam','Wolt','Pizza Hut','Café Greg','Mahane Yehuda Market','Yango Deli'],
    transport: ['Pango','Yango','Gett','Egged','Israel Railways','Sonol','Paz','Dan'],
    housing: ['Landlord — Rent','Vaad Bayit','Insurance — Apt'],
    utilities: ['IEC — Electric','Pelephone','Bezeq','Hot','Mei Avivim','Cellcom'],
    health: ['Clalit','Maccabi Pharm','Super-Pharm','Dr. Cohen','Optic Halperin'],
    entertainment: ['Cinema City','Spotify','Netflix','YES','Habima','Dizengoff Center'],
    travel: ['El Al','Booking.com','Airbnb','Israir','Hertz'],
    shopping: ['Castro','Renuar','IKEA','Hamashbir','ACE','Zara','Amazon'],
    gifts: ['Steimatzky','Golf','Tchibo'],
    taxes: ['Mas Hachnasa','Bituach Leumi','Arnona — Tel Aviv'],
    savings_transfer: ['Transfer → IBKR','Transfer → Discount MM'],
    fees: ['Hapoalim — Fees','Leumi — Fees','IBKR — Fees'],
    other: ['Misc','—'],
  };
  const baseAmt = {
    food: [180, 700], transport: [40, 320], housing: [6500, 9000],
    utilities: [180, 950], health: [60, 480], entertainment: [40, 320],
    travel: [400, 4500], shopping: [80, 1200], gifts: [120, 600],
    taxes: [800, 3200], savings_transfer: [3000, 9000], fees: [12, 80],
    other: [40, 300],
  };
  const freq = {
    food: 22, transport: 14, housing: 1, utilities: 5, health: 3,
    entertainment: 4, travel: 0.6, shopping: 5, gifts: 0.7, taxes: 1.2,
    savings_transfer: 1, fees: 2, other: 1.5,
  };
  let id = 0;
  months.forEach(ym => {
    const month = parseInt(ym.split('-')[1]);
    CATEGORIES.forEach(cat => {
      const f = freq[cat] || 1;
      const count = Math.max(0, Math.round(f + (rnd()-0.5)*f*0.4));
      for (let i = 0; i < count; i++) {
        let [lo, hi] = baseAmt[cat];
        // travel skews summer
        if (cat === 'travel' && [7,8].includes(month)) hi *= 1.6;
        // shopping skews december
        if (cat === 'shopping' && month === 12) hi *= 1.4;
        const amt = Math.round(lo + rnd()*(hi-lo));
        const m = merchants[cat];
        const merchant = m[Math.floor(rnd()*m.length)];
        const day = 1 + Math.floor(rnd()*27);
        const owner = rnd() > 0.6 ? 'Alon' : 'Amit';
        const account = owner === 'Alon' ? 'hap-checking-alon' : 'leumi-checking-amit';
        const dateStr = `${ym}-${String(day).padStart(2,'0')}`;
        const billingDay = Math.min(28, day + 5 + Math.floor(rnd()*10));
        const billingDate = `${ym}-${String(billingDay).padStart(2,'0')}`;
        const refId = String(1000000 + Math.floor(rnd()*9000000));
        out.push({
          id: ++id,
          date: dateStr,
          billing_date: billingDate,
          ym,
          owner,
          account,
          merchant,
          category: cat,
          amount: amt,
          purchase_amount: amt,
          purchase_currency: 'ILS',
          currency: 'ILS',
          external_ref_id: refId,
          created_at: `${dateStr}T12:00:00.000Z`,
          source_doc: null,
        });
      }
    });
    // tiny chance of uncategorized
    if (rnd() > 0.8) {
      const uncatAmt = Math.round(80+rnd()*400);
      out.push({
        id: ++id, date: `${ym}-15`, billing_date: `${ym}-20`, ym,
        owner: 'Alon', account: 'hap-checking-alon',
        merchant: '???', category: null, amount: uncatAmt,
        purchase_amount: uncatAmt, purchase_currency: 'ILS', currency: 'ILS',
        external_ref_id: null, created_at: `${ym}-15T12:00:00.000Z`, source_doc: null,
      });
    }
  });
  return out;
}

const EXPENSES = genExpenses();

// ── ASSET CLASS GROUPING ────────────────────────────────────────────────────
const TYPE_GROUP = {
  checking: 'Cash / Checking', savings: 'Cash / Checking',
  money_market: 'Money Market',
  brokerage: 'Brokerage',
  pension_comprehensive: 'Pension', pension_supplementary: 'Pension',
  provident: 'Provident',
  study_fund: 'Study Fund',
};

const GROUP_ORDER = ['Cash / Checking','Money Market','Brokerage','Pension','Provident','Study Fund'];

const TYPE_ICON = {
  checking: '🏦', savings: '🏦',
  money_market: '💰',
  brokerage: '📈',
  pension_comprehensive: '🏛', pension_supplementary: '🏛',
  provident: '🔒',
  study_fund: '🎓',
};

window.FinanceData = { FX, ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, CATEGORIES, TYPE_GROUP, GROUP_ORDER, TYPE_ICON };
