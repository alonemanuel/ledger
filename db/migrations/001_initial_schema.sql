-- 001_initial_schema.sql
-- Multi-tenant personal finance ledger. Every data table scoped by user_id.

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  description TEXT
);

CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE accounts (
  id         TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  owner      TEXT NOT NULL,
  provider   TEXT NOT NULL,
  nickname   TEXT NOT NULL,
  type       TEXT NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'ILS',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE snapshots (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  account_id     TEXT NOT NULL,
  date           DATE NOT NULL,
  balance_native NUMERIC(14,2) NOT NULL,
  currency       TEXT NOT NULL,
  fx_rate        NUMERIC(8,4),
  source_doc     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_id, date),
  FOREIGN KEY (user_id, account_id) REFERENCES accounts(user_id, id)
);

CREATE TABLE income (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  date         DATE NOT NULL,
  source       TEXT NOT NULL,
  type         TEXT NOT NULL,
  gross_native NUMERIC(14,2) NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'ILS',
  source_doc   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date, source, type, gross_native)
);

CREATE TABLE expenses (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  date            DATE NOT NULL,
  account_id      TEXT NOT NULL,
  amount_native   NUMERIC(14,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'ILS',
  amount_ils      NUMERIC(14,2) NOT NULL,
  fx_rate         NUMERIC(8,4) DEFAULT 1,
  category        TEXT,
  subcategory     TEXT,
  merchant        TEXT NOT NULL,
  description     TEXT,
  source_doc      TEXT,
  billing_date    DATE,
  external_ref_id TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (user_id, account_id) REFERENCES accounts(user_id, id)
);

CREATE INDEX idx_expenses_user_date ON expenses(user_id, date);
CREATE INDEX idx_expenses_user_account ON expenses(user_id, account_id);
CREATE UNIQUE INDEX idx_expenses_dedup
  ON expenses(user_id, account_id, external_ref_id)
  WHERE external_ref_id IS NOT NULL;

CREATE TABLE fx_rates (
  user_id INTEGER NOT NULL REFERENCES users(id),
  ym      TEXT NOT NULL,
  rate    NUMERIC(8,4) NOT NULL,
  PRIMARY KEY (user_id, ym)
);
