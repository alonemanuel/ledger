#!/usr/bin/env python3
"""
Generate data/data.js from CSV files in your Drive.

Usage:
    python scripts/generate_data.py
    DRIVE_DATA_DIR=/some/other/path python scripts/generate_data.py

Reads:
    $DRIVE_DATA_DIR/{accounts,snapshots,income,expenses}.csv

Writes:
    data/data.js  (gitignored)
"""
import csv
import os
import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_DRIVE_DIR = (
    "/Users/alonemanuel/Library/CloudStorage/"
    "GoogleDrive-alonemanuel95@gmail.com/My Drive/"
    "finance/personal_dashboard/data"
)
DRIVE_DATA_DIR = os.environ.get("DRIVE_DATA_DIR", DEFAULT_DRIVE_DIR)

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "data" / "data.js"


def read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def js_str(s):
    if s is None:
        return "null"
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def js_obj(d):
    parts = []
    for k, v in d.items():
        if isinstance(v, str):
            vv = js_str(v)
        elif v is None:
            vv = "null"
        elif isinstance(v, bool):
            vv = "true" if v else "false"
        else:
            vv = repr(v)
        parts.append(f"{k}: {vv}")
    return "{ " + ", ".join(parts) + " }"


def months_range():
    out = []
    for y in range(2024, 2027):
        for m in range(1, 13):
            if y == 2024 and m < 5:
                continue
            if y == 2026 and m > 5:
                continue
            out.append(f"{y}-{m:02d}")
    return out


