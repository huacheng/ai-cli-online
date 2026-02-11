import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Compact inline fallback for per-pane usage (vs full-page for app root) */
  inline?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.inline) {
        return (
          <div style={{
            height: '100%',
            backgroundColor: 'var(--bg-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '8px',
            color: 'var(--text-bright)',
            fontFamily: 'monospace',
            padding: '16px',
          }}>
            <div style={{ fontSize: '14px', color: 'var(--accent-red)' }}>Pane crashed</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                background: 'var(--bg-hover)',
                border: '1px solid var(--border)',
                color: 'var(--text-bright)',
                padding: '4px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Retry
            </button>
          </div>
        );
      }
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '16px',
          color: 'var(--text-bright)',
          fontFamily: 'monospace',
        }}>
          <div style={{ fontSize: '18px', color: 'var(--accent-red)' }}>Something went wrong</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '500px', textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-purple) 100%)',
              border: 'none',
              color: 'var(--bg-primary)',
              padding: '8px 24px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
