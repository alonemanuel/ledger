# Ledger

Personal finance dashboard. Single-file HTML, React + SVG charts, no backend.

## What it shows

Four tabs:

- **Overview** — net worth, KPIs, trends
- **Accounts** — balances grouped by asset class with sparklines & drill-downs
- **Cashflow** — income vs expense per month, by category
- **Passive Income** — dividends, interest, employer benefits, blended yield

Built from a design prototype, then wired to read CSVs.

## Privacy model

This repo is **public code**. Your **financial data is never committed.**

- `data/data.js` is git-ignored — it's generated from your private CSVs.
- `data/data.example.js` (committed) is synthetic demo data so anyone can see how the dashboard works.
- The build pipeline reads CSVs from a path you configure (defaults to your Drive folder).

## Running locally

### Option A: bundled (single file, opens with `open`)

```bash
# 1. Generate data.js from your CSVs (private)
python scripts/generate_data.py

# 2. Bundle everything into dist/index.html
python scripts/bundle.py

# 3. Open
open dist/index.html
```

### Option B: dev mode (multiple files, requires HTTP server)

```bash
python scripts/generate_data.py
python -m http.server 8000
# visit http://localhost:8000
```

The bundled mode (A) is needed because Babel can't fetch external `.jsx` files from `file://`. Option B works in dev because HTTP requests succeed.

### See the demo (no real data)

```bash
python scripts/bundle.py --example
open dist/index.html
```

## Data layout

CSVs live at `$DRIVE_DATA_DIR` (default: `~/Library/CloudStorage/.../My Drive/finance/personal_dashboard/data/`):

- `accounts.csv` — master list of accounts
- `snapshots.csv` — point-in-time balances
- `income.csv` — money in (salary, dividends, etc.)
- `expenses.csv` — money out (categorized transactions)
- `taxes.csv` — taxes paid

Schemas defined in `../personal_dashboard/PLAN.md` on Drive.

To override the location:

```bash
DRIVE_DATA_DIR=/path/to/csv/dir python scripts/generate_data.py
```

## Mobile viewing

See [`DEPLOY.md`](DEPLOY.md).

## Project structure

```
ledger/
├── README.md
├── DEPLOY.md                  ← mobile / remote viewing options
├── .gitignore                 ← excludes data.js, dist/
├── index.html                 ← dev entry (multi-file)
├── styles.css                 ← all styling
├── app.jsx                    ← shell, tabs, header, FX strip
├── tweaks-panel.jsx           ← theme/density/accent/privacy controls
├── components/
│   ├── icons.jsx              ← SVG icon set
│   ├── charts.jsx             ← line/donut/stacked bar/treemap primitives
│   ├── tab-overview.jsx
│   ├── tab-accounts.jsx
│   ├── tab-cashflow.jsx
│   └── tab-passive.jsx
├── data/
│   ├── helpers.js             ← formatters + derivations (pure code)
│   ├── data.example.js        ← synthetic demo data
│   └── data.js                ← real data (gitignored)
├── scripts/
│   ├── generate_data.py       ← CSVs → data.js
│   └── bundle.py              ← all → dist/index.html
└── dist/                      ← gitignored output
```

## Refresh workflow

When you have new CSVs:

```bash
python scripts/generate_data.py    # regenerate data.js
python scripts/bundle.py           # re-bundle dist/index.html
```

Reload the page (or push to your deploy target — see `DEPLOY.md`).

## Stack

- React 18 (UMD via CDN)
- Babel Standalone (compiles JSX in the browser)
- Hand-rolled SVG charts — no Chart.js, no D3
- ~430 lines of CSS, ~1500 lines of JSX
- Inter / JetBrains Mono / Newsreader fonts
- Editorial-meets-terminal aesthetic, light/dark, ochre accent

## License

Personal use. Code is MIT-equivalent — copy whatever's useful. Data is mine.