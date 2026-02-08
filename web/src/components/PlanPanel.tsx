import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MarkdownEditor, MarkdownEditorHandle } from './MarkdownEditor';
import { DocumentPicker } from './DocumentPicker';
import { PdfRenderer } from './PdfRenderer';
import { fetchFileContent } from '../api/docs';
import { useHorizontalResize } from '../hooks/useHorizontalResize';

interface PlanPanelProps {
  sessionId: string;
  token: string;
  onClose: () => void;
  onSend: (text: string) => void;
}

const POLL_INTERVAL = 3000;

type DocType = 'md' | 'html' | 'pdf' | null;

function getDocType(path: string): DocType {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (ext === '.md') return 'md';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.pdf') return 'pdf';
  return null;
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function PlanPanel({ sessionId, token, onClose, onSend }: PlanPanelProps) {
  // Document state
  const [docPath, setDocPath] = useState<string | null>(null);
  const [docContent, setDocContent] = useState('');
  const [docType, setDocType] = useState<DocType>(null);
  const docMtimeRef = useRef(0);

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

  // Open a document
  const openDoc = useCallback((path: string) => {
    saveScrollPosition();
    const type = getDocType(path);
    setDocPath(path);
    setDocType(type);
    setDocContent('');
    docMtimeRef.current = 0;
    setPickerOpen(false);

    // Fetch immediately
    fetchFileContent(token, sessionId, path).then((result) => {
      if (result) {
        setDocContent(result.content);
        docMtimeRef.current = result.mtime;
        requestAnimationFrame(() => restoreScrollPosition(path));
      }
    }).catch(() => {});
  }, [token, sessionId, saveScrollPosition, restoreScrollPosition]);

  // Poll for file changes
  useEffect(() => {
    if (!docPath) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const result = await fetchFileContent(token, sessionId, docPath, docMtimeRef.current);
        if (cancelled) return;
        if (result) {
          setDocContent(result.content);
          docMtimeRef.current = result.mtime;
        }
      } catch {
        // ignore polling errors
      }
    };

    const id = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, sessionId, docPath]);

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
    if (docPath) restoreScrollPosition(docPath);
  }, [expanded, docPath, restoreScrollPosition]);

  // Render document content
  const renderDoc = (scrollRefSetter?: (el: HTMLDivElement | null) => void) => {
    if (!docPath || !docType) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#414868',
          fontStyle: 'italic',
          fontSize: '13px',
        }}>
          Click Open to browse documents
        </div>
      );
    }

    if (!docContent && docType !== 'pdf') {
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

    if (docType === 'md') {
      return (
        <div
          ref={scrollRefSetter}
          style={{ height: '100%', overflow: 'auto' }}
        >
          <MarkdownRenderer content={docContent} />
        </div>
      );
    }

    if (docType === 'html') {
      return (
        <div
          ref={scrollRefSetter}
          style={{ height: '100%', overflow: 'auto' }}
        >
          <iframe
            srcDoc={docContent}
            sandbox="allow-same-origin"
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

    if (docType === 'pdf') {
      return <PdfRenderer data={docContent} scrollRef={scrollRefSetter} />;
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
        {/* Left section: Open + file info (matches doc preview width) */}
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

        {/* Document Picker overlay */}
        {pickerOpen && (
          <DocumentPicker
            sessionId={sessionId}
            onSelect={openDoc}
            onClose={() => setPickerOpen(false)}
          />
        )}
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
