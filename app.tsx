import React, { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './data/data.ts';
import { Fin } from './data/helpers.ts';
import './data/db-loader.ts';
import demoSource from './data/data.example.js?raw';
window.__LEDGER_DEMO_SOURCE__ = demoSource;
import { useTweaks } from './tweaks-panel.tsx';
import { Icon } from './components/icons.tsx';
import { OverviewTab } from './components/tab-overview.tsx';
import { AccountsTab } from './components/tab-accounts.tsx';
import { CashflowTab } from './components/tab-cashflow.tsx';
import { PassiveTab } from './components/tab-passive.tsx';
import { IntakeTab } from './components/tab-intake.tsx';
import { Sidebar, useSidebar, SIDEBAR_WIDTH, SIDEBAR_RAIL } from './components/sidebar.jsx';
// Main app — shell, header, sidebar, content.

/* ── ErrorBoundary ────────────────────────────────────────────────────── */
interface ErrorBoundaryProps {
  children: React.ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
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

const ACCENT_PALETTES: Record<string, { accent: string; accent2: string }> = {
  ochre:     { accent: 'oklch(62% 0.13 65)', accent2: 'oklch(72% 0.10 80)' },
  terracotta:{ accent: 'oklch(58% 0.13 35)', accent2: 'oklch(68% 0.10 50)' },
  ink:       { accent: 'oklch(45% 0.10 250)', accent2: 'oklch(60% 0.08 230)' },
  moss:      { accent: 'oklch(54% 0.10 140)', accent2: 'oklch(66% 0.08 130)' },
};

interface FxStripProps {
  rate: number;
  manualOpen: boolean;
  setManualOpen: (v: boolean) => void;
  manualRate: number;
  setManualRate: (v: number) => void;
}

function FxStrip({ rate, manualOpen, setManualOpen, manualRate, setManualRate }: FxStripProps) {
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

const TAB_IDS = ['overview', 'accounts', 'cashflow', 'passive', 'intake'] as const;
type TabId = typeof TAB_IDS[number];

function parseUrl(): { tab: string; accountId: string | null; section: string | null } {
  const segs = location.pathname.split('/').filter(Boolean);
  const tab = (TAB_IDS as readonly string[]).includes(segs[0]) ? segs[0] : 'overview';
  const accountId = (tab === 'accounts' && segs[1]) ? decodeURIComponent(segs[1]) : null;
  const section = location.hash ? location.hash.slice(1) : null;
  return { tab, accountId, section };
}

function pathFor(tab: string, accountId: string | null, section?: string | null): string {
  let path: string;
  if (tab === 'accounts' && accountId) path = `/accounts/${encodeURIComponent(accountId)}`;
  else if (tab === 'overview') path = '/';
  else path = `/${tab}`;
  if (section) path += `#${section}`;
  return path;
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [{ tab, accountId, section }, setRoute] = useState(parseUrl);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRate, setManualRate] = useState(window.FinanceData.FX.current);
  const [dataTick, setDataTick] = useState(0);
  const sidebar = useSidebar();

  const navigate = (tabId: string, sectionId?: string | null) => {
    setRoute({ tab: tabId, accountId: null, section: sectionId || null });
  };
  const openAccount = (id: string) => setRoute({ tab: 'accounts', accountId: id, section: null });
  const closeAccount = () => setRoute({ tab: 'accounts', accountId: null, section: null });

  useEffect(() => { window.FinanceData.FX.current = manualRate; }, [manualRate]);

  useEffect(() => {
    const want = pathFor(tab, accountId, section);
    const current = location.pathname + (location.hash || '');
    if (current !== want) {
      history.pushState({ tab, accountId, section }, '', want);
    }
  }, [tab, accountId, section]);

  useEffect(() => {
    const onPop = () => setRoute(parseUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-density', t.density);
    document.documentElement.setAttribute('data-privacy', t.privacy ? 'on' : 'off');
    const palette = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES.ochre;
    document.documentElement.style.setProperty('--accent', palette.accent);
    document.documentElement.style.setProperty('--accent-2', palette.accent2);
  }, [t.dark, t.density, t.privacy, t.accent]);

  const sidebarWidth = sidebar.isMobile ? 0
    : sidebar.collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH;

  return (
    <div className="app app-with-sidebar">
      <header className="app-h">
        {sidebar.isMobile && (
          <button
            className="theme-toggle sb-menu-btn"
            onClick={sidebar.toggle}
            aria-label="Toggle menu"
          >
            <Icon name="menu" size={18}/>
          </button>
        )}
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
      </header>

      <div className="app-body">
        <Sidebar
          tab={tab}
          section={section}
          onNavigate={navigate}
          sidebar={sidebar}
        />
        <main className="app-main" style={{ marginLeft: sidebarWidth }}>
          {tab === 'overview' && <OverviewTab key={`overview-${dataTick}`} section={section}/>}
          {tab === 'accounts' && <AccountsTab key={`accounts-${dataTick}`} primaryCurrency={t.primaryCurrency} openAccountId={accountId} onOpenAccount={openAccount} onCloseAccount={closeAccount}/>}
          {tab === 'cashflow' && <CashflowTab key={`cashflow-${dataTick}`} section={section}/>}
          {tab === 'passive' && <PassiveTab key={`passive-${dataTick}`} section={section}/>}
          {tab === 'intake' && <IntakeTab onIngested={() => setDataTick(x => x + 1)}/>}
        </main>
      </div>
    </div>
  );
}

function Bootstrap() {
  const [phase, setPhase] = useState<string>('loading');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const start = async () => {
    setError(null); setPhase('loading');
    try {
      await window.DbLoader.init();
      await window.DbLoader.bootstrap();
      setTick(x => x + 1); setPhase('ready');
    } catch (e: any) {
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
    } catch (e: any) {
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
              } catch (e: any) {
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

import { ACCOUNTS, SNAPSHOTS, INCOME, EXPENSES, FX } from './data/data.ts';

async function mount() {
  if (isExample) {
    // @ts-ignore side-effect script, not an ES module
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
  ReactDOM.createRoot(document.getElementById('root')!).render(
    isExample ? <App/> : <Bootstrap/>
  );
}
mount();
