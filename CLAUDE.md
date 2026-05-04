# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

Personal finance dashboard. Single-page React app — JSX is compiled in the browser by Babel Standalone, React is loaded via UMD CDN, and "bundling" is a Python script that concatenates files into one HTML. Data is stored in **Neon Postgres** (Vercel Marketplace) and served via Vercel serverless functions.

## Commands

```bash
# Run dev server (requires vercel CLI for API functions)
vercel dev --listen 3000

# Bundle into single self-contained dist/index.html
python scripts/bundle.py            # live mode — DB-backed, auth at runtime
python scripts/bundle.py --example  # synthetic demo mode — no auth

# Deploy (Vercel)
vercel deploy --prod

# Run DB migrations
node db/migrate.js

# Seed DB from XLSX export
node db/seed-from-xlsx.js /path/to/ledger.xlsx [email]
```

There are no lint, type-check, or test commands — none are configured.

## Architecture

### Data flow

```
Browser (SPA)                    Vercel Functions (API)
┌──────────────┐                ┌─────────────────────┐
│ db-loader.js │── GET /api/data ──▶│ data.js (read)  │──▶ Neon Postgres
│ tab-intake   │── POST /api/intake ─▶│ intake.js       │──▶ Gemini + DB write
│ app.jsx      │                │ expenses/income/     │
│ helpers.js   │                │ snapshots.js (CRUD) │
└──────────────┘                └─────────────────────┘
```

### Two modes

1. **Live mode** (default `bundle.py`, also `vercel dev`): User signs in via Google OAuth. `db-loader.js` fetches data from `/api/data` (Neon Postgres), populates `window.FinanceData` globals in place, and the app renders.

2. **Example mode** (`bundle.py --example`): `data/data.example.js` is inlined with synthetic data; entry point renders `<App/>` directly, bypassing auth.

### Auth model

Multi-tenant. Each user signs in via Google OAuth, gets auto-registered in the `users` table, and sees only their own data (all queries scoped by `user_id`). The "account owner" field (e.g. "Alon"/"Amit") is a label within a user's ledger, not a separate auth identity.

### Script load order (matters!)

1. React + ReactDOM (UMD)
2. Babel Standalone
3. Google Identity Services (live mode only)
4. SheetJS / XLSX (live mode only — for XLSX upload in Intake tab)
5. `data/data.js` — declares **mutable top-level consts** `ACCOUNTS`, `SNAPSHOTS`, `INCOME`, `EXPENSES`, `FX`, etc.
6. `data/helpers.js` — reads those globals, defines `window.Fin` namespace.
7. `data/db-loader.js` — defines `window.DbLoader` (live mode only).
8. JSX components in dependency order: `tweaks-panel.jsx` → `icons.jsx` → `charts.jsx` → tab components → `app.jsx`.

### API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/data` | GET | Full data fetch for authenticated user |
| `/api/expenses` | POST | Batch create expenses |
| `/api/income` | POST | Batch create income |
| `/api/snapshots` | POST | Batch create snapshots |
| `/api/intake` | POST | Gemini extraction → DB write |
| `/api/seed` | POST | Bulk import from frontend |
| `/api/ping` | GET | Health check |

All authenticated endpoints verify the Google OAuth token server-side (`api/_db.js`).

### Database (Neon Postgres)

Tables: `users`, `accounts`, `snapshots`, `income`, `expenses`, `fx_rates`, `schema_version`. All data tables have `user_id` FK. Schema migrations live in `db/migrations/` — numbered SQL files run by `db/migrate.js`.

### Intake (LLM extraction)

`api/intake.js` calls Gemini (free tier) to extract structured rows from text/images/PDFs/CSVs. Model fallback chain: `gemini-2.5-flash → gemini-2.0-flash → gemini-2.5-flash-lite`. Extracted rows are validated, stamped with `created_at`/`source_doc`, and written to DB. No client-side write step.

### Currency model

All amounts stored in **native currency** (ILS or USD). FX-to-ILS conversion at display time via `Fin.toILS(amount, currency, ym)`.

### Tab structure

`app.jsx` is the shell. Each tab is a separate file in `components/`: `tab-overview.jsx`, `tab-accounts.jsx`, `tab-cashflow.jsx`, `tab-passive.jsx`, `tab-intake.jsx`. Charts are hand-rolled SVG in `charts.jsx` — **no Chart.js, no D3**.

## Demo data requirement

**Every feature must be reflected in `data/data.example.js`.** When adding new fields or data structures, update the synthetic demo data.

## Conventions

- **Globals over imports.** Add shared utilities to `window.Fin` in `helpers.js`.
- **Mutate, don't reassign.** `ACCOUNTS.length = 0; ACCOUNTS.push(...)` — never `ACCOUNTS = [...]`.
- **Privacy invariant.** `data/data.js` and `dist/` are gitignored. Never commit real numbers.
- **Editorial-meets-terminal aesthetic.** Inter / JetBrains Mono / Newsreader fonts; ochre accent; oklch color space.
- **Privacy mode** (`data-privacy="on"`) blurs numbers via CSS. Monetary values need `private` className.
- **Months as `YYYY-MM` strings** throughout.

## Environment variables

| Var | Purpose |
|-----|---------|
| `POSTGRES_URL` | Neon connection string (auto-injected by Vercel Marketplace) |
| `GEMINI_API_KEY` | Google AI Studio key (free tier) |
