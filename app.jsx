// Main app — shell, header, FX strip, tabs.
const { useState, useEffect, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "density": "regular",
  "primaryCurrency": "ILS",
  "accent": "ochre",
  "groupDetails": false,
  "privacy": false
}/*EDITMODE-END*/;

const ACCENT_PALETTES = {
  ochre:     { accent: 'oklch(62% 0.13 65)', accent2: 'oklch(72% 0.10 80)' },
  terracotta:{ accent: 'oklch(58% 0.13 35)', accent2: 'oklch(68% 0.10 50)' },
  ink:       { accent: 'oklch(45% 0.10 250)', accent2: 'oklch(60% 0.08 230)' },
  moss:      { accent: 'oklch(54% 0.10 140)', accent2: 'oklch(66% 0.08 130)' },
};

function FxStrip({ rate, manualOpen, setManualOpen, manualRate, setManualRate }) {
  return (
    <div className={`fx-strip ${manualOpen ? 'open' : ''}`}>
      <button className="fx-summary" onClick={() => setManualOpen(!manualOpen)}>
        <span className="fx-mono">USD/ILS today</span>
        <strong className="fx-rate">{rate.toFixed(4)}</strong>
        <span className="fx-meta">manual · set {window.FinanceData.FX.setOn}</span>
        <span className="fx-caret">{manualOpen ? '▾' : '▸'}</span>
      </button>
      {manualOpen && (
        <div className="fx-detail">
          <div className="fx-note">
            Snapshot &amp; income rows in foreign currency are converted using the FX rate of <em>that day</em>; today's "as-of-now" displays use the rate above.
          </div>
          <table className="fx-tbl">
            <thead><tr><th>Month</th><th className="r">USD/ILS</th></tr></thead>
            <tbody>
              {Object.entries(window.FinanceData.FX.byMonth).slice(-6).map(([ym, r]) => (
                <tr key={ym}><td>{Fin.fmtMonth(ym)}</td><td className="r mono">{r.toFixed(4)}</td></tr>
              ))}
            </tbody>
          </table>
          <label className="fx-override">
            <span>Override today's rate:</span>
            <input type="number" step="0.0001" value={manualRate} onChange={e => setManualRate(parseFloat(e.target.value) || 0)}/>
          </label>
        </div>
      )}
    </div>
  );
}

const TAB_IDS = ['overview', 'accounts', 'cashflow', 'passive'];

