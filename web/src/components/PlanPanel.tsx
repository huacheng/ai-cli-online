import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MarkdownEditor, MarkdownEditorHandle } from './MarkdownEditor';
import { DocumentPicker } from './DocumentPicker';
import { PdfRenderer } from './PdfRenderer';
import { VirtualTextRenderer } from './VirtualTextRenderer';
import { PlanAnnotationRenderer } from './PlanAnnotationRenderer';
import type { PlanAnnotationRendererHandle, PlanAnnotations } from './PlanAnnotationRenderer';
import { generateMultiFileSummary } from './PlanAnnotationRenderer';
import { PlanFileBrowser } from './PlanFileBrowser';
import { useFileStream } from '../hooks/useFileStream';
import { registerFileStreamHandler, unregisterFileStreamHandler } from '../fileStreamBus';
import { useHorizontalResize } from '../hooks/useHorizontalResize';
import { useFileBrowser } from '../hooks/useFileBrowser';
import { FileListHeader, FileListStatus } from './FileListShared';
import { fetchFiles, touchFile, mkdirPath } from '../api/files';
import type { FileEntry } from '../api/files';
import { formatSize, fileIcon } from '../utils';

interface PlanPanelProps {
  sessionId: string;
  token: string;
  connected: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  onRequestFileStream?: (path: string) => void;
  onCancelFileStream?: () => void;
  planMode?: boolean;
  onPlanModeClose?: () => void;
}

type DocType = 'md' | 'html' | 'pdf' | 'image' | 'text' | null;

const IMAGE_EXTS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

function getDocType(path: string): DocType {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (ext === '.md') return 'md';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.pdf') return 'pdf';
  if (ext in IMAGE_EXTS) return 'image';
  return 'text';
}

function getImageMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTS[ext] || 'image/png';
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

const CWD_POLL_INTERVAL = 3000;

