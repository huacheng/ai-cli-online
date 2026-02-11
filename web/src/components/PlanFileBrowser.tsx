import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFiles, touchFile, mkdirPath } from '../api/files';
import type { FileEntry } from '../api/files';
import { formatSize } from '../utils';

interface PlanFileBrowserProps {
  sessionId: string;
  token: string;
  planDir: string;           // absolute path, e.g. "/home/user/project/PLAN"
  selectedFile: string | null;
  onSelectFile: (fullPath: string) => void;
  onCreateFile: (fullPath: string) => void;
}

export function PlanFileBrowser({ sessionId, token, planDir, selectedFile, onSelectFile, onCreateFile }: PlanFileBrowserProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!token || !planDir) return;
    setLoading(true);
    try {
      const data = await fetchFiles(token, sessionId, planDir);
      // Show .md files + subdirectories, sort: INDEX.md first, then dirs, then files
      const entries = data.files
        .filter((f) => (f.type === 'file' && f.name.toLowerCase().endsWith('.md')) || f.type === 'directory')
        .sort((a, b) => {
          const aIsIndex = a.type === 'file' && a.name.toLowerCase() === 'index.md';
          const bIsIndex = b.type === 'file' && b.name.toLowerCase() === 'index.md';
          if (aIsIndex && !bIsIndex) return -1;
          if (!aIsIndex && bIsIndex) return 1;
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });
      setFiles(entries);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [token, sessionId, planDir]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Poll every 5s
  useEffect(() => {
    const id = setInterval(loadFiles, 5000);
    return () => clearInterval(id);
  }, [loadFiles]);

  // Create new .md file
  const handleCreateFile = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    const finalName = name.endsWith('.md') ? name : `${name}.md`;
    setCreating(true);
    try {
      const planDirName = planDir.split('/').pop() || 'PLAN';
      const result = await touchFile(token, sessionId, `${planDirName}/${finalName}`);
      if (result.ok) {
        setNewName('');
        await loadFiles();
        onCreateFile(result.path);
      }
    } catch { /* ignore */ } finally {
      setCreating(false);
    }
  }, [newName, token, sessionId, planDir, loadFiles, onCreateFile]);

  // Create new subdirectory
  const handleCreateFolder = useCallback(async () => {
    const name = newName.trim().replace(/\/+$/, '');
    if (!name) return;
    setCreating(true);
    try {
      const planDirName = planDir.split('/').pop() || 'PLAN';
      await mkdirPath(token, sessionId, `${planDirName}/${name}`);
      setNewName('');
      await loadFiles();
    } catch { /* ignore */ } finally {
      setCreating(false);
    }
  }, [newName, token, sessionId, planDir, loadFiles]);

  const selectedName = selectedFile ? selectedFile.split('/').pop() : null;

  return (
    <div className="plan-file-browser">
      {/* Header */}
      <div className="plan-file-browser__header">
        <span className="plan-file-browser__title">PLAN/</span>
        <button
          className="pane-btn pane-btn--sm"
          onClick={loadFiles}
          title="Refresh file list"
          style={{ fontSize: 12 }}
        >
          &#x21BB;
        </button>
      </div>

      {/* Create new file/folder — at top */}
      <div className="plan-file-browser__create">
        <input
          ref={inputRef}
          className="plan-file-browser__input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleCreateFile(); }
          }}
          placeholder="name"
          disabled={creating}
        />
        <button
          className="pane-btn pane-btn--sm"
          onClick={handleCreateFile}
          disabled={creating || !newName.trim()}
          title="Create new .md file"
          style={newName.trim() ? { color: 'var(--accent-green)' } : { opacity: 0.4 }}
        >
          +
        </button>
        <button
          className="pane-btn pane-btn--sm"
          onClick={handleCreateFolder}
          disabled={creating || !newName.trim()}
          title="Create new folder"
          style={newName.trim() ? { color: 'var(--accent-blue)' } : { opacity: 0.4 }}
        >
          &#x1F4C1;
        </button>
      </div>

      {/* File list */}
      <div className="plan-file-browser__list">
        {loading && files.length === 0 && (
          <div className="plan-file-browser__status">Loading...</div>
        )}
        {!loading && files.length === 0 && (
          <div className="plan-file-browser__status">No .md files</div>
        )}
        {files.map((file) => {
          const fullPath = `${planDir}/${file.name}`;
          const isSelected = file.type === 'file' && file.name === selectedName;
          const isDir = file.type === 'directory';
          return (
            <div
              key={file.name}
              className={`plan-file-browser__item${isSelected ? ' plan-file-browser__item--active' : ''}`}
              onClick={() => !isDir && onSelectFile(fullPath)}
              title={file.name}
              style={isDir ? { opacity: 0.6, cursor: 'default' } : undefined}
            >
              <span className="plan-file-browser__icon">
                {isDir ? '\u{1F4C1}' : file.name.toLowerCase() === 'index.md' ? '\u2605' : '\u25A1'}
              </span>
              <span className="plan-file-browser__name">{file.name}{isDir ? '/' : ''}</span>
              {!isDir && <span className="plan-file-browser__size">{formatSize(file.size)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
