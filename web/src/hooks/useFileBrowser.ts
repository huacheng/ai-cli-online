import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { fetchFiles, fetchCwd } from '../api/files';
import type { FileEntry } from '../api/files';

interface UseFileBrowserOptions {
  sessionId: string;
  onClose: () => void;
  /** Optional filter applied to fetched files (e.g. doc-only filter) */
  filter?: (files: FileEntry[]) => FileEntry[];
  /** Poll terminal CWD at this interval (ms). When CWD changes, reset browser. */
  pollCwd?: number;
}

export function useFileBrowser({ sessionId, onClose, filter, pollCwd }: UseFileBrowserOptions) {
  const token = useStore((s) => s.token);
  const [cwd, setCwd] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const baseCwdRef = useRef('');

  const loadFiles = useCallback(async (path?: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFiles(token, sessionId, path);
      if (!path) baseCwdRef.current = data.cwd;
      setCwd(data.cwd);
      setFiles(filter ? filter(data.files) : data.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [token, sessionId, filter]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Poll terminal CWD and reset browser when it changes
  useEffect(() => {
    if (!pollCwd || !token) return;
    let cancelled = false;
    const id = setInterval(async () => {
      if (cancelled) return;
      try {
        const termCwd = await fetchCwd(token, sessionId);
        if (cancelled) return;
        if (termCwd !== baseCwdRef.current) {
          baseCwdRef.current = termCwd;
          const data = await fetchFiles(token, sessionId);
          if (cancelled) return;
          setCwd(data.cwd);
          setFiles(filter ? filter(data.files) : data.files);
        }
      } catch {
        // ignore polling errors
      }
    }, pollCwd);
    return () => { cancelled = true; clearInterval(id); };
  }, [pollCwd, token, sessionId, filter]);

  // ESC to close
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleNavigate = useCallback((dirName: string) => {
    loadFiles(cwd + '/' + dirName);
  }, [loadFiles, cwd]);

  const handleGoUp = useCallback(() => {
    const parent = cwd.replace(/\/[^/]+$/, '') || '/';
    loadFiles(parent);
  }, [loadFiles, cwd]);

  const handleRefresh = useCallback(() => {
    loadFiles(cwd);
  }, [loadFiles, cwd]);

  return {
    cwd,
    files,
    loading,
    error,
    setError,
    handleNavigate,
    handleGoUp,
    handleRefresh,
  };
}
