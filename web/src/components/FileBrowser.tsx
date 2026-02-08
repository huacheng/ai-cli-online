import { useState } from 'react';
import { useStore } from '../store';
import { downloadFile } from '../api/files';
import { useFileBrowser } from '../hooks/useFileBrowser';
import { formatSize } from '../utils';
import { FileListHeader, FileListStatus } from './FileListShared';

interface FileBrowserProps {
  sessionId: string;
  onClose: () => void;
}

export function FileBrowser({ sessionId, onClose }: FileBrowserProps) {
  const token = useStore((s) => s.token);
  const { cwd, files, loading, error, setError, handleNavigate, handleGoUp, handleRefresh } =
    useFileBrowser({ sessionId, onClose });
  const [downloading, setDownloading] = useState<string | null>(null);

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
        fontFamily: 'inherit',
      }}
    >
      <FileListHeader cwd={cwd} onGoUp={handleGoUp} onRefresh={handleRefresh} onClose={onClose} />

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <FileListStatus loading={loading} error={error} empty={files.length === 0} emptyText="Empty directory" />
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
            {file.type === 'file' ? (
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
                  marginRight: 6,
                }}
              >
                {downloading === file.name ? '...' : '\u2193'}
              </button>
            ) : (
              <span style={{ width: 26, flexShrink: 0, marginRight: 6 }} />
            )}
            <span style={{
              width: 20,
              flexShrink: 0,
              color: file.type === 'directory' ? '#7aa2f7' : '#565f89',
            }}>
              {file.type === 'directory' ? '\ud83d\udcc1' : '\ud83d\udcc4'}
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
            <span style={{
              width: 80,
              textAlign: 'right',
              color: '#565f89',
              fontSize: 11,
              flexShrink: 0,
            }}>
              {file.type === 'file' ? formatSize(file.size) : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
