import { useState } from 'react';
import { useStore } from '../store';

export function LoginForm() {
  const [inputToken, setInputToken] = useState('');
  const { setToken, error } = useStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputToken.trim()) {
      setToken(inputToken.trim());
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1a1b26',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
    }}>
      <div style={{
        backgroundColor: '#24283b',
        borderRadius: '8px',
        padding: '32px',
        width: '100%',
        maxWidth: '400px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#c0caf5', marginBottom: '8px' }}>
            CLI-Online
          </h1>
          <p style={{ color: '#565f89', fontSize: '14px' }}>Terminal in your browser</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="token"
              style={{ display: 'block', fontSize: '13px', color: '#a9b1d6', marginBottom: '8px' }}
            >
              Auth Token
            </label>
            <input
              type="password"
              id="token"
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              placeholder="Enter your AUTH_TOKEN"
              autoFocus
              style={{
                width: '100%',
                padding: '10px 14px',
                backgroundColor: '#1a1b26',
                color: '#c0caf5',
                border: '1px solid #292e42',
                borderRadius: '6px',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              backgroundColor: '#3b2029',
              border: '1px solid #f7768e',
              color: '#f7768e',
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!inputToken.trim()}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: inputToken.trim() ? '#7aa2f7' : '#292e42',
              color: inputToken.trim() ? '#1a1b26' : '#565f89',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: inputToken.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Connect
          </button>
        </form>

        <div style={{ marginTop: '24px', textAlign: 'center', color: '#414868', fontSize: '12px' }}>
          <p>Token is configured in <code style={{ backgroundColor: '#1a1b26', padding: '2px 4px', borderRadius: '3px' }}>server/.env</code></p>
        </div>
      </div>
    </div>
  );
}
