import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { formatTime } from '../utils';

function SessionItem({ sessionId, active, createdAt }: {
  sessionId: string;
  active: boolean;
  createdAt: number;
}) {
  const isOpen = useStore((s) => !!s.terminalsMap[sessionId]);
  const addTerminal = useStore((s) => s.addTerminal);
  const killServerSession = useStore((s) => s.killServerSession);
  const displayName = useStore((s) => s.sessionNames[sessionId] || sessionId);
  const renameSession = useStore((s) => s.renameSession);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (isOpen) return;
    addTerminal('horizontal', sessionId);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(displayName !== sessionId ? displayName : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRenameCommit = () => {
    const trimmed = editValue.trim();
    renameSession(sessionId, trimmed);
    setEditing(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete session "${displayName}"? This will kill the tmux session.`)) return;
    killServerSession(sessionId);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        padding: '8px 12px',
        cursor: isOpen ? 'default' : 'pointer',
        borderLeft: isOpen ? '3px solid #7aa2f7' : '3px solid transparent',
        backgroundColor: isOpen ? 'rgba(122, 162, 247, 0.08)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderBottom: '1px solid #292e42',
        transition: 'background-color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!isOpen) e.currentTarget.style.backgroundColor = 'rgba(122, 162, 247, 0.05)';
      }}
      onMouseLeave={(e) => {
        if (!isOpen) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {/* Status dot */}
      <span style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: active ? '#9ece6a' : '#565f89',
        flexShrink: 0,
      }} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameCommit();
              if (e.key === 'Escape') setEditing(false);
            }}
            style={{
              width: '100%',
              background: '#1a1b26',
              border: '1px solid #7aa2f7',
              color: '#c0caf5',
              borderRadius: '3px',
              padding: '1px 4px',
              fontSize: '13px',
              outline: 'none',
            }}
            placeholder={sessionId}
          />
        ) : (
          <div
            onDoubleClick={handleDoubleClick}
            style={{
              color: '#c0caf5',
              fontSize: '13px',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title="Double-click to rename"
          >
            {displayName}
          </div>
        )}
        <div style={{
          color: '#565f89',
          fontSize: '11px',
          marginTop: '2px',
        }}>
          {sessionId !== displayName && <span>{sessionId} · </span>}
          {formatTime(createdAt)}
        </div>
      </div>

      {/* Delete button */}
      <button
        className="pane-btn pane-btn--danger"
        onClick={handleDelete}
        style={{ flexShrink: 0 }}
        title="Delete session"
      >
        ×
      </button>
    </div>
  );
}

export function SessionSidebar() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const serverSessions = useStore((s) => s.serverSessions);
  const fetchSessions = useStore((s) => s.fetchSessions);

  const terminalCount = useStore((s) => s.terminalIds.length);

  // Poll sessions when sidebar is open and page is visible
  useEffect(() => {
    if (!sidebarOpen) return;
    fetchSessions();

    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchSessions, 5000);

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        fetchSessions();
        if (!interval) interval = setInterval(fetchSessions, 5000);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [sidebarOpen, fetchSessions]);

  // Refresh when terminals are added/removed (small delay for tmux session creation)
  useEffect(() => {
    if (!sidebarOpen) return;
    const timer = setTimeout(fetchSessions, 800);
    return () => clearTimeout(timer);
  }, [terminalCount, sidebarOpen, fetchSessions]);

  return (
    <div
      className="session-sidebar"
      style={{
        width: sidebarOpen ? 280 : 0,
        height: '100%',
        backgroundColor: '#16161e',
        borderLeft: sidebarOpen ? '1px solid #292e42' : 'none',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'width 0.2s ease',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid #292e42',
        flexShrink: 0,
      }}>
        <span style={{ color: '#7aa2f7', fontSize: '14px', fontWeight: 'bold' }}>
          Sessions
        </span>
        <button
          onClick={toggleSidebar}
          style={{
            background: 'none',
            border: 'none',
            color: '#565f89',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 4px',
            lineHeight: 1,
          }}
          title="Close sidebar"
        >
          ×
        </button>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {serverSessions.length === 0 ? (
          <div style={{
            color: '#565f89',
            fontSize: '13px',
            textAlign: 'center',
            padding: '24px 12px',
          }}>
            No sessions
          </div>
        ) : (
          serverSessions.map((s) => (
            <SessionItem
              key={s.sessionId}
              sessionId={s.sessionId}
              active={s.active}
              createdAt={s.createdAt}
            />
          ))
        )}
      </div>
    </div>
  );
}
