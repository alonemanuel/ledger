# Setup — Live Drive Mode

The dashboard reads CSVs directly from your Google Drive folder at view time.
No deploy step on data updates: edit a CSV, refresh phone, fresh data.

## Prerequisites (one-time, ~10 min)

### 1. Google Cloud project + OAuth client

You've already done this. The values are baked into `data/drive-loader.js`:

```js
const CLIENT_ID = '524822374717-...apps.googleusercontent.com';
const FOLDER_ID = '1x3REt2-XYd73s1wH61MFRBPbs94e1NJN';
```

If you ever need to redo it:

1. [console.cloud.google.com](https://console.cloud.google.com) → create project (or reuse)
2. **APIs & Services → Library** → enable **Google Drive API**
3. **APIs & Services → OAuth consent screen** → External, status: **Testing**
   - Add yourself (and Amit) as test users
   - Scope: `https://www.googleapis.com/auth/drive.readonly`
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: add every URL where you'll run the app
     - `http://localhost:8000` (dev)
     - `https://your-app.pages.dev` (prod, after first deploy)
5. Copy the Client ID into `data/drive-loader.js` (or whoever maintains it)
6. Open the data folder on Drive — the URL contains the folder ID after `/folders/`. Paste into `data/drive-loader.js`.

### 2. Test users

The OAuth consent screen is in **Testing** mode (production requires Google
to verify your Drive access scope, which takes weeks). Testing mode allows
up to 100 explicitly-added users. To allow Amit / anyone else to view:

→ Google Cloud → OAuth consent screen → Test users → Add user

## Running locally (dev)

```bash
cd ~/alonpersonal/ledger

# Multi-file dev server
python -m http.server 8000

# Open in browser
open http://localhost:8000
```

Click **Sign in with Google** → grant Drive read access → dashboard loads.
Token cached in `sessionStorage` for ~1 hour.

## Building bundle for deploy

```bash
# Live-Drive bundle (default)
python scripts/bundle.py

# Synthetic demo bundle (no Drive auth — for the public README/screenshot)
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

After Claude updates a CSV on Drive:

1. **Don't** rebuild/redeploy
2. **Just refresh your phone** — the dashboard re-fetches CSVs on load

You only need to redeploy when **code** changes (not when data changes).

```bash
python scripts/bundle.py
wrangler pages deploy dist --project-name=alon-ledger
```

## Vendor lock-in story (the durability invariant)

```
Drive CSVs                 ← Source of truth, plain text, yours forever
   ↑↓
data/drive-loader.js       ← Reads CSVs at runtime
   ↓
Cloudflare Pages           ← Hosts the static HTML (replaceable)
   ↓
Phone with Google login    ← Access via OAuth
```

If Cloudflare disappears tomorrow:
- Your data is on Drive, untouched
- Run `python scripts/bundle.py`
- Deploy to Vercel / Netlify / GitHub Pages — `dist/index.html` is portable
- New URL → add to OAuth client → done. <30 min.

If Google Drive disappears tomorrow:
- Drive's takeout export gives you the CSVs as plain files
- Move CSVs to any other store (S3, Dropbox, local)
- Adapt `drive-loader.js` to fetch from the new location

## Sign-out

Built into the dashboard's Tweaks panel (gear icon, top right). Or manually:

```js
sessionStorage.removeItem('ledger_drive_token');
```

## Troubleshooting

**"AUTH_EXPIRED"** — Token expired (>1hr old). Click the sign-out / retry button in the boot screen, sign in again.

**"redirect_uri_mismatch"** — The URL you're visiting isn't in the OAuth client's authorized origins. Add it in Google Cloud → Credentials → OAuth Client → Authorized JavaScript origins.

**"Missing CSV files in Drive folder"** — A required CSV is absent from the folder. Check `data/drive-loader.js → FILE_NAMES` for the expected names: `accounts.csv`, `snapshots.csv`, `income.csv`, `expenses.csv`.

**"This app isn't verified"** — Normal for testing-mode apps. Click "Advanced" → "Go to Ledger (unsafe)". The "unsafe" warning is generic; the app only requests Drive read access scoped to your account.

**Sign-in popup blocked** — Allow popups for the dashboard URL in your browser settings, or use the redirect-mode fallback (TODO if needed).