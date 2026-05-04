// Tab: Overview
const { useState: useStateOv } = React;

function KPICard({ label, value, sub, trend }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value private">{value}</div>
      {sub && <div className={`kpi-sub ${trend || ''}`}>{sub}</div>}
    </div>
  );
}

function NetWorthChart({ ownerFilter }) {
  const [range, setRange] = useStateOv('1Y');
  const accFilter = ownerFilter === 'both' ? () => true : (a) => a.owner === ownerFilter;
  const accs = window.FinanceData.ACCOUNTS.filter(accFilter);
  const series = Fin.netWorthSeries(Fin.ALL_MONTHS, accFilter);
  // also produce per-account ILS contribution for hover breakdown
  const breakdown = series.map(s => {
    const parts = accs
      .map(a => ({ acc: a, value: Fin.balanceILS(a.id, s.ym) }))
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);
    return { ym: s.ym, value: s.value, parts };
  });
  const sliced = Fin.sliceByRange(breakdown, range);
  return (
    <>
      <div className="chart-controls">
        <TimeRangeFilter value={range} onChange={setRange}/>
      </div>
      <LineChart
        data={sliced}
        height={260}
        formatY={(v) => Fin.fmtILS(v, { compact: true })}
        tooltipExtra={(d) => (
          <div className="tt-breakdown">
            {d.parts.slice(0, 6).map(p => (
              <div key={p.acc.id} className="tt-row">
                <Icon name={ACC_TYPE_ICON[p.acc.type]} size={11}/>
                <span className="tt-key">{p.acc.name} <span className="muted">{p.acc.owner}</span></span>
                <span className="tt-val private">{Fin.fmtILS(p.value, { compact: true })}</span>
              </div>
            ))}
            {d.parts.length > 6 && <div className="tt-row muted">+ {d.parts.length - 6} more</div>}
          </div>
        )}
      />
    </>
  );
}

function DonutCard({ title, entries, centerLabel, centerValue }) {
  const [hover, setHover] = useStateOv(null);
  const total = entries.reduce((s, e) => s + e.value, 0);
  const active = hover != null ? entries[hover] : null;
  return (
    <section className="panel square">
      <header className="panel-h"><h3>{title}</h3></header>
      <Donut
        entries={entries} size={180}
        centerLabel={active ? active.label : centerLabel}
        centerValue={active ? `${Fin.fmtILS(active.value, { compact: true })} · ${((active.value/total)*100).toFixed(0)}%` : centerValue}
        hover={hover} onHover={setHover}
      />
      <ul className="legend">
        {entries.map((e, i) => (
          <li key={e.label}
            className={hover === i ? 'on' : hover != null ? 'off' : ''}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}>
            <span className="sw" style={{ background: e.color }}></span>
            <span className="lk">{e.label}</span>
            <span className="lv private">{Fin.fmtILS(e.value, { compact: true })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OverviewTab() {
  const [ownerFilter, setOwnerFilter] = useStateOv('both');
  const accFilter = ownerFilter === 'both' ? () => true : (a) => a.owner === ownerFilter;

  const nw = Fin.netWorthAt(Fin.LATEST, accFilter);
  const nwPrev = Fin.netWorthAt(Fin.ALL_MONTHS[Fin.ALL_MONTHS.length - 2], accFilter);
  const delta = nw - nwPrev;

  // Avg monthly (for cashflow side, not filtered by owner — household)
  const inc12 = Fin.last12.reduce((s, ym) => s + Fin.incomeInMonth(ym), 0);
  const exp12 = Fin.last12.reduce((s, ym) => s + Fin.expenseInMonth(ym), 0);
  const avgInc = inc12 / 12, avgExp = exp12 / 12;

  const groups = Fin.groupedAssets(Fin.LATEST, accFilter);
  const groupEntries = Object.entries(groups).filter(([, v]) => v > 0).map(([k, v]) => ({
    label: k, value: v, color: Fin.GROUP_COLOR[k],
  }));

  const owners = Fin.byOwner(Fin.LATEST);
  const ownerEntries = [
    { label: 'Alon', value: owners.Alon, color: 'oklch(50% 0.08 250)' },
    { label: 'Amit', value: owners.Amit, color: 'oklch(64% 0.08 130)' },
  ];

  const activity = Fin.recentActivity(10);

  return (
    <div className="tab tab-overview">
      <div className="row-toolbar sticky-toolbar">
        <div className="seg">
          {['both','Alon','Amit'].map(o => (
            <button key={o} className={ownerFilter === o ? 'on' : ''} onClick={() => setOwnerFilter(o)}>{o === 'both' ? 'Joint' : o}</button>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        <KPICard label="Net worth" value={Fin.fmtILS(nw)} sub={<><span className="private">{Fin.fmtSigned(delta)}</span> MoM</>} trend={delta >= 0 ? 'up' : 'down'}/>
        <KPICard label="Δ MoM" value={Fin.fmtSigned(delta, (v) => Fin.fmtILS(v, { compact: true }))} sub={<><span className="private">{((delta/nwPrev)*100).toFixed(2)}%</span> change</>} trend={delta >= 0 ? 'up' : 'down'}/>
        <KPICard label="Avg monthly income" value={Fin.fmtILS(avgInc, { compact: true })} sub={`12-mo trailing`}/>
        <KPICard label="Avg monthly spend" value={Fin.fmtILS(avgExp, { compact: true })} sub={<>net <span className="private">{Fin.fmtSigned(avgInc - avgExp, (v) => Fin.fmtILS(v, { compact: true }))}</span> / mo</>} trend={(avgInc - avgExp) >= 0 ? 'up' : 'down'}/>
      </div>

      <section className="panel">
        <header className="panel-h">
          <h3>Net worth</h3>
          <span className="panel-sub">{Fin.fmtMonth(Fin.ALL_MONTHS[0])} → {Fin.fmtMonth(Fin.LATEST)}</span>
        </header>
        <NetWorthChart ownerFilter={ownerFilter}/>
      </section>

      <div className="split-2 squares">
        <DonutCard title="By owner" entries={ownerEntries}
          centerLabel="Joint" centerValue={Fin.fmtILS(owners.Alon + owners.Amit, { compact: true })}/>
        <DonutCard title="By asset class" entries={groupEntries}
          centerLabel="Total" centerValue={Fin.fmtILS(nw, { compact: true })}/>
      </div>

      <section className="panel">
        <header className="panel-h"><h3>Recent activity</h3><span className="panel-sub">last 10 events</span></header>
        <ul className="activity">
          {activity.map((e, i) => (
            <li key={i} className={`act ${e.kind}`}>
              <span className="act-date">{e.date.slice(5)}</span>
              <span className="act-icon">
                <Icon name={e.kind === 'income' ? 'arrowUp' : 'arrowDown'} size={12}/>
              </span>
              <span className="act-label">
                <span className="al-main">{e.label}</span>
                <span className="al-sub">{e.sub} · {e.owner}</span>
              </span>
              <span className={`act-amt private ${e.amount >= 0 ? 'pos' : 'neg'}`}>{Fin.fmtSigned(e.amount)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

window.OverviewTab = OverviewTab;
