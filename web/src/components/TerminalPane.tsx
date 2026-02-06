import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import type { TerminalInstance } from '../types';

interface TerminalPaneProps {
  terminal: TerminalInstance;
  canClose: boolean;
}

const paneButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#565f89',
  cursor: 'pointer',
  fontSize: '14px',
  lineHeight: '1',
  padding: '0 2px',
};

export function TerminalPane({ terminal, canClose }: TerminalPaneProps) {
  const removeTerminal = useStore((s) => s.removeTerminal);
  const splitTerminal = useStore((s) => s.splitTerminal);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0 }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 8px',
        backgroundColor: '#16161e',
        borderBottom: '1px solid #292e42',
        flexShrink: 0,
        height: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: terminal.connected ? '#9ece6a' : '#f7768e',
          }} />
          <span style={{ fontSize: '11px', color: '#565f89' }}>
            {terminal.id}
            {terminal.connected
              ? (terminal.sessionResumed ? ' (resumed)' : '')
              : ' (disconnected)'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => splitTerminal(terminal.id, 'horizontal')}
            style={paneButtonStyle}
            title="Split horizontal (left/right)"
          >
            |
          </button>
          <button
            onClick={() => splitTerminal(terminal.id, 'vertical')}
            style={paneButtonStyle}
            title="Split vertical (top/bottom)"
          >
            ─
          </button>
          {canClose && (
            <button
              onClick={() => removeTerminal(terminal.id)}
              style={paneButtonStyle}
              title="Close terminal"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <TerminalView sessionId={terminal.id} />
      </div>

      {/* Error bar */}
      {terminal.error && (
        <div style={{
          padding: '2px 8px',
          backgroundColor: '#3b2029',
          borderTop: '1px solid #f7768e',
          color: '#f7768e',
          fontSize: '11px',
          flexShrink: 0,
        }}>
          {terminal.error}
        </div>
      )}
    </div>
  );
}
