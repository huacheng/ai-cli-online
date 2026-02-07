import { useState } from 'react';
import { useStore } from '../store';

export function LoginForm() {
  const [inputToken, setInputToken] = useState('');
  const setToken = useStore((s) => s.setToken);

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
      background: 'radial-gradient(ellipse at 50% 0%, rgba(122, 162, 247, 0.08) 0%, #1a1b26 70%)',
    }}>
      <div className="login-card" style={{
        backgroundColor: '#24283b',
        borderRadius: '12px',
        padding: '40px 36px',
        width: '100%',
        maxWidth: '400px',
        border: '1px solid #292e42',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          {/* Terminal icon */}
          <div style={{
            width: '56px',
            height: '56px',
            margin: '0 auto 16px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, #7aa2f7 0%, #bb9af7 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            color: '#1a1b26',
            fontWeight: 'bold',
            boxShadow: '0 4px 16px rgba(122, 162, 247, 0.3)',
          }}>
            &gt;_
          </div>
          <h1 style={{
            fontSize: '22px',
            fontWeight: 'bold',
            color: '#c0caf5',
            marginBottom: '6px',
            letterSpacing: '0.5px',
          }}>
            CLI-Online
          </h1>
          <p style={{ color: '#565f89', fontSize: '13px' }}>Terminal in your browser</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="token"
              style={{
                display: 'block',
                fontSize: '12px',
                color: '#7aa2f7',
                marginBottom: '8px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Auth Token
            </label>
            <input
              type="password"
              id="token"
              className="login-input"
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              placeholder="Enter your AUTH_TOKEN"
              autoFocus
              style={{
                width: '100%',
                padding: '11px 14px',
                backgroundColor: '#1a1b26',
                color: '#c0caf5',
                border: '1px solid #292e42',
                borderRadius: '8px',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={!inputToken.trim()}
            style={{
              width: '100%',
              padding: '11px',
              background: inputToken.trim()
                ? 'linear-gradient(135deg, #7aa2f7 0%, #7dcfff 100%)'
                : '#292e42',
              color: inputToken.trim() ? '#1a1b26' : '#565f89',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: inputToken.trim() ? 'pointer' : 'not-allowed',
              letterSpacing: '0.3px',
            }}
          >
            Connect
          </button>
        </form>

        <div style={{
          marginTop: '28px',
          textAlign: 'center',
          color: '#414868',
          fontSize: '11px',
        }}>
          <p>
            Token is configured in{' '}
            <code style={{
              backgroundColor: '#1a1b26',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid #292e42',
              fontSize: '11px',
            }}>
              server/.env
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
