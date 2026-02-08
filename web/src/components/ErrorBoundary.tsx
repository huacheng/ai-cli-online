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
            backgroundColor: '#1a1b26',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '8px',
            color: '#c0caf5',
            fontFamily: 'monospace',
            padding: '16px',
          }}>
            <div style={{ fontSize: '14px', color: '#f7768e' }}>Pane crashed</div>
            <div style={{ fontSize: '12px', color: '#565f89', textAlign: 'center' }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                background: '#292e42',
                border: '1px solid #414868',
                color: '#c0caf5',
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
          backgroundColor: '#1a1b26',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '16px',
          color: '#c0caf5',
          fontFamily: 'monospace',
        }}>
          <div style={{ fontSize: '18px', color: '#f7768e' }}>Something went wrong</div>
          <div style={{ fontSize: '13px', color: '#565f89', maxWidth: '500px', textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'linear-gradient(135deg, #7aa2f7 0%, #bb9af7 100%)',
              border: 'none',
              color: '#1a1b26',
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
