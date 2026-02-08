import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { fetchFiles } from '../api/files';
import type { FileEntry } from '../api/files';

interface UseFileBrowserOptions {
  sessionId: string;
  onClose: () => void;
  /** Optional filter applied to fetched files (e.g. doc-only filter) */
  filter?: (files: FileEntry[]) => FileEntry[];
}

export function useFileBrowser({ sessionId, onClose, filter }: UseFileBrowserOptions) {
  const token = useStore((s) => s.token);
  const [cwd, setCwd] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async (path?: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFiles(token, sessionId, path);
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
