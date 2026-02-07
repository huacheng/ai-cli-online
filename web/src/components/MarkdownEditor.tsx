import { useState, useRef, useCallback, useEffect } from 'react';

interface MarkdownEditorProps {
  onSend: (text: string) => void;
  onClose: () => void;
}

export function MarkdownEditor({ onSend, onClose }: MarkdownEditorProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const text = content.trim();
    if (!text) return;
    onSend(text);
    setContent('');
  }, [content, onSend]);

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
