import { useRef, useState } from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { FileBrowser } from './FileBrowser';
import { uploadFiles } from '../api/files';
import type { TerminalInstance } from '../types';

interface TerminalPaneProps {
  terminal: TerminalInstance;
  canClose: boolean;
}

// Buttons now use .pane-btn CSS class from index.css

export function TerminalPane({ terminal, canClose }: TerminalPaneProps) {
  const removeTerminal = useStore((s) => s.removeTerminal);
  const splitTerminal = useStore((s) => s.splitTerminal);
  const customName = useStore((s) => s.sessionNames[terminal.id]);
  const token = useStore((s) => s.token);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !token) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      await uploadFiles(token, terminal.id, files, (percent) => {
        setUploadProgress(percent);
      });
    } catch (err) {
      console.error('[upload] Failed:', err);
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0 }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 8px',
        backgroundColor: '#16161e',
        borderBottom: '1px solid #292e42',
        flexShrink: 0,
        height: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: terminal.connected ? '#9ece6a' : '#f7768e',
          }} />
          <span style={{ fontSize: '11px', color: '#565f89' }}>
            {customName || terminal.id}
            {customName && <span style={{ color: '#414868' }}> ({terminal.id})</span>}
            {terminal.connected
              ? (terminal.sessionResumed ? ' (resumed)' : '')
              : ' (disconnected)'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleUpload}
          />
          {/* Upload button */}
          <button
            className="pane-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={uploading ? { color: '#e0af68' } : undefined}
            title={uploading ? `Uploading ${uploadProgress}%` : 'Upload files'}
            aria-label="Upload files"
          >
            {uploading ? `${uploadProgress}%` : '\u2191'}
          </button>
          {/* Download / File Browser button */}
          <button
            className="pane-btn"
            onClick={() => setFileBrowserOpen((v) => !v)}
            style={fileBrowserOpen ? { color: '#7aa2f7' } : undefined}
            title="Browse files"
            aria-label="Browse files"
          >
            {'\u2193'}
          </button>
          <button
            className="pane-btn"
            onClick={() => splitTerminal(terminal.id, 'horizontal')}
            title="Split horizontal (left/right)"
            aria-label="Split horizontal"
          >
            |
          </button>
          <button
            className="pane-btn"
            onClick={() => splitTerminal(terminal.id, 'vertical')}
            title="Split vertical (top/bottom)"
            aria-label="Split vertical"
          >
            ─
          </button>
          {canClose && (
            <button
              className="pane-btn pane-btn--danger"
              onClick={() => removeTerminal(terminal.id)}
              title="Close terminal"
              aria-label="Close terminal"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Terminal + FileBrowser overlay */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <TerminalView sessionId={terminal.id} />
        {fileBrowserOpen && (
          <FileBrowser
            sessionId={terminal.id}
            onClose={() => setFileBrowserOpen(false)}
          />
        )}
      </div>

      {/* Error bar */}
      {terminal.error && (
        <div style={{
          padding: '2px 8px',
          backgroundColor: '#3b2029',
          borderTop: '1px solid #f7768e',
          color: '#f7768e',
          fontSize: '11px',
          flexShrink: 0,
        }}>
          {terminal.error}
        </div>
      )}
    </div>
  );
}

