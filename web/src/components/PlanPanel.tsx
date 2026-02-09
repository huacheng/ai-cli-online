import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MarkdownEditor, MarkdownEditorHandle } from './MarkdownEditor';
import { DocumentPicker } from './DocumentPicker';
import { PdfRenderer } from './PdfRenderer';
import { VirtualTextRenderer } from './VirtualTextRenderer';
import { useFileStream } from '../hooks/useFileStream';
import { registerFileStreamHandler, unregisterFileStreamHandler } from '../fileStreamBus';
import { useHorizontalResize } from '../hooks/useHorizontalResize';
import { useFileBrowser } from '../hooks/useFileBrowser';
import { FileListHeader, FileListStatus } from './FileListShared';
import type { FileEntry } from '../api/files';

interface PlanPanelProps {
  sessionId: string;
  token: string;
  onClose: () => void;
  onSend: (text: string) => void;
  onRequestFileStream?: (path: string) => void;
  onCancelFileStream?: () => void;
}

type DocType = 'md' | 'html' | 'pdf' | 'text' | null;

function getDocType(path: string): DocType {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (ext === '.md') return 'md';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.pdf') return 'pdf';
  return 'text';
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(f: FileEntry): string {
  if (f.type === 'directory') return '\u{1F4C1}';
  const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
  if (ext === '.pdf') return '\u{1F4D5}';
  if (ext === '.html' || ext === '.htm') return '\u{1F310}';
  if (ext === '.md') return '\u{1F4DD}';
  return '\u{1F4C4}';
}

const CWD_POLL_INTERVAL = 3000;

/** Inline directory browser shown when no document is open */
function InlineDocBrowser({ sessionId, onSelect }: { sessionId: string; onSelect: (path: string) => void }) {
  const noop = useCallback(() => {}, []);
  const { cwd, files, loading, error, handleNavigate, handleGoUp, handleRefresh } =
    useFileBrowser({ sessionId, onClose: noop, pollCwd: CWD_POLL_INTERVAL });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <FileListHeader cwd={cwd} onGoUp={handleGoUp} onRefresh={handleRefresh} onClose={noop} />
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <FileListStatus loading={loading} error={error} empty={files.length === 0} emptyText="No files found" />
        {!loading && !error && files.map((file) => (
          <div
            key={file.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 12px',
              fontSize: 13,
              cursor: 'pointer',
              borderBottom: '1px solid #1e2030',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#24283b'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            onClick={() => {
              if (file.type === 'directory') handleNavigate(file.name);
              else onSelect(cwd + '/' + file.name);
            }}
          >
            <span style={{ width: 20, flexShrink: 0, marginRight: 6, color: file.type === 'directory' ? '#7aa2f7' : '#565f89' }}>
              {fileIcon(file)}
            </span>
            <span style={{
              flex: 1,
              color: file.type === 'directory' ? '#7aa2f7' : '#a9b1d6',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              {file.name}
            </span>
            {file.type === 'file' && (
              <>
                <span style={{
                  fontSize: 10,
                  color: '#565f89',
                  marginLeft: 6,
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}>
                  {formatSize(file.size)}
                </span>
                <span style={{
                  fontSize: 10,
                  color: '#565f89',
                  background: '#24283b',
                  padding: '1px 5px',
                  borderRadius: 3,
                  marginLeft: 6,
                  flexShrink: 0,
                }}>
                  {file.name.slice(file.name.lastIndexOf('.')).toLowerCase()}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlanPanel({ sessionId, token, onClose, onSend, onRequestFileStream }: PlanPanelProps) {
  // Document state
  const [docPath, setDocPath] = useState<string | null>(null);
  const [docType, setDocType] = useState<DocType>(null);

  // File stream hook
  const fileStream = useFileStream();

  // UI state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Horizontal resize (extracted hook)
  const { leftWidthPercent, containerRef, onDividerMouseDown } = useHorizontalResize(50);

  // Editor ref + content tracking
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [editorHasContent, setEditorHasContent] = useState(false);

  // Scroll position memory: filePath → scrollTop
  const scrollPositionsRef = useRef(new Map<string, number>());
  const rendererScrollRef = useRef<HTMLDivElement | null>(null);
  const expandedScrollRef = useRef<HTMLDivElement | null>(null);

  // Register file stream event bus handler
  useEffect(() => {
    registerFileStreamHandler(sessionId, fileStream.handleChunk, fileStream.handleControl);
    return () => unregisterFileStreamHandler(sessionId);
  }, [sessionId, fileStream.handleChunk, fileStream.handleControl]);

  // Save scroll position for current doc
  const saveScrollPosition = useCallback(() => {
    if (!docPath) return;
    const el = expanded ? expandedScrollRef.current : rendererScrollRef.current;
    if (el) {
      scrollPositionsRef.current.set(docPath, el.scrollTop);
    }
  }, [docPath, expanded]);

  // Restore scroll position for a doc
  const restoreScrollPosition = useCallback((path: string) => {
    const saved = scrollPositionsRef.current.get(path);
    if (saved == null) return;
    requestAnimationFrame(() => {
      const el = expanded ? expandedScrollRef.current : rendererScrollRef.current;
      if (el) el.scrollTop = saved;
    });
  }, [expanded]);

  // Open a document — all files go through WS stream
  const openDoc = useCallback((path: string, _size?: number) => {
    saveScrollPosition();
    const type = getDocType(path);
    setDocPath(path);
    setDocType(type);
    setPickerOpen(false);

    // Reset and start stream with appropriate mode
    fileStream.reset();
    const mode = type === 'text' ? 'lines'
               : type === 'pdf' ? 'binary'
               : 'content';  // md, html
    fileStream.startStream(mode);
    onRequestFileStream?.(path);
  }, [saveScrollPosition, fileStream, onRequestFileStream]);

  // Copy path to clipboard
  const handleCopyPath = useCallback(() => {
    if (!docPath) return;
    navigator.clipboard.writeText(docPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [docPath]);

  // Close expanded view on ESC
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        saveScrollPosition();
        setExpanded(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded, saveScrollPosition]);

  // Sync scroll when toggling expanded
  useEffect(() => {
    if (docPath && fileStream.state.status === 'complete') restoreScrollPosition(docPath);
  }, [expanded, docPath, restoreScrollPosition, fileStream.state.status]);

  // Progress bar data
  const { status, totalSize, receivedBytes } = fileStream.state;
  const streamPct = totalSize > 0 ? Math.round((receivedBytes / totalSize) * 100) : 0;

  // Render document content
  const renderDoc = (scrollRefSetter?: (el: HTMLDivElement | null) => void) => {
    if (!docPath) {
      return <InlineDocBrowser sessionId={sessionId} onSelect={openDoc} />;
    }

    const { status: st, lines, content, buffer } = fileStream.state;

    // Error state
    if (st === 'error') {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#f7768e',
          fontSize: '13px',
          padding: '12px',
          textAlign: 'center',
        }}>
          {fileStream.state.error || 'Stream error'}
        </div>
      );
    }

    // Streaming: text renders progressively, others wait
    if (st === 'streaming') {
      if (docType === 'text') {
        return (
          <VirtualTextRenderer
            lines={lines}
            totalSize={totalSize}
            receivedBytes={receivedBytes}
            streaming={true}
          />
        );
      }
      // md/html/pdf — show loading, progress bar is in toolbar
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#565f89',
          fontSize: '13px',
        }}>
          Loading...
        </div>
      );
    }

    // Complete: render by type
    if (st === 'complete') {
      if (docType === 'text') {
        return (
          <VirtualTextRenderer
            lines={lines}
            totalSize={totalSize}
            receivedBytes={receivedBytes}
            streaming={false}
          />
        );
      }
      if (docType === 'md') {
        return (
          <div ref={scrollRefSetter} style={{ height: '100%', overflow: 'auto' }}>
            <MarkdownRenderer content={content} />
          </div>
        );
      }
      if (docType === 'html') {
        return (
          <div ref={scrollRefSetter} style={{ height: '100%', overflow: 'auto' }}>
            <iframe
              srcDoc={content}
              sandbox=""
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                backgroundColor: '#fff',
              }}
              title="HTML Preview"
            />
          </div>
        );
      }
      if (docType === 'pdf' && buffer) {
        return <PdfRenderer data={buffer} scrollRef={scrollRefSetter} />;
      }
    }

    // idle — show inline browser
    if (st === 'idle') {
      return <InlineDocBrowser sessionId={sessionId} onSelect={openDoc} />;
    }

    return null;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#1a1b26',
      overflow: 'hidden',
    }}>
      {/* Toolbar — mirrors left/right split below */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        height: '28px',
        flexShrink: 0,
        backgroundColor: '#16161e',
        borderBottom: '1px solid #292e42',
      }}>
        {/* Left section: Open + file info + progress bar (matches doc preview width) */}
        <div style={{
          width: `${leftWidthPercent}%`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 8px',
          minWidth: 0,
        }}>
          <button
            className="pane-btn"
            onClick={() => setPickerOpen((v) => !v)}
            title="Open document"
            style={{ color: '#7aa2f7' }}
          >
            Open
          </button>
          {docPath && (
            <>
              <span
                style={{
                  fontSize: '11px',
                  color: '#565f89',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  cursor: 'pointer',
                }}
                onClick={handleCopyPath}
                title={copied ? 'Copied!' : `Click to copy: ${docPath}`}
              >
                {copied ? 'Copied!' : getFileName(docPath)}
              </span>
              <button
                className="pane-btn"
                onClick={() => {
                  saveScrollPosition();
                  setExpanded(true);
                }}
                title="Expand document view"
                style={{ fontSize: '12px' }}
              >
                &#x26F6;
              </button>
            </>
          )}
          {/* Progress bar — shown during streaming */}
          {status === 'streaming' && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
              <div style={{
                flex: 1, height: 4, backgroundColor: '#292e42', borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${streamPct}%`,
                  backgroundColor: '#7aa2f7',
                  transition: 'width 0.2s',
                }} />
              </div>
              <span style={{ fontSize: 10, color: '#565f89', whiteSpace: 'nowrap' }}>
                {streamPct}%
              </span>
            </div>
          )}
        </div>

        {/* 4px gap matching the divider width */}
        <div style={{ width: '4px', flexShrink: 0 }} />

        {/* Right section: Send + close (matches editor width) */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          minWidth: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              className="pane-btn"
              onClick={() => editorRef.current?.send()}
              disabled={!editorHasContent}
              title="Send to terminal (Ctrl+Enter)"
              style={!editorHasContent ? { opacity: 0.4, cursor: 'default' } : { color: '#9ece6a' }}
            >
              Send
            </button>
            <span style={{ fontSize: '10px', color: '#414868' }}>Ctrl+Enter</span>
          </div>
          <button
            className="pane-btn pane-btn--danger"
            onClick={onClose}
            title="Close Doc panel"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Left/Right split body */}
      <div ref={containerRef} className="plan-panel-body" style={{ position: 'relative' }}>
        {/* Left: Document renderer */}
        <div className="plan-renderer" style={{ width: `${leftWidthPercent}%`, flexShrink: 0 }}>
          {renderDoc((el) => { rendererScrollRef.current = el; })}
          {/* Document Picker overlay (scoped to renderer area) */}
          {pickerOpen && (
            <DocumentPicker
              sessionId={sessionId}
              onSelect={openDoc}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>

        {/* Horizontal divider */}
        <div className="plan-divider-h" onMouseDown={onDividerMouseDown} />

        {/* Right: Editor */}
        <div className="plan-editor-wrap">
          <MarkdownEditor
            ref={editorRef}
            onSend={onSend}
            onContentChange={setEditorHasContent}
            sessionId={sessionId}
            token={token}
          />
        </div>
      </div>

      {/* Expanded overlay */}
      {expanded && (
        <div className="doc-expanded-overlay">
          <div className="doc-expanded-header">
            <span style={{
              fontSize: '12px',
              color: '#a9b1d6',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {docPath ? getFileName(docPath) : ''}
            </span>
            <button
              className="pane-btn pane-btn--danger"
              onClick={() => {
                saveScrollPosition();
                setExpanded(false);
              }}
              title="Close expanded view (ESC)"
            >
              &times;
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {renderDoc((el) => { expandedScrollRef.current = el; })}
          </div>
        </div>
      )}
    </div>
  );
}
