import React, { useState as useStateAcc, useMemo as useMemoAcc } from 'react';
import { Fin } from '../data/helpers.ts';
import { ACCOUNTS as ACCS_ACC, TYPE_GROUP as TG_ACC, TYPE_ICON as TI_ACC } from '../data/data.ts';
import { Icon, ACC_TYPE_ICON } from './icons.tsx';
import { LineChart, Sparkline, TimeRangeFilter } from './charts.tsx';
import type { Account } from '../types.ts';
// Tab: Accounts & Net Worth

function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-${status}`} title={status}></span>;
}

function AccountRow({ acc, onOpen, primaryCurrency }: { acc: Account; onOpen: () => void; primaryCurrency: string }) {
  const native = window.FinanceData.SNAPSHOTS.find(s => s.accountId === acc.id && s.ym === Fin.LATEST)?.balance || 0;
  const ils = Fin.balanceILS(acc.id, Fin.LATEST);
  const series = Fin.accountSeries(acc.id).slice(-12).map(p => p.value);
  const lastUpdated = Fin.LATEST + '-01';
  const showUSDFirst = primaryCurrency === 'USD' && acc.currency === 'USD';
  return (
    <button className={`account-row status-${acc.status}`} onClick={onOpen}>
      <span className="acc-icon"><Icon name={ACC_TYPE_ICON[acc.type]} size={18} color="var(--ink-2)"/></span>
      <span className="acc-main">
        <span className="acc-name">{acc.name} <StatusDot status={acc.status}/></span>
        <span className="acc-meta">{acc.provider} · {acc.owner} · {acc.currency}</span>
      </span>
      <span className="acc-spark"><Sparkline values={series} w={120} h={28}/></span>
      <span className="acc-bal private">
        {showUSDFirst ? (
          <>
            <span className="acc-bal-primary">{Fin.fmtUSD(native)}</span>
            <span className="acc-bal-secondary">≈ {Fin.fmtILS(ils, { compact: true })}</span>
          </>
        ) : (
          <>
            <span className="acc-bal-primary">{Fin.fmtILS(ils)}</span>
            {acc.currency !== 'ILS' && <span className="acc-bal-secondary">{Fin.fmtUSD(native)} @ {window.FinanceData.FX.current}</span>}
          </>
        )}
        <span className="acc-updated">{lastUpdated}</span>
      </span>
    </button>
  );
}

function AccountDetail({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const [range, setRange] = useStateAcc('1Y');
  const series = Fin.accountSeries(acc.id);
  const sliced = Fin.sliceByRange(series, range);
  const idx = ACCS_ACC.findIndex(a => a.id === acc.id);
  const serial = idx >= 0 ? String(idx + 1).padStart(3, '0') : '—';
  return (
    <div className="acc-detail">
      <header className="acc-detail-h">
        <button className="back" onClick={onClose}>← Back</button>
        <div>
          <h2><Icon name={ACC_TYPE_ICON[acc.type]} size={22}/> {acc.name}</h2>
          <div className="acc-detail-sub">{acc.provider} · {acc.owner} · {acc.currency} · <StatusDot status={acc.status}/> {acc.status}</div>
          <div className="acc-detail-id"><span className="acc-id-label">#{serial}</span><span className="acc-id-slug">{acc.id}</span></div>
        </div>
      </header>
      <section className="panel">
        <header className="panel-h">
          <h3>Balance history</h3>
          <TimeRangeFilter value={range} onChange={setRange}/>
        </header>
        <LineChart data={sliced} height={280} formatY={(v: number) => Fin.fmtILS(v, { compact: true })}/>
      </section>
      <section className="panel">
        <header className="panel-h"><h3>Snapshots</h3><span className="panel-sub">monthly</span></header>
        <table className="data-tbl">
          <thead>
            <tr><th>Month</th><th className="r">Native</th><th className="r">ILS-eq</th><th className="r">FX rate</th><th className="r">Δ</th></tr>
          </thead>
          <tbody>
            {series.slice().reverse().map((s, i, arr) => {
              const next = arr[i + 1];
              const delta = next ? s.value - next.value : 0;
              return (
                <tr key={s.ym}>
                  <td>{Fin.fmtMonth(s.ym)}</td>
                  <td className="r mono private">{acc.currency === 'USD' ? Fin.fmtUSD(s.native) : Fin.fmtILS(s.native)}</td>
                  <td className="r mono private">{Fin.fmtILS(s.value)}</td>
                  <td className="r mono">{acc.currency === 'USD' ? window.FinanceData.FX.rateFor(s.ym).toFixed(4) : '—'}</td>
                  <td className={`r mono private ${delta >= 0 ? 'pos' : 'neg'}`}>{next ? Fin.fmtSigned(delta, (v: number) => Fin.fmtILS(v, { compact: true })) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

interface AccountsTabProps {
  primaryCurrency: string;
  openAccountId: string | null;
  onOpenAccount: (id: string) => void;
  onCloseAccount: () => void;
}

function AccountsTab({ primaryCurrency, openAccountId, onOpenAccount, onCloseAccount }: AccountsTabProps) {
  const [filterOwner, setFilterOwner] = useStateAcc('all');
  const [filterStatus, setFilterStatus] = useStateAcc('active');
  const [showDetails, setShowDetails] = useStateAcc(false);

  const openAcc = openAccountId ? ACCS_ACC.find(a => a.id === openAccountId) : null;
  if (openAcc) {
    return <AccountDetail acc={openAcc} onClose={onCloseAccount}/>;
  }

  const filtered = ACCS_ACC.filter(a =>
    (filterOwner === 'all' || a.owner === filterOwner) &&
    (filterStatus === 'all' || a.status === filterStatus)
  );

  // group rollups
  const groups: Record<string, Account[]> = {};
  filtered.forEach(a => {
    const g = showDetails
      ? (a.type === 'pension_comprehensive' ? 'Pension — Comprehensive'
         : a.type === 'pension_supplementary' ? 'Pension — Supplementary'
         : TG_ACC[a.type])
      : TG_ACC[a.type];
    if (!groups[g]) groups[g] = [];
    groups[g].push(a);
  });

  const totalNW = filtered.reduce((s, a) => s + Fin.balanceILS(a.id, Fin.LATEST), 0);

  return (
    <div className="tab tab-accounts">
      <div className="row-toolbar sticky-toolbar">
        <div className="seg">
          {['all','Alon','Amit'].map(o => (
            <button key={o} className={filterOwner === o ? 'on' : ''} onClick={() => setFilterOwner(o)}>{o === 'all' ? 'All' : o}</button>
          ))}
        </div>
        <div className="seg">
          {['active','inactive','closed','all'].map(s => (
            <button key={s} className={filterStatus === s ? 'on' : ''} onClick={() => setFilterStatus(s)}>{s}</button>
          ))}
        </div>
        <label className="toggle-mini">
          <input type="checkbox" checked={showDetails} onChange={e => setShowDetails(e.target.checked)}/>
          <span>Detail groups</span>
        </label>
        <span className="toolbar-spacer"></span>
        <span className="total-pill">Σ <span className="private">{Fin.fmtILS(totalNW)}</span></span>
      </div>

      {Object.entries(groups).map(([g, accs]) => {
        const gTotal = (accs as Account[]).reduce((s: number, a: Account) => s + Fin.balanceILS(a.id, Fin.LATEST), 0);
        return (
          <section key={g} className="panel acc-group">
            <header className="panel-h">
              <h3><span className="group-swatch" style={{ background: Fin.GROUP_COLOR[TG_ACC[(accs as Account[])[0].type]] || 'var(--rule)' }}></span>{g}</h3>
              <span className="panel-sub">{(accs as Account[]).length} account{(accs as Account[]).length>1?'s':''} · <span className="private">{Fin.fmtILS(gTotal)}</span> · <span className="private">{((gTotal/totalNW)*100).toFixed(0)}%</span></span>
            </header>
            <div className="acc-list">
              {(accs as Account[]).map((a: Account) => <AccountRow key={a.id} acc={a} primaryCurrency={primaryCurrency} onOpen={() => onOpenAccount(a.id)}/>)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export { AccountsTab };
