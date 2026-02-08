import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { formatTime } from '../utils';

// Component for each tab in the Tabs section
function TabItem({ tabId }: { tabId: string }) {
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId));
  const activeTabId = useStore((s) => s.activeTabId);
  const switchTab = useStore((s) => s.switchTab);
  const closeTab = useStore((s) => s.closeTab);
  const reopenTab = useStore((s) => s.reopenTab);
  const deleteTab = useStore((s) => s.deleteTab);
  const renameTab = useStore((s) => s.renameTab);
  const terminalStates = useStore((s) => {
    if (!tab) return [];
    return tab.terminalIds.map((id) => {
      const t = s.terminalsMap[id];
      return t ? { id, connected: t.connected } : { id, connected: false };
    });
  });

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!tab) return null;

  const isActive = activeTabId === tabId;
  const isOpen = tab.status === 'open';

  const handleClick = () => {
    if (isOpen) {
      switchTab(tabId);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!isOpen) return;
    e.stopPropagation();
    setEditValue(tab.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRenameCommit = () => {
    const trimmed = editValue.trim();
    if (trimmed) {
      renameTab(tabId, trimmed);
    }
    setEditing(false);
  };

  const handleReopen = (e: React.MouseEvent) => {
    e.stopPropagation();
    reopenTab(tabId);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete tab "${tab.name}"? This will kill all tmux sessions in this tab.`)) return;
    await deleteTab(tabId);
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          padding: '8px 12px',
          cursor: isOpen ? 'pointer' : 'default',
          borderLeft: isActive ? '3px solid #7aa2f7' : '3px solid transparent',
          backgroundColor: isActive ? 'rgba(122, 162, 247, 0.08)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderBottom: '1px solid #292e42',
          transition: 'background-color 0.15s',
          opacity: isOpen ? 1 : 0.5,
        }}
        onMouseEnter={(e) => {
          if (isOpen && !isActive) e.currentTarget.style.backgroundColor = 'rgba(122, 162, 247, 0.05)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {/* Expand arrow for open tabs */}
        {isOpen && tab.terminalIds.length > 0 && (
          <button
            onClick={handleToggleExpand}
            style={{
              background: 'none',
              border: 'none',
              color: '#565f89',
              cursor: 'pointer',
              fontSize: '10px',
              padding: 0,
              width: 14,
              height: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {expanded ? '▼' : '▶'}
          </button>
        )}

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
              title={isOpen ? "Double-click to rename" : tab.name}
            >
              {tab.name}
            </div>
          )}
          <div style={{
            color: '#565f89',
            fontSize: '11px',
            marginTop: '2px',
          }}>
            {tab.terminalIds.length} terminal{tab.terminalIds.length !== 1 ? 's' : ''} · {formatTime(Math.floor(tab.createdAt / 1000))}
          </div>
        </div>

        {/* Action buttons */}
        {isOpen ? (
          <button
            className="pane-btn pane-btn--danger"
            onClick={handleClose}
            style={{ flexShrink: 0 }}
            title="Close tab"
          >
            ×
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <button
              className="pane-btn"
              onClick={handleReopen}
              title="Reopen tab"
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              ↻
            </button>
            <button
              className="pane-btn pane-btn--danger"
              onClick={handleDelete}
              title="Delete tab"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Nested terminal list */}
      {isOpen && expanded && terminalStates.length > 0 && (
        <div style={{ paddingLeft: '28px', backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
          {terminalStates.map((term) => (
            <div
              key={term.id}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                color: '#565f89',
                borderBottom: '1px solid rgba(41, 46, 66, 0.5)',
              }}
              title={`Connected: ${term.connected}`}
            >
              <span style={{ fontFamily: 'monospace' }}>{term.id}</span>
              <span style={{ marginLeft: '8px', color: term.connected ? '#9ece6a' : '#f7768e' }}>
                {term.connected ? '●' : '○'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Component for orphaned server sessions
function OrphanedSessionItem({ sessionId, active, createdAt }: {
  sessionId: string;
  active: boolean;
  createdAt: number;
}) {
  const addTerminal = useStore((s) => s.addTerminal);
  const killServerSession = useStore((s) => s.killServerSession);

  const handleClick = () => {
    addTerminal('horizontal', sessionId);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete orphaned session "${sessionId}"? This will kill the tmux session.`)) return;
    killServerSession(sessionId);
  };

  return (
    <div
      onClick={handleClick}
      style={{
        padding: '8px 12px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderBottom: '1px solid #292e42',
        transition: 'background-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(122, 162, 247, 0.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
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
        <div style={{
          color: '#c0caf5',
          fontSize: '13px',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {sessionId}
        </div>
        <div style={{
          color: '#565f89',
          fontSize: '11px',
          marginTop: '2px',
        }}>
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
  const tabs = useStore((s) => s.tabs);
  const terminalIds = useStore((s) => s.terminalIds);

  // Find orphaned sessions (server sessions not in any tab)
  const allTabTerminalIds = new Set(
    tabs.flatMap((tab) => tab.terminalIds)
  );
  const orphanedSessions = serverSessions.filter(
    (s) => !allTabTerminalIds.has(s.sessionId)
  );

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
  }, [terminalIds.length, sidebarOpen, fetchSessions]);

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
          Tabs & Sessions
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

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Tabs Section */}
        <div>
          <div style={{
            padding: '8px 12px',
            color: '#7aa2f7',
            fontSize: '12px',
            fontWeight: 'bold',
            backgroundColor: 'rgba(122, 162, 247, 0.05)',
            borderBottom: '1px solid #292e42',
          }}>
            TABS
          </div>
          {tabs.length === 0 ? (
            <div style={{
              color: '#565f89',
              fontSize: '13px',
              textAlign: 'center',
              padding: '12px',
            }}>
              No tabs
            </div>
          ) : (
            tabs.map((tab) => <TabItem key={tab.id} tabId={tab.id} />)
          )}
        </div>

        {/* Orphaned Sessions Section */}
        {orphanedSessions.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{
              padding: '8px 12px',
              color: '#e0af68',
              fontSize: '12px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(224, 175, 104, 0.05)',
              borderBottom: '1px solid #292e42',
            }}>
              ORPHANED SESSIONS
            </div>
            {orphanedSessions.map((s) => (
              <OrphanedSessionItem
                key={s.sessionId}
                sessionId={s.sessionId}
                active={s.active}
                createdAt={s.createdAt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
