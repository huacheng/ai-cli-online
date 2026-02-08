import { useCallback } from 'react';
import { useFileBrowser } from '../hooks/useFileBrowser';
import { FileListHeader, FileListStatus } from './FileListShared';
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

const docFilter = (files: FileEntry[]) =>
  files.filter((f) => f.type === 'directory' || isDocFile(f.name));

interface DocumentPickerProps {
  sessionId: string;
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

export function DocumentPicker({ sessionId, onSelect, onClose }: DocumentPickerProps) {
  const filter = useCallback(docFilter, []);
  const { cwd, files, loading, error, handleNavigate, handleGoUp, handleRefresh } =
    useFileBrowser({ sessionId, onClose, filter });

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
      <FileListHeader cwd={cwd} onGoUp={handleGoUp} onRefresh={handleRefresh} onClose={onClose} />

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <FileListStatus loading={loading} error={error} empty={files.length === 0} emptyText="No documents found" />
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
            <span style={{
              width: 20,
              flexShrink: 0,
              marginRight: 6,
              color: file.type === 'directory' ? '#7aa2f7' : '#565f89',
            }}>
              {file.type === 'directory' ? '\ud83d\udcc1' : docIcon(file.name)}
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