/** Centered loading indicator with optional progress bar */
function CenteredLoading({ label, percent }: { label: string; percent?: number }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 8,
    }}>
      <span style={{ color: '#565f89', fontSize: 13 }}>{label}</span>
      {percent != null && (
        <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            flex: 1, height: 4, backgroundColor: '#292e42', borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${percent}%`,
              backgroundColor: '#7aa2f7',
              transition: 'width 0.2s',
            }} />
          </div>
          <span style={{ fontSize: 10, color: '#565f89', whiteSpace: 'nowrap' }}>{percent}%</span>
        </div>
      )}
    </div>
  );
}

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
              {fileIcon(file.name, file.type)}
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
              <span style={{
                fontSize: 10,
                color: '#565f89',
                marginLeft: 6,
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}>
                {formatSize(file.size)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlanPanel({ sessionId, token, connected, onClose, onSend, onRequestFileStream, planMode, onPlanModeClose }: PlanPanelProps) {
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
  const { leftWidthPercent, containerRef, onDividerMouseDown } = useHorizontalResize(50, 20, 80, `plan-hresize-${sessionId}`);

  // Editor ref + content tracking
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const planAnnotationRef = useRef<PlanAnnotationRendererHandle>(null);
  const [editorHasContent, setEditorHasContent] = useState(false);

  // Track which consumer owns the current file stream ('doc' or 'plan')
  const streamTargetRef = useRef<'doc' | 'plan'>('doc');

  // Plan mode state — directory-based (PLAN/ directory with multiple .md files)
  const [planDir, setPlanDir] = useState<string | null>(null);
  const [planSelectedFile, setPlanSelectedFile] = useState<string | null>(null);
  const [planMarkdown, setPlanMarkdown] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  // Cache file content for multi-file annotation aggregation on close
  const planContentCacheRef = useRef(new Map<string, string>());

  // Auto-detect PLAN/ directory when planMode activates
  useEffect(() => {
    if (!planMode) {
      planStreamedRef.current = null;
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    (async () => {
      try {
        const res = await fetchFiles(token, sessionId);
        if (cancelled) return;
        const planDirEntry = res.files.find((f: FileEntry) => f.name === 'PLAN' && f.type === 'directory');
        if (planDirEntry) {
          const dirPath = res.cwd + '/PLAN';
          setPlanDir(dirPath);
          // Check for INDEX.md inside PLAN/
          const innerRes = await fetchFiles(token, sessionId, dirPath);
          if (cancelled) return;
          const indexFile = innerRes.files.find((f: FileEntry) => f.name.toLowerCase() === 'index.md');
          if (indexFile) {
            setPlanSelectedFile(dirPath + '/' + indexFile.name);
          } else {
            // Create INDEX.md
            try {
              const result = await touchFile(token, sessionId, 'PLAN/INDEX.md');
              if (cancelled) return;
              if (result.ok) setPlanSelectedFile(result.path);
            } catch { /* ignore */ }
          }
        } else {
          // Create PLAN/ directory + INDEX.md
          try {
            const mkResult = await mkdirPath(token, sessionId, 'PLAN');
            if (cancelled) return;
            setPlanDir(mkResult.path);
            const touchResult = await touchFile(token, sessionId, 'PLAN/INDEX.md');
            if (cancelled) return;
            if (touchResult.ok) {
              setPlanSelectedFile(touchResult.path);
            }
          } catch {
            setPlanDir(null);
            setPlanSelectedFile(null);
          }
        }
      } catch {
        setPlanDir(null);
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planMode, sessionId, token]);

  // Request file stream once WS is connected and planSelectedFile is known
  const planStreamedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!planMode || !planSelectedFile || !connected) return;
    if (planStreamedRef.current === planSelectedFile && planMarkdown) return;
    planStreamedRef.current = planSelectedFile;
    streamTargetRef.current = 'plan';
    fileStream.reset();
    fileStream.startStream('content');
    onRequestFileStream?.(planSelectedFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planMode, planSelectedFile, connected]);

  // When plan mode stream completes, capture the content
  useEffect(() => {
    if (planMode && fileStream.state.status === 'complete' && planSelectedFile && streamTargetRef.current === 'plan') {
      setPlanMarkdown(fileStream.state.content);
      // Cache content for multi-file aggregation
      planContentCacheRef.current.set(planSelectedFile, fileStream.state.content);
    }
  }, [planMode, fileStream.state.status, fileStream.state.content, planSelectedFile]);

  // Switch file within PLAN/ directory
  const handlePlanFileSelect = useCallback((fullPath: string) => {
    if (fullPath === planSelectedFile) return;
    // Cache current content before switching
    if (planSelectedFile && planMarkdown) {
      planContentCacheRef.current.set(planSelectedFile, planMarkdown);
    }
    setPlanSelectedFile(fullPath);
    setPlanMarkdown('');
    planStreamedRef.current = null; // force re-stream
  }, [planSelectedFile, planMarkdown]);

  // Handle new file creation from PlanFileBrowser
  const handlePlanFileCreate = useCallback((fullPath: string) => {
    setPlanSelectedFile(fullPath);
    setPlanMarkdown('');
    planStreamedRef.current = null;
  }, []);

  // Handle Save from annotation renderer — fill editor directly
  const handlePlanSave = useCallback((summary: string) => {
    if (summary && editorRef.current) {
      editorRef.current.fillContent(summary);
    }
  }, []);

  // Handle Plan overlay close — aggregate all files' un-forwarded annotations + close
  const handlePlanOverlayClose = useCallback(() => {
    // Cache current file content
    if (planSelectedFile && planMarkdown) {
      planContentCacheRef.current.set(planSelectedFile, planMarkdown);
    }

    // Try single-file summary first (current file via ref)
    const singleSummary = planAnnotationRef.current?.getSummary();

    // Collect multi-file annotations from all cached files
    const cache = planContentCacheRef.current;
    const fileAnnotations: Array<{ filePath: string; annotations: PlanAnnotations; sourceLines: string[] }> = [];
    for (const [fp, content] of cache.entries()) {
      // Skip current file — it's handled by ref above, avoid double-counting
      if (fp === planSelectedFile) continue;
      const key = `plan-annotations-${sessionId}-${fp}`;
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const annotations: PlanAnnotations = JSON.parse(saved);
          if (annotations.additions.length > 0 || annotations.deletions.length > 0) {
            fileAnnotations.push({ filePath: fp, annotations, sourceLines: content.split('\n') });
          }
        }
      } catch { /* skip corrupt */ }
    }

    if (fileAnnotations.length > 0) {
      // Multi-file: include current file's annotations too
      if (singleSummary && planSelectedFile) {
        // Get raw annotations for current file to include in multi-file summary
        const currentKey = `plan-annotations-${sessionId}-${planSelectedFile}`;
        try {
          const saved = localStorage.getItem(currentKey);
          if (saved) {
            const annotations: PlanAnnotations = JSON.parse(saved);
            const currentContent = planMarkdown || cache.get(planSelectedFile) || '';
            fileAnnotations.unshift({ filePath: planSelectedFile, annotations, sourceLines: currentContent.split('\n') });
          }
        } catch { /* ignore */ }
      }
      const multiSummary = generateMultiFileSummary(fileAnnotations);
      if (multiSummary && editorRef.current) {
        editorRef.current.fillContent(multiSummary);
      }
    } else if (singleSummary && editorRef.current) {
      editorRef.current.fillContent(singleSummary);
    }
    onPlanModeClose?.();
  }, [onPlanModeClose, planSelectedFile, planMarkdown, sessionId]);

  // Refresh current plan file: re-request file stream
  const handlePlanRefresh = useCallback(() => {
    if (!planSelectedFile || !connected) return;
    planStreamedRef.current = null;
    streamTargetRef.current = 'plan';
    setPlanMarkdown('');
    fileStream.reset();
    fileStream.startStream('content');
    onRequestFileStream?.(planSelectedFile);
    planStreamedRef.current = planSelectedFile;
  }, [planSelectedFile, connected, fileStream, onRequestFileStream]);

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
    streamTargetRef.current = 'doc';
    fileStream.reset();
    const mode = type === 'text' ? 'lines'
               : (type === 'pdf' || type === 'image') ? 'binary'
               : 'content';  // md, html
    fileStream.startStream(mode);
    onRequestFileStream?.(path);
  }, [saveScrollPosition, fileStream, onRequestFileStream]);

  // Refresh current document
  const handleRefresh = useCallback(() => {
    if (!docPath || !docType) return;
    streamTargetRef.current = 'doc';
    fileStream.reset();
    const mode = docType === 'text' ? 'lines'
               : (docType === 'pdf' || docType === 'image') ? 'binary'
               : 'content';
    fileStream.startStream(mode);
    onRequestFileStream?.(docPath);
  }, [docPath, docType, fileStream, onRequestFileStream]);

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
  const { totalSize, receivedBytes } = fileStream.state;
  const streamPct = totalSize > 0 ? Math.round((receivedBytes / totalSize) * 100) : 0;

  // Auto-copy selection to clipboard when user selects text in document viewer
  const handleDocSelectionCopy = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString();
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }, []);

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
      // md/html/pdf — centered loading with progress
      return <CenteredLoading label="Loading..." percent={streamPct} />;
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
          <div ref={scrollRefSetter} style={{ height: '100%' }}>
            <MarkdownRenderer content={content} scrollStorageKey={docPath ? `md-scroll-${sessionId}-${docPath}` : undefined} />
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
      if (docType === 'image' && buffer) {
        const blob = new Blob([buffer.buffer as ArrayBuffer], { type: getImageMime(docPath!) });
        const url = URL.createObjectURL(blob);
        return (
          <div ref={scrollRefSetter} style={{ height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
            <img
              src={url}
              alt={getFileName(docPath!)}
              onLoad={() => URL.revokeObjectURL(url)}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
            />
          </div>
        );
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
        height: '30px',
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
              >
                &#x26F6;
              </button>
              <button
                className="pane-btn"
                onClick={handleRefresh}
                title="Refresh document"
              >
                &#x21BB;
              </button>
            </>
          )}
        </div>

        {/* 4px gap matching the divider width */}
        <div style={{ width: '4px', flexShrink: 0 }} />

        {/* Right section: Editor controls or Plan controls */}
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
        <div className="plan-renderer" style={{ width: `${leftWidthPercent}%`, flexShrink: 0 }} onMouseUp={handleDocSelectionCopy}>
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

        {/* Right: Always Chat Editor */}
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

      {/* Expanded overlay (doc) */}
      {expanded && (
        <div className="doc-expanded-overlay">
          <div className="doc-expanded-header">
            <span style={{
              fontSize: '14px',
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
              style={{ fontSize: '14px' }}
            >
              &times;
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }} onMouseUp={handleDocSelectionCopy}>
            {renderDoc((el) => { expandedScrollRef.current = el; })}
          </div>
        </div>
      )}

      {/* Plan fullscreen overlay — three-column layout */}
      {planMode && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#1a1b26',
        }}>
          {/* Header */}
          <div className="doc-expanded-header">
            <span style={{ fontSize: '14px', color: '#bb9af7' }}>
              Plan: PLAN/{planSelectedFile ? planSelectedFile.split('/').pop() : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                className="pane-btn"
                onClick={handlePlanRefresh}
                title="Refresh current file"
              >
                &#x21BB;
              </button>
              <button
                className="pane-btn pane-btn--danger"
                onClick={handlePlanOverlayClose}
                title="Close Plan (forward annotations to Chat)"
              >
                &times;Plan
              </button>
            </div>
          </div>

          {/* Three-column body */}
          <div className="plan-overlay-body">
            {/* Left: File browser */}
            {planDir && (
              <PlanFileBrowser
                sessionId={sessionId}
                token={token}
                planDir={planDir}
                selectedFile={planSelectedFile}
                onSelectFile={handlePlanFileSelect}
                onCreateFile={handlePlanFileCreate}
              />
            )}

            {/* Center: Annotation editor */}
            <div className="plan-overlay-center">
              {planLoading ? (
                <CenteredLoading label="Loading PLAN/..." />
              ) : planSelectedFile && (!planMarkdown && (fileStream.state.status === 'streaming' || fileStream.state.status === 'idle')) ? (
                <CenteredLoading label={`Loading ${planSelectedFile.split('/').pop()}...`} percent={fileStream.state.totalSize > 0 ? Math.round((fileStream.state.receivedBytes / fileStream.state.totalSize) * 100) : undefined} />
              ) : planSelectedFile ? (
                <PlanAnnotationRenderer
                  ref={planAnnotationRef}
                  markdown={planMarkdown}
                  filePath={planSelectedFile}
                  sessionId={sessionId}
                  onExecute={handlePlanSave}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
                  <span style={{ color: '#565f89', fontSize: 13, fontStyle: 'italic' }}>Select a file from the left panel</span>
                </div>
              )}
            </div>
            {/* Right: TOC is already integrated inside PlanAnnotationRenderer */}
          </div>
        </div>
      )}
    </div>
  );
}
