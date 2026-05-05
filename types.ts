export interface Account {
  id: string;
  owner: string;
  provider: string;
  name: string;
  type: string;
  currency: 'ILS' | 'USD';
  status: 'active' | 'inactive' | 'closed';
}

export interface Snapshot {
  accountId: string;
  ym: string;
  balance: number;
}

export interface IncomeRow {
  ym: string;
  owner: string;
  type: string;
  amount: number;
  currency: 'ILS' | 'USD';
  source: string;
}

export interface ExpenseRow {
  id: number;
  date: string;
  billing_date: string | null;
  ym: string;
  owner: string;
  account: string;
  merchant: string;
  category: string | null;
  amount: number;
  purchase_amount: number;
  purchase_currency: string;
  currency: string;
  external_ref_id: string | null;
  created_at: string | null;
  source_doc: string | null;
}

export interface FXData {
  current: number;
  setOn: string;
  byMonth: Record<string, number>;
  rateFor: (ym: string) => number;
}
