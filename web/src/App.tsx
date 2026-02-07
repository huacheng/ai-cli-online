import { useEffect } from 'react';
import { useStore } from './store';
import { LoginForm } from './components/LoginForm';
import { SplitPaneContainer } from './components/SplitPaneContainer';
import { SessionSidebar } from './components/SessionSidebar';

// Read token from URL params or localStorage
function getInitialToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem('cli-online-token', urlToken);
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('token');
    window.history.replaceState({}, '', newUrl.toString());
    return urlToken;
  }
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
          <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#7aa2f7' }}>CLI-Online</span>
          <span style={{ fontSize: '12px', color: '#565f89' }}>
            {terminalIds.length} terminal{terminalIds.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => addTerminal('horizontal')}
            style={{
              background: 'none',
              border: '1px solid #292e42',
              color: '#7aa2f7',
              padding: '1px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: '1.4',
            }}
            title="Add terminal (horizontal split)"
          >
            |
          </button>
          <button
            onClick={() => addTerminal('vertical')}
            style={{
              background: 'none',
              border: '1px solid #292e42',
              color: '#7aa2f7',
              padding: '1px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: '1.4',
            }}
            title="Add terminal (vertical split)"
          >
            ─
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <NetworkIndicator />
          <button
            onClick={toggleSidebar}
            style={{
              background: 'none',
              border: '1px solid #292e42',
              color: '#7aa2f7',
              padding: '1px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: '1.4',
            }}
            title="Toggle session sidebar"
          >
            ☰
          </button>
          <button
            onClick={() => setToken(null)}
            style={{
              background: 'none',
              border: '1px solid #292e42',
              color: '#565f89',
              padding: '2px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
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
      style={{ display: 'inline-flex', alignItems: 'end', gap: '1px' }}
      title={`Latency: ${latency}ms`}
    >
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: '2px',
            height: `${3 + i * 2}px`,
            backgroundColor: i <= bars ? color : '#292e42',
            borderRadius: '1px',
          }}
        />
      ))}
      <span style={{ fontSize: '10px', color, marginLeft: '3px' }}>
        {latency}ms
      </span>
    </span>
  );
}

export default App;
