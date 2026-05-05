import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './data/data.js';
import { Fin } from './data/helpers.js';
import './data/db-loader.js';
import demoSource from './data/data.example.js?raw';
window.__LEDGER_DEMO_SOURCE__ = demoSource;
import { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakRadio, TweakSelect } from './tweaks-panel.jsx';
import { Icon } from './components/icons.jsx';
import { OverviewTab } from './components/tab-overview.jsx';
import { AccountsTab } from './components/tab-accounts.jsx';
import { CashflowTab } from './components/tab-cashflow.jsx';
import { PassiveTab } from './components/tab-passive.jsx';
import { IntakeTab } from './components/tab-intake.jsx';
// Main app — shell, header, FX strip, tabs.

/* ── ErrorBoundary ────────────────────────────────────────────────────── */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠</div>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-message">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <pre className="error-boundary-stack">
              {this.state.error?.stack?.split('\n').slice(0, 4).join('\n')}
            </pre>
            <button className="boot-btn" onClick={this.handleReset}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
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

const TAB_IDS = ['overview', 'accounts', 'cashflow', 'passive', 'intake'];

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
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRate, setManualRate] = useState(window.FinanceData.FX.current);
  // Bumped after a successful Intake; keys the data-driven tabs so they
  // re-mount and re-derive from the freshly populated FinanceData.
  const [dataTick, setDataTick] = useState(0);

  const goTab = (id) => setRoute({ tab: id, accountId: null });
  const openAccount = (id) => setRoute({ tab: 'accounts', accountId: id });
  const closeAccount = () => setRoute({ tab: 'accounts', accountId: null });

  // apply manual rate
  useEffect(() => { window.FinanceData.FX.current = manualRate; }, [manualRate]);

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
    { id: 'intake',    label: 'Intake' },
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
            onClick={() => setTweak('privacy', !t.privacy)}
            aria-label={t.privacy ? 'Show amounts' : 'Hide amounts'}
            title={t.privacy ? 'Show amounts' : 'Hide amounts (privacy mode)'}
          >
            <Icon name={t.privacy ? 'eyeOff' : 'eye'} size={16}/>
          </button>
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
            <button key={tt.id} data-screen-label={tt.label} className={tab === tt.id ? 'on' : ''} onClick={() => goTab(tt.id)}>{tt.label}</button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === 'overview' && <OverviewTab key={`overview-${dataTick}`}/>}
        {tab === 'accounts' && <AccountsTab key={`accounts-${dataTick}`} primaryCurrency={t.primaryCurrency} openAccountId={accountId} onOpenAccount={openAccount} onCloseAccount={closeAccount}/>}
        {tab === 'cashflow' && <CashflowTab key={`cashflow-${dataTick}`}/>}
        {tab === 'passive' && <PassiveTab key={`passive-${dataTick}`}/>}
        {tab === 'intake' && <IntakeTab onIngested={() => setDataTick(x => x + 1)}/>}
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
      await window.DbLoader.init();
      await window.DbLoader.bootstrap();
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
      await window.DbLoader.requestSignIn();
      await window.DbLoader.fetchAndPopulate();
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
    return <ErrorBoundary><App key={tick}/></ErrorBoundary>;
  }

  return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="boot-mark">◐</div>
        <div className="boot-title">Ledger</div>
        <div className="boot-sub">Personal finance dashboard</div>

        {phase === 'loading' && <div className="boot-status">Loading…</div>}

        {phase === 'fetching' && (
          <div className="boot-status">
            <div className="boot-spinner"/>
            <div>Loading your ledger…</div>
          </div>
        )}

        {phase === 'signin' && (
          <>
            {error && <div className="boot-error">⚠ {error}</div>}
            <button className="boot-btn" onClick={handleSignIn}>Sign in with Google</button>
            <div className="boot-note">
              Sign in to access your ledger.<br/>
              Your data is stored securely and never shared.
            </div>
            <button className="boot-btn boot-btn-ghost" onClick={async () => {
              setError(null); setPhase('fetching');
              try {
                await window.DbLoader.loadDemoData();
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
            <button className="boot-btn boot-btn-ghost" onClick={() => { window.DbLoader.signOut(); start(); }}>Sign out & retry</button>
          </>
        )}
      </div>
    </div>
  );
}

const isExample = import.meta.env.VITE_EXAMPLE_MODE === 'true';

import { ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, FX } from './data/data.js';

async function mount() {
  if (isExample) {
    await import('./data/data.example.js');
    const ex = window.FinanceData;
    ACCOUNTS.length = 0; ACCOUNTS.push(...ex.ACCOUNTS);
    SNAPSHOTS.length = 0; SNAPSHOTS.push(...ex.SNAPSHOTS);
    INCOME.length = 0; INCOME.push(...ex.INCOME);
    EXPENSES.length = 0; EXPENSES.push(...ex.EXPENSES);
    Object.keys(FX.byMonth).forEach(k => delete FX.byMonth[k]);
    Object.assign(FX.byMonth, ex.FX.byMonth);
    FX.current = ex.FX.current;
    FX.setOn = ex.FX.setOn;
    Fin.rebuildDerivations();
  }
  ReactDOM.createRoot(document.getElementById('root')).render(
    isExample ? <App/> : <Bootstrap/>
  );
}
mount();
