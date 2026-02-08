import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import type { TabState } from '../types';

export const TabBar = React.memo(() => {
  const { tabs, activeTabId, addTab, switchTab, closeTab, renameTab } = useStore();
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const openTabs = tabs.filter(tab => tab.status === 'open');

  useEffect(() => {
    if (renamingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingTabId]);

  const handleDoubleClick = (tab: TabState) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.name);
  };

  const commitRename = () => {
    if (renamingTabId && renameValue.trim()) {
      renameTab(renamingTabId, renameValue.trim());
    }
    setRenamingTabId(null);
    setRenameValue('');
  };

  const cancelRename = () => {
    setRenamingTabId(null);
    setRenameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitRename();
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  };

  const handleTabClick = (tabId: string) => {
    if (renamingTabId) return;
    switchTab(tabId);
  };

  const handleCloseClick = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  };

  const showCloseButton = openTabs.length > 1;

  return (
    <div className="tab-bar">
      {openTabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const isRenaming = renamingTabId === tab.id;
        const terminalCount = tab.terminalIds.length;

        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? 'tab-item--active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab)}
            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
          >
            {isRenaming ? (
              <input
                ref={inputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleRenameKeyDown}
                className="tab-item__rename-input"
              />
            ) : (
              <>
                <span className="tab-item__name">
                  {tab.name} {terminalCount > 0 && `(${terminalCount})`}
                </span>
                {showCloseButton && (
                  <button
                    className="tab-item__close"
                    onClick={(e) => handleCloseClick(e, tab.id)}
                    title="Close tab"
                    aria-label="Close tab"
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      <button
        className="tab-bar-add"
        onClick={() => addTab()}
        title="New tab"
        aria-label="Add new tab"
      >
        +
      </button>
    </div>
  );
});

TabBar.displayName = 'TabBar';