function tabFromUrl() {
  const seg = location.pathname.replace(/^\/+|\/+$/g, '');
  return TAB_IDS.includes(seg) ? seg : 'overview';
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab] = useState(tabFromUrl);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRate, setManualRate] = useState(window.FinanceData.FX.current);

  // apply manual rate
  useEffect(() => { window.FinanceData.FX.current = manualRate; }, [manualRate]);

  // persist tab in path
  useEffect(() => {
    const want = tab === 'overview' ? '/' : `/${tab}`;
    if (location.pathname !== want) {
      history.pushState({ tab }, '', want);
    }
  }, [tab]);

  // back/forward navigation
  useEffect(() => {
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-density', t.density);
    document.documentElement.setAttribute('data-privacy', t.privacy ? 'on' : 'off');
    const palette = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES.ochre;
    document.documentElement.style.setProperty('--accent', palette.accent);
    document.documentElement.style.setProperty('--accent-2', palette.accent2);
  }, [t.dark, t.density, t.privacy, t.accent]);

  const tabs = [
    { id: 'overview',  label: 'Overview' },
    { id: 'accounts',  label: 'Accounts' },
    { id: 'cashflow',  label: 'Cashflow' },
    { id: 'passive',   label: 'Passive Income' },
  ];

  return (
    <div className="app">
      <header className="app-h">
        <div className="brand">
          <span className="brand-mark">◐</span>
          <span className="brand-name">Ledger</span>
          <span className="brand-sub">Alon &amp; Amit · personal finance</span>
        </div>
        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={() => setTweak('dark', !t.dark)}
            aria-label={t.dark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={t.dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Icon name={t.dark ? 'sun' : 'moon'} size={16}/>
          </button>
          <FxStrip rate={manualRate} manualOpen={manualOpen} setManualOpen={setManualOpen} manualRate={manualRate} setManualRate={setManualRate}/>
        </div>
        <nav className="app-nav">
          {tabs.map(tt => (
            <button key={tt.id} data-screen-label={tt.label} className={tab === tt.id ? 'on' : ''} onClick={() => setTab(tt.id)}>{tt.label}</button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === 'overview' && <OverviewTab/>}
        {tab === 'accounts' && <AccountsTab primaryCurrency={t.primaryCurrency}/>}
        {tab === 'cashflow' && <CashflowTab/>}
        {tab === 'passive' && <PassiveTab/>}
      </main>

      <TweaksPanel>
        <TweakSection label="Theme"/>
        <TweakToggle label="Dark mode" value={t.dark} onChange={v => setTweak('dark', v)}/>
        <TweakRadio label="Density" value={t.density} options={['compact','regular']} onChange={v => setTweak('density', v)}/>
        <TweakSelect label="Accent" value={t.accent} options={['ochre','terracotta','ink','moss']} onChange={v => setTweak('accent', v)}/>
        <TweakSection label="Display"/>
        <TweakRadio label="Currency primary" value={t.primaryCurrency} options={['ILS','USD','native']} onChange={v => setTweak('primaryCurrency', v)}/>
        <TweakToggle label="Pension detail groups" value={t.groupDetails} onChange={v => setTweak('groupDetails', v)}/>
        <TweakToggle label="Privacy mode (hide ₪)" value={t.privacy} onChange={v => setTweak('privacy', v)}/>
      </TweaksPanel>
    </div>
  );
}

function Bootstrap() {
  const [phase, setPhase] = useState('loading');   // loading | signin | fetching | ready | error
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const start = async () => {
    setError(null);
    try {
      if (window.DriveLoader.loadCachedToken()) {
        setPhase('fetching');
        await window.DriveLoader.fetchAndPopulate();
        setTick(x => x + 1); setPhase('ready');
      } else {
        setPhase('signin');
      }
    } catch (e) {
      setError(e.message || String(e)); setPhase('error');
    }
  };

  const handleSignIn = async () => {
    setError(null); setPhase('fetching');
    try {
      await window.DriveLoader.requestSignIn();
      await window.DriveLoader.fetchAndPopulate();
      setTick(x => x + 1); setPhase('ready');
    } catch (e) {
      setError(e.message || String(e)); setPhase('error');
    }
  };

  useEffect(() => { start(); }, []);

  if (phase === 'ready') {
    return <App key={tick}/>;
  }

  return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="boot-mark">◐</div>
        <div className="boot-title">Ledger</div>
        <div className="boot-sub">Personal finance · live from Google Drive</div>

        {phase === 'loading' && <div className="boot-status">Loading…</div>}

        {phase === 'fetching' && (
          <div className="boot-status">
            <div className="boot-spinner"/>
            <div>Fetching CSVs from Drive…</div>
          </div>
        )}

        {phase === 'signin' && (
          <>
            <button className="boot-btn" onClick={handleSignIn}>Sign in with Google</button>
            <div className="boot-note">
              Read-only access to your Drive folder.<br/>
              Tokens stay in your browser; nothing is sent anywhere else.
            </div>
            <button className="boot-btn boot-btn-ghost" onClick={async () => {
              setError(null); setPhase('fetching');
              try {
                await window.DriveLoader.loadDemoData();
                setTick(x => x + 1); setPhase('ready');
              } catch (e) {
                setError(e.message || String(e)); setPhase('error');
              }
            }}>Load demo data</button>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="boot-error">⚠ {error}</div>
            <button className="boot-btn" onClick={start}>Retry</button>
            <button className="boot-btn boot-btn-ghost" onClick={() => { window.DriveLoader.signOut(); start(); }}>Sign out & retry</button>
          </>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Bootstrap/>);
