#!/usr/bin/env python3
"""
Bundle everything into a single self-contained dist/index.html.

This is what you deploy / share / open on mobile. The HTML has all CSS, JSX,
and data inlined — no external requests except for fonts + CDN scripts.

Usage:
    python scripts/bundle.py            # uses data/data.js (your real data)
    python scripts/bundle.py --example  # uses data/data.example.js (synthetic)
"""
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
USE_EXAMPLE = "--example" in sys.argv


def read(rel):
    with open(REPO_ROOT / rel, encoding="utf-8") as f:
        return f.read()


def main():
    if USE_EXAMPLE:
        # Synthetic demo: static data, no Drive auth, no loader
        data_path = "data/data.example.js"
        if not (REPO_ROOT / data_path).exists():
            print(f"ERROR: {data_path} missing.", file=sys.stderr)
            sys.exit(1)
        data_js = read(data_path)
        loader_js = ""  # not needed
        extra_scripts = ""
    else:
        # Live mode: empty data scaffold + sheets-loader + GIS + SheetJS
        data_js = read("data/data.js")
        loader_js = read("data/sheets-loader.js")
        # Inline the demo data source as a string so the "Load demo data"
        # button works in the deployed bundle without needing the
        # data.example.js file to be served separately.
        demo_src = read("data/data.example.js")
        demo_literal = json.dumps(demo_src).replace("</", "<\\/")
        # SheetJS is needed by the Intake tab to convert XLSX uploads to CSV
        # in the browser. Live mode only — demo mode hides the Intake tab.
        extra_scripts = (
            '<script src="https://accounts.google.com/gsi/client" async defer></script>\n'
            '<script src="https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"></script>\n'
            f'<script>window.__LEDGER_DEMO_SOURCE__ = {demo_literal};</script>\n'
        )

    styles = read("styles.css")
    helpers = read("data/helpers.js")
    tweaks = read("tweaks-panel.jsx")
    icons = read("components/icons.jsx")
    charts = read("components/charts.jsx")
    overview = read("components/tab-overview.jsx")
    accounts = read("components/tab-accounts.jsx")
    cashflow = read("components/tab-cashflow.jsx")
    passive = read("components/tab-passive.jsx")
    intake = read("components/tab-intake.jsx")
    app = read("app.jsx")

    # In example mode, replace Bootstrap with direct App render (no auth flow)
    if USE_EXAMPLE:
        app = app.replace(
            'ReactDOM.createRoot(document.getElementById(\'root\')).render(<Bootstrap/>);',
            'ReactDOM.createRoot(document.getElementById(\'root\')).render(<App/>);'
        )

    loader_script = f'<script>{loader_js}</script>' if loader_js else ''

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Ledger — Personal Finance</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet"/>
<style>
{styles}
</style>
</head>
<body>
<div id="root"></div>
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"></script>
{extra_scripts}<script>{data_js}</script>
<script>{helpers}</script>
{loader_script}
<script type="text/babel">{tweaks}</script>
<script type="text/babel">{icons}</script>
<script type="text/babel">{charts}</script>
<script type="text/babel">{overview}</script>
<script type="text/babel">{accounts}</script>
<script type="text/babel">{cashflow}</script>
<script type="text/babel">{passive}</script>
<script type="text/babel">{intake}</script>
<script type="text/babel">{app}</script>
</body>
</html>
"""
    out = REPO_ROOT / "dist" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    # SPA fallback (rewrites) is configured in the *root* vercel.json,
    # which Vercel reads for routing. Don't write a vercel.json into the
    # output dir — it would shadow the root one and accidentally drop
    # the /api/* exclusion needed for Vercel Functions.

    print(f"✓ Wrote {out}")
    print(f"  Size: {os.path.getsize(out):,} B")
    print(f"  Mode: {'example (synthetic data)' if USE_EXAMPLE else 'live (Google Sheets)'}")


if __name__ == "__main__":
    main()