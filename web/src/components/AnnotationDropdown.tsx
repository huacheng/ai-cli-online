import { useState, useEffect, useRef, useCallback } from 'react';
import type { PlanAnnotations } from '../types/annotations';

interface AnnotationDropdownProps {
  annotations: PlanAnnotations;
  annCounts: { total: number; sent: number; unsent: number };
  isSent: (id: string) => boolean;
  onSendAll: () => void;
  onSendSingle: (id: string, type: 'add' | 'del' | 'rep' | 'com') => void;
  onDelete: (id: string, type: 'add' | 'del' | 'rep' | 'com') => void;
}

const TYPE_CONFIG = {
  add: { symbol: '+', color: 'var(--accent-yellow)', field: 'content' as const },
  del: { symbol: '\u2212', color: 'var(--accent-red)', field: 'selectedText' as const },
  rep: { symbol: '\u21C4', color: 'var(--accent-blue)', field: 'content' as const },
  com: { symbol: '?', color: 'var(--accent-green)', field: 'content' as const },
} as const;

export function AnnotationDropdown({ annotations, annCounts, isSent, onSendAll, onSendSingle, onDelete }: AnnotationDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const renderItem = useCallback((
    id: string,
    type: 'add' | 'del' | 'rep' | 'com',
    text: string,
  ) => {
    const config = TYPE_CONFIG[type];
    const sent = isSent(id);
    return (
      <div key={id} className={`plan-anno-dropdown__item plan-anno-dropdown__item--${type}`}>
        <span className="plan-anno-dropdown__type" style={{ color: config.color }}>{config.symbol}</span>
        <span className="plan-anno-dropdown__text">{text.slice(0, 60)}{text.length > 60 ? '...' : ''}</span>
        <button
          className="pane-btn pane-btn--sm"
          onClick={() => !sent && onSendSingle(id, type)}
          disabled={sent}
          title={sent ? 'Already sent' : 'Send to terminal'}
          style={sent ? { opacity: 0.3 } : { color: 'var(--accent-blue)' }}
        >Send</button>
        <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => onDelete(id, type)} title="Delete">&times;</button>
      </div>
    );
  }, [isSent, onSendSingle, onDelete]);

  // First annotation preview text
  const previewText = (() => {
    const firstAdd = annotations.additions[0];
    const firstDel = annotations.deletions[0];
    const firstRep = annotations.replacements[0];
    const firstCom = annotations.comments[0];
    const text = firstAdd ? firstAdd.content : firstDel ? firstDel.selectedText : firstRep ? firstRep.content : firstCom ? firstCom.content : '';
    if (!text) return '';
    return text.slice(0, 40) + (text.length > 40 ? '...' : '');
  })();

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <div
        className={`plan-anno-dropdown-trigger${open ? ' plan-anno-dropdown-trigger--active' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={annCounts.total > 0 ? `${annCounts.total} annotations (${annCounts.unsent} unsent)` : 'No annotations'}
      >
        <span className="plan-anno-dropdown-trigger__text">{previewText}</span>
        <span className="plan-anno-dropdown-trigger__arrow">&#x25BC;</span>
      </div>
      {open && (
        <div className="plan-anno-dropdown">
          {annCounts.unsent > 0 && (
            <div className="plan-anno-dropdown__header">
              <button
                className="pane-btn"
                onClick={onSendAll}
                style={{ color: 'var(--accent-blue)', fontSize: 11 }}
              >
                Send All Unsent ({annCounts.unsent})
              </button>
            </div>
          )}
          <div className="plan-anno-dropdown__list">
            {annotations.additions.map(a => renderItem(a.id, 'add', a.content))}
            {annotations.deletions.map(d => renderItem(d.id, 'del', d.selectedText))}
            {annotations.replacements.map(r => renderItem(r.id, 'rep', r.content))}
            {annotations.comments.map(c => renderItem(c.id, 'com', c.content))}
            {annCounts.total === 0 && (
              <div className="plan-anno-dropdown__empty">No annotations</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
