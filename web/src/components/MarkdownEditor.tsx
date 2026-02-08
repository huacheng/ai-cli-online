import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { fetchDraft, saveDraft } from '../api/drafts';
import { useStore } from '../store';

const SLASH_COMMANDS = [
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
];

export interface MarkdownEditorHandle {
  send: () => void;
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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const loadedRef = useRef(false);

  // Slash command autocomplete state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS;
    const q = slashFilter.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
  }, [slashFilter]);

  // Load draft on mount
  useEffect(() => {
    let cancelled = false;
    fetchDraft(token, sessionId).then((draft) => {
      if (!cancelled && draft) {
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

  const handleSend = useCallback(() => {
    const text = content.trim();
    if (!text) return;
    onSend(text);
    setContent('');
    saveDraft(token, sessionId, '').catch(() => {});
  }, [content, onSend, token, sessionId]);

  useImperativeHandle(ref, () => ({ send: handleSend }), [handleSend]);

  // Notify parent of content emptiness changes
  useEffect(() => {
    onContentChange?.(content.trim().length > 0);
  }, [content, onContentChange]);

  // Insert slash command at cursor, replacing the /prefix
  const insertSlashCommand = useCallback((cmd: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    // Find the start of the slash token before cursor
    const lastNewline = before.lastIndexOf('\n');
    const lineStart = lastNewline + 1;
    const lineBeforeCursor = before.slice(lineStart);
    // Match /... at the end of line content before cursor
    const match = lineBeforeCursor.match(/\/[a-zA-Z-]*$/);
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
  }, [content]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    // Detect slash command trigger
    const pos = e.target.selectionStart;
    const before = val.slice(0, pos);
    const lastNewline = before.lastIndexOf('\n');
    const lineBeforeCursor = before.slice(lastNewline + 1);

    const match = lineBeforeCursor.match(/^\/([a-zA-Z-]*)$/);
    if (match) {
      setSlashOpen(true);
      setSlashFilter(match[1]);
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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

      // Tab key: insert 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = textareaRef.current;
        if (ta) {
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          const newContent = content.slice(0, start) + '  ' + content.slice(end);
          setContent(newContent);
          const newPos = start + 2;
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = newPos;
          });
        }
        return;
      }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, slashOpen, filteredCommands, slashIndex, insertSlashCommand, content],
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#1a1b26',
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

      {/* Full-width textarea */}
      <textarea
        ref={textareaRef}
        className="md-editor-textarea"
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Type / for commands, Ctrl+Enter to send"
        spellCheck={false}
        style={{ flex: 1, fontSize: `${fontSize}px` }}
      />
    </div>
  );
});
