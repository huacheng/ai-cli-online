import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { PlanPanel } from './PlanPanel';
import { MarkdownEditor, MarkdownEditorHandle } from './MarkdownEditor';
import { uploadFiles, fetchCwd } from '../api/files';

import type { TerminalInstance } from '../types';
import type { TerminalViewHandle } from './TerminalView';

interface TerminalPaneProps {
  terminal: TerminalInstance;
  canClose: boolean;
}

const NARROW_THRESHOLD = 600;

/** Shared matchMedia hook — single listener, only fires when crossing the threshold */
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

  const handleSplit = useCallback(async (direction: 'horizontal' | 'vertical') => {
    let cwd: string | undefined;
    if (token) {
      try { cwd = await fetchCwd(token, terminal.id); } catch { /* use default */ }
    }
    splitTerminal(terminal.id, direction, cwd);
  }, [token, terminal.id, splitTerminal]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalViewRef = useRef<TerminalViewHandle>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editorHasContent, setEditorHasContent] = useState(false);
  const outerRef = useRef<HTMLDivElement>(null);
  const topRowRef = useRef<HTMLDivElement>(null);

  // Plan width percent (horizontal resize)
  const [planWidthPercent, setPlanWidthPercent] = useState(() => {
    const saved = localStorage.getItem(`plan-width-${terminal.id}`);
    if (saved) {
      const n = Number(saved);
      if (Number.isFinite(n) && n >= 20 && n <= 80) return n;
    }
    return 50;
  });

  // Persist plan width
  const prevPlanWidthRef = useRef(planWidthPercent);
  if (planWidthPercent !== prevPlanWidthRef.current) {
    prevPlanWidthRef.current = planWidthPercent;
    try { localStorage.setItem(`plan-width-${terminal.id}`, String(Math.round(planWidthPercent))); } catch { /* full */ }
  }

  // Chat height percent (vertical resize)
  const [chatHeightPercent, setChatHeightPercent] = useState(() => {
    const saved = localStorage.getItem(`doc-height-${terminal.id}`);
    if (saved) {
      const n = Number(saved);
      if (Number.isFinite(n) && n >= 15 && n <= 60) return n;
    }
    return 35;
  });

  // Persist chat height
  const prevChatHeightRef = useRef(chatHeightPercent);
  if (chatHeightPercent !== prevChatHeightRef.current) {
    prevChatHeightRef.current = chatHeightPercent;
    try { localStorage.setItem(`doc-height-${terminal.id}`, String(Math.round(chatHeightPercent))); } catch { /* full */ }
  }

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

  // Clean up editor send timer on unmount
  useEffect(() => {
    return () => { if (sendTimerRef.current) clearTimeout(sendTimerRef.current); };
  }, []);

  // Plan close -> forward annotations to chat editor
  const handlePlanForwardToChat = useCallback((summary: string) => {
    if (summary && editorRef.current) {
      editorRef.current.fillContent(summary);
    }
  }, []);

  // Plan close (×) -> forward + toggle off
  const handlePlanClose = useCallback(() => {
    togglePlan(terminal.id);
  }, [togglePlan, terminal.id]);

  // Chat vertical divider drag
  const handleChatDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = outerRef.current;
    if (!container) return;
    // Measure from after the title bar (28px)
    const rect = container.getBoundingClientRect();
    const containerHeight = rect.height - 28; // subtract title bar

    document.body.classList.add('resizing-panes-v');

    const onMouseMove = (ev: MouseEvent) => {
      const localY = ev.clientY - rect.top - 28;
      const terminalPct = (localY / containerHeight) * 100;
      const clamped = Math.min(85, Math.max(40, terminalPct));
      setChatHeightPercent(100 - clamped);
    };

    const onMouseUp = () => {
      document.body.classList.remove('resizing-panes-v');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Plan horizontal divider drag
  const handlePlanDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = topRowRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;

    document.body.classList.add('resizing-panes');

    const onMouseMove = (ev: MouseEvent) => {
      const termPct = ((ev.clientX - rect.left) / containerWidth) * 100;
      const clamped = Math.min(80, Math.max(20, termPct));
      setPlanWidthPercent(100 - clamped);
    };

    const onMouseUp = () => {
      document.body.classList.remove('resizing-panes');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: terminal.connected ? 'var(--accent-green)' : 'var(--accent-red)',
          }} />
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {terminal.id}
            {terminal.connected
              ? (terminal.sessionResumed ? ' (resumed)' : '')
              : ' (disconnected)'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          {/* Upload button */}
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
          {/* Chat panel toggle */}
          <button
            className={`pane-btn${chatOpen ? ' pane-btn--active' : ''}`}
            onClick={() => toggleChat(terminal.id)}
            title="Toggle Chat panel"
            aria-label="Toggle Chat panel"
          >
            Chat
          </button>
          {/* Plan panel toggle */}
          <button
            className={`pane-btn${planOpen ? ' pane-btn--active' : ''}`}
            onClick={() => togglePlan(terminal.id)}
            title="Toggle Plan annotation panel"
            aria-label="Toggle Plan annotation panel"
          >
            Plan
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

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {/* Top row: Terminal | Plan */}
        <div ref={topRowRef} style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 80 }}>
          {/* Terminal */}
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

          {/* Horizontal divider + Plan panel (right side) */}
          {planOpen && (
            <>
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
              <div style={{ width: `${planWidthPercent}%`, minWidth: 200, flexShrink: 0, overflow: 'hidden' }}>
                <PlanPanel
                  sessionId={terminal.id}
                  token={token || ''}
                  connected={terminal.connected}
                  onRequestFileStream={(path) => terminalViewRef.current?.requestFileStream(path)}
                  onCancelFileStream={() => terminalViewRef.current?.cancelFileStream()}
                  onClose={handlePlanClose}
                  onForwardToChat={handlePlanForwardToChat}
                />
              </div>
            </>
          )}
        </div>

        {/* Vertical divider + Chat panel (bottom) */}
        {chatOpen && (
          <>
            <div
              className="md-editor-divider"
              onMouseDown={handleChatDividerMouseDown}
            />
            <div style={{ height: `${chatHeightPercent}%`, minHeight: 80, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}>
              {/* Chat toolbar */}
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
                <button
                  className="pane-btn pane-btn--danger"
                  onClick={() => toggleChat(terminal.id)}
                  title="Close Chat panel"
                >
                  &times;
                </button>
              </div>
              {/* Editor */}
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

      {/* Error bar */}
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
