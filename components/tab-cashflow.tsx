import React, { useState as useStateCf } from 'react';
import { Fin } from '../data/helpers.ts';
import { Icon, CAT_ICON } from './icons.tsx';
import { PairedBars, StackedBar, Treemap } from './charts.tsx';

const CASHFLOW_SECTIONS = [
  { id: 'trends', label: 'Trends' },
  { id: 'month',  label: 'Month View' },
];

const CF_SAVINGS_LS = 'ledger_cashflow_show_savings';

function CashflowTab({ section }: { section?: string | null }) {
  const [windowMonths, setWindowMonths] = useStateCf(12);
  const [openCat, setOpenCat] = useStateCf<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useStateCf('all');
  const [showSavings, setShowSavingsState] = useStateCf(() => {
    try { return localStorage.getItem(CF_SAVINGS_LS) !== 'false'; }
    catch (_) { return true; }
  });
  const [selectedMonth, setSelectedMonth] = useStateCf(Fin.LATEST);
  const [expSort, setExpSort] = useStateCf<{ col: string; dir: string }>({ col: 'amount', dir: 'desc' });

  const setShowSavings = (v: boolean) => {
    setShowSavingsState(v);
    try { localStorage.setItem(CF_SAVINGS_LS, String(v)); } catch (_) {}
  };

  const matchOwner = (rec: { owner: string }) => ownerFilter === 'all' || rec.owner === ownerFilter;

  // ── Overall section data (scoped by windowMonths) ──────────────────────
  const months = Fin.ALL_MONTHS.slice(-windowMonths);

  const ie = months.map(ym => {
    const inc = window.FinanceData.INCOME
      .filter(i => i.ym === ym && matchOwner(i))
      .reduce((s, i) => s + Fin.toILS(i.amount, i.currency, i.ym), 0);
    let regular = 0, investment = 0;
    window.FinanceData.EXPENSES
      .filter(e => e.ym === ym && matchOwner(e))
      .forEach(e => {
        const v = Fin.toILS(e.amount, e.currency, e.ym);
        if (Fin.isInvestment(e)) investment += v; else regular += v;
      });
    return showSavings
      ? { ym, income: inc, expense: regular, investment }
      : { ym, income: inc, expense: regular };
  });

  const expCats = window.FinanceData.CATEGORIES;
  const expStacked = months.map(ym => {
    const row: Record<string, any> = { ym };
    window.FinanceData.EXPENSES
      .filter(e => e.ym === ym && matchOwner(e))
      .forEach(e => {
        const k = e.category || 'uncategorized';
        row[k] = (row[k] || 0) + Fin.toILS(e.amount, e.currency, e.ym);
      });
    expCats.forEach(c => { if (!(c in row)) row[c] = 0; });
    return row;
  });
  const allExpKeys = [...expCats, 'uncategorized'];

  // ── Month detail data (scoped by selectedMonth) ────────────────────────
  const monthIdx = Fin.ALL_MONTHS.indexOf(selectedMonth);
  const hasPrev = monthIdx > 0;
  const hasNext = monthIdx < Fin.ALL_MONTHS.length - 1;

  const monthIncome = window.FinanceData.INCOME
    .filter(i => i.ym === selectedMonth && matchOwner(i))
    .reduce((s, i) => s + Fin.toILS(i.amount, i.currency, i.ym), 0);

  const monthExpensesRaw = window.FinanceData.EXPENSES
    .filter(e => e.ym === selectedMonth && matchOwner(e));

  let monthExpenseTotal = 0, monthInvestmentTotal = 0;
  monthExpensesRaw.forEach(e => {
    const v = Fin.toILS(e.amount, e.currency, e.ym);
    if (Fin.isInvestment(e)) monthInvestmentTotal += v; else monthExpenseTotal += v;
  });

  const monthCats: Record<string, number> = {};
  monthExpensesRaw.forEach(e => {
    const k = e.category || 'uncategorized';
    monthCats[k] = (monthCats[k] || 0) + Fin.toILS(e.amount, e.currency, e.ym);
  });
  const monthTreemapItems = Object.entries(monthCats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      label: Fin.PRETTY_CAT[k] || k, value: v,
      color: Fin.CATEGORY_COLOR[k] || 'var(--rule)',
      icon: CAT_ICON[k],
    }));

  const monthTopSpend = monthExpensesRaw
    .slice()
    .sort((a, b) => Fin.toILS(b.amount, b.currency, b.ym) - Fin.toILS(a.amount, a.currency, a.ym))
    .slice(0, 5);

  const monthSortedExpenses = monthExpensesRaw
    .slice()
    .sort((a, b) => {
      const sign = expSort.dir === 'asc' ? 1 : -1;
      if (expSort.col === 'date') return sign * a.date.localeCompare(b.date);
      if (expSort.col === 'created_at') return sign * (a.created_at || '').localeCompare(b.created_at || '');
      return sign * (Fin.toILS(a.amount, a.currency, a.ym) - Fin.toILS(b.amount, b.currency, b.ym));
    });

  const sortArrow = (col: string) => expSort.col === col ? (expSort.dir === 'asc' ? ' ↑' : ' ↓') : null;
  const toggleSort = (col: string) => setExpSort(s =>
    s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }
  );

  const monthMystery = monthExpensesRaw.filter(e => !e.category);

  const catTx = openCat
    ? monthExpensesRaw
        .filter(e => e.category === openCat)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  const monthNet = monthIncome - monthExpenseTotal - monthInvestmentTotal;

  return (
    <div className="tab tab-cashflow">
      {/* ── OVERALL TOOLBAR ─────────────────────────────────────────────── */}
      <div className="row-toolbar sticky-toolbar">
        <div className="seg">
          {[6,12,24].map(n => (
            <button key={n} className={windowMonths === n ? 'on' : ''} onClick={() => setWindowMonths(n)}>{n}m</button>
          ))}
        </div>
        <div className="seg">
          {['all','Alon','Amit'].map(o => (
            <button key={o} className={ownerFilter === o ? 'on' : ''} onClick={() => setOwnerFilter(o)}>{o === 'all' ? 'All' : o}</button>
          ))}
        </div>
        <label className="toggle-mini" title="Include investment transfers (e.g. → IBKR) as a stacked segment on the expense bar">
          <input type="checkbox" checked={showSavings} onChange={e => setShowSavings(e.target.checked)}/>
          <span>Show savings</span>
        </label>
        <span className="toolbar-spacer"></span>
        <span className="total-pill">In <span className="private">{Fin.fmtILS(ie.reduce((s,x)=>s+x.income,0), { compact: true })}</span> · Out <span className="private">{Fin.fmtILS(ie.reduce((s,x)=>s + x.expense + (x.investment||0), 0), { compact: true })}</span></span>
      </div>

      {/* ── OVERALL: TRENDS ─────────────────────────────────────────────── */}
      <section className="panel" data-section="trends">
        <header className="panel-h"><h3>Income vs Expense</h3><span className="panel-sub">click a month to drill down</span></header>
        <PairedBars data={ie} height={280} onBarClick={setSelectedMonth} activeYm={selectedMonth}/>
        <div className="legend-row">
          <span><span className="sw" style={{ background: 'oklch(58% 0.08 140)' }}></span>Income</span>
          <span><span className="sw" style={{ background: 'oklch(58% 0.09 30)' }}></span>Expense</span>
          {showSavings && (
            <span><span className="sw" style={{ background: Fin.INVESTMENT_COLOR }}></span>Savings</span>
          )}
          <span><span className="sw" style={{ background: 'var(--ink)', height: 2, width: 14, marginRight: 6 } as React.CSSProperties}></span>Net</span>
        </div>
      </section>

      <section className="panel">
        <header className="panel-h"><h3>Expenses by category</h3><span className="panel-sub">stacked monthly · hover a band to isolate</span></header>
        <StackedBar data={expStacked} keys={allExpKeys} colors={Fin.CATEGORY_COLOR} height={260}
          labelFor={(k: string) => Fin.PRETTY_CAT[k] || k}/>
        <ul className="legend cat-legend">
          {allExpKeys.map(c => (
            <li key={c} className="clickable" onClick={() => setOpenCat(c)}>
              <span className="sw" style={{ background: Fin.CATEGORY_COLOR[c] }}></span>
              <Icon name={CAT_ICON[c]} size={12}/>
              <span className="lk">{Fin.PRETTY_CAT[c] || c}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── MONTH DETAIL ────────────────────────────────────────────────── */}
      <div className="month-picker" data-section="month">
        <button className="month-picker-arrow" disabled={!hasPrev}
          onClick={() => hasPrev && setSelectedMonth(Fin.ALL_MONTHS[monthIdx - 1])}>
          ‹
        </button>
        <span className="month-picker-label">{Fin.fmtMonth(selectedMonth)}</span>
        <button className="month-picker-arrow" disabled={!hasNext}
          onClick={() => hasNext && setSelectedMonth(Fin.ALL_MONTHS[monthIdx + 1])}>
          ›
        </button>
      </div>

      <div className="month-summary">
        <div className="month-summary-item">
          <span className="month-summary-label">Income</span>
          <span className="month-summary-value private pos">{Fin.fmtILS(monthIncome, { compact: true })}</span>
        </div>
        <div className="month-summary-item">
          <span className="month-summary-label">Expenses</span>
          <span className="month-summary-value private neg">{Fin.fmtILS(monthExpenseTotal, { compact: true })}</span>
        </div>
        {monthInvestmentTotal > 0 && (
          <div className="month-summary-item">
            <span className="month-summary-label">Savings</span>
            <span className="month-summary-value private">{Fin.fmtILS(monthInvestmentTotal, { compact: true })}</span>
          </div>
        )}
        <div className="month-summary-item">
          <span className="month-summary-label">Net</span>
          <span className={`month-summary-value private ${monthNet >= 0 ? 'pos' : 'neg'}`}>{Fin.fmtSigned(monthNet, n => Fin.fmtILS(n, { compact: true }))}</span>
        </div>
      </div>

      {monthTreemapItems.length > 0 && (
        <section className="panel">
          <header className="panel-h"><h3>Categories</h3><span className="panel-sub">{Fin.fmtMonth(selectedMonth)}</span></header>
          <Treemap items={monthTreemapItems} height={280}/>
        </section>
      )}

      {monthTopSpend.length > 0 && (
        <section className="panel">
          <header className="panel-h"><h3>Top spendings</h3><span className="panel-sub">{Fin.fmtMonth(selectedMonth)}</span></header>
          <table className="data-tbl compact">
            <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Owner</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {monthTopSpend.map(e => (
                <tr key={e.id}>
                  <td className="mono">{e.date}</td>
                  <td>{e.merchant}</td>
                  <td>
                    <span className="cat-pill" style={{ '--c': Fin.CATEGORY_COLOR[e.category || 'uncategorized'] } as React.CSSProperties}>
                      <Icon name={CAT_ICON[e.category || 'uncategorized']} size={11}/>
                      {Fin.PRETTY_CAT[e.category ?? ''] || e.category || '—'}
                    </span>
                  </td>
                  <td>{e.owner}</td>
                  <td className="r mono private">{Fin.fmtILS(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <header className="panel-h"><h3>Expenses</h3><span className="panel-sub">{monthSortedExpenses.length} transactions · {Fin.fmtMonth(selectedMonth)}</span></header>
        <div style={{ overflowX: 'auto' }}>
        <table className="data-tbl compact">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Owner</th>
              <th className="r sortable" onClick={() => toggleSort('amount')}>Charge ₪{sortArrow('amount')}</th>
              <th className="r">Purchase</th>
              <th>Ref</th>
              <th className="sortable" onClick={() => toggleSort('created_at')}>Added{sortArrow('created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {monthSortedExpenses.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px' }}>No expenses in {Fin.fmtMonth(selectedMonth)}</td></tr>
            )}
            {monthSortedExpenses.map(e => (
              <tr key={e.id}>
                <td className="mono">{e.date}</td>
                <td>{e.merchant}</td>
                <td>
                  <span className="cat-pill" style={{ '--c': Fin.CATEGORY_COLOR[e.category || 'uncategorized'] } as React.CSSProperties}>
                    <Icon name={CAT_ICON[e.category || 'uncategorized']} size={11}/>
                    {Fin.PRETTY_CAT[e.category ?? ''] || e.category || '—'}
                  </span>
                </td>
                <td>{e.owner}</td>
                <td className="r mono private">{Fin.fmtILS(e.amount)}</td>
                <td className="r mono private">{e.purchase_currency !== 'ILS' ? `${e.purchase_amount} ${e.purchase_currency}` : ''}</td>
                <td className="mono dim">{e.external_ref_id || ''}</td>
                <td className="mono dim">{e.created_at ? e.created_at.slice(0, 10) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {monthMystery.length > 0 && (
        <section className="panel mystery">
          <header className="panel-h"><h3>⚠ Uncategorized</h3><span className="panel-sub">{monthMystery.length} rows · <span className="private">{Fin.fmtILS(monthMystery.reduce((s,e)=>s+Fin.toILS(e.amount,e.currency,e.ym),0))}</span></span></header>
          <table className="data-tbl compact">
            <thead><tr><th>Date</th><th>Merchant</th><th>Owner</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {monthMystery.slice(0, 8).map(e => (
                <tr key={e.id}>
                  <td className="mono">{e.date}</td>
                  <td>{e.merchant}</td>
                  <td>{e.owner}</td>
                  <td className="r mono private">{Fin.fmtILS(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {openCat && (
        <div className="modal" onClick={() => setOpenCat(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <header className="panel-h">
              <h3><Icon name={CAT_ICON[openCat]} size={14}/> {Fin.PRETTY_CAT[openCat]} — {Fin.fmtMonth(selectedMonth)}</h3>
              <button className="back" onClick={() => setOpenCat(null)}>×</button>
            </header>
            <table className="data-tbl compact">
              <thead><tr><th>Date</th><th>Merchant</th><th>Owner</th><th>Account</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {catTx.slice(0, 50).map(e => (
                  <tr key={e.id}>
                    <td className="mono">{e.date}</td>
                    <td>{e.merchant}</td>
                    <td>{e.owner}</td>
                    <td>{Fin.accountById(e.account)?.name || '—'}</td>
                    <td className="r mono private">{Fin.fmtILS(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {catTx.length > 50 && <div className="modal-foot">+ {catTx.length - 50} more</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export { CashflowTab, CASHFLOW_SECTIONS };
