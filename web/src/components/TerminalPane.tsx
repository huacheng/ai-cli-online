import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { FileBrowser } from './FileBrowser';
import { PlanPanel } from './PlanPanel';
import { uploadFiles } from '../api/files';

import type { TerminalInstance } from '../types';
import type { TerminalViewHandle } from './TerminalView';

interface TerminalPaneProps {
  terminal: TerminalInstance;
  canClose: boolean;
}

const DOC_MIN_HEIGHT = 100;
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

  const setTerminalPanelMode = useStore((s) => s.setTerminalPanelMode);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalViewRef = useRef<TerminalViewHandle>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [docHeightPercent, setDocHeightPercent] = useState(50);

  // Panel mode from store (persists across tab switches)
  const docOpen = terminal.panelMode !== 'none';
  const planMode = terminal.panelMode === 'plan';
  const outerRef = useRef<HTMLDivElement>(null);

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

  // Send editor text to terminal PTY as a single string (strip newlines, ensure trailing \r for Enter)
  const sendTimerRef = useRef<number>(undefined);
  const handleEditorSend = useCallback((text: string) => {
    if (terminalViewRef.current) {
      const merged = text.replace(/\r?\n/g, ' ').trimEnd();
      // PTY raw mode: \r = Enter (carriage return), send text then \r separately to ensure Enter fires
      terminalViewRef.current.sendInput(merged);
      sendTimerRef.current = window.setTimeout(() => terminalViewRef.current?.sendInput('\r'), 50);
    }
  }, []);

  // Clean up editor send timer on unmount
  useEffect(() => {
    return () => { if (sendTimerRef.current) clearTimeout(sendTimerRef.current); };
  }, []);

  // Drag resize for plan panel (vertical divider)
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = outerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const containerHeight = rect.height;

    document.body.classList.add('resizing-panes-v');

    const onMouseMove = (ev: MouseEvent) => {
      const terminalPct = ((ev.clientY - rect.top) / containerHeight) * 100;
      // Plan panel is bottom part; clamp terminal between 20% and 80%
      const clamped = Math.min(80, Math.max(20, terminalPct));
      setDocHeightPercent(100 - clamped);
    };

    const onMouseUp = () => {
      document.body.classList.remove('resizing-panes-v');
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
        backgroundColor: '#16161e',
        borderBottom: '1px solid #292e42',
        flexShrink: 0,
        height: '28px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            display: 'inline-block',
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            backgroundColor: terminal.connected ? '#9ece6a' : '#f7768e',
            boxShadow: terminal.connected ? '0 0 4px rgba(158,206,106,0.5)' : '0 0 4px rgba(247,118,142,0.5)',
          }} />
          <span style={{ fontSize: '14px', color: '#565f89' }}>
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
            style={uploading ? { color: '#e0af68' } : undefined}
            title={uploading ? `Uploading ${uploadProgress}%` : 'Upload files'}
            aria-label="Upload files"
          >
            {uploading ? `${uploadProgress}%` : '\u2191'}
          </button>
          {/* Download / File Browser button */}
          <button
            className="pane-btn"
            onClick={() => setFileBrowserOpen((v) => !v)}
            style={fileBrowserOpen ? { color: '#7aa2f7' } : undefined}
            title="Browse files"
            aria-label="Browse files"
          >
            {'\u2193'}
          </button>
          {/* Chat panel toggle */}
          <button
            className={`pane-btn${terminal.panelMode === 'chat' ? ' pane-btn--active' : ''}`}
            onClick={() => setTerminalPanelMode(terminal.id, terminal.panelMode === 'chat' ? 'none' : 'chat')}
            title="Toggle Chat panel"
            aria-label="Toggle Chat panel"
          >
            Chat
          </button>
          {/* Plan mode toggle */}
          <button
            className={`pane-btn${terminal.panelMode === 'plan' ? ' pane-btn--active' : ''}`}
            onClick={() => setTerminalPanelMode(terminal.id, terminal.panelMode === 'plan' ? 'none' : 'plan')}
            title="Toggle Plan annotation mode"
            aria-label="Toggle Plan annotation mode"
          >
            Plan
          </button>
          <button
            className="pane-btn"
            onClick={() => splitTerminal(terminal.id, isNarrow ? 'vertical' : 'horizontal')}
            title={isNarrow ? 'Split vertical (screen too narrow for horizontal)' : 'Split horizontal (left/right)'}
            aria-label="Split horizontal"
          >
            |
          </button>
          <button
            className="pane-btn"
            onClick={() => splitTerminal(terminal.id, 'vertical')}
            title="Split vertical (top/bottom)"
            aria-label="Split vertical"
          >
            ─
          </button>
        </div>
      </div>

      {/* Terminal + FileBrowser overlay */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: '80px' }}>
        <TerminalView ref={terminalViewRef} sessionId={terminal.id} />
        {!terminal.connected && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(26, 27, 38, 0.85)',
            zIndex: 2,
            pointerEvents: 'none',
          }}>
            <span style={{ color: '#565f89', fontSize: '13px', fontStyle: 'italic' }}>
              Connecting...
            </span>
          </div>
        )}
        {fileBrowserOpen && (
          <FileBrowser
            sessionId={terminal.id}
            onClose={() => setFileBrowserOpen(false)}
          />
        )}
      </div>

      {/* Resize divider + Doc panel */}
      {docOpen && (
        <>
          <div
            className="md-editor-divider"
            onMouseDown={handleDividerMouseDown}
          />
          <div style={{ height: `${docHeightPercent}%`, minHeight: DOC_MIN_HEIGHT, flexShrink: 0, overflow: 'hidden' }}>
            <PlanPanel
              onSend={handleEditorSend}
              onClose={() => setTerminalPanelMode(terminal.id, 'none')}
              sessionId={terminal.id}
              token={token || ''}
              connected={terminal.connected}
              onRequestFileStream={(path) => terminalViewRef.current?.requestFileStream(path)}
              onCancelFileStream={() => terminalViewRef.current?.cancelFileStream()}
              planMode={planMode}
              onPlanModeClose={() => setTerminalPanelMode(terminal.id, 'chat')}
            />
          </div>
        </>
      )}

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
});
