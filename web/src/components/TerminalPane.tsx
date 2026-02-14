import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { PlanPanel } from './PlanPanel';
import { MarkdownEditor, MarkdownEditorHandle } from './MarkdownEditor';
import { DownloadPopup } from './DownloadPopup';
import { uploadFiles, fetchCwd } from '../api/files';
import { usePanelResize } from '../hooks/usePanelResize';

import type { TerminalInstance } from '../types';
import type { TerminalViewHandle } from './TerminalView';

interface TerminalPaneProps {
  terminal: TerminalInstance;
  canClose: boolean;
}

const NARROW_THRESHOLD = 600;

const narrowQuery = typeof window !== 'undefined'
  ? window.matchMedia(`(max-width: ${NARROW_THRESHOLD - 1}px)`)
  : null;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => narrowQuery?.matches ?? false);
  useEffect(() => {
    if (!narrowQuery) return;
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    narrowQuery.addEventListener('change', handler);
    return () => narrowQuery.removeEventListener('change', handler);
  }, []);
  return narrow;
}

export const TerminalPane = memo(function TerminalPane({ terminal }: TerminalPaneProps) {
  const isNarrow = useIsNarrow();
  const splitTerminal = useStore((s) => s.splitTerminal);
  const token = useStore((s) => s.token);
  const toggleChat = useStore((s) => s.toggleChat);
  const togglePlan = useStore((s) => s.togglePlan);
  const { chatOpen, planOpen } = terminal.panels;

  const outerRef = useRef<HTMLDivElement>(null);
  const topRowRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalViewRef = useRef<TerminalViewHandle>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  // Panel resize hooks
  const [planWidthPercent, handlePlanDividerMouseDown] = usePanelResize(
    `plan-width-${terminal.id}`, 50,
    { containerRef: topRowRef, axis: 'x', min: 20, max: 80, bodyClass: 'resizing-panes' },
  );

  const [chatHeightPercent, handleChatDividerMouseDown] = usePanelResize(
    `doc-height-${terminal.id}`, 35,
    { containerRef: outerRef, axis: 'y', offset: 24, min: 15, max: 60, invert: true, bodyClass: 'resizing-panes-v' },
  );

  // Poll CWD for display in title bar
  const [cwd, setCwd] = useState('');
  useEffect(() => {
    if (!token || !terminal.connected) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const dir = await fetchCwd(token, terminal.id);
        if (!cancelled) setCwd(dir);
      } catch { /* ignore */ }
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [token, terminal.id, terminal.connected]);

  const handleSplit = useCallback(async (direction: 'horizontal' | 'vertical') => {
    let cwd: string | undefined;
    if (token) {
      try { cwd = await fetchCwd(token, terminal.id); } catch { /* use default */ }
    }
    splitTerminal(terminal.id, direction, cwd);
  }, [token, terminal.id, splitTerminal]);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editorHasContent, setEditorHasContent] = useState(false);

  // Download popup
  const [showDownloadPopup, setShowDownloadPopup] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !token) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      await uploadFiles(token, terminal.id, files, (percent) => {
        setUploadProgress(percent);
      });
    } catch (err) {
      console.error('[upload] Failed:', err);
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Send editor text to terminal PTY
  const sendTimerRef = useRef<number>(undefined);
  const handleEditorSend = useCallback((text: string) => {
    if (terminalViewRef.current) {
      const merged = text.replace(/\r?\n/g, ' ').trimEnd();
      terminalViewRef.current.sendInput(merged);
      sendTimerRef.current = window.setTimeout(() => terminalViewRef.current?.sendInput('\r'), 50);
    }
  }, []);

  useEffect(() => {
    return () => { if (sendTimerRef.current) clearTimeout(sendTimerRef.current); };
  }, []);

  // Plan Send -> send annotations directly to terminal PTY
  const handlePlanSendToTerminal = useCallback((text: string) => {
    if (terminalViewRef.current) {
      const merged = text.replace(/\r?\n/g, ' ').trimEnd();
      terminalViewRef.current.sendInput(merged);
      setTimeout(() => terminalViewRef.current?.sendInput('\r'), 50);
    }
  }, []);

  const handleCloseDownload = useCallback(() => setShowDownloadPopup(false), []);

  return (
    <div ref={outerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0 }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '3px 10px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        height: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: terminal.connected ? 'var(--accent-green)' : 'var(--accent-red)',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', flexShrink: 0 }}>
            {terminal.id}
            {terminal.connected
              ? (terminal.sessionResumed ? ' (resumed)' : '')
              : ' (disconnected)'}
          </span>
          {cwd && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                direction: 'rtl',
                textAlign: 'left',
                minWidth: 0,
              }}
              title={cwd}
            >
              {cwd}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          <button
            className="pane-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={uploading ? { color: 'var(--accent-yellow)' } : undefined}
            title={uploading ? `Uploading ${uploadProgress}%` : 'Upload files'}
            aria-label="Upload files"
          >
            {uploading ? `${uploadProgress}%` : '\u2191'}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              className="pane-btn"
              onClick={() => setShowDownloadPopup(true)}
              title="Download files"
              aria-label="Download files"
            >
              {'\u2193'}
            </button>
            {showDownloadPopup && token && (
              <DownloadPopup
                token={token}
                sessionId={terminal.id}
                onClose={handleCloseDownload}
              />
            )}
          </div>
          <button
            className={`pane-btn${chatOpen ? ' pane-btn--active' : ''}`}
            onClick={() => toggleChat(terminal.id)}
            title="Toggle Chat panel"
            aria-label="Toggle Chat panel"
          >
            Chat
          </button>
          <button
            className={`pane-btn${planOpen ? ' pane-btn--active' : ''}`}
            onClick={() => togglePlan(terminal.id)}
            title="Toggle Task annotation panel"
            aria-label="Toggle Task annotation panel"
          >
            Task
          </button>
          <button
            className="pane-btn"
            onClick={() => handleSplit(isNarrow ? 'vertical' : 'horizontal')}
            title={isNarrow ? 'Split vertical (screen too narrow for horizontal)' : 'Split horizontal (left/right)'}
            aria-label="Split horizontal"
          >
            |
          </button>
          <button
            className="pane-btn"
            onClick={() => handleSplit('vertical')}
            title="Split vertical (top/bottom)"
            aria-label="Split vertical"
          >
            ─
          </button>
        </div>
      </div>

      {/* Main area: Plan (left) | Right column (Terminal + Chat) */}
      <div ref={topRowRef} style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 0 }}>
        {planOpen && (
          <>
            <div style={{ width: `${planWidthPercent}%`, minWidth: 200, flexShrink: 0, overflow: 'hidden' }}>
              <PlanPanel
                sessionId={terminal.id}
                token={token || ''}
                connected={terminal.connected}
                onRequestFileStream={(path) => terminalViewRef.current?.requestFileStream(path)}
                onSendToTerminal={handlePlanSendToTerminal}
              />
            </div>
            <div
              className="md-editor-divider-h"
              onMouseDown={handlePlanDividerMouseDown}
              style={{
                width: '2px',
                flexShrink: 0,
                cursor: 'col-resize',
                backgroundColor: 'var(--border)',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--accent-blue)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--border)'; }}
            />
          </>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minWidth: 80 }}>
            <TerminalView ref={terminalViewRef} sessionId={terminal.id} />
            {!terminal.connected && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'var(--bg-secondary)',
                opacity: 0.85,
                zIndex: 2,
                pointerEvents: 'none',
              }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic' }}>
                  Connecting...
                </span>
              </div>
            )}
          </div>

          {chatOpen && (
            <>
              <div
                className="md-editor-divider"
                onMouseDown={handleChatDividerMouseDown}
              />
              <div style={{ height: `${chatHeightPercent}%`, minHeight: 80, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 8px',
                  height: '22px',
                  flexShrink: 0,
                  backgroundColor: 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--accent-blue)', fontWeight: 500 }}>Chat</span>
                    <button
                      className="pane-btn"
                      onClick={() => editorRef.current?.send()}
                      disabled={!editorHasContent}
                      title="Send to terminal (Ctrl+Enter)"
                      style={!editorHasContent ? { opacity: 0.4, cursor: 'default' } : { color: 'var(--accent-green)' }}
                    >
                      Send
                    </button>
                    <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>Ctrl+Enter</span>
                  </div>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <MarkdownEditor
                    ref={editorRef}
                    onSend={handleEditorSend}
                    onContentChange={setEditorHasContent}
                    sessionId={terminal.id}
                    token={token || ''}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {terminal.error && (
        <div style={{
          padding: '2px 8px',
          backgroundColor: 'var(--bg-secondary)',
          borderTop: '1px solid var(--accent-red)',
          color: 'var(--accent-red)',
          fontSize: '11px',
          flexShrink: 0,
        }}>
          {terminal.error}
        </div>
      )}
    </div>
  );
});
