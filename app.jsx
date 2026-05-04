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

function FxStrip() {
  const [rate, setRate] = useState(window.FinanceData.FX.current);

  useEffect(() => {
    const get = (url, pick) => fetch(url).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(pick);
    get('https://api.frankfurter.app/latest?from=USD&to=ILS', d => d.rates && d.rates.ILS)
      .catch(() => get('https://open.er-api.com/v6/latest/USD', d => d.rates && d.rates.ILS))
      .then(r => { if (r) { setRate(r); window.FinanceData.FX.current = r; } })
      .catch(() => {});
  }, []);

  return (
    <div className="fx-strip">
      <span className="fx-pair">$/₪</span>
      <strong className="fx-rate">{rate.toFixed(2)}</strong>
    </div>
  );
}

const TAB_IDS = ['overview', 'accounts', 'cashflow', 'passive'];

function parseUrl() {
  const segs = location.pathname.split('/').filter(Boolean);
  const tab = TAB_IDS.includes(segs[0]) ? segs[0] : 'overview';
  const accountId = (tab === 'accounts' && segs[1]) ? decodeURIComponent(segs[1]) : null;
  return { tab, accountId };
}

function pathFor(tab, accountId) {
  if (tab === 'accounts' && accountId) return `/accounts/${encodeURIComponent(accountId)}`;
  if (tab === 'overview') return '/';
  return `/${tab}`;
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [{ tab, accountId }, setRoute] = useState(parseUrl);
  const goTab = (id) => setRoute({ tab: id, accountId: null });
  const openAccount = (id) => setRoute({ tab: 'accounts', accountId: id });
  const closeAccount = () => setRoute({ tab: 'accounts', accountId: null });

  // persist route in path
  useEffect(() => {
    const want = pathFor(tab, accountId);
    if (location.pathname !== want) {
      history.pushState({ tab, accountId }, '', want);
    }
  }, [tab, accountId]);

  // back/forward navigation
  useEffect(() => {
    const onPop = () => setRoute(parseUrl());
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
          <FxStrip/>
        </div>
        <nav className="app-nav">
          {tabs.map(tt => (
            <button key={tt.id} data-screen-label={tt.label} className={tab === tt.id ? 'on' : ''} onClick={() => goTab(tt.id)}>{tt.label}</button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === 'overview' && <OverviewTab/>}
        {tab === 'accounts' && <AccountsTab primaryCurrency={t.primaryCurrency} openAccountId={accountId} onOpenAccount={openAccount} onCloseAccount={closeAccount}/>}
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
    setError(null); setPhase('loading');
    try {
      // Initialize GIS before showing the signin button so the click
      // handler can call requestAccessToken synchronously and Chrome
      // doesn't classify the OAuth window as a programmatic popup.
      await window.DriveLoader.init();
      await window.DriveLoader.bootstrap();
      setTick(x => x + 1); setPhase('ready');
    } catch (e) {
      if (e.message === 'NEEDS_SIGNIN') {
        setPhase('signin');
      } else {
        setError(e.message || String(e)); setPhase('error');
      }
    }
  };

  const handleSignIn = async () => {
    setError(null); setPhase('fetching');
    try {
      await window.DriveLoader.requestSignIn();
      await window.DriveLoader.fetchAndPopulate();
      setTick(x => x + 1); setPhase('ready');
    } catch (e) {
      if (e.message === 'POPUP_BLOCKED') {
        setError('Pop-up blocked. Allow pop-ups for this site and try again, or use demo data.');
        setPhase('signin');
      } else if (e.message === 'POPUP_CLOSED') {
        setPhase('signin');
      } else {
        setError(e.message || String(e)); setPhase('error');
      }
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
            {error && <div className="boot-error">⚠ {error}</div>}
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
