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
      return t
        ? { id, connected: t.connected, active: true }
        : { id, connected: false, active: false };
    });
  });

  const disconnectTerminal = useStore((s) => s.disconnectTerminal);
  const reconnectTerminal = useStore((s) => s.reconnectTerminal);
  const killServerSession = useStore((s) => s.killServerSession);
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
          borderLeft: isActive ? '3px solid var(--accent-blue)' : '3px solid transparent',
          backgroundColor: isActive ? 'rgba(122, 162, 247, 0.08)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderBottom: '1px solid var(--border)',
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
              color: 'var(--text-secondary)',
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
                background: 'var(--bg-primary)',
                border: '1px solid var(--accent-blue)',
                color: 'var(--text-bright)',
                borderRadius: '3px',
                padding: '1px 4px',
                fontSize: '14px',
                outline: 'none',
              }}
            />
          ) : (
            <div
              onDoubleClick={handleDoubleClick}
              style={{
                color: 'var(--text-bright)',
                fontSize: '14px',
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
            color: 'var(--text-secondary)',
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
                color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
              }}
              title={`Connected: ${term.connected}`}
            >
              <span style={{ fontFamily: 'monospace' }}>{term.id}</span>
              <span style={{ marginLeft: '8px', color: term.active ? (term.connected ? 'var(--accent-green)' : 'var(--accent-yellow)') : 'var(--text-secondary)' }}>
                {term.active ? (term.connected ? '●' : '◐') : '○'}
              </span>
              {term.active ? (
                <button
                  className="pane-btn pane-btn--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    disconnectTerminal(term.id);
                  }}
                  style={{ marginLeft: 'auto', flexShrink: 0 }}
                  title="Disconnect terminal (keeps session alive)"
                >
                  ×
                </button>
              ) : (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', flexShrink: 0 }}>
                  <button
                    className="pane-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      reconnectTerminal(term.id);
                    }}
                    title="Reconnect terminal"
                    style={{ fontSize: '11px', padding: '2px 6px' }}
                  >
                    ↻
                  </button>
                  <button
                    className="pane-btn pane-btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Kill terminal "${term.id}"? This will destroy the tmux session.`)) {
                        killServerSession(term.id);
                      }
                    }}
                    title="Kill session"
                  >
                    ×
                  </button>
                </div>
              )}
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
        borderBottom: '1px solid var(--border)',
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
        backgroundColor: active ? 'var(--accent-green)' : 'var(--text-secondary)',
        flexShrink: 0,
      }} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: 'var(--text-bright)',
          fontSize: '14px',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {sessionId}
        </div>
        <div style={{
          color: 'var(--text-secondary)',
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
  const fetchSessions = useStore((s) => s.fetchSessions);
  // Only subscribe to heavy data when sidebar is actually open
  const serverSessions = useStore((s) => sidebarOpen ? s.serverSessions : []);
  const tabs = useStore((s) => sidebarOpen ? s.tabs : []);
  const terminalIdsLength = useStore((s) => s.terminalIds.length);
  const tabsLoading = useStore((s) => s.tabsLoading);

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
  }, [terminalIdsLength, sidebarOpen, fetchSessions]);

  return (
    <div
      className="session-sidebar"
      style={{
        width: sidebarOpen ? 280 : 0,
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderLeft: sidebarOpen ? '1px solid var(--border)' : 'none',
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
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--accent-blue)', fontSize: '14px', fontWeight: 'bold' }}>
          Tabs & Terminals
        </span>
        <button
          onClick={toggleSidebar}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
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
            color: 'var(--accent-blue)',
            fontSize: '12px',
            fontWeight: 'bold',
            backgroundColor: 'rgba(122, 162, 247, 0.05)',
            borderBottom: '1px solid var(--border)',
          }}>
            Tabs
          </div>
          {tabs.length === 0 ? (
            <div style={{
              color: 'var(--text-secondary)',
              fontSize: '14px',
              textAlign: 'center',
              padding: '12px',
            }}>
              No tabs
            </div>
          ) : (
            tabs.map((tab) => <TabItem key={tab.id} tabId={tab.id} />)
          )}
        </div>

        {/* Orphaned Sessions Section — hide while tabs are still loading from server */}
        {!tabsLoading && orphanedSessions.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{
              padding: '8px 12px',
              color: 'var(--accent-yellow)',
              fontSize: '12px',
              fontWeight: 'bold',
              backgroundColor: 'rgba(224, 175, 104, 0.05)',
              borderBottom: '1px solid var(--border)',
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
