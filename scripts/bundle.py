#!/usr/bin/env python3
"""
Bundle everything into a single self-contained dist/index.html.

This is what you deploy / share / open on mobile. The HTML has all CSS, JSX,
and data inlined — no external requests except for fonts + CDN scripts.

Usage:
    python scripts/bundle.py            # uses data/data.js (your real data)
    python scripts/bundle.py --example  # uses data/data.example.js (synthetic)
"""
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
USE_EXAMPLE = "--example" in sys.argv


def read(rel):
    with open(REPO_ROOT / rel, encoding="utf-8") as f:
        return f.read()


def main():
    data_path = "data/data.example.js" if USE_EXAMPLE else "data/data.js"
    if not (REPO_ROOT / data_path).exists():
        print(f"ERROR: {data_path} missing.", file=sys.stderr)
        if not USE_EXAMPLE:
            print("Run `python scripts/generate_data.py` first.", file=sys.stderr)
        sys.exit(1)

    styles = read("styles.css")
    data_js = read(data_path)
    helpers = read("data/helpers.js")
    tweaks = read("tweaks-panel.jsx")
    icons = read("components/icons.jsx")
    charts = read("components/charts.jsx")
    overview = read("components/tab-overview.jsx")
    accounts = read("components/tab-accounts.jsx")
    cashflow = read("components/tab-cashflow.jsx")
    passive = read("components/tab-passive.jsx")
    app = read("app.jsx")

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
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.development.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"></script>
<script>{data_js}</script>
<script>{helpers}</script>
<script type="text/babel">{tweaks}</script>
<script type="text/babel">{icons}</script>
<script type="text/babel">{charts}</script>
<script type="text/babel">{overview}</script>
<script type="text/babel">{accounts}</script>
<script type="text/babel">{cashflow}</script>
<script type="text/babel">{passive}</script>
<script type="text/babel">{app}</script>
</body>
</html>
"""
    out = REPO_ROOT / "dist" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✓ Wrote {out}")
    print(f"  Size: {os.path.getsize(out):,} B")
    print(f"  Data source: {data_path}")


if __name__ == "__main__":
    main()