# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

Personal finance dashboard. Single-page React app with Neon Postgres backend, deployed on Vercel. JSX is compiled in the browser by Babel Standalone; "bundling" is a Python script that concatenates files into one HTML.

## Commands

```bash
# Run dev server (requires vercel CLI for API functions)
vercel dev --listen 3000

# Bundle into single self-contained dist/index.html
python scripts/bundle.py            # live mode -- DB-backed, auth at runtime
python scripts/bundle.py --example  # synthetic demo mode -- no auth

# Deploy (Vercel)
vercel deploy --prod

# Run DB migrations
node db/migrate.js

# Seed DB from XLSX export
node db/seed-from-xlsx.js /path/to/ledger.xlsx [email]
```

There are no lint, type-check, or test commands -- none are configured.

## Rules

- When working on a feature or development task, always do so in a fresh worktree aligned with remote main, unless stated otherwise.
- Every feature must be reflected in `data/data.example.js` -- update synthetic demo data when adding new fields or data structures.
- Never commit real financial data. `data/data.js` and `dist/` are gitignored.
- Months are `YYYY-MM` strings throughout.
- For any stack or architecture changes, update `ARCHITECTURE.md` -- it must always reflect the current state.
- Reference `ARCHITECTURE.md` when you need to understand the stack, data flow, or system architecture.

## Conventions

- **Globals over imports.** Shared utilities go on `window.Fin` in `helpers.js`.
- **Mutate, don't reassign.** `ACCOUNTS.length = 0; ACCOUNTS.push(...)` -- never `ACCOUNTS = [...]`.
- **Editorial-meets-terminal aesthetic.** Inter / JetBrains Mono / Newsreader fonts; ochre accent; oklch color space.
- **Privacy mode** (`data-privacy="on"`) blurs numbers via CSS. Monetary values need `private` className.
- **Hand-rolled SVG charts.** No Chart.js, no D3.
- **Script load order matters.** See comments in `index.html` / `bundle.py`.

## Environment variables

| Var | Purpose |
|-----|---------|
| `POSTGRES_URL` | Neon connection string (auto-injected by Vercel Marketplace) |
| `GEMINI_API_KEY` | Google AI Studio key (free tier) |