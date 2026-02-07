import { useEffect } from 'react';
import { useStore } from './store';
import { LoginForm } from './components/LoginForm';
import { SplitPaneContainer } from './components/SplitPaneContainer';
import { SessionSidebar } from './components/SessionSidebar';

// Read token from localStorage only (URL-based token removed for security — avoids log/history leak)
function getInitialToken(): string | null {
  return localStorage.getItem('cli-online-token');
}

function App() {
  const { token, setToken, terminalIds, addTerminal, toggleSidebar } = useStore();

  // Initialize token from URL/localStorage on mount
  useEffect(() => {
    const saved = getInitialToken();
    if (saved && !token) {
      setToken(saved);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create first terminal after login
  useEffect(() => {
    if (token && terminalIds.length === 0) {
      addTerminal();
    }
  }, [token]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) {
    return <LoginForm />;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1a1b26' }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px',
        backgroundColor: '#16161e',
        borderBottom: '1px solid #292e42',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '15px',
            fontWeight: 'bold',
            color: '#7aa2f7',
            letterSpacing: '0.5px',
          }}>
            AI-Cli Online
          </span>
          <span style={{
            fontSize: '11px',
            color: '#565f89',
            backgroundColor: '#1a1b26',
            padding: '1px 8px',
            borderRadius: '10px',
            border: '1px solid #292e42',
          }}>
            {terminalIds.length} terminal{terminalIds.length !== 1 ? 's' : ''}
          </span>
          <button
            className="header-btn"
            onClick={() => addTerminal('horizontal')}
            title="Add terminal (horizontal split)"
          >
            |
          </button>
          <button
            className="header-btn"
            onClick={() => addTerminal('vertical')}
            title="Add terminal (vertical split)"
          >
            ─
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <NetworkIndicator />
          <button
            className="header-btn"
            onClick={toggleSidebar}
            title="Toggle session sidebar"
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
    </div>
  );
}

/** Global network quality indicator in header */
function NetworkIndicator() {
  const latency = useStore((s) => s.latency);

  if (latency === null) {
    return (
      <span style={{ fontSize: '10px', color: '#414868' }} title="Measuring latency...">
        --ms
      </span>
    );
  }

  let color: string;
  let bars: number;
  if (latency < 50) {
    color = '#9ece6a'; bars = 4;
  } else if (latency < 150) {
    color = '#e0af68'; bars = 3;
  } else if (latency < 300) {
    color = '#ff9e64'; bars = 2;
  } else {
    color = '#f7768e'; bars = 1;
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
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: '2.5px',
            height: `${3 + i * 2}px`,
            backgroundColor: i <= bars ? color : '#292e42',
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
