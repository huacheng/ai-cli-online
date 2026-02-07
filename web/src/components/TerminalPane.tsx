import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { FileBrowser } from './FileBrowser';
import { PlanPanel } from './PlanPanel';
import { uploadFiles } from '../api/files';
import { fetchPaneCommand } from '../api/plans';
import type { TerminalInstance } from '../types';
import type { TerminalViewHandle } from './TerminalView';

interface TerminalPaneProps {
  terminal: TerminalInstance;
  canClose: boolean;
}

const PLAN_MIN_HEIGHT = 100;

export const TerminalPane = memo(function TerminalPane({ terminal, canClose }: TerminalPaneProps) {
  const removeTerminal = useStore((s) => s.removeTerminal);
  const splitTerminal = useStore((s) => s.splitTerminal);
  const customName = useStore((s) => s.sessionNames[terminal.id]);
  const token = useStore((s) => s.token);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalViewRef = useRef<TerminalViewHandle>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  const [planHeightPercent, setPlanHeightPercent] = useState(50);
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
  const sendTimerRef = useRef<number>();
  const handleEditorSend = useCallback((text: string) => {
    if (terminalViewRef.current) {
      const merged = text.replace(/\r?\n/g, ' ').trimEnd();
      // PTY raw mode: \r = Enter (carriage return), send text then \r separately to ensure Enter fires
      terminalViewRef.current.sendInput(merged);
      sendTimerRef.current = window.setTimeout(() => terminalViewRef.current?.sendInput('\r'), 50);
    }
  }, []);

  // Check if claude is running, if not start it
  const checkAndStartClaude = useCallback(async () => {
    if (!token) return;
    try {
      const cmd = await fetchPaneCommand(token, terminal.id);
      if (cmd && cmd.toLowerCase().includes('claude')) return; // already running
      terminalViewRef.current?.sendInput('claude\r');
    } catch {
      // ignore — best effort
    }
  }, [token, terminal.id]);

  // Clean up editor send timer on unmount
  useEffect(() => {
    return () => { if (sendTimerRef.current) clearTimeout(sendTimerRef.current); };
  }, []);

  // Toggle plan panel + auto-start claude
  const handlePlanToggle = useCallback(() => {
    setPlanOpen((prev) => {
      if (!prev) {
        // Opening: check and start claude
        checkAndStartClaude();
      }
      return !prev;
    });
  }, [checkAndStartClaude]);

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
      setPlanHeightPercent(100 - clamped);
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
            {customName || terminal.id}
            {customName && <span style={{ color: '#414868' }}> ({terminal.id})</span>}
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
          {/* Plan panel toggle */}
          <button
            className={`pane-btn${planOpen ? ' pane-btn--active' : ''}`}
            onClick={handlePlanToggle}
            title="Toggle Plan panel"
            aria-label="Toggle Plan panel"
          >
            Plan
          </button>
          <button
            className="pane-btn"
            onClick={() => splitTerminal(terminal.id, 'horizontal')}
            title="Split horizontal (left/right)"
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
          {canClose && (
            <button
              className="pane-btn pane-btn--danger"
              onClick={() => removeTerminal(terminal.id)}
              title="Close terminal"
              aria-label="Close terminal"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Terminal + FileBrowser overlay */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: '80px' }}>
        <TerminalView ref={terminalViewRef} sessionId={terminal.id} />
        {fileBrowserOpen && (
          <FileBrowser
            sessionId={terminal.id}
            onClose={() => setFileBrowserOpen(false)}
          />
        )}
      </div>

      {/* Resize divider + Plan panel */}
      {planOpen && (
        <>
          <div
            className="md-editor-divider"
            onMouseDown={handleDividerMouseDown}
          />
          <div style={{ height: `${planHeightPercent}%`, minHeight: PLAN_MIN_HEIGHT, flexShrink: 0, overflow: 'hidden' }}>
            <PlanPanel
              onSend={handleEditorSend}
              onClose={() => setPlanOpen(false)}
              sessionId={terminal.id}
              token={token || ''}
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
