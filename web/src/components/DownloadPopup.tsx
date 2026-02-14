import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchFiles, downloadFile, downloadCwd } from '../api/files';
import type { FileEntry } from '../api/files';
import { formatSize, fileIcon } from '../utils';

interface DownloadPopupProps {
  token: string;
  sessionId: string;
  onClose: () => void;
}

export function DownloadPopup({ token, sessionId, onClose }: DownloadPopupProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dir, setDir] = useState('');
  const [dirStack, setDirStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Fetch initial file list on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchFiles(token, sessionId);
        if (!cancelled) {
          setDir(res.cwd);
          setFiles(res.files);
        }
      } catch (err) {
        console.error('[download-popup] Failed to list files:', err);
        if (!cancelled) onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, sessionId, onClose]);

  // Close on ESC or click outside
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 50);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
      clearTimeout(timer);
    };
  }, [onClose]);

  const navigateInto = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await fetchFiles(token, sessionId, dirPath);
      setDirStack((prev) => [...prev, dir]);
      setDir(dirPath);
      setFiles(res.files);
    } catch (err) {
      console.error('[download-popup] Failed to navigate:', err);
    } finally {
      setLoading(false);
    }
  }, [token, sessionId, dir]);

  const navigateBack = useCallback(async () => {
    if (dirStack.length === 0) return;
    const parentDir = dirStack[dirStack.length - 1];
    setLoading(true);
    try {
      const res = await fetchFiles(token, sessionId, parentDir);
      setDirStack((prev) => prev.slice(0, -1));
      setDir(parentDir);
      setFiles(res.files);
    } catch (err) {
      console.error('[download-popup] Failed to go back:', err);
    } finally {
      setLoading(false);
    }
  }, [token, sessionId, dirStack]);

  const handleDownloadFile = useCallback(async (filePath: string) => {
    try {
      await downloadFile(token, sessionId, filePath);
    } catch (err) {
      console.error('[download-file] Failed:', err);
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [token, sessionId]);

  const handleDownloadAll = useCallback(async () => {
    setDownloading(true);
    onClose();
    try {
      await downloadCwd(token, sessionId);
    } catch (err) {
      console.error('[download-cwd] Failed:', err);
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloading(false);
    }
  }, [token, sessionId, onClose]);

  return (
    <div
      ref={popupRef}
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
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 8px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        flexShrink: 0,
      }}>
        {dirStack.length > 0 && (
          <button
            className="pane-btn"
            onClick={navigateBack}
            disabled={loading}
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
          {dir.split('/').slice(-2).join('/') || dir}
        </span>
        <button
          className="pane-btn"
          onClick={onClose}
          style={{ fontSize: 11, flexShrink: 0 }}
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* File list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
        {loading ? (
          <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
            Loading...
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12, fontStyle: 'italic' }}>
            Empty directory
          </div>
        ) : (
          files.map((f) => (
            <div
              key={f.name}
              onClick={() => {
                const fullPath = dir + '/' + f.name;
                if (f.type === 'directory') {
                  navigateInto(fullPath);
                } else {
                  handleDownloadFile(fullPath);
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

      {/* Footer */}
      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '6px 8px',
        flexShrink: 0,
        backgroundColor: 'var(--bg-secondary)',
      }}>
        <button
          className="pane-btn"
          onClick={handleDownloadAll}
          disabled={downloading}
          style={{ fontSize: 11, color: 'var(--accent-blue)', width: '100%', textAlign: 'center' }}
          title="Download entire CWD as tar.gz"
        >
          {downloading ? 'Downloading...' : 'Download All (tar.gz)'}
        </button>
      </div>
    </div>
  );
}
