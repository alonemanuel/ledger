# Setup — Live Sheets Mode

The dashboard reads from a Google Sheet (named `ledger`) in your Drive folder
at view time. No deploy step on data updates: edit the Sheet, refresh phone,
fresh data.

## One-time migration: CSV → Sheet

If you previously ran the CSV-based version, you have four CSVs in the Drive
folder. The new loader reads from a single Google Sheet with four tabs. Run
the in-browser migrator once to copy the CSVs into the Sheet:

```bash
# From repo root, start the dev server
python -m http.server 8000

# Open the migrator
open http://localhost:8000/tools/migrate.html
```

Click **Sign in & migrate**. The page:

1. Reads `accounts.csv`, `snapshots.csv`, `income.csv`, `expenses.csv` from your Drive folder.
2. Creates a spreadsheet named `ledger` in the same folder (or finds the existing one).
3. Writes one tab per CSV, identical headers/rows.

The CSVs in Drive are **left untouched** — they're not the source of truth
anymore, but they remain as a snapshot/backup. You can delete them later if
you like.

Re-running the migrator overwrites the Sheet's tabs, so it's safe to run
again after editing CSVs.

## Prerequisites (one-time, ~10 min)

### 1. Google Cloud project + OAuth client

You've already done this. The values are baked into `data/sheets-loader.js`
and `tools/migrate.html`:

```js
const CLIENT_ID = '524822374717-...apps.googleusercontent.com';
const FOLDER_ID = '1x3REt2-XYd73s1wH61MFRBPbs94e1NJN';
```

If you ever need to redo it:

1. [console.cloud.google.com](https://console.cloud.google.com) → create project (or reuse)
2. **APIs & Services → Library** → enable **Google Drive API** and **Google Sheets API**
3. **APIs & Services → OAuth consent screen** → External, status: **Testing**
   - Add yourself (and any other test user) as test users
   - Scopes used:
     - `https://www.googleapis.com/auth/drive.readonly` (runtime + migrator)
     - `https://www.googleapis.com/auth/spreadsheets.readonly` (runtime)
     - `https://www.googleapis.com/auth/drive.file` (migrator only — to create the Sheet inside the folder)
     - `https://www.googleapis.com/auth/spreadsheets` (migrator only — to write tabs)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: add every URL where you'll run the app
     - `http://localhost:8000` (dev)
     - `https://your-app.pages.dev` (prod, after first deploy)
5. Copy the Client ID into `data/sheets-loader.js` and `tools/migrate.html`.
6. Open the data folder on Drive — the URL contains the folder ID after `/folders/`. Paste into both files.

### 2. Test users

The OAuth consent screen is in **Testing** mode (production requires Google
verification, which takes weeks). Testing mode allows up to 100
explicitly-added users.

→ Google Cloud → OAuth consent screen → Test users → Add user

## Running locally (dev)

```bash
cd ~/alonpersonal/ledger

# Multi-file dev server
python -m http.server 8000

# Open in browser
open http://localhost:8000
```

Click **Sign in with Google** → grant access → dashboard loads.
Token cached in `localStorage` for ~1 hour.

## Building bundle for deploy

```bash
# Live-Sheets bundle (default)
python scripts/bundle.py

# Synthetic demo bundle (no auth — for the public README/screenshot)
python scripts/bundle.py --example
```

Output: `dist/index.html` — single self-contained file.

## Deploying to Cloudflare Pages

This is the recommended host. **Free**, fast CDN, custom domain support.

```bash
# Install wrangler once
npm install -g wrangler
wrangler login

# Create project (one-time)
wrangler pages project create alon-ledger --production-branch=main

# Build + deploy
python scripts/bundle.py
wrangler pages deploy dist --project-name=alon-ledger
```

After first deploy you'll get a URL like `https://alon-ledger.pages.dev`.

**Important: add that URL to Google Cloud OAuth client's "Authorized JavaScript
origins" list**, otherwise sign-in will fail with `redirect_uri_mismatch`.

### Refresh workflow

After updating data in the Sheet:

1. **Don't** rebuild/redeploy
2. **Just refresh your phone** — the dashboard re-fetches the Sheet on load

You only need to redeploy when **code** changes (not when data changes).

```bash
python scripts/bundle.py
wrangler pages deploy dist --project-name=alon-ledger
```

## Vendor lock-in story (the durability invariant)

```
Google Sheet (`ledger`)    ← Source of truth, exportable to CSV/XLSX
   ↑↓
data/sheets-loader.js      ← Reads tabs at runtime
   ↓
Cloudflare Pages           ← Hosts the static HTML (replaceable)
   ↓
Phone with Google login    ← Access via OAuth
```

If Cloudflare disappears tomorrow:
- Your data is in Drive, untouched
- Run `python scripts/bundle.py`
- Deploy to Vercel / Netlify / GitHub Pages — `dist/index.html` is portable
- New URL → add to OAuth client → done. <30 min.

If Google disappears tomorrow:
- Sheets export gives you back CSVs as plain files
- Move data to any other store (S3, Dropbox, local)
- Adapt `sheets-loader.js` to fetch from the new location

## Sign-out

Built into the dashboard's Tweaks panel (gear icon, top right). Or manually:

```js
localStorage.removeItem('ledger_sheets_token');
```

## Troubleshooting

**"AUTH_EXPIRED"** — Token expired (>1hr old). Click the sign-out / retry button in the boot screen, sign in again.

**"redirect_uri_mismatch"** — The URL you're visiting isn't in the OAuth client's authorized origins. Add it in Google Cloud → Credentials → OAuth Client → Authorized JavaScript origins.

**`No spreadsheet named "ledger" in the Drive folder`** — Run `tools/migrate.html` once to create it.

**"This app isn't verified"** — Normal for testing-mode apps. Click "Advanced" → "Go to Ledger (unsafe)". The "unsafe" warning is generic; the app only requests Drive + Sheets read access scoped to your account.

**Sign-in popup blocked** — Allow popups for the dashboard URL in your browser settings.
