// Tab: Cashflow
const { useState: useStateCf } = React;

const CF_SAVINGS_LS = 'ledger_cashflow_show_savings';

function CashflowTab() {
  const [windowMonths, setWindowMonths] = useStateCf(12);
  const [openCat, setOpenCat] = useStateCf(null);
  const [ownerFilter, setOwnerFilter] = useStateCf('all');
  const [showSavings, setShowSavingsState] = useStateCf(() => {
    try { return localStorage.getItem(CF_SAVINGS_LS) !== 'false'; }
    catch (_) { return true; }
  });
  const setShowSavings = (v) => {
    setShowSavingsState(v);
    try { localStorage.setItem(CF_SAVINGS_LS, String(v)); } catch (_) {}
  };

  const months = Fin.ALL_MONTHS.slice(-windowMonths);
  const matchOwner = (rec) => ownerFilter === 'all' || rec.owner === ownerFilter;

  // Income vs expense per month. Investment categories (e.g. savings_transfer)
  // are split out so the IvE chart can either hide them (showSavings off) or
  // stack them as a blue segment on top of the expense bar (showSavings on).
  // The net line in PairedBars considers the total outflow shown in the bar.
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

  // Stacked expenses by category (with hover details)
  const expCats = window.FinanceData.CATEGORIES;
  const expStacked = months.map(ym => {
    const row = { ym };
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

  // last 3 months — categories treemap (squarified, area ∝ amount)
  const last3 = Fin.ALL_MONTHS.slice(-3);
  const cat3 = {};
  window.FinanceData.EXPENSES
    .filter(e => last3.includes(e.ym) && matchOwner(e))
    .forEach(e => {
      const k = e.category || 'uncategorized';
      cat3[k] = (cat3[k] || 0) + Fin.toILS(e.amount, e.currency, e.ym);
    });
  const treemapItems = Object.entries(cat3)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      label: Fin.PRETTY_CAT[k] || k, value: v,
      color: Fin.CATEGORY_COLOR[k] || 'var(--rule)',
      icon: CAT_ICON[k],
    }));

  // Top single spendings (largest individual transactions)
  const topSpend = window.FinanceData.EXPENSES
    .filter(e => months.includes(e.ym) && matchOwner(e))
    .sort((a, b) => Fin.toILS(b.amount, b.currency, b.ym) - Fin.toILS(a.amount, a.currency, a.ym))
    .slice(0, 12);

  // mystery
  const mystery = window.FinanceData.EXPENSES.filter(e => !e.category && months.includes(e.ym) && matchOwner(e));

  // category drill-down
  const catTx = openCat
    ? window.FinanceData.EXPENSES
        .filter(e => (e.category === openCat) && months.includes(e.ym) && matchOwner(e))
        .sort((a,b) => b.date.localeCompare(a.date))
    : [];

  return (
    <div className="tab tab-cashflow">
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

      <section className="panel">
        <header className="panel-h"><h3>Income vs Expense</h3><span className="panel-sub">net cashflow line overlay</span></header>
        <PairedBars data={ie} height={280}/>
        <div className="legend-row">
          <span><span className="sw" style={{ background: 'oklch(58% 0.08 140)' }}></span>Income</span>
          <span><span className="sw" style={{ background: 'oklch(58% 0.09 30)' }}></span>Expense</span>
          {showSavings && (
            <span><span className="sw" style={{ background: Fin.INVESTMENT_COLOR }}></span>Savings</span>
          )}
          <span><span className="sw" style={{ background: 'var(--ink)', height: 2, width: 14, marginRight: 6 }}></span>Net</span>
        </div>
      </section>

      <section className="panel">
        <header className="panel-h"><h3>Expenses by category</h3><span className="panel-sub">stacked monthly · hover a band to isolate</span></header>
        <StackedBar data={expStacked} keys={allExpKeys} colors={Fin.CATEGORY_COLOR} height={260}
          labelFor={(k) => Fin.PRETTY_CAT[k] || k}/>
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

      <section className="panel">
        <header className="panel-h"><h3>Last 3 months — categories</h3><span className="panel-sub">{Fin.fmtMonth(last3[0])} → {Fin.fmtMonth(last3[2])}</span></header>
        <Treemap items={treemapItems} height={320}/>
      </section>

      <section className="panel">
        <header className="panel-h"><h3>Top spendings</h3><span className="panel-sub">single largest transactions · {windowMonths}m</span></header>
        <table className="data-tbl compact">
          <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Owner</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {topSpend.map(e => (
              <tr key={e.id}>
                <td className="mono">{e.date}</td>
                <td>{e.merchant}</td>
                <td>
                  <span className="cat-pill" style={{ '--c': Fin.CATEGORY_COLOR[e.category || 'uncategorized'] }}>
                    <Icon name={CAT_ICON[e.category || 'uncategorized']} size={11}/>
                    {Fin.PRETTY_CAT[e.category] || e.category || '—'}
                  </span>
                </td>
                <td>{e.owner}</td>
                <td className="r mono private">{Fin.fmtILS(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {mystery.length > 0 && (
        <section className="panel mystery">
          <header className="panel-h"><h3>⚠ Uncategorized</h3><span className="panel-sub">{mystery.length} rows · <span className="private">{Fin.fmtILS(mystery.reduce((s,e)=>s+Fin.toILS(e.amount,e.currency,e.ym),0))}</span></span></header>
          <table className="data-tbl compact">
            <thead><tr><th>Date</th><th>Merchant</th><th>Owner</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {mystery.slice(0, 8).map(e => (
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
              <h3><Icon name={CAT_ICON[openCat]} size={14}/> {Fin.PRETTY_CAT[openCat]}</h3>
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

window.CashflowTab = CashflowTab;
