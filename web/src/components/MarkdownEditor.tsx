import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { fetchDraft, saveDraft } from '../api/drafts';
import { fetchFiles, type FileEntry } from '../api/files';
import { useStore } from '../store';
import { useTextareaUndo, handleTabKey } from '../hooks/useTextareaKit';

/* ── Chat History (localStorage) ── */

interface HistoryItem {
  text: string;
  ts: number;
}

const HISTORY_KEY = 'chat-history';
const HISTORY_MAX = 50;

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToHistory(text: string) {
  const items = loadHistory();
  // Deduplicate: remove existing entry with same text
  const filtered = items.filter((h) => h.text !== text);
  filtered.unshift({ text, ts: Date.now() });
  if (filtered.length > HISTORY_MAX) filtered.length = HISTORY_MAX;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
}

const SLASH_COMMANDS = [
  // Local (intercepted, not sent to terminal)
  { cmd: '/history', desc: 'Browse sent message history' },
  // Claude Code built-in
  { cmd: '/plan', desc: 'Enter plan mode' },
  { cmd: '/help', desc: 'Get help' },
  { cmd: '/compact', desc: 'Compact conversation' },
  { cmd: '/clear', desc: 'Clear conversation' },
  { cmd: '/model', desc: 'Switch model' },
  { cmd: '/cost', desc: 'Show token usage' },
  { cmd: '/status', desc: 'Show status' },
  { cmd: '/init', desc: 'Initialize project CLAUDE.md' },
  { cmd: '/memory', desc: 'Edit memory files' },
  { cmd: '/review', desc: 'Review code' },
  { cmd: '/bug', desc: 'Report a bug' },
  { cmd: '/login', desc: 'Login to Anthropic' },
  { cmd: '/doctor', desc: 'Run diagnostics' },
  { cmd: '/permissions', desc: 'Manage permissions' },
  { cmd: '/mcp', desc: 'MCP server management' },
  { cmd: '/terminal-setup', desc: 'Configure terminal' },
  { cmd: '/vim', desc: 'Toggle vim mode' },
  // oh-my-claudecode
  { cmd: '/oh-my-claudecode:autopilot', desc: 'Full autonomous execution' },
  { cmd: '/oh-my-claudecode:ralph', desc: 'Persistence loop until done' },
  { cmd: '/oh-my-claudecode:ultrawork', desc: 'Max parallel execution' },
  { cmd: '/oh-my-claudecode:ecomode', desc: 'Token-efficient execution' },
  { cmd: '/oh-my-claudecode:plan', desc: 'Strategic planning session' },
  { cmd: '/oh-my-claudecode:ralplan', desc: 'Iterative planning consensus' },
  { cmd: '/oh-my-claudecode:ultrapilot', desc: 'Parallel autopilot (3-5x faster)' },
  { cmd: '/oh-my-claudecode:analyze', desc: 'Deep analysis/investigation' },
  { cmd: '/oh-my-claudecode:deepsearch', desc: 'Thorough codebase search' },
  { cmd: '/oh-my-claudecode:deepinit', desc: 'Generate AGENTS.md hierarchy' },
  { cmd: '/oh-my-claudecode:ultraqa', desc: 'QA cycling: test/fix/repeat' },
  { cmd: '/oh-my-claudecode:tdd', desc: 'Test-driven development' },
  { cmd: '/oh-my-claudecode:code-review', desc: 'Comprehensive code review' },
  { cmd: '/oh-my-claudecode:security-review', desc: 'Security vulnerability review' },
  { cmd: '/oh-my-claudecode:build-fix', desc: 'Fix build/TypeScript errors' },
  { cmd: '/oh-my-claudecode:research', desc: 'Parallel research orchestration' },
  { cmd: '/oh-my-claudecode:swarm', desc: 'N coordinated agents' },
  { cmd: '/oh-my-claudecode:pipeline', desc: 'Sequential agent chaining' },
  { cmd: '/oh-my-claudecode:learner', desc: 'Extract skill from session' },
  { cmd: '/oh-my-claudecode:note', desc: 'Save notes to notepad' },
  { cmd: '/oh-my-claudecode:cancel', desc: 'Cancel active OMC mode' },
  { cmd: '/oh-my-claudecode:help', desc: 'OMC usage guide' },
  { cmd: '/oh-my-claudecode:doctor', desc: 'Diagnose OMC issues' },
  { cmd: '/oh-my-claudecode:omc-setup', desc: 'One-time OMC setup' },
  { cmd: '/oh-my-claudecode:hud', desc: 'Configure HUD statusline' },
  { cmd: '/oh-my-claudecode:release', desc: 'Automated release workflow' },
  { cmd: '/oh-my-claudecode:ralph-init', desc: 'Initialize PRD for ralph' },
  { cmd: '/oh-my-claudecode:review', desc: 'Review plan with Critic' },
  { cmd: '/oh-my-claudecode:git-master', desc: 'Git expert for commits' },
  { cmd: '/oh-my-claudecode:mcp-setup', desc: 'Configure MCP servers' },
  { cmd: '/oh-my-claudecode:skill', desc: 'Manage local skills' },
  { cmd: '/oh-my-claudecode:writer-memory', desc: 'Writer memory system' },
  { cmd: '/oh-my-claudecode:psm', desc: 'Project session manager' },
  { cmd: '/oh-my-claudecode:trace', desc: 'Agent flow trace timeline' },
  { cmd: '/plan-analyzer', desc: 'Task complexity grading & token routing' },
];

