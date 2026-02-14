import { useState, useEffect, useCallback, useRef } from 'react';
import { PlanAnnotationRenderer } from './PlanAnnotationRenderer';
import type { PlanAnnotationRendererHandle } from './PlanAnnotationRenderer';
import { PlanFileBrowser } from './PlanFileBrowser';
import { useFileStream } from '../hooks/useFileStream';
import { registerFileStreamHandler, unregisterFileStreamHandler } from '../fileStreamBus';
import { fetchFiles } from '../api/files';
import type { FileEntry } from '../api/files';
import { fetchFileContent } from '../api/docs';

interface PlanPanelProps {
  sessionId: string;
  token: string;
  connected: boolean;
  onRequestFileStream?: (path: string) => void;
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

export function PlanPanel({ sessionId, token, connected, onRequestFileStream, onSendToTerminal }: PlanPanelProps) {
  // File stream hook
  const fileStream = useFileStream();

  // Plugin install prompt
  const [showPluginPrompt, setShowPluginPrompt] = useState(false);

  // Plan mode state — directory-based (AiTasks/ directory with multiple .md files)
  const [planDir, setPlanDir] = useState<string | null>(null);
  const [planSelectedFile, setPlanSelectedFile] = useState<string | null>(null);
  const [planMarkdown, setPlanMarkdown] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  // When AiTasks/ directory is not found, show init guidance
  const [showInitGuide, setShowInitGuide] = useState(false);
  const planAnnotationRef = useRef<PlanAnnotationRendererHandle>(null);

  // Persist selected file to localStorage (global key — sessionId omitted so it persists across terminals)
  const planFileKey = 'plan-selected-file';
  const planFileSaveRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!planSelectedFile) return;
    clearTimeout(planFileSaveRef.current);
    planFileSaveRef.current = setTimeout(() => {
      try { localStorage.setItem(planFileKey, planSelectedFile); } catch { /* full */ }
    }, 50);
    return () => clearTimeout(planFileSaveRef.current);
  }, [planSelectedFile]);

  // Auto-detect AiTasks/ directory on mount
  const planStreamedRef = useRef<string | null>(null);
  useEffect(() => {
    planStreamedRef.current = null;
    let cancelled = false;
    setPlanLoading(true);
    setShowInitGuide(false);
    (async () => {
      let home = '';
      try {
        const res = await fetchFiles(token, sessionId);
        if (cancelled) return;
        home = res.home || '';
        const aiTasksEntry = res.files.find((f: FileEntry) => f.name === 'AiTasks' && f.type === 'directory');
        if (aiTasksEntry) {
          const dirPath = res.cwd + '/AiTasks';
          setPlanDir(dirPath);
          // Restore previously selected file if path is under AiTasks/
          const savedFile = localStorage.getItem(planFileKey);
          if (savedFile && savedFile.startsWith(dirPath + '/')) {
            setPlanSelectedFile(savedFile);
          }
        } else {
          // AiTasks/ not found — show init guidance
          setPlanDir(null);
          setPlanSelectedFile(null);
          setShowInitGuide(true);
        }
      } catch {
        setPlanDir(null);
      } finally {
        if (!cancelled) setPlanLoading(false);
      }

      // Check if ai-cli-task plugin is installed by reading installed_plugins.json
      try {
        if (cancelled) return;
        if (home) {
          const pluginFile = `${home}/.claude/plugins/installed_plugins.json`;
          const result = await fetchFileContent(token, sessionId, pluginFile, 0);
          if (!cancelled && result) {
            try {
              const parsed = JSON.parse(result.content);
              const pluginMap = parsed.plugins || parsed;
              if (!('ai-cli-task@moonview' in pluginMap)) setShowPluginPrompt(true);
            } catch { setShowPluginPrompt(true); }
          }
        }
      } catch { /* ignore — file not accessible or doesn't exist */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  // Auto-detect AiTasks/ creation when init guide is shown (poll every 3s)
  useEffect(() => {
    if (!showInitGuide || !connected) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetchFiles(token, sessionId);
        const aiTasksEntry = res.files.find((f: FileEntry) => f.name === 'AiTasks' && f.type === 'directory');
        if (aiTasksEntry) {
          const dirPath = res.cwd + '/AiTasks';
          setPlanDir(dirPath);
          setShowInitGuide(false);
          const savedFile = localStorage.getItem(planFileKey);
          if (savedFile && savedFile.startsWith(dirPath + '/')) {
            setPlanSelectedFile(savedFile);
          }
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [showInitGuide, connected, token, sessionId, planFileKey]);

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

  // When stream completes, capture the content and record mtime for polling
  const planMtimeRef = useRef(0);
  useEffect(() => {
    if (fileStream.state.status === 'complete' && planSelectedFile) {
      setPlanMarkdown(fileStream.state.content);

      planMtimeRef.current = Date.now();
    }
  }, [fileStream.state.status, fileStream.state.content, planSelectedFile]);

  // Poll for file changes (3s interval, uses 304 Not Modified)
  useEffect(() => {
    if (!planSelectedFile || !connected || !planMarkdown) return;
    const iv = setInterval(async () => {
      if (!planMtimeRef.current) return;
      try {
        const result = await fetchFileContent(token, sessionId, planSelectedFile, planMtimeRef.current);
        if (result) {
          // File changed — update content
          setPlanMarkdown(result.content);
          planMtimeRef.current = result.mtime;
        }
      } catch { /* ignore network errors */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [planSelectedFile, connected, planMarkdown, token, sessionId]);

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

  // Switch file within AiTasks/ directory
  const handlePlanFileSelect = useCallback((fullPath: string) => {
    if (fullPath === planSelectedFile) return;
    savePlanScrollPosition();
    setPlanSelectedFile(fullPath);
    setPlanMarkdown('');
    planStreamedRef.current = null;
  }, [planSelectedFile, savePlanScrollPosition]);

  // Handle file deletion — clear selection if deleted file is currently selected
  const handlePlanFileDelete = useCallback((fullPath: string) => {
    if (planSelectedFile && (planSelectedFile === fullPath || planSelectedFile.startsWith(fullPath + '/'))) {
      setPlanSelectedFile(null);
      setPlanMarkdown('');
      planStreamedRef.current = null;
    }
  }, [planSelectedFile]);

  // Handle new file creation from PlanFileBrowser
  const handlePlanFileCreate = useCallback((fullPath: string) => {
    setPlanSelectedFile(fullPath);
    setPlanMarkdown('');
    planStreamedRef.current = null;
  }, []);

  // Handle Save from annotation renderer — send directly to terminal
  const handlePlanSave = useCallback((summary: string) => {
    if (summary) onSendToTerminal?.(summary);
  }, [onSendToTerminal]);

  // Handle content saved from edit mode — update markdown + mtime
  const handleContentSaved = useCallback((newContent: string, mtime: number) => {
    setPlanMarkdown(newContent);
    planMtimeRef.current = mtime;
  }, []);

  // Handle close file — deselect current file (does NOT close the Plan panel)
  const handleCloseFile = useCallback(() => {
    savePlanScrollPosition();
    setPlanSelectedFile(null);
    setPlanMarkdown('');
    planStreamedRef.current = null;
  }, [savePlanScrollPosition]);

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
      {/* Plugin install prompt */}
      {showPluginPrompt && (
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
          <span style={{ color: 'var(--accent-yellow)', flex: 1 }}>ai-cli-task plugin not installed</span>
          <button
            className="pane-btn"
            style={{ color: 'var(--accent-green)', fontSize: 11 }}
            onClick={() => {
              if (onSendToTerminal) {
                onSendToTerminal('/plugin marketplace add huacheng/moonview && /plugin install ai-cli-task@moonview');
              }
              setShowPluginPrompt(false);
            }}
          >
            Install
          </button>
          <button
            className="pane-btn"
            style={{ fontSize: 11 }}
            onClick={() => setShowPluginPrompt(false)}
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
            <CenteredLoading label="Loading AiTasks/..." />
          ) : showInitGuide ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: '0 20px' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>AiTasks/ directory not found</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12, textAlign: 'center' }}>
                Run <code style={{ color: 'var(--accent-blue)', backgroundColor: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 3 }}>/ai-cli-task:ai-cli-task init &lt;name&gt;</code> in the terminal to create a task
              </span>
            </div>
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
              onContentSaved={handleContentSaved}
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
