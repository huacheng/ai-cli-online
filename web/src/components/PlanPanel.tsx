import { useState, useEffect, useCallback, useRef } from 'react';
import { PlanAnnotationRenderer } from './PlanAnnotationRenderer';
import type { PlanAnnotationRendererHandle } from './PlanAnnotationRenderer';
import { PlanFileBrowser } from './PlanFileBrowser';
import { useFileStream } from '../hooks/useFileStream';
import { registerFileStreamHandler, unregisterFileStreamHandler } from '../fileStreamBus';
import { fetchFiles, touchFile, mkdirPath } from '../api/files';
import type { FileEntry } from '../api/files';

interface PlanPanelProps {
  sessionId: string;
  token: string;
  connected: boolean;
  onRequestFileStream?: (path: string) => void;
  onCancelFileStream?: () => void;
  onForwardToChat?: (summary: string) => void;
  onSendToTerminal?: (text: string) => void;
}

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
      <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{label}</span>
      {percent != null && (
        <div style={{ width: 120, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            flex: 1, height: 4, backgroundColor: 'var(--border)', borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${percent}%`,
              backgroundColor: 'var(--accent-blue)',
              transition: 'width 0.2s',
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{percent}%</span>
        </div>
      )}
    </div>
  );
}

export function PlanPanel({ sessionId, token, connected, onRequestFileStream, onForwardToChat, onSendToTerminal }: PlanPanelProps) {
  // File stream hook
  const fileStream = useFileStream();

  // /aicli-task-review command install prompt
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const projectCwdRef = useRef('');

  // Plan mode state — directory-based (TASK/ directory with multiple .md files)
  const [planDir, setPlanDir] = useState<string | null>(null);
  const [planSelectedFile, setPlanSelectedFile] = useState<string | null>(null);
  const [planMarkdown, setPlanMarkdown] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  // Cache file content for multi-file annotation aggregation on close
  const planContentCacheRef = useRef(new Map<string, string>());

  const planAnnotationRef = useRef<PlanAnnotationRendererHandle>(null);

  // Persist selected file to localStorage (50ms debounce)
  const planFileKey = `plan-selected-file-${sessionId}`;
  const planFileSaveRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!planSelectedFile) return;
    clearTimeout(planFileSaveRef.current);
    planFileSaveRef.current = setTimeout(() => {
      try { localStorage.setItem(planFileKey, planSelectedFile); } catch { /* full */ }
    }, 50);
    return () => clearTimeout(planFileSaveRef.current);
  }, [planSelectedFile, planFileKey]);

  // Auto-detect PLAN/ directory on mount
  const planStreamedRef = useRef<string | null>(null);
  useEffect(() => {
    planStreamedRef.current = null;
    let cancelled = false;
    setPlanLoading(true);
    (async () => {
      try {
        const res = await fetchFiles(token, sessionId);
        if (cancelled) return;
        const planDirEntry = res.files.find((f: FileEntry) => f.name === 'TASK' && f.type === 'directory');
        if (planDirEntry) {
          const dirPath = res.cwd + '/TASK';
          const innerRes = await fetchFiles(token, sessionId, dirPath);
          if (cancelled) return;
          const indexFile = innerRes.files.find((f: FileEntry) => f.name === '.index.md');
          if (indexFile) {
            setPlanDir(dirPath);
            // Restore previously selected file if path is under TASK/
            const savedFile = localStorage.getItem(planFileKey);
            if (savedFile && savedFile.startsWith(dirPath + '/')) {
              setPlanSelectedFile(savedFile);
            } else {
              setPlanSelectedFile(dirPath + '/' + indexFile.name);
            }
          } else {
            try {
              const result = await touchFile(token, sessionId, 'TASK/.index.md');
              if (cancelled) return;
              setPlanDir(dirPath);
              if (result.ok) setPlanSelectedFile(result.path);
            } catch {
              setPlanDir(dirPath);
            }
          }
        } else {
          try {
            const mkResult = await mkdirPath(token, sessionId, 'TASK');
            if (cancelled) return;
            setPlanDir(mkResult.path);
            const touchResult = await touchFile(token, sessionId, 'TASK/.index.md');
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

      // Check if /aicli-task-review command is installed
      try {
        const res = await fetchFiles(token, sessionId);
        if (cancelled) return;
        const home = res.home || '';
        projectCwdRef.current = res.cwd;
        if (home) {
          const cmdDir = `${home}/.claude/commands`;
          try {
            const cmdFiles = await fetchFiles(token, sessionId, cmdDir);
            if (cancelled) return;
            const hasTaskReview = cmdFiles.files.some((f: FileEntry) => f.name === 'aicli-task-review.md');
            if (!hasTaskReview) setShowInstallPrompt(true);
          } catch {
            // directory doesn't exist — needs install
            if (!cancelled) setShowInstallPrompt(true);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  // Register file stream event bus handler
  useEffect(() => {
    registerFileStreamHandler(sessionId, fileStream.handleChunk, fileStream.handleControl);
    return () => unregisterFileStreamHandler(sessionId);
  }, [sessionId, fileStream.handleChunk, fileStream.handleControl]);

  // Request file stream once WS is connected and planSelectedFile is known
  useEffect(() => {
    if (!planSelectedFile || !connected) return;
    if (planStreamedRef.current === planSelectedFile && planMarkdown) return;
    planStreamedRef.current = planSelectedFile;
    fileStream.reset();
    fileStream.startStream('content');
    onRequestFileStream?.(planSelectedFile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSelectedFile, connected]);

  // When stream completes, capture the content
  useEffect(() => {
    if (fileStream.state.status === 'complete' && planSelectedFile) {
      setPlanMarkdown(fileStream.state.content);
      planContentCacheRef.current.set(planSelectedFile, fileStream.state.content);
    }
  }, [fileStream.state.status, fileStream.state.content, planSelectedFile]);

  // Plan scroll position memory: filePath → scrollTop
  const planScrollPositionsRef = useRef(new Map<string, number>());

  const savePlanScrollPosition = useCallback(() => {
    if (!planSelectedFile) return;
    const top = planAnnotationRef.current?.getScrollTop?.() ?? 0;
    if (top > 0) planScrollPositionsRef.current.set(planSelectedFile, top);
  }, [planSelectedFile]);

  // Restore plan scroll position after content renders
  useEffect(() => {
    if (!planSelectedFile || !planMarkdown) return;
    const saved = planScrollPositionsRef.current.get(planSelectedFile);
    if (saved != null) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          planAnnotationRef.current?.setScrollTop?.(saved);
        });
      });
    }
  }, [planSelectedFile, planMarkdown]);

  // Switch file within PLAN/ directory
  const handlePlanFileSelect = useCallback((fullPath: string) => {
    if (fullPath === planSelectedFile) return;
    savePlanScrollPosition();
    if (planSelectedFile && planMarkdown) {
      planContentCacheRef.current.set(planSelectedFile, planMarkdown);
    }
    setPlanSelectedFile(fullPath);
    setPlanMarkdown('');
    planStreamedRef.current = null;
  }, [planSelectedFile, planMarkdown, savePlanScrollPosition]);

  // Handle file deletion — clear selection if deleted file is currently selected
  const handlePlanFileDelete = useCallback((fullPath: string) => {
    if (planSelectedFile && (planSelectedFile === fullPath || planSelectedFile.startsWith(fullPath + '/'))) {
      setPlanSelectedFile(null);
      setPlanMarkdown('');
      planStreamedRef.current = null;
    }
    planContentCacheRef.current.delete(fullPath);
  }, [planSelectedFile]);

  // Handle new file creation from PlanFileBrowser
  const handlePlanFileCreate = useCallback((fullPath: string) => {
    setPlanSelectedFile(fullPath);
    setPlanMarkdown('');
    planStreamedRef.current = null;
  }, []);

  // Handle Save from annotation renderer — forward to chat
  const handlePlanSave = useCallback((summary: string) => {
    if (summary) onForwardToChat?.(summary);
  }, [onForwardToChat]);

  // Handle close file — deselect current file (does NOT close the Plan panel)
  const handleCloseFile = useCallback(() => {
    savePlanScrollPosition();
    if (planSelectedFile && planMarkdown) {
      planContentCacheRef.current.set(planSelectedFile, planMarkdown);
    }
    setPlanSelectedFile(null);
    setPlanMarkdown('');
    planStreamedRef.current = null;
  }, [planSelectedFile, planMarkdown, savePlanScrollPosition]);

  // Refresh current plan file
  const handlePlanRefresh = useCallback(() => {
    if (!planSelectedFile || !connected) return;
    planStreamedRef.current = null;
    setPlanMarkdown('');
    fileStream.reset();
    fileStream.startStream('content');
    onRequestFileStream?.(planSelectedFile);
    planStreamedRef.current = planSelectedFile;
  }, [planSelectedFile, connected, fileStream, onRequestFileStream]);

  // File browser width (resizable)
  const [fbWidth, setFbWidth] = useState(() => {
    const saved = localStorage.getItem(`plan-fb-width-${sessionId}`);
    if (saved) { const n = Number(saved); if (Number.isFinite(n) && n >= 60 && n <= 300) return n; }
    return 130;
  });
  const prevFbWidthRef = useRef(fbWidth);
  if (fbWidth !== prevFbWidthRef.current) {
    prevFbWidthRef.current = fbWidth;
    try { localStorage.setItem(`plan-fb-width-${sessionId}`, String(Math.round(fbWidth))); } catch { /* full */ }
  }

  const handleFbDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = fbWidth;
    document.body.classList.add('resizing-panes');
    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setFbWidth(Math.min(300, Math.max(60, startW + delta)));
    };
    const onMouseUp = () => {
      document.body.classList.remove('resizing-panes');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [fbWidth]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {/* Install prompt for /aicli-task-review command */}
      {showInstallPrompt && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
          flexShrink: 0,
        }}>
          <span style={{ color: 'var(--accent-yellow)', flex: 1 }}>/aicli-task-review command not installed</span>
          <button
            className="pane-btn"
            style={{ color: 'var(--accent-green)', fontSize: 11 }}
            onClick={() => {
              const cwd = projectCwdRef.current;
              if (cwd && onSendToTerminal) {
                onSendToTerminal(`mkdir -p ~/.claude/commands && cp ${cwd}/.commands/*.md ~/.claude/commands/`);
              }
              setShowInstallPrompt(false);
            }}
          >
            Install
          </button>
          <button
            className="pane-btn"
            style={{ fontSize: 11 }}
            onClick={() => setShowInstallPrompt(false)}
          >
            &times;
          </button>
        </div>
      )}

      {/* Single-level body: file browser + divider + annotation editor */}
      <div className="plan-overlay-body">
        {/* Left: File browser */}
        {planDir && (
          <>
            <div style={{ width: fbWidth, flexShrink: 0, overflow: 'hidden' }}>
              <PlanFileBrowser
                sessionId={sessionId}
                token={token}
                planDir={planDir}
                selectedFile={planSelectedFile}
                onSelectFile={handlePlanFileSelect}
                onCreateFile={handlePlanFileCreate}
                onDeleteFile={handlePlanFileDelete}
              />
            </div>
            <div
              onMouseDown={handleFbDividerMouseDown}
              style={{
                width: 2,
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

        {/* Center: Annotation editor */}
        <div className="plan-overlay-center">
          {planLoading ? (
            <CenteredLoading label="Loading TASK/..." />
          ) : planSelectedFile && (!planMarkdown && (fileStream.state.status === 'streaming' || fileStream.state.status === 'idle')) ? (
            <CenteredLoading label={`Loading ${planSelectedFile.split('/').pop()}...`} percent={fileStream.state.totalSize > 0 ? Math.round((fileStream.state.receivedBytes / fileStream.state.totalSize) * 100) : undefined} />
          ) : planSelectedFile ? (
            <PlanAnnotationRenderer
              ref={planAnnotationRef}
              markdown={planMarkdown}
              filePath={planSelectedFile}
              sessionId={sessionId}
              token={token}
              onExecute={handlePlanSave}
              onSend={onSendToTerminal}
              onRefresh={handlePlanRefresh}
              onClose={handleCloseFile}
              readOnly={planSelectedFile.endsWith('/.index.md')}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontStyle: 'italic' }}>Select a file from the left panel</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
