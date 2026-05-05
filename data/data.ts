// Empty data scaffold — populated at runtime by db-loader.js.
// helpers.js relies on these top-level consts being declared.

import type { Account, Snapshot, IncomeRow, ExpenseRow, FXData } from '../types.ts';

export const FX: FXData = {
  current: 3.20,
  setOn: new Date().toISOString().slice(0, 10),
  byMonth: {} as Record<string, number>,
  rateFor(ym: string) { return this.byMonth[ym] || this.current; },
};

export const ACCOUNTS: Account[] = [];
export const SNAPSHOTS: Snapshot[] = [];
export const INCOME: IncomeRow[] = [];
export const EXPENSES: ExpenseRow[] = [];

export const CATEGORIES: string[] = ['food','transport','housing','utilities','health','entertainment','travel','shopping','gifts','taxes','savings_transfer','fees','other'];

export const TYPE_GROUP: Record<string, string> = {
  checking: 'Cash / Checking', savings: 'Cash / Checking',
  money_market: 'Money Market',
  brokerage: 'Brokerage',
  pension_comprehensive: 'Pension', pension_supplementary: 'Pension',
  provident: 'Provident',
  study_fund: 'Study Fund',
};

export const GROUP_ORDER: string[] = ['Cash / Checking','Money Market','Brokerage','Pension','Provident','Study Fund'];

export const TYPE_ICON: Record<string, string> = {
  checking: '🏦', savings: '🏦',
  money_market: '💰',
  brokerage: '📈',
  pension_comprehensive: '🏛', pension_supplementary: '🏛',
  provident: '🔒',
  study_fund: '🎓',
};

window.FinanceData = { FX, ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, CATEGORIES, TYPE_GROUP, GROUP_ORDER, TYPE_ICON };