def main():
    base = Path(DRIVE_DATA_DIR)
    if not base.exists():
        print(f"ERROR: data dir not found: {base}", file=sys.stderr)
        print("Set DRIVE_DATA_DIR env var to override.", file=sys.stderr)
        sys.exit(1)

    accounts_raw = read_csv(base / "accounts.csv")
    snapshots_raw = read_csv(base / "snapshots.csv")
    income_raw = read_csv(base / "income.csv")
    expenses_raw = read_csv(base / "expenses.csv")

    ALL_MONTHS = months_range()

    js_accounts = []
    for a in accounts_raw:
        js_accounts.append({
            "id": a["account_id"],
            "owner": a["owner"],
            "provider": a["provider"],
            "name": a["nickname"].split(" - ", 1)[-1] if " - " in a["nickname"] else a["nickname"],
            "type": a["type"],
            "currency": a["currency"].replace("NIS", "ILS"),
            "status": a["status"],
        })

    # Snapshots: forward-fill across months
    per_acct = defaultdict(list)
    for s in snapshots_raw:
        per_acct[s["account_id"]].append((s["date"][:7], float(s["balance_native"])))

    js_snapshots = []
    for acc in js_accounts:
        snap_list = sorted(per_acct.get(acc["id"], []))
        if not snap_list:
            continue
        first_ym = snap_list[0][0]
        snap_dict = dict(snap_list)
        last_bal = None
        for ym in ALL_MONTHS:
            if ym < first_ym:
                continue
            if ym in snap_dict:
                last_bal = snap_dict[ym]
            if last_bal is not None:
                js_snapshots.append({
                    "accountId": acc["id"],
                    "ym": ym,
                    "balance": round(last_bal),
                })

    # FX rates from snapshot data, filled forward
    fx_by_month = {}
    for s in snapshots_raw:
        if s["currency"] == "USD":
            try:
                r = float(s["fx_rate"])
                if r > 0:
                    fx_by_month[s["date"][:7]] = r
            except Exception:
                pass
    last = 3.20
    fx_full = {}
    for ym in ALL_MONTHS:
        if ym in fx_by_month:
            last = fx_by_month[ym]
        fx_full[ym] = last
    fx_current = fx_by_month.get(ALL_MONTHS[-1], last)

    # Income: spread annual aggregates across the months they cover
    SOURCE_OWNER = {
        "MongooseNet": "Alon", "ImagenAI": "Alon", "Bezalel": "Alon",
        "IBKR": "Alon", "Mongoose Net": "Alon", "Imagen": "Alon",
    }
    js_income = []
    for r in income_raw:
        src = r["source"]
        typ = r["type"]
        owner = SOURCE_OWNER.get(src, "Alon")
        amt = float(r["gross_native"])
        cur = r["currency"].replace("NIS", "ILS")
        date_str = r["date"]
        ym = date_str[:7]
        is_annual = date_str.endswith("-12-31") and typ in (
            "salary",
            "employer_pension_contribution",
            "employer_study_fund_contribution",
        )
        if is_annual:
            year = ym[:4]
            if src == "MongooseNet":
                months = [f"{year}-{m:02d}" for m in range(1, 12)]
            elif src == "ImagenAI":
                months = [f"{year}-11", f"{year}-12"]
            elif src == "Bezalel":
                months = [f"{year}-06"]
            else:
                months = [f"{year}-{m:02d}" for m in range(1, 13)]
            per = amt / len(months)
            for mym in months:
                js_income.append({
                    "ym": mym, "owner": owner, "type": typ,
                    "amount": round(per), "currency": cur, "source": src,
                })
        else:
            js_income.append({
                "ym": ym, "owner": owner, "type": typ,
                "amount": round(amt, 2), "currency": cur, "source": src,
            })

    # Expenses
    acct_owner = {a["id"]: a["owner"] for a in js_accounts}
    js_expenses = []
    nid = 1
    for r in expenses_raw:
        js_expenses.append({
            "id": nid,
            "date": r["date"],
            "ym": r["date"][:7],
            "owner": acct_owner.get(r["account_id"], "Alon"),
            "account": r["account_id"],
            "merchant": r["merchant"],
            "category": r["category"] if r["category"] else None,
            "amount": float(r["amount_native"]),
            "currency": r["currency"].replace("NIS", "ILS"),
        })
        nid += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED from CSV — do not edit by hand\n\n")
        f.write("const FX = {\n")
        f.write(f"  current: {fx_current},\n")
        f.write(f'  setOn: "{__import__("datetime").date.today().isoformat()}",\n')
        f.write("  byMonth: {\n")
        for ym, r in sorted(fx_full.items()):
            f.write(f'    "{ym}": {r},\n')
        f.write("  },\n")
        f.write("  rateFor(ym) { return this.byMonth[ym] || this.current; },\n};\n\n")

        f.write("const ACCOUNTS = [\n")
        for a in js_accounts:
            f.write("  " + js_obj(a) + ",\n")
        f.write("];\n\n")

        f.write("const SNAPSHOTS = [\n")
        for s in js_snapshots:
            f.write("  " + js_obj(s) + ",\n")
        f.write("];\n\n")

        f.write("const INCOME = [\n")
        for i in js_income:
            f.write("  " + js_obj(i) + ",\n")
        f.write("];\n\n")

        f.write("const EXPENSES = [\n")
        for e in js_expenses:
            f.write("  " + js_obj(e) + ",\n")
        f.write("];\n\n")

        f.write('const CATEGORIES = ["food","transport","housing","utilities","health","entertainment","travel","shopping","gifts","taxes","savings_transfer","fees","other"];\n\n')
        f.write("const TYPE_GROUP = {\n")
        f.write('  checking: "Cash / Checking", savings: "Cash / Checking",\n')
        f.write('  money_market: "Savings",\n  brokerage: "Investments", provident: "Investments",\n')
        f.write('  pension_comprehensive: "Retirement", pension_supplementary: "Retirement",\n')
        f.write('  study_fund: "Retirement",\n};\n\n')
        f.write('const GROUP_ORDER = ["Cash / Checking","Savings","Investments","Retirement"];\n\n')
        f.write("const TYPE_ICON = {\n")
        f.write('  checking: "🏦", savings: "🏦",\n  money_market: "💰",\n')
        f.write('  brokerage: "📈",\n  pension_comprehensive: "🏛", pension_supplementary: "🏛",\n')
        f.write('  provident: "🔒",\n  study_fund: "🎓",\n};\n\n')
        f.write("window.FinanceData = { FX, ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, CATEGORIES, TYPE_GROUP, GROUP_ORDER, TYPE_ICON };\n")

    print(f"✓ Wrote {OUT}")
    print(f"  Source: {base}")
    print(f"  Counts: {len(js_accounts)} accounts, {len(js_snapshots)} snapshots, "
          f"{len(js_income)} income rows, {len(js_expenses)} expenses")


if __name__ == "__main__":
    main()
