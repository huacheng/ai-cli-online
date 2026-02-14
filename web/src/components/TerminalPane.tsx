import { memo, useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { PlanPanel } from './PlanPanel';
import { MarkdownEditor, MarkdownEditorHandle } from './MarkdownEditor';
import { uploadFiles, fetchCwd, downloadCwd, fetchFiles, downloadFile } from '../api/files';
import type { FileEntry } from '../api/files';
import { formatSize, fileIcon } from '../utils';

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalViewRef = useRef<TerminalViewHandle>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [editorHasContent, setEditorHasContent] = useState(false);

  // Download popup state
  const [showDownloadPopup, setShowDownloadPopup] = useState(false);
  const [downloadFiles, setDownloadFiles] = useState<FileEntry[]>([]);
  const [downloadDir, setDownloadDir] = useState('');
  const [downloadDirStack, setDownloadDirStack] = useState<string[]>([]);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const downloadPopupRef = useRef<HTMLDivElement>(null);
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

  // Open download popup — fetch CWD file list
  const handleOpenDownloadPopup = useCallback(async () => {
    if (!token) return;
    setDownloadLoading(true);
    setShowDownloadPopup(true);
    try {
      const res = await fetchFiles(token, terminal.id);
      setDownloadDir(res.cwd);
      setDownloadFiles(res.files);
      setDownloadDirStack([]);
    } catch (err) {
      console.error('[download-popup] Failed to list files:', err);
      setShowDownloadPopup(false);
    } finally {
      setDownloadLoading(false);
    }
  }, [token, terminal.id]);

  // Navigate into a subdirectory in download popup
  const handleDownloadNavigate = useCallback(async (dirPath: string) => {
    if (!token) return;
    setDownloadLoading(true);
    try {
      const res = await fetchFiles(token, terminal.id, dirPath);
      setDownloadDirStack((prev) => [...prev, downloadDir]);
      setDownloadDir(dirPath);
      setDownloadFiles(res.files);
    } catch (err) {
      console.error('[download-popup] Failed to navigate:', err);
    } finally {
      setDownloadLoading(false);
    }
  }, [token, terminal.id, downloadDir]);

  // Go back to parent directory in download popup
  const handleDownloadBack = useCallback(async () => {
    if (!token || downloadDirStack.length === 0) return;
    const parentDir = downloadDirStack[downloadDirStack.length - 1];
    setDownloadLoading(true);
    try {
      const res = await fetchFiles(token, terminal.id, parentDir);
      setDownloadDirStack((prev) => prev.slice(0, -1));
      setDownloadDir(parentDir);
      setDownloadFiles(res.files);
    } catch (err) {
      console.error('[download-popup] Failed to go back:', err);
    } finally {
      setDownloadLoading(false);
    }
  }, [token, terminal.id, downloadDirStack]);

  // Download a single file from popup
  const handleDownloadSingleFile = useCallback(async (filePath: string) => {
    if (!token) return;
    try {
      await downloadFile(token, terminal.id, filePath);
    } catch (err) {
      console.error('[download-file] Failed:', err);
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [token, terminal.id]);

  // Close download popup on ESC or click outside
  useEffect(() => {
    if (!showDownloadPopup) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDownloadPopup(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (downloadPopupRef.current && !downloadPopupRef.current.contains(e.target as Node)) {
        setShowDownloadPopup(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    // Delay click listener to avoid immediate close from the button click
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 50);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
      clearTimeout(timer);
    };
  }, [showDownloadPopup]);

  // Plan Send -> send annotations directly to terminal PTY
  const handlePlanSendToTerminal = useCallback((text: string) => {
    if (terminalViewRef.current) {
      const merged = text.replace(/\r?\n/g, ' ').trimEnd();
      terminalViewRef.current.sendInput(merged);
      setTimeout(() => terminalViewRef.current?.sendInput('\r'), 50);
    }
  }, []);

  // Plan close -> forward annotations to chat editor
  const handlePlanForwardToChat = useCallback((summary: string) => {
    if (summary && editorRef.current) {
      editorRef.current.fillContent(summary);
    }
  }, []);

  // Chat vertical divider drag
  const handleChatDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = outerRef.current;
    if (!container) return;
    // Measure from after the title bar (24px)
    const rect = container.getBoundingClientRect();
    const containerHeight = rect.height - 24; // subtract title bar

    document.body.classList.add('resizing-panes-v');

    const onMouseMove = (ev: MouseEvent) => {
      const localY = ev.clientY - rect.top - 24;
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
      const planPct = ((ev.clientX - rect.left) / containerWidth) * 100;
      const clamped = Math.min(80, Math.max(20, planPct));
      setPlanWidthPercent(clamped);
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
                opacity: 0.6,
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
          {/* Download button + popup */}
          <div style={{ position: 'relative' }}>
            <button
              className="pane-btn"
              onClick={handleOpenDownloadPopup}
              disabled={downloading}
              style={downloading ? { color: 'var(--accent-yellow)' } : undefined}
              title={downloading ? 'Downloading...' : 'Download files'}
              aria-label="Download files"
            >
              {downloading ? '...' : '\u2193'}
            </button>
            {showDownloadPopup && (
              <div
                ref={downloadPopupRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  width: 300,
                  maxHeight: 360,
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  zIndex: 100,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {/* Header: current path + back button */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 8px',
                  borderBottom: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-secondary)',
                  flexShrink: 0,
                }}>
                  {downloadDirStack.length > 0 && (
                    <button
                      className="pane-btn"
                      onClick={handleDownloadBack}
                      disabled={downloadLoading}
                      style={{ fontSize: 11, flexShrink: 0 }}
                      title="Go back"
                    >
                      ..
                    </button>
                  )}
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl',
                    textAlign: 'left',
                    flex: 1,
                  }}>
                    {downloadDir.split('/').slice(-2).join('/') || downloadDir}
                  </span>
                  <button
                    className="pane-btn"
                    onClick={() => setShowDownloadPopup(false)}
                    style={{ fontSize: 11, flexShrink: 0 }}
                    title="Close"
                  >
                    &times;
                  </button>
                </div>

                {/* File list */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
                  {downloadLoading ? (
                    <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
                      Loading...
                    </div>
                  ) : downloadFiles.length === 0 ? (
                    <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12, fontStyle: 'italic' }}>
                      Empty directory
                    </div>
                  ) : (
                    downloadFiles.map((f) => (
                      <div
                        key={f.name}
                        onClick={() => {
                          const fullPath = downloadDir + '/' + f.name;
                          if (f.type === 'directory') {
                            handleDownloadNavigate(fullPath);
                          } else {
                            handleDownloadSingleFile(fullPath);
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 10px',
                          cursor: 'pointer',
                          fontSize: 12,
                          color: 'var(--text-primary)',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--bg-secondary)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
                      >
                        <span style={{ flexShrink: 0, fontSize: 13 }}>
                          {f.type === 'directory' ? '\u{1F4C1}' : fileIcon(f.name, f.type)}
                        </span>
                        <span style={{
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {f.name}
                        </span>
                        {f.type === 'directory' ? (
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>&rsaquo;</span>
                        ) : f.size != null ? (
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0 }}>{formatSize(f.size)}</span>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                {/* Footer: download all */}
                <div style={{
                  borderTop: '1px solid var(--border)',
                  padding: '6px 8px',
                  flexShrink: 0,
                  backgroundColor: 'var(--bg-secondary)',
                }}>
                  <button
                    className="pane-btn"
                    onClick={async () => {
                      setDownloading(true);
                      setShowDownloadPopup(false);
                      try {
                        await downloadCwd(token || '', terminal.id);
                      } catch (err) {
                        console.error('[download-cwd] Failed:', err);
                        alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                      } finally {
                        setDownloading(false);
                      }
                    }}
                    style={{ fontSize: 11, color: 'var(--accent-blue)', width: '100%', textAlign: 'center' }}
                    title="Download entire CWD as tar.gz"
                  >
                    Download All (tar.gz)
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Chat panel toggle */}
          <button
            className={`pane-btn${chatOpen ? ' pane-btn--active' : ''}`}
            onClick={() => toggleChat(terminal.id)}
            title="Toggle Chat panel"
            aria-label="Toggle Chat panel"
          >
            Chat
          </button>
          {/* Task panel toggle */}
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
        {/* Plan panel (left side) + Horizontal divider */}
        {planOpen && (
          <>
            <div style={{ width: `${planWidthPercent}%`, minWidth: 200, flexShrink: 0, overflow: 'hidden' }}>
              <PlanPanel
                sessionId={terminal.id}
                token={token || ''}
                connected={terminal.connected}
                onRequestFileStream={(path) => terminalViewRef.current?.requestFileStream(path)}
                onCancelFileStream={() => terminalViewRef.current?.cancelFileStream()}
                onForwardToChat={handlePlanForwardToChat}
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

        {/* Right column: Terminal + Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
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
