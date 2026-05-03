# Mobile & Remote Viewing

Goal: see the dashboard on my phone (and laptop) **without putting financial
data on public GitHub** — code stays public, data stays private.

The dashboard is a single self-contained `dist/index.html` with all data
inlined. The question is just: **where does that file live, and how does my
phone reach it?**

## Options ranked by my preference

### 1. Cloudflare Pages + Cloudflare Access (recommended)

Free, private, auth-protected, real URL. Best UX.

**Setup (one-time, ~15 min):**

```bash
# Install wrangler (Cloudflare's CLI)
npm install -g wrangler
wrangler login

# Create a project (one-time)
wrangler pages project create alon-ledger --production-branch=main

# Deploy the bundled dashboard
python scripts/bundle.py
wrangler pages deploy dist --project-name=alon-ledger
# → gives you a URL like https://alon-ledger.pages.dev
```

Then **enable Cloudflare Access** on the project:

1. Cloudflare dashboard → Zero Trust → Access → Applications → Add
2. Self-hosted, set domain to `alon-ledger.pages.dev`
3. Create policy: "Email is alon@…" → Google sign-in
4. Done — URL now requires login

**Refresh:**
```bash
python scripts/generate_data.py && python scripts/bundle.py
wrangler pages deploy dist --project-name=alon-ledger
```

**Pros:** real URL, fast CDN, auth, free, mobile-friendly
**Cons:** one-time CF account setup; need to redeploy each time data changes

---

### 2. Tailscale + local HTTP server

Run a static server on your Mac, reach it from your phone over a private mesh.

**Setup (one-time, ~5 min):**

1. Install Tailscale on Mac and phone (free for personal use)
2. Sign in to both with the same account

**Each time you want to view:**

```bash
cd ~/alonpersonal/ledger
python scripts/generate_data.py
python -m http.server 8000
# Mac shows up in Tailscale as e.g. "alon-mbp.tail-scale.ts.net"
```

On phone, open Safari → `http://alon-mbp.tail-scale.ts.net:8000` (or the IP).

**Pros:** zero deployment, instant refresh (just regenerate data.js, reload)
**Cons:** Mac must be awake & on, server must be running

---

### 3. Drive + Documents app (no setup, lowest tech)

The bundled HTML is already on Drive (`finance/personal_dashboard/reports/dashboard/index.html`). You can open it on phone via:

- **iPhone**: Drive app → tap file → "Open in another app" → "Documents by Readdle" (free) — renders HTML
- **Or save to Files**: Drive app → tap file → Send a copy → Files → open with Safari
- **Android**: Drive app → tap → renders inline (mostly works)

**Pros:** zero setup, file already where it should be
**Cons:** clunky on iOS (third-party app), can't bookmark a clean URL

---

### 4. ngrok / Cloudflare Tunnel (temporary public URL)

Run local server, expose via tunnel with auth. Good for occasional access.

```bash
python -m http.server 8000 &
cloudflared tunnel --url http://localhost:8000
# gives you a https://xxx.trycloudflare.com URL
```

Add a basic-auth wrapper (e.g. with Caddy) if you want auth. More setup than
Cloudflare Pages but no rebuild on data changes.

**Pros:** real URL, instant data refresh
**Cons:** Mac must be on, URL changes each session, manual auth setup

---

### 5. Private GitHub repo + GitHub Pages (NOT recommended)

Would require GitHub Pro to make a Pages site private. Skip — Cloudflare Pages
does the same thing for free with better auth.

---

## Recommended workflow

**Daily use:** keep `dist/index.html` deployed to Cloudflare Pages. Bookmark on
phone. Visit anytime, it's fresh as of last `wrangler pages deploy`.

**When you add data:**

```bash
cd ~/alonpersonal/ledger
python scripts/generate_data.py        # CSVs → data.js
python scripts/bundle.py               # → dist/index.html
wrangler pages deploy dist --project-name=alon-ledger   # → deployed
```

Three commands. ~10 seconds. URL stays the same — just refresh the phone tab.

**Setup script (optional):**
We can wrap the three commands into `scripts/deploy.sh` once you've decided on
Cloudflare Pages and run the wrangler login flow once.

---

## Data sync flow

```
Drive CSVs                       (source of truth, private to your account)
   ↓ generate_data.py
data/data.js                     (local, gitignored)
   ↓ bundle.py
dist/index.html                  (everything inlined, also gitignored)
   ↓ wrangler pages deploy
Cloudflare Pages (private)       (only you can view)
   ↓ Safari on phone
You looking at your dashboard 📱
```

GitHub never sees data.js or dist/ — both gitignored. The repo only has code.

---

## Security note

Even on Cloudflare Pages, the deployed HTML contains your numbers in plaintext
JavaScript. Cloudflare Access protects who can _reach_ the file, but anyone who
gets the file (e.g. by you accidentally sharing the URL while logged in) can
read it. Keep the URL to yourself, don't share it with shoulder-surfing
distance. The dashboard has a built-in **Privacy mode** (in the Tweaks panel)
that blurs all numbers — useful in cafés.