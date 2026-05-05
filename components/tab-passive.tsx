import React, { useState as useStatePi, useMemo as useMemoPi } from 'react';
import { Fin } from '../data/helpers.ts';
import { Icon, ACC_TYPE_ICON } from './icons.tsx';
import { StackedBar } from './charts.tsx';
// Tab: Passive Income

function PassiveTab({ section }: { section?: string | null }) {
  const [windowMonths, setWindowMonths] = useStatePi(12);
  const months = Fin.ALL_MONTHS.slice(-windowMonths);

  const passiveTypes = ['dividend','interest','capital_gain_realized','employer_pension_contribution','employer_study_fund_contribution'];

  const stacked = months.map(ym => {
    const row: Record<string, any> = { ym };
    const all = Fin.incomeByTypeMonth(ym);
    passiveTypes.forEach(t => row[t] = all[t] || 0);
    return row;
  });

  const total12 = months.reduce((s, ym) => s + Fin.passiveInMonth(ym), 0);
  const liquidTypes = ['dividend','interest','capital_gain_realized'];
  const lockedTypes = ['employer_pension_contribution','employer_study_fund_contribution'];
  const liquid = months.reduce((s, ym) => s + Fin.passiveInMonth(ym, liquidTypes), 0);
  const locked = months.reduce((s, ym) => s + Fin.passiveInMonth(ym, lockedTypes), 0);

  // Per-account yield
  const perAccount = Fin.passivePerAccount(months);
  const accountYields = window.FinanceData.ACCOUNTS
    .filter(a => perAccount[a.id] > 0)
    .map(a => {
      const earned = perAccount[a.id];
      const avgBal = Fin.avgBalance(a.id, months);
      const periodYears = months.length / 12;
      const apy = avgBal > 0 ? (earned / avgBal) / periodYears : 0;
      return { acc: a, earned, avgBal, apy };
    })
    .sort((a, b) => b.earned - a.earned);

  // Benchmark — SPY ~10% historical
  const benchmark = 0.10;
  const swr = 0.04;

  // Net liquid available — sum of cash + brokerage avg balance
  const liquidAccs = window.FinanceData.ACCOUNTS.filter(a =>
    ['checking','savings','money_market','brokerage'].includes(a.type)
  );
  const liquidAvgBal = liquidAccs.reduce((s, a) => s + Fin.avgBalance(a.id, months), 0);
  const blendedYield = liquidAvgBal > 0 ? (liquid / liquidAvgBal) / (months.length/12) : 0;

  return (
    <div className="tab tab-passive">
      <div className="row-toolbar">
        <div className="seg">
          {[6,12,24].map(n => (
            <button key={n} className={windowMonths === n ? 'on' : ''} onClick={() => setWindowMonths(n)}>{n}m</button>
          ))}
        </div>
      </div>

      <section className="panel hero-panel compact">
        <div className="hero-num">
          <div className="hero-label">Passive income · last {windowMonths} months</div>
          <div className="hero-value private">{Fin.fmtILS(total12)}</div>
          <div className="hero-sub">avg <span className="private">{Fin.fmtILS(total12/windowMonths, { compact: true })}</span> / month</div>
        </div>
        <div className="hero-split">
          <div className="hsplit">
            <div className="hsplit-label"><Icon name="coin" size={13}/> Liquid</div>
            <div className="hsplit-val private">{Fin.fmtILS(liquid, { compact: true })}</div>
            <div className="hsplit-sub">dividends · interest · gains</div>
          </div>
          <div className="hsplit">
            <div className="hsplit-label"><Icon name="lock" size={13}/> Locked</div>
            <div className="hsplit-val private">{Fin.fmtILS(locked, { compact: true })}</div>
            <div className="hsplit-sub">pension · study fund</div>
          </div>
          <div className="hsplit">
            <div className="hsplit-label"><Icon name="bolt" size={13}/> Blended yield</div>
            <div className="hsplit-val private">{Fin.fmtPct(blendedYield, 2)}</div>
            <div className="hsplit-sub">on liquid avg bal.</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-h"><h3>Passive income — composition</h3><span className="panel-sub">stacked monthly</span></header>
        <StackedBar data={stacked} keys={passiveTypes} colors={Fin.INCOME_TYPE_COLOR} height={260}/>
        <ul className="legend">
          {passiveTypes.map(t => (
            <li key={t}>
              <span className="sw" style={{ background: Fin.INCOME_TYPE_COLOR[t] }}></span>
              <span className="lk">{Fin.PRETTY_TYPE[t]}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="split-2">
        <section className="panel">
          <header className="panel-h"><h3>Per-account yield</h3><span className="panel-sub">annualized</span></header>
          <table className="data-tbl">
            <thead>
              <tr><th>Account</th><th className="r">Avg bal</th><th className="r">Earned</th><th className="r">APY</th></tr>
            </thead>
            <tbody>
              {accountYields.map(({ acc, earned, avgBal, apy }) => (
                <tr key={acc.id}>
                  <td><span className="acc-icon-inline"><Icon name={ACC_TYPE_ICON[acc.type]} size={13}/></span> {acc.name} <span className="acc-meta-inline">{acc.owner}</span></td>
                  <td className="r mono private">{Fin.fmtILS(avgBal, { compact: true })}</td>
                  <td className="r mono private">{Fin.fmtILS(earned, { compact: true })}</td>
                  <td className="r mono apy private">
                    <span className="apy-bar"><span style={{ width: `${Math.min(100, apy*100*4)}%`, background: apy > 0.07 ? 'oklch(58% 0.08 140)' : apy > 0.04 ? 'oklch(68% 0.09 80)' : 'oklch(58% 0.09 30)' }}></span></span>
                    <span>{Fin.fmtPct(apy, 1)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <header className="panel-h"><h3>Benchmark comparison</h3><span className="panel-sub">your blended yield vs reference</span></header>
          <div className="benchmarks">
            <div className="bench-row">
              <div className="bench-label">Your liquid yield <span className="muted">(cash + IBKR + MM)</span></div>
              <div className="bench-bar"><span style={{ width: `${(blendedYield/0.12)*100}%`, background: 'var(--accent)' }}></span></div>
              <div className="bench-val private">{Fin.fmtPct(blendedYield, 2)}</div>
            </div>
            <div className="bench-row">
              <div className="bench-label">SPY (S&amp;P 500) — 10y avg <span className="muted">reference</span></div>
              <div className="bench-bar"><span style={{ width: `${(benchmark/0.12)*100}%`, background: 'oklch(58% 0.06 230)' }}></span></div>
              <div className="bench-val">{Fin.fmtPct(benchmark, 2)}</div>
            </div>
            <div className="bench-row">
              <div className="bench-label">4% safe withdrawal <span className="muted">(Trinity)</span></div>
              <div className="bench-bar"><span style={{ width: `${(swr/0.12)*100}%`, background: 'oklch(60% 0.06 130)' }}></span></div>
              <div className="bench-val">{Fin.fmtPct(swr, 2)}</div>
            </div>
          </div>
          <div className="bench-note">
            At your current liquid yield, <span className="private">₪{(liquidAvgBal).toLocaleString('en-IL', { maximumFractionDigits: 0 })}</span> of liquid avg balance generates ~<span className="private">{Fin.fmtILS(liquidAvgBal*blendedYield, { compact: true })}</span>/yr.
            To match a 4% SWR baseline you'd need ~<span className="private">{Fin.fmtILS((total12/swr), { compact: true })}</span> invested.
          </div>
        </section>
      </div>
    </div>
  );
}

export { PassiveTab };
