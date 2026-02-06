import { useStore } from './store';
import { LoginForm } from './components/LoginForm';
import { TerminalView } from './components/TerminalView';

function App() {
  const { token, setToken, connected, sessionResumed, error, setError } = useStore();

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
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: connected ? '#9ece6a' : '#f7768e',
          }} />
          <span style={{ fontSize: '12px', color: '#565f89' }}>
            {connected ? (sessionResumed ? 'Resumed' : 'Connected') : 'Disconnected'}
          </span>
        </div>
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
      </header>

      {/* Error Banner */}
      {error && (
        <div style={{
          padding: '6px 16px',
          backgroundColor: '#3b2029',
          borderBottom: '1px solid #f7768e',
          color: '#f7768e',
          fontSize: '13px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: '#f7768e', cursor: 'pointer', fontSize: '16px' }}
          >
            x
          </button>
        </div>
      )}

      {/* Terminal */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        <TerminalView />
      </main>
    </div>
  );
}

export default App;
