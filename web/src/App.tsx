import { useEffect } from 'react';
import { useStore } from './store';
import { LoginForm } from './components/LoginForm';
import { SplitPaneContainer } from './components/SplitPaneContainer';
import { SessionSidebar } from './components/SessionSidebar';
import { TabBar } from './components/TabBar';

// Read token from localStorage only (URL-based token removed for security — avoids log/history leak)
function getInitialToken(): string | null {
  return localStorage.getItem('ai-cli-online-token');
}

function App() {
  const token = useStore((s) => s.token);
  const setToken = useStore((s) => s.setToken);
  const tabs = useStore((s) => s.tabs);
  const addTab = useStore((s) => s.addTab);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const fontSize = useStore((s) => s.fontSize);
  const setFontSize = useStore((s) => s.setFontSize);
  const tabsLoading = useStore((s) => s.tabsLoading);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  // Initialize token from URL/localStorage on mount
  useEffect(() => {
    const saved = getInitialToken();
    if (saved && !token) {
      setToken(saved);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create first tab after login (wait for server restore to finish)
  useEffect(() => {
    if (token && !tabsLoading && tabs.filter((t) => t.status === 'open').length === 0) {
      addTab('Default');
    }
  }, [token, tabsLoading]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) {
    return <LoginForm />;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '15px',
            fontWeight: 'bold',
            color: 'var(--accent-blue)',
            letterSpacing: '0.5px',
          }}>
            AI-Cli Online
          </span>
          <span style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            fontWeight: 400,
          }}>
            v{__APP_VERSION__}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Font size controls */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            padding: '1px 4px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0,0,0,0.2)',
          }}>
            <button
              className="header-btn"
              onClick={() => setFontSize(fontSize - 1)}
              disabled={fontSize <= 10}
              title="Decrease font size"
              style={{ fontSize: '11px', padding: '1px 5px', minWidth: 0 }}
            >
              A−
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text-primary)', minWidth: '20px', textAlign: 'center' }}>
              {fontSize}
            </span>
            <button
              className="header-btn"
              onClick={() => setFontSize(fontSize + 1)}
              disabled={fontSize >= 24}
              title="Increase font size"
              style={{ fontSize: '11px', padding: '1px 5px', minWidth: 0 }}
            >
              A+
            </button>
          </span>
          <NetworkIndicator />
          <button
            className="header-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
          <button
            className="header-btn"
            onClick={toggleSidebar}
            title="Toggle Tabs & Terminals Sidebar"
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <button
            className="header-btn header-btn--muted"
            onClick={() => {
              if (window.confirm('Logout will close all terminals. Continue?')) {
                setToken(null);
              }
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Content area: terminals + sidebar */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <SplitPaneContainer />
        </main>
        <SessionSidebar />
      </div>

      {/* Tab bar at bottom */}
      <TabBar />
    </div>
  );
}

const SIGNAL_BARS = [1, 2, 3, 4] as const;

/** Global network quality indicator in header */
function NetworkIndicator() {
  const latency = useStore((s) => s.latency);

  if (latency === null) {
    return (
      <span style={{ fontSize: '10px', color: 'var(--scrollbar-thumb-hover)' }} title="Measuring latency...">
        --ms
      </span>
    );
  }

  let color: string;
  let bars: number;
  if (latency < 50) {
    color = 'var(--accent-green)'; bars = 4;
  } else if (latency < 150) {
    color = 'var(--accent-yellow)'; bars = 3;
  } else if (latency < 300) {
    color = 'var(--accent-orange)'; bars = 2;
  } else {
    color = 'var(--accent-red)'; bars = 1;
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'end',
        gap: '1.5px',
        padding: '2px 8px',
        borderRadius: '10px',
        backgroundColor: 'rgba(0,0,0,0.2)',
      }}
      title={`Latency: ${latency}ms`}
    >
      {SIGNAL_BARS.map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: '2.5px',
            height: `${3 + i * 2}px`,
            backgroundColor: i <= bars ? color : 'var(--border)',
            borderRadius: '1px',
            transition: 'background-color 0.3s ease',
          }}
        />
      ))}
      <span style={{ fontSize: '10px', color, marginLeft: '4px', fontWeight: 500 }}>
        {latency}ms
      </span>
    </span>
  );
}

export default App;
