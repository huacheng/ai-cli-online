import { useState, useRef, useEffect, useCallback } from 'react';
import { autoRows } from '../hooks/useTextareaKit';
import type { DeleteAnnotation, ReplaceAnnotation, CommentAnnotation } from '../types/annotations';

type AnnType = 'del' | 'rep' | 'com';

interface AnnotationCardProps {
  type: AnnType;
  annotation: DeleteAnnotation | ReplaceAnnotation | CommentAnnotation;
  fontSize: number;
  onEdit: (id: string, newContent: string) => void;
  onRemove: (id: string) => void;
  onSend?: (id: string) => void;
  isSent: boolean;
}

const TYPE_META: Record<AnnType, { className: string; icon: string; color: string }> = {
  del: { className: 'plan-deletion-card', icon: '', color: 'var(--accent-red)' },
  rep: { className: 'plan-replace-card', icon: '\u21C4', color: 'var(--accent-blue)' },
  com: { className: 'plan-comment-card', icon: '?', color: 'var(--accent-green)' },
};

export function AnnotationCard({ type, annotation, fontSize, onEdit, onRemove, onSend, isSent }: AnnotationCardProps) {
  const meta = TYPE_META[type];
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Determine display/edit text based on type
  const displayText = type === 'del'
    ? (annotation as DeleteAnnotation).selectedText
    : (annotation as ReplaceAnnotation | CommentAnnotation).content;

  const startEdit = useCallback(() => {
    setEditing(true);
    setEditText(displayText);
  }, [displayText]);

  const saveEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (trimmed) {
      onEdit(annotation.id, trimmed);
    } else {
      onRemove(annotation.id);
    }
    setEditing(false);
  }, [editText, annotation.id, onEdit, onRemove]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        const el = editRef.current;
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
      });
    }
  }, [editing]);

  if (editing) {
    return (
      <div className={meta.className}>
        <textarea
          ref={editRef}
          className="plan-annotation-textarea"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }}
          onBlur={saveEdit}
          rows={autoRows(editText)}
          style={{ fontSize: `${fontSize}px`, flex: 1 }}
        />
      </div>
    );
  }

  return (
    <div className={meta.className}>
      {/* Type icon (not for del) */}
      {meta.icon && <span style={{ color: meta.color, flexShrink: 0 }}>{meta.icon}</span>}

      {/* Content display */}
      {type === 'del' ? (
        <span
          style={{ flex: 1, fontSize: `${fontSize}px`, color: meta.color, textDecoration: 'line-through', whiteSpace: 'pre-wrap', cursor: 'text' }}
          onDoubleClick={startEdit}
          title="Double-click to edit"
        >
          {(annotation as DeleteAnnotation).selectedText}
        </span>
      ) : type === 'rep' ? (
        <span
          style={{ flex: 1, fontSize: `${fontSize}px`, whiteSpace: 'pre-wrap', cursor: 'text' }}
          onDoubleClick={startEdit}
          title="Double-click to edit"
        >
          <span style={{ color: 'var(--accent-red)', textDecoration: 'line-through' }}>{(annotation as ReplaceAnnotation).selectedText}</span>
          <span style={{ color: 'var(--text-secondary)' }}> &rarr; </span>
          <span style={{ color: 'var(--accent-blue)' }}>{(annotation as ReplaceAnnotation).content}</span>
        </span>
      ) : (
        <span
          style={{ flex: 1, fontSize: `${fontSize}px`, whiteSpace: 'pre-wrap', cursor: 'text' }}
          onDoubleClick={startEdit}
          title="Double-click to edit"
        >
          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>"{(annotation as CommentAnnotation).selectedText}"</span>
          <span style={{ color: 'var(--text-secondary)' }}>: </span>
          <span style={{ color: 'var(--accent-green)' }}>{(annotation as CommentAnnotation).content}</span>
        </span>
      )}

      {/* Send button */}
      {onSend && (
        <button
          className="pane-btn pane-btn--sm"
          onClick={() => !isSent && onSend(annotation.id)}
          disabled={isSent}
          title={isSent ? 'Already sent' : 'Send to terminal'}
          style={isSent ? { opacity: 0.3 } : { color: 'var(--accent-green)' }}
        >Send</button>
      )}

      {/* Edit button */}
      <button
        className="pane-btn pane-btn--sm"
        onClick={startEdit}
        style={{ color: 'var(--accent-blue)' }}
        title={`Edit ${type === 'del' ? 'deletion' : type === 'rep' ? 'replacement' : 'comment'}`}
      >&#x270E;</button>

      {/* Remove button */}
      <button
        className="pane-btn pane-btn--danger pane-btn--sm"
        onClick={() => onRemove(annotation.id)}
        title={`Remove ${type === 'del' ? 'deletion' : type === 'rep' ? 'replacement' : 'comment'}`}
      >&times;</button>
    </div>
  );
}
