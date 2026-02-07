import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchDraft, saveDraft } from '../api/drafts';

interface MarkdownEditorProps {
  onSend: (text: string) => void;
  onClose: () => void;
  sessionId: string;
  token: string;
}

export function MarkdownEditor({ onSend, onClose, sessionId, token }: MarkdownEditorProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Track whether initial load is done to avoid saving the loaded content back immediately
  const loadedRef = useRef(false);

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
    // Clear server draft after send
    saveDraft(token, sessionId, '').catch(() => {});
  }, [content, onSend, token, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#1a1b26',
      overflow: 'hidden',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        height: '28px',
        flexShrink: 0,
        backgroundColor: '#16161e',
        borderBottom: '1px solid #292e42',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="pane-btn"
            onClick={handleSend}
            disabled={!content.trim()}
            title="Send to terminal (Ctrl+Enter)"
            style={!content.trim() ? { opacity: 0.4, cursor: 'default' } : { color: '#9ece6a' }}
          >
            Send ⏎
          </button>
          <button
            className="pane-btn"
            onClick={() => setContent('')}
            title="Clear editor"
          >
            Clear
          </button>
        </div>
        <button
          className="pane-btn pane-btn--danger"
          onClick={onClose}
          title="Close editor"
        >
          ×
        </button>
      </div>

      {/* Full-width textarea */}
      <textarea
        ref={textareaRef}
        className="md-editor-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type here... (Ctrl+Enter to send)"
        spellCheck={false}
        style={{ flex: 1 }}
      />
    </div>
  );
}
