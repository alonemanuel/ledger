// Empty data scaffold — populated at runtime by db-loader.js.
// helpers.js relies on these top-level consts being declared.

export const FX = {
  current: 3.20,
  setOn: new Date().toISOString().slice(0, 10),
  byMonth: {},
  rateFor(ym) { return this.byMonth[ym] || this.current; },
};

export const ACCOUNTS = [];
export const SNAPSHOTS = [];
export const INCOME = [];
export const EXPENSES = [];

export const CATEGORIES = ['food','transport','housing','utilities','health','entertainment','travel','shopping','gifts','taxes','savings_transfer','fees','other'];

export const TYPE_GROUP = {
  checking: 'Cash / Checking', savings: 'Cash / Checking',
  money_market: 'Money Market',
  brokerage: 'Brokerage',
  pension_comprehensive: 'Pension', pension_supplementary: 'Pension',
  provident: 'Provident',
  study_fund: 'Study Fund',
};

export const GROUP_ORDER = ['Cash / Checking','Money Market','Brokerage','Pension','Provident','Study Fund'];

export const TYPE_ICON = {
  checking: '🏦', savings: '🏦',
  money_market: '💰',
  brokerage: '📈',
  pension_comprehensive: '🏛', pension_supplementary: '🏛',
  provident: '🔒',
  study_fund: '🎓',
};

window.FinanceData = { FX, ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, CATEGORIES, TYPE_GROUP, GROUP_ORDER, TYPE_ICON };
