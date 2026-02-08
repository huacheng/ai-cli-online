import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store';
import { fetchFiles } from '../api/files';
import type { FileEntry } from '../api/files';

const DOC_EXTENSIONS = new Set(['.md', '.html', '.htm', '.pdf']);

function isDocFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return DOC_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function docIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.pdf') return '\u{1F4D5}';
  if (ext === '.html' || ext === '.htm') return '\u{1F310}';
  return '\u{1F4DD}';
}

interface DocumentPickerProps {
  sessionId: string;
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

export function DocumentPicker({ sessionId, onSelect, onClose }: DocumentPickerProps) {
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
      // Filter: directories + doc files only
      setFiles(data.files.filter((f) => f.type === 'directory' || isDocFile(f.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [token, sessionId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleNavigate = (dirName: string) => {
    loadFiles(cwd + '/' + dirName);
  };

  const handleGoUp = () => {
    const parent = cwd.replace(/\/[^/]+$/, '') || '/';
    loadFiles(parent);
  };

  const handleSelect = (fileName: string) => {
    onSelect(cwd + '/' + fileName);
  };

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 5,
      backgroundColor: '#1a1b26',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'inherit',
    }}>
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
            No documents found
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
              cursor: 'pointer',
              borderBottom: '1px solid #1e2030',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#24283b'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            onClick={() => {
              if (file.type === 'directory') handleNavigate(file.name);
              else handleSelect(file.name);
            }}
          >
            {/* Icon */}
            <span style={{
              width: 20,
              flexShrink: 0,
              marginRight: 6,
              color: file.type === 'directory' ? '#7aa2f7' : '#565f89',
            }}>
              {file.type === 'directory' ? '\ud83d\udcc1' : docIcon(file.name)}
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
            {/* Extension badge for files */}
            {file.type === 'file' && (
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
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
