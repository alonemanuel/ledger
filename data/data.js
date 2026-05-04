// Empty data scaffold — populated at runtime by sheets-loader.js.
// helpers.js relies on these top-level consts being declared.

const FX = {
  current: 3.20,
  setOn: new Date().toISOString().slice(0, 10),
  byMonth: {},
  rateFor(ym) { return this.byMonth[ym] || this.current; },
};

const ACCOUNTS = [];
const SNAPSHOTS = [];
const INCOME = [];
const EXPENSES = [];

const CATEGORIES = ['food','transport','housing','utilities','health','entertainment','travel','shopping','gifts','taxes','savings_transfer','fees','other'];

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