export interface MarkdownEditorHandle {
  send: () => void;
  fillContent: (text: string) => void;
  insertAtCursor: (text: string) => void;
}

interface MarkdownEditorProps {
  onSend: (text: string) => void;
  onContentChange?: (hasContent: boolean) => void;
  sessionId: string;
  token: string;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ onSend, onContentChange, sessionId, token }, ref) {
  const fontSize = useStore((s) => s.fontSize);
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loadedRef = useRef(false);
  const filledRef = useRef(false); // set by fillContent to prevent draft overwrite

  // Shared undo stack for programmatic edits (Tab, slash insert, @ insert)
  const { pushUndo: _pushUndo, popUndo } = useTextareaUndo();
  const contentRef = useRef(content);
  contentRef.current = content;
  const pushUndo = useCallback(() => _pushUndo(contentRef.current), [_pushUndo]);

  // Slash command autocomplete state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);

  // History popup state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyFilter, setHistoryFilter] = useState('');
  const historyDropdownRef = useRef<HTMLDivElement>(null);

  const filteredHistory = useMemo(() => {
    if (!historyFilter) return historyItems;
    const q = historyFilter.toLowerCase();
    return historyItems.filter((h) => h.text.toLowerCase().includes(q));
  }, [historyItems, historyFilter]);

  // File selector autocomplete state
  const [fileOpen, setFileOpen] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [fileDir, setFileDir] = useState('');
  const [fileIndex, setFileIndex] = useState(0);
  const [fileList, setFileList] = useState<FileEntry[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const baseCwdRef = useRef('');
  const fileDropdownRef = useRef<HTMLDivElement>(null);

  const filteredCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS;
    const q = slashFilter.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
  }, [slashFilter]);

  const filteredFiles = useMemo(() => {
    let list = fileList;
    if (fileFilter) {
      const q = fileFilter.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [fileList, fileFilter]);

  // Load draft on mount
  useEffect(() => {
    let cancelled = false;
    fetchDraft(token, sessionId).then((draft) => {
      if (!cancelled && draft && !filledRef.current) {
        setContent(draft);
      }
      loadedRef.current = true;
    }).catch(() => {
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [token, sessionId]);

  // Auto-save with 500ms debounce
  useEffect(() => {
    if (!loadedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveDraft(token, sessionId, content).catch(() => {});
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, token, sessionId]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Fetch file list when @ selector opens or directory changes
  useEffect(() => {
    if (!fileOpen) return;
    let cancelled = false;
    setFileLoading(true);

    (async () => {
      try {
        if (!fileDir) {
          // Fresh @ open — fetch CWD
          const res = await fetchFiles(token, sessionId);
          if (cancelled) return;
          baseCwdRef.current = res.cwd;
          setFileList(res.files);
        } else {
          // Subdirectory navigation
          if (!baseCwdRef.current) {
            const cwdRes = await fetchFiles(token, sessionId);
            if (cancelled) return;
            baseCwdRef.current = cwdRes.cwd;
          }
          const targetPath = `${baseCwdRef.current}/${fileDir.replace(/\/$/, '')}`;
          const res = await fetchFiles(token, sessionId, targetPath);
          if (cancelled) return;
          setFileList(res.files);
        }
        setFileLoading(false);
      } catch {
        if (cancelled) return;
        setFileList([]);
        setFileLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [fileOpen, fileDir, token, sessionId]);

  // Scroll active file item into view
  useEffect(() => {
    if (!fileOpen || !fileDropdownRef.current) return;
    const active = fileDropdownRef.current.querySelector('.file-item--active');
    active?.scrollIntoView({ block: 'nearest' });
  }, [fileIndex, fileOpen]);

  const handleSend = useCallback(() => {
    const text = contentRef.current.trim();
    if (!text) return;
    saveToHistory(text);
    onSend(text);
    setContent('');
    saveDraft(token, sessionId, '').catch(() => {});
  }, [onSend, token, sessionId]);

  const fillContent = useCallback((text: string) => {
    pushUndo();
    setContent(text);
    filledRef.current = true; // prevent pending draft fetch from overwriting
  }, [pushUndo]);

  const insertAtCursor = useCallback((text: string) => {
    const ta = textareaRef.current;
    pushUndo();
    const cur = contentRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newContent = cur.slice(0, start) + text + cur.slice(end);
      setContent(newContent);
      const newPos = start + text.length;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = newPos;
        ta.focus();
      });
    } else {
      setContent(cur + text);
    }
  }, [pushUndo]);

  useImperativeHandle(ref, () => ({ send: handleSend, fillContent, insertAtCursor }), [handleSend, fillContent, insertAtCursor]);

  // Notify parent of content emptiness changes
  useEffect(() => {
    onContentChange?.(content.trim().length > 0);
  }, [content, onContentChange]);

  // ── Clipboard: auto-copy on select + right-click paste ──
  const pasteFloatElRef = useRef<HTMLDivElement | null>(null);
  const pasteFloatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insertAtCursorRef = useRef(insertAtCursor);
  insertAtCursorRef.current = insertAtCursor;

  const removePasteFloat = useCallback(() => {
    if (pasteFloatTimerRef.current) { clearTimeout(pasteFloatTimerRef.current); pasteFloatTimerRef.current = null; }
    if (pasteFloatElRef.current) { pasteFloatElRef.current.remove(); pasteFloatElRef.current = null; }
  }, []);

  const showPasteFloat = useCallback((x: number, y: number) => {
    removePasteFloat();
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:1000;display:flex;align-items:center;gap:4px;padding:4px 6px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-family:inherit;`;
    const ta = document.createElement('textarea');
    ta.style.cssText = `width:90px;height:22px;resize:none;border:1px solid var(--border);border-radius:3px;background:var(--bg-primary);color:var(--text-primary);font-size:11px;font-family:inherit;padding:2px 4px;outline:none;`;
    ta.placeholder = 'Ctrl+V';
    ta.addEventListener('paste', (ev) => {
      ev.preventDefault();
      const text = ev.clipboardData?.getData('text/plain');
      if (text) insertAtCursorRef.current(text);
      removePasteFloat();
    });
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') removePasteFloat(); });
    el.appendChild(ta);
    document.body.appendChild(el);
    pasteFloatElRef.current = el;
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
      if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;
      ta.focus();
    });
    pasteFloatTimerRef.current = setTimeout(removePasteFloat, 8000);
  }, [removePasteFloat]);

  useEffect(() => {
    const dismiss = () => { if (pasteFloatElRef.current) removePasteFloat(); };
    document.addEventListener('click', dismiss);
    return () => { document.removeEventListener('click', dismiss); removePasteFloat(); };
  }, [removePasteFloat]);

  const handleEditorMouseUp = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd } = ta;
    if (selectionStart !== selectionEnd) {
      const selected = ta.value.substring(selectionStart, selectionEnd);
      if (selected) navigator.clipboard.writeText(selected).catch(() => {});
    }
  }, []);

  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    removePasteFloat();
    if (!navigator.clipboard?.readText) {
      showPasteFloat(e.clientX, e.clientY);
      return;
    }
    navigator.clipboard.readText().then((text) => {
      if (text) insertAtCursorRef.current(text);
    }).catch(() => {
      showPasteFloat(e.clientX, e.clientY);
    });
  }, [removePasteFloat, showPasteFloat]);

  // Open history popup
  const openHistory = useCallback(() => {
    const items = loadHistory();
    setSlashOpen(false);
    setSlashFilter('');
    // Clear the /history text from the editor
    const ta = textareaRef.current;
    if (ta) {
      const pos = ta.selectionStart;
      const before = content.slice(0, pos);
      const after = content.slice(pos);
      const match = before.match(/(?:^|\s)(\/history)\s*$/);
      if (match) {
        const start = before.length - match[1].length;
        setContent(content.slice(0, start) + after);
      }
    }
    if (items.length === 0) return; // no history — don't open empty popup
    setHistoryItems(items);
    setHistoryIndex(0);
    setHistoryFilter('');
    setHistoryOpen(true);
  }, [content]);

  // Select history item → fill editor
  const selectHistoryItem = useCallback((item: HistoryItem) => {
    pushUndo();
    setContent(item.text);
    setHistoryOpen(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) { ta.selectionStart = ta.selectionEnd = item.text.length; ta.focus(); }
    });
  }, [pushUndo]);

  // Delete history item
  const deleteHistoryItem = useCallback((index: number) => {
    const item = filteredHistory[index];
    if (!item) return;
    const updated = historyItems.filter((h) => h.ts !== item.ts || h.text !== item.text);
    setHistoryItems(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    // Clamp index: recompute filtered length after removal
    const newFiltered = historyFilter
      ? updated.filter((h) => h.text.toLowerCase().includes(historyFilter.toLowerCase()))
      : updated;
    if (historyIndex >= newFiltered.length) setHistoryIndex(Math.max(0, newFiltered.length - 1));
  }, [filteredHistory, historyItems, historyIndex, historyFilter]);

  // Scroll active history item into view
  useEffect(() => {
    if (!historyOpen || !historyDropdownRef.current) return;
    const active = historyDropdownRef.current.querySelector('.history-item--active');
    active?.scrollIntoView({ block: 'nearest' });
  }, [historyIndex, historyOpen]);

  // Insert slash command at cursor, replacing the /prefix
  const insertSlashCommand = useCallback((cmd: string) => {
    // Intercept local commands
    if (cmd === '/history') { openHistory(); return; }

    const ta = textareaRef.current;
    if (!ta) return;
    pushUndo();
    const pos = ta.selectionStart;
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    // Find the start of the slash token before cursor
    const lastNewline = before.lastIndexOf('\n');
    const lineStart = lastNewline + 1;
    const lineBeforeCursor = before.slice(lineStart);
    // Match /... at the end of line content before cursor
    const match = lineBeforeCursor.match(/\/[a-zA-Z:-]*$/);
    if (match) {
      const replaceStart = lineStart + (match.index ?? 0);
      const inserted = cmd + ' ';
      const newContent = content.slice(0, replaceStart) + inserted + after;
      setContent(newContent);
      // Move cursor after inserted command + space
      const newPos = replaceStart + inserted.length;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = newPos;
        ta.focus();
      });
    } else {
      // Fallback: just insert at cursor
      const newContent = before + cmd + after;
      setContent(newContent);
      const newPos = pos + cmd.length;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = newPos;
        ta.focus();
      });
    }
    setSlashOpen(false);
    setSlashFilter('');
    setSlashIndex(0);
  }, [content, pushUndo, openHistory]);

  // Insert file at @ mention, or navigate into directory
  const insertFileAtMention = useCallback((file: FileEntry) => {
    const ta = textareaRef.current;
    if (!ta) return;
    pushUndo();
    const pos = ta.selectionStart;
    const before = content.slice(0, pos);
    const after = content.slice(pos);

    const atMatch = before.match(/@([a-zA-Z0-9_.\-/]*)$/);
    if (!atMatch) return;

    const atStart = before.length - atMatch[0].length;

    if (file.type === 'directory') {
      // Append directory name and navigate into it
      const newToken = '@' + fileDir + file.name + '/';
      const newContent = content.slice(0, atStart) + newToken + after;
      setContent(newContent);
      const newPos = atStart + newToken.length;
      setFileDir(fileDir + file.name + '/');
      setFileFilter('');
      setFileIndex(0);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = newPos;
        ta.focus();
      });
    } else {
      // Insert filename and close selector
      const inserted = file.name + ' ';
      const newContent = content.slice(0, atStart) + inserted + after;
      setContent(newContent);
      const newPos = atStart + inserted.length;
      setFileOpen(false);
      setFileFilter('');
      setFileDir('');
      setFileIndex(0);
      setFileList([]);
      baseCwdRef.current = '';
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = newPos;
        ta.focus();
      });
    }
  }, [content, fileDir, pushUndo]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    // Close history popup when user types
    if (historyOpen) {
      // Use typed content as filter
      const trimmed = val.trim();
      if (trimmed) {
        setHistoryFilter(trimmed);
        setHistoryIndex(0);
      } else {
        setHistoryFilter('');
      }
      return;
    }

    // Detect slash command trigger
    const pos = e.target.selectionStart;
    const before = val.slice(0, pos);
    const lastNewline = before.lastIndexOf('\n');
    const lineBeforeCursor = before.slice(lastNewline + 1);

    const match = lineBeforeCursor.match(/(?:^|\s)\/([a-zA-Z:-]*)$/);
    if (match) {
      setSlashOpen(true);
      setSlashFilter(match[1]);
      setSlashIndex(0);
      setFileOpen(false);
    } else {
      setSlashOpen(false);
      // Check for @ file mention
      const atMatch = before.match(/@([a-zA-Z0-9_.\-/]*)$/);
      if (atMatch) {
        const fullPath = atMatch[1];
        const lastSlash = fullPath.lastIndexOf('/');
        const dirPart = lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : '';
        const filterPart = lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
        setFileFilter(filterPart);
        setFileIndex(0);
        setFileDir(dirPart);
        setFileOpen(true);
      } else {
        setFileOpen(false);
      }
    }
  }, [historyOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash command navigation
      if (slashOpen && filteredCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashIndex((i) => (i + 1) % filteredCommands.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertSlashCommand(filteredCommands[slashIndex].cmd);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashOpen(false);
          return;
        }
      }

      // File selector navigation
      if (fileOpen && filteredFiles.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFileIndex((i) => (i + 1) % filteredFiles.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFileIndex((i) => (i - 1 + filteredFiles.length) % filteredFiles.length);
          return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          insertFileAtMention(filteredFiles[fileIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setFileOpen(false);
          return;
        }
      }

      // History popup navigation
      if (historyOpen && filteredHistory.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHistoryIndex((i) => (i + 1) % filteredHistory.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHistoryIndex((i) => (i - 1 + filteredHistory.length) % filteredHistory.length);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          selectHistoryItem(filteredHistory[historyIndex]);
          return;
        }
        if (e.key === 'Delete' || (e.key === 'Backspace' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          deleteHistoryItem(historyIndex);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setHistoryOpen(false);
          return;
        }
      }

      // Tab key: insert 2 spaces
      if (e.key === 'Tab') {
        handleTabKey(e, setContent, _pushUndo);
        return;
      }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, slashOpen, filteredCommands, slashIndex, insertSlashCommand, fileOpen, filteredFiles, fileIndex, insertFileAtMention, _pushUndo, popUndo, historyOpen, filteredHistory, historyIndex, selectHistoryItem, deleteHistoryItem],
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {/* Slash command dropdown */}
      {slashOpen && filteredCommands.length > 0 && (
        <div className="slash-dropdown">
          {filteredCommands.map((c, i) => (
            <div
              key={c.cmd}
              className={`slash-item${i === slashIndex ? ' slash-item--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus
                insertSlashCommand(c.cmd);
              }}
              onMouseEnter={() => setSlashIndex(i)}
            >
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* File selector dropdown */}
      {fileOpen && (fileLoading || filteredFiles.length > 0) && (
        <div className="file-dropdown" ref={fileDropdownRef}>
          {fileLoading ? (
            <div className="file-item file-loading">Loading...</div>
          ) : (
            filteredFiles.map((f, i) => (
              <div
                key={f.name}
                className={`file-item${i === fileIndex ? ' file-item--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertFileAtMention(f);
                }}
                onMouseEnter={() => setFileIndex(i)}
              >
                <span className="file-icon">{f.type === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}'}</span>
                <span className="file-name">{f.name}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* History popup */}
      {historyOpen && (
        <div className="history-dropdown" ref={historyDropdownRef}>
          {filteredHistory.length === 0 ? (
            <div className="history-item history-empty">No history yet</div>
          ) : (
            filteredHistory.map((h, i) => (
              <div
                key={`${h.ts}-${i}`}
                className={`history-item${i === historyIndex ? ' history-item--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectHistoryItem(h);
                }}
                onMouseEnter={() => setHistoryIndex(i)}
              >
                <span className="history-text">{h.text.length > 120 ? h.text.slice(0, 120) + '...' : h.text}</span>
                <span className="history-time">{new Date(h.ts).toLocaleString()}</span>
                <button
                  className="history-delete"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteHistoryItem(i);
                  }}
                  title="Delete (Del key)"
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Full-width textarea */}
      <textarea
        ref={textareaRef}
        className="md-editor-textarea"
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onMouseUp={handleEditorMouseUp}
        onContextMenu={handleEditorContextMenu}
        placeholder="Type / for commands, @ for files, Ctrl+Enter to send"
        spellCheck={false}
        style={{ flex: 1, fontSize: `${fontSize}px` }}
      />
    </div>
  );
});
