import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFiles, touchFile } from '../api/files';
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
  const [newFileName, setNewFileName] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!token || !planDir) return;
    setLoading(true);
    try {
      const data = await fetchFiles(token, sessionId, planDir);
      // Filter .md files only, sort with INDEX.md first
      const mdFiles = data.files
        .filter((f) => f.type === 'file' && f.name.toLowerCase().endsWith('.md'))
        .sort((a, b) => {
          const aIsIndex = a.name.toLowerCase() === 'index.md';
          const bIsIndex = b.name.toLowerCase() === 'index.md';
          if (aIsIndex && !bIsIndex) return -1;
          if (!aIsIndex && bIsIndex) return 1;
          return a.name.localeCompare(b.name);
        });
      setFiles(mdFiles);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [token, sessionId, planDir]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Expose reload capability via polling (every 5s)
  useEffect(() => {
    const id = setInterval(loadFiles, 5000);
    return () => clearInterval(id);
  }, [loadFiles]);

  const handleCreate = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;
    const finalName = name.endsWith('.md') ? name : `${name}.md`;
    setCreating(true);
    try {
      // Touch creates the file relative to CWD; planDir is inside CWD as "PLAN/"
      // We need to pass the path relative to CWD: "PLAN/{finalName}"
      const planDirName = planDir.split('/').pop() || 'PLAN';
      const result = await touchFile(token, sessionId, `${planDirName}/${finalName}`);
      if (result.ok) {
        setNewFileName('');
        await loadFiles();
        onCreateFile(result.path);
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }, [newFileName, token, sessionId, planDir, loadFiles, onCreateFile]);

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
          const isSelected = file.name === selectedName;
          return (
            <div
              key={file.name}
              className={`plan-file-browser__item${isSelected ? ' plan-file-browser__item--active' : ''}`}
              onClick={() => onSelectFile(fullPath)}
              title={file.name}
            >
              <span className="plan-file-browser__icon">
                {file.name.toLowerCase() === 'index.md' ? '\u2605' : '\u25A1'}
              </span>
              <span className="plan-file-browser__name">{file.name}</span>
              <span className="plan-file-browser__size">{formatSize(file.size)}</span>
            </div>
          );
        })}
      </div>

      {/* New file input */}
      <div className="plan-file-browser__create">
        <input
          ref={inputRef}
          className="plan-file-browser__input"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
          }}
          placeholder="new-file.md"
          disabled={creating}
        />
        <button
          className="pane-btn pane-btn--sm"
          onClick={handleCreate}
          disabled={creating || !newFileName.trim()}
          title="Create new file"
          style={newFileName.trim() ? { color: '#9ece6a' } : { opacity: 0.4 }}
        >
          +
        </button>
      </div>
    </div>
  );
}
