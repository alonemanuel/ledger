import type { Account, Snapshot, IncomeRow, ExpenseRow, FXData } from './types';

declare module '*?raw' {
  const src: string;
  export default src;
}


interface DbLoaderAPI {
  init: () => Promise<void>;
  bootstrap: () => Promise<{ accounts: number; snapshots: number; income: number; expenses: number }>;
  signOut: () => void;
  requestSignIn: (opts?: { silent?: boolean }) => Promise<void>;
  loadDemoData: () => Promise<void>;
  fetchAndPopulate: () => Promise<{ accounts: number; snapshots: number; income: number; expenses: number }>;
  appendRows: (tab: string, rows: unknown[]) => Promise<{ appended: number }>;
  getCurrentToken: () => string | null;
}

interface FinanceDataGlobal {
  FX: FXData;
  ACCOUNTS: Account[];
  SNAPSHOTS: Snapshot[];
  INCOME: IncomeRow[];
  EXPENSES: ExpenseRow[];
  CATEGORIES: string[];
  TYPE_GROUP: Record<string, string>;
  GROUP_ORDER: string[];
  TYPE_ICON: Record<string, string>;
}

interface GoogleIdentityServices {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; error?: string; expires_in?: number }) => void;
      }) => {
        callback: (response: { access_token?: string; error?: string; expires_in?: number }) => void;
        error_callback: (err: { type?: string; message?: string }) => void;
        requestAccessToken: (opts: { prompt: string }) => void;
      };
      revoke: (token: string, callback: () => void) => void;
    };
  };
}

interface XLSXStatic {
  read: (data: ArrayBuffer, opts?: { type?: string }) => { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json: <T = unknown>(sheet: unknown, opts?: { header?: number | 'A'; defval?: unknown }) => T[];
  };
}

declare global {
  interface Window {
    FinanceData: FinanceDataGlobal;
    DbLoader: DbLoaderAPI;
    Fin: typeof import('./data/helpers').Fin;
    __LEDGER_DEMO_SOURCE__: string;
    XLSX: XLSXStatic;
    google: GoogleIdentityServices;
  }

  // Allow direct access without window. prefix
  const google: GoogleIdentityServices;
}

export {};
