import { useState, useEffect, useCallback, useRef } from 'react';
import { PlanAnnotationRenderer } from './PlanAnnotationRenderer';
import type { PlanAnnotationRendererHandle, PlanAnnotations } from './PlanAnnotationRenderer';
import { generateMultiFileSummary } from './PlanAnnotationRenderer';
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
  onClose: () => void;
  onForwardToChat?: (summary: string) => void;
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

export function PlanPanel({ sessionId, token, connected, onRequestFileStream, onClose, onForwardToChat }: PlanPanelProps) {
  // File stream hook
  const fileStream = useFileStream();

  // Plan mode state — directory-based (PLAN/ directory with multiple .md files)
  const [planDir, setPlanDir] = useState<string | null>(null);
  const [planSelectedFile, setPlanSelectedFile] = useState<string | null>(null);
  const [planMarkdown, setPlanMarkdown] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  // Cache file content for multi-file annotation aggregation on close
  const planContentCacheRef = useRef(new Map<string, string>());

  const planAnnotationRef = useRef<PlanAnnotationRendererHandle>(null);

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
        const planDirEntry = res.files.find((f: FileEntry) => f.name === 'PLAN' && f.type === 'directory');
        if (planDirEntry) {
          const dirPath = res.cwd + '/PLAN';
          const innerRes = await fetchFiles(token, sessionId, dirPath);
          if (cancelled) return;
          const indexFile = innerRes.files.find((f: FileEntry) => f.name.toLowerCase() === 'index.md');
          if (indexFile) {
            setPlanDir(dirPath);
            setPlanSelectedFile(dirPath + '/' + indexFile.name);
          } else {
            try {
              const result = await touchFile(token, sessionId, 'PLAN/INDEX.md');
              if (cancelled) return;
              setPlanDir(dirPath);
              if (result.ok) setPlanSelectedFile(result.path);
            } catch {
              setPlanDir(dirPath);
            }
          }
        } else {
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

  // Handle close — aggregate all files' un-forwarded annotations + forward to chat
  const handlePlanClose = useCallback(() => {
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
      if (singleSummary && planSelectedFile) {
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
      if (multiSummary) onForwardToChat?.(multiSummary);
    } else if (singleSummary) {
      onForwardToChat?.(singleSummary);
    }

    onClose();
  }, [onClose, onForwardToChat, planSelectedFile, planMarkdown, sessionId]);

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

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {/* Plan toolbar */}
      <div className="doc-expanded-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', color: 'var(--accent-purple)', fontWeight: 500 }}>
            Plan: PLAN/{planSelectedFile ? planSelectedFile.split('/').pop() : ''}
          </span>
          <button
            className="pane-btn"
            onClick={handlePlanRefresh}
            title="Refresh current file"
          >
            &#x21BB;
          </button>
        </div>
        <button
          className="pane-btn pane-btn--danger"
          onClick={handlePlanClose}
          title="Close Plan (forward annotations to Chat)"
        >
          &times;
        </button>
      </div>

      {/* Two-column body: file browser + annotation editor */}
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
              <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontStyle: 'italic' }}>Select a file from the left panel</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
