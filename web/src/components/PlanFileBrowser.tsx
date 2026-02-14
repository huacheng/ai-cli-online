import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFiles, touchFile, mkdirPath, deleteItem } from '../api/files';
import type { FileEntry } from '../api/files';
import { formatSize } from '../utils';

interface PlanFileBrowserProps {
  sessionId: string;
  token: string;
  planDir: string;           // absolute path, e.g. "/home/user/project/AiTasks"
  selectedFile: string | null;
  onSelectFile: (fullPath: string) => void;
  onCreateFile: (fullPath: string) => void;
  onDeleteFile?: (fullPath: string) => void;
}

export function PlanFileBrowser({ sessionId, token, planDir, selectedFile, onSelectFile, onCreateFile, onDeleteFile }: PlanFileBrowserProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Current browsing directory (can navigate into subdirectories)
  // Derive initial value from selectedFile so the first render is already correct
  const [currentDir, setCurrentDir] = useState(() => {
    if (selectedFile && selectedFile.startsWith(planDir + '/')) {
      const parentDir = selectedFile.substring(0, selectedFile.lastIndexOf('/'));
      if (parentDir.startsWith(planDir)) return parentDir;
    }
    return planDir;
  });

  // Sync currentDir when planDir or selectedFile changes after mount
  useEffect(() => {
    if (selectedFile && selectedFile.startsWith(planDir + '/')) {
      const parentDir = selectedFile.substring(0, selectedFile.lastIndexOf('/'));
      if (parentDir.startsWith(planDir)) {
        setCurrentDir(parentDir);
        return;
      }
    }
    setCurrentDir(planDir);
  }, [selectedFile, planDir]);

  const loadFiles = useCallback(async () => {
    if (!token || !currentDir) return;
    setLoading(true);
    try {
      const data = await fetchFiles(token, sessionId, currentDir);
      // Show .md files + subdirectories, sort: INDEX.md first, then dirs, then files
      const entries = data.files
        .filter((f) => (f.type === 'file' && (f.name.toLowerCase().endsWith('.md') || f.name === '.index.json')) || f.type === 'directory')
        .sort((a, b) => {
          const aIsIndex = a.type === 'file' && a.name === '.index.json';
          const bIsIndex = b.type === 'file' && b.name === '.index.json';
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
  }, [token, sessionId, currentDir]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Poll every 5s
  useEffect(() => {
    const id = setInterval(loadFiles, 5000);
    return () => clearInterval(id);
  }, [loadFiles]);

  // Relative path from planDir root for API calls (e.g. "PLAN" or "PLAN/sub")
  const relativeDir = useCallback(() => {
    // planDir is the root PLAN/ absolute path. currentDir may be deeper.
    const rootParent = planDir.substring(0, planDir.lastIndexOf('/') + 1);
    return currentDir.startsWith(rootParent) ? currentDir.substring(rootParent.length) : currentDir;
  }, [planDir, currentDir]);

  // Create new .md file
  const handleCreateFile = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    const finalName = name.endsWith('.md') ? name : `${name}.md`;
    setCreating(true);
    try {
      const result = await touchFile(token, sessionId, `${relativeDir()}/${finalName}`);
      if (result.ok) {
        setNewName('');
        await loadFiles();
        onCreateFile(result.path);
      }
    } catch { /* ignore */ } finally {
      setCreating(false);
    }
  }, [newName, token, sessionId, relativeDir, loadFiles, onCreateFile]);

  // Create new subdirectory
  const handleCreateFolder = useCallback(async () => {
    const name = newName.trim().replace(/\/+$/, '');
    if (!name) return;
    setCreating(true);
    try {
      await mkdirPath(token, sessionId, `${relativeDir()}/${name}`);
      setNewName('');
      await loadFiles();
    } catch { /* ignore */ } finally {
      setCreating(false);
    }
  }, [newName, token, sessionId, relativeDir, loadFiles]);

  // Delete a file or directory
  const handleDelete = useCallback(async (file: FileEntry) => {
    const fullPath = `${currentDir}/${file.name}`;
    const label = file.type === 'directory' ? `folder "${file.name}" and all its contents` : `"${file.name}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    try {
      await deleteItem(token, sessionId, fullPath);
      onDeleteFile?.(fullPath);
      await loadFiles();
    } catch { /* ignore */ }
  }, [token, sessionId, currentDir, loadFiles, onDeleteFile]);

  // Navigate into a subdirectory
  const handleEnterDir = useCallback((dirName: string) => {
    setCurrentDir(prev => `${prev}/${dirName}`);
  }, []);

  // Navigate up to parent directory
  const handleGoUp = useCallback(() => {
    if (currentDir === planDir) return;
    setCurrentDir(prev => prev.substring(0, prev.lastIndexOf('/')));
  }, [currentDir, planDir]);

  // Display label: parent dir + relative path from root
  const dirBaseName = planDir.split('/').pop() || 'AiTasks';
  const parentName = (() => {
    const parts = planDir.split('/');
    return parts.length >= 2 ? parts[parts.length - 2] + '/' : '';
  })();
  const displayPath = currentDir === planDir
    ? parentName + dirBaseName + '/'
    : parentName + dirBaseName + '/' + currentDir.substring(planDir.length + 1) + '/';

  const selectedName = selectedFile ? selectedFile.split('/').pop() : null;

  return (
    <div className="plan-file-browser">
      {/* Header */}
      <div className="plan-file-browser__header">
        <span className="plan-file-browser__title" title={displayPath}>{displayPath}</span>
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
          style={newName.trim() ? { color: 'var(--accent-green)', fontWeight: 700, fontSize: 14 } : { opacity: 0.4, fontWeight: 700, fontSize: 14 }}
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
        {/* ".." back to parent when in subdirectory */}
        {currentDir !== planDir && (
          <div
            className="plan-file-browser__item"
            onClick={handleGoUp}
            title="Go up to parent directory"
            style={{ cursor: 'pointer' }}
          >
            <span className="plan-file-browser__icon" style={{ color: 'var(--accent-blue)' }}>&larr;</span>
            <span className="plan-file-browser__name" style={{ color: 'var(--accent-blue)' }}>..</span>
          </div>
        )}
        {files.map((file) => {
          const fullPath = `${currentDir}/${file.name}`;
          const isSelected = file.type === 'file' && file.name === selectedName;
          const isDir = file.type === 'directory';
          return (
            <div
              key={file.name}
              className={`plan-file-browser__item${isSelected ? ' plan-file-browser__item--active' : ''}`}
              onClick={() => isDir ? handleEnterDir(file.name) : onSelectFile(fullPath)}
              title={isDir ? `Open folder ${file.name}` : file.name}
              style={{ cursor: 'pointer' }}
            >
              <span className="plan-file-browser__icon">
                {isDir ? '\u{1F4C1}' : file.name === '.index.json' ? '\u{1F512}' : '\u25A1'}
              </span>
              <span className="plan-file-browser__name">{file.name}{isDir ? '/' : ''}</span>
              {!isDir && <span className="plan-file-browser__size">{formatSize(file.size)}</span>}
              {!file.name.startsWith('.') && (
                <button
                  className="pane-btn pane-btn--danger pane-btn--sm plan-file-browser__delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                  title={`Delete ${file.name}`}
                >
                  &times;
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
