# Ledger

Personal finance dashboard. Multi-tenant React SPA with hand-rolled SVG charts, Google OAuth, and LLM-powered data intake.

## What it shows

- **Overview** -- net worth, KPIs, trends
- **Accounts** -- balances grouped by asset class with sparklines and drill-downs
- **Cashflow** -- income vs expense per month, by category
- **Passive Income** -- dividends, interest, employer benefits, blended yield

## Key features

- **Hand-rolled SVG charts** -- no Chart.js, no D3
- **Multi-tenant** -- Google OAuth, each user sees only their own data
- **LLM-powered intake** -- paste text, images, PDFs, or CSVs and Gemini extracts structured rows into the database
- **Privacy model** -- code is public, financial data is never committed. Built-in privacy mode blurs all numbers on screen

## Demo mode

```bash
python scripts/bundle.py --example
open dist/index.html
```

Generates a self-contained HTML file with synthetic data -- no auth, no database.

## Running locally

```bash
vercel dev --listen 3000
```

Requires the Vercel CLI and linked project (for serverless API functions and environment variables).

## Stack

- React 18 (UMD via CDN), Babel Standalone (in-browser JSX compilation)
- Neon Postgres (Vercel Marketplace), Vercel Serverless Functions
- Gemini (free tier) for structured data extraction
- Inter / JetBrains Mono / Newsreader fonts, oklch color space

## License

Code is MIT-equivalent -- copy whatever is useful. Data is private.