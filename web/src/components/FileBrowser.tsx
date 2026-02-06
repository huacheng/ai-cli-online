import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store';
import { fetchFiles, downloadFile } from '../api/files';
import type { FileEntry } from '../api/files';

interface FileBrowserProps {
  sessionId: string;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function FileBrowser({ sessionId, onClose }: FileBrowserProps) {
  const token = useStore((s) => s.token);
  const [cwd, setCwd] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadFiles = useCallback(async (path?: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFiles(token, sessionId, path);
      setCwd(data.cwd);
      setFiles(data.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [token, sessionId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleNavigate = (dirName: string) => {
    const newPath = cwd + '/' + dirName;
    loadFiles(newPath);
  };

  const handleGoUp = () => {
    const parent = cwd.replace(/\/[^/]+$/, '') || '/';
    loadFiles(parent);
  };

  const handleDownload = async (fileName: string) => {
    if (!token) return;
    setDownloading(fileName);
    try {
      await downloadFile(token, sessionId, cwd + '/' + fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        backgroundColor: '#1a1b26',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      {/* Header */}
      <div style={{
        padding: '6px 12px',
        background: '#24283b',
        borderBottom: '1px solid #414868',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <button
            onClick={handleGoUp}
            style={{
              background: 'none',
              border: '1px solid #414868',
              color: '#7aa2f7',
              borderRadius: 3,
              padding: '1px 8px',
              fontSize: 12,
              cursor: 'pointer',
              flexShrink: 0,
            }}
            title="Go to parent directory"
          >
            ..
          </button>
          <span style={{
            color: '#7aa2f7',
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {cwd || '...'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={() => loadFiles(cwd)}
            style={{
              background: 'none',
              border: 'none',
              color: '#565f89',
              fontSize: 14,
              cursor: 'pointer',
              padding: '0 4px',
            }}
            title="Refresh"
          >
            &#x21bb;
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#565f89',
              fontSize: 14,
              cursor: 'pointer',
              padding: '0 4px',
            }}
            title="Close (ESC)"
          >
            &#x2715;
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {loading && (
          <div style={{ padding: '20px', textAlign: 'center', color: '#565f89', fontSize: 13 }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ padding: '12px', color: '#f7768e', fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: '#565f89', fontSize: 13 }}>
            Empty directory
          </div>
        )}
        {!loading && !error && files.map((file) => (
          <div
            key={file.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 12px',
              fontSize: 13,
              cursor: file.type === 'directory' ? 'pointer' : 'default',
              borderBottom: '1px solid #1e2030',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#24283b'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            onClick={() => {
              if (file.type === 'directory') handleNavigate(file.name);
            }}
          >
            {/* Icon */}
            <span style={{
              width: 20,
              flexShrink: 0,
              color: file.type === 'directory' ? '#7aa2f7' : '#565f89',
            }}>
              {file.type === 'directory' ? '\ud83d\udcc1' : '\ud83d\udcc4'}
            </span>
            {/* Name */}
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
            {/* Size */}
            <span style={{
              width: 80,
              textAlign: 'right',
              color: '#565f89',
              fontSize: 11,
              flexShrink: 0,
              marginRight: 8,
            }}>
              {file.type === 'file' ? formatSize(file.size) : ''}
            </span>
            {/* Download button for files */}
            {file.type === 'file' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(file.name);
                }}
                disabled={downloading === file.name}
                style={{
                  background: 'none',
                  border: '1px solid #414868',
                  color: downloading === file.name ? '#565f89' : '#9ece6a',
                  borderRadius: 3,
                  padding: '1px 8px',
                  fontSize: 11,
                  cursor: downloading === file.name ? 'wait' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {downloading === file.name ? '...' : '\u2193'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
