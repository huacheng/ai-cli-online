import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { marked, type Token } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';

/* ── Data Types ── */

export interface AddAnnotation {
  id: string;
  afterTokenIndex: number;
  sourceLine: number;
  content: string;
}

export interface DeleteAnnotation {
  id: string;
  tokenIndices: number[];
  startLine: number;
  endLine: number;
  selectedText: string;
}

export interface PlanAnnotations {
  additions: AddAnnotation[];
  deletions: DeleteAnnotation[];
}

const EMPTY_ANNOTATIONS: PlanAnnotations = { additions: [], deletions: [] };

/* ── Helpers ── */

let _idCounter = 0;
function uid() { return `ann_${++_idCounter}_${Date.now()}`; }

function storageKey(sessionId: string, filePath: string) {
  return `plan-annotations-${sessionId}-${filePath}`;
}

/** Render a single marked token to sanitized HTML (XSS-safe via DOMPurify) */
function tokenToHtml(token: Token): string {
  const raw = marked.parser([token as Token], { async: false } as never) as unknown as string;
  // All HTML is sanitized with DOMPurify before rendering — safe against XSS
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['img'],
    ADD_ATTR: ['src', 'alt', 'title', 'width', 'height'],
  });
}

/** Approximate source line for a given token index */
function tokenSourceLine(tokens: Token[], index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < tokens.length; i++) {
    const raw = (tokens[i] as { raw?: string }).raw ?? '';
    for (const ch of raw) if (ch === '\n') line++;
  }
  return line;
}

/* ── Summary Generation ── */

export function generateSummary(
  annotations: PlanAnnotations,
  sourceLines: string[],
): string {
  const parts: string[] = [];

  if (annotations.additions.length > 0) {
    parts.push('[增加批注]');
    annotations.additions.forEach((a, i) => {
      const ctx = sourceLines[a.sourceLine - 1]?.trim().slice(0, 50) ?? '';
      parts.push(`${i + 1}. 在第${a.sourceLine}行 ("${ctx}") 之后添加: "${a.content}"`);
    });
  }

  if (annotations.deletions.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push('[删除标记]');
    annotations.deletions.forEach((d, i) => {
      const text = sourceLines.slice(d.startLine - 1, d.endLine).join(' ').trim();
      parts.push(`${i + 1}. 删除第${d.startLine}-${d.endLine}行: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
    });
  }

  if (parts.length === 0) return '';
  return '请根据以下用户批注修改 PLAN.md:\n\n' + parts.join('\n');
}

/* ── Component ── */

interface Props {
  markdown: string;
  filePath: string;
  sessionId: string;
  onExecute: (summary: string) => void;
  onClear?: () => void;
  expanded?: boolean;
}

export function PlanAnnotationRenderer({ markdown, filePath, sessionId, onExecute, onClear, expanded }: Props) {
  const fontSize = useStore((s) => s.fontSize);

  // Parse markdown into tokens
  const tokens = useMemo(() => {
    if (!markdown) return [];
    return marked.lexer(markdown);
  }, [markdown]);

  const sourceLines = useMemo(() => markdown.split('\n'), [markdown]);

  // Annotations state
  const [annotations, setAnnotations] = useState<PlanAnnotations>(() => {
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      return saved ? JSON.parse(saved) : EMPTY_ANNOTATIONS;
    } catch { return EMPTY_ANNOTATIONS; }
  });

  // Undo stack for annotations
  const historyRef = useRef<PlanAnnotations[]>([]);
  const HISTORY_MAX = 30;

  const pushHistory = useCallback(() => {
    historyRef.current.push(JSON.parse(JSON.stringify(annotations)));
    if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift();
  }, [annotations]);

  // Persist annotations to localStorage (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(storageKey(sessionId, filePath), JSON.stringify(annotations));
    }, 300);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [annotations, sessionId, filePath]);

  // Reload annotations when filePath changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      setAnnotations(saved ? JSON.parse(saved) : EMPTY_ANNOTATIONS);
      historyRef.current = [];
    } catch { setAnnotations(EMPTY_ANNOTATIONS); }
  }, [sessionId, filePath]);

  // Active insert zone editing
  const [activeInsert, setActiveInsert] = useState<number | null>(null);
  const [insertText, setInsertText] = useState('');
  const insertTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Delete float button
  const [deleteFloat, setDeleteFloat] = useState<{ x: number; y: number; tokenIndices: number[]; startLine: number; endLine: number; text: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus insert textarea when zone opens
  useEffect(() => {
    if (activeInsert != null) {
      requestAnimationFrame(() => insertTextareaRef.current?.focus());
    }
  }, [activeInsert]);

  // Add annotation
  const handleAddAnnotation = useCallback((afterIndex: number) => {
    if (!insertText.trim()) {
      setActiveInsert(null);
      setInsertText('');
      return;
    }
    pushHistory();
    const line = tokenSourceLine(tokens, afterIndex + 1);
    setAnnotations((prev) => ({
      ...prev,
      additions: [...prev.additions, {
        id: uid(),
        afterTokenIndex: afterIndex,
        sourceLine: line,
        content: insertText.trim(),
      }],
    }));
    setActiveInsert(null);
    setInsertText('');
  }, [insertText, pushHistory, tokens]);

  // Remove an addition annotation
  const handleRemoveAddition = useCallback((id: string) => {
    pushHistory();
    setAnnotations((prev) => ({
      ...prev,
      additions: prev.additions.filter((a) => a.id !== id),
    }));
  }, [pushHistory]);

  // Mark deletion from selection
  const handleMarkDeletion = useCallback(() => {
    if (!deleteFloat) return;
    pushHistory();
    setAnnotations((prev) => ({
      ...prev,
      deletions: [...prev.deletions, {
        id: uid(),
        tokenIndices: deleteFloat.tokenIndices,
        startLine: deleteFloat.startLine,
        endLine: deleteFloat.endLine,
        selectedText: deleteFloat.text.slice(0, 80),
      }],
    }));
    setDeleteFloat(null);
    window.getSelection()?.removeAllRanges();
  }, [deleteFloat, pushHistory]);

  // Remove a deletion annotation
  const handleRemoveDeletion = useCallback((id: string) => {
    pushHistory();
    setAnnotations((prev) => ({
      ...prev,
      deletions: prev.deletions.filter((d) => d.id !== id),
    }));
  }, [pushHistory]);

  // Detect text selection for delete float
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !containerRef.current) {
      setDeleteFloat(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) { setDeleteFloat(null); return; }

    // Find token indices from selection
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.parentElement?.closest('[data-token-index]');
    const endEl = range.endContainer.parentElement?.closest('[data-token-index]');
    if (!startEl || !endEl) { setDeleteFloat(null); return; }

    const startIdx = parseInt(startEl.getAttribute('data-token-index') || '0', 10);
    const endIdx = parseInt(endEl.getAttribute('data-token-index') || '0', 10);
    const indices: number[] = [];
    for (let i = Math.min(startIdx, endIdx); i <= Math.max(startIdx, endIdx); i++) indices.push(i);

    const startLine = tokenSourceLine(tokens, Math.min(startIdx, endIdx));
    const endLine = tokenSourceLine(tokens, Math.max(startIdx, endIdx) + 1);

    // Position the float button near the selection
    const rect = range.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    setDeleteFloat({
      x: rect.right - containerRect.left + 4,
      y: rect.top - containerRect.top - 4,
      tokenIndices: indices,
      startLine,
      endLine,
      text,
    });
  }, [tokens]);

  // Ctrl+Z for annotation undo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // Only handle if no textarea is focused (editor has its own undo)
        if (document.activeElement?.tagName === 'TEXTAREA') return;
        const prev = historyRef.current.pop();
        if (prev) {
          e.preventDefault();
          setAnnotations(prev);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Execute: generate summary
  const handleExecute = useCallback(() => {
    const summary = generateSummary(annotations, sourceLines);
    if (summary) onExecute(summary);
  }, [annotations, sourceLines, onExecute]);

  // Clear all annotations
  const handleClear = useCallback(() => {
    pushHistory();
    setAnnotations(EMPTY_ANNOTATIONS);
    onClear?.();
  }, [pushHistory, onClear]);

  // Check if a token index is marked for deletion
  const deletedIndices = useMemo(() => {
    const set = new Set<number>();
    annotations.deletions.forEach((d) => d.tokenIndices.forEach((i) => set.add(i)));
    return set;
  }, [annotations.deletions]);

  // Additions grouped by afterTokenIndex
  const additionsByIndex = useMemo(() => {
    const map = new Map<number, AddAnnotation[]>();
    annotations.additions.forEach((a) => {
      const list = map.get(a.afterTokenIndex) || [];
      list.push(a);
      map.set(a.afterTokenIndex, list);
    });
    return map;
  }, [annotations.additions]);

  const hasAnnotations = annotations.additions.length > 0 || annotations.deletions.length > 0;

  // markdown can be empty string for a valid empty file — still show the annotation UI
  // The parent (PlanPanel) only renders this component when planFilePath is set

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div className="plan-anno-toolbar">
        <button
          className="pane-btn"
          onClick={handleExecute}
          disabled={!hasAnnotations}
          title="Generate summary and fill into editor"
          style={hasAnnotations ? { color: '#9ece6a' } : { opacity: 0.4 }}
        >
          Execute
        </button>
        <button
          className="pane-btn"
          onClick={handleClear}
          disabled={!hasAnnotations}
          title="Clear all annotations"
          style={hasAnnotations ? {} : { opacity: 0.4 }}
        >
          Clear
        </button>
        {hasAnnotations && (
          <span style={{ fontSize: 10, color: '#565f89', marginLeft: 4 }}>
            +{annotations.additions.length} &minus;{annotations.deletions.length}
          </span>
        )}
      </div>

      {/* Annotatable content */}
      <div
        ref={containerRef}
        className="plan-anno-content md-preview"
        style={{ flex: 1, overflow: 'auto', padding: '8px 12px', position: 'relative', fontSize: `${fontSize}px` }}
        onMouseUp={handleMouseUp}
      >
        {/* Insert zone before first block */}
        <InsertZone
          index={-1}
          active={activeInsert === -1}
          additions={additionsByIndex.get(-1)}
          onOpen={() => { setActiveInsert(-1); setInsertText(''); }}
          onSubmit={() => handleAddAnnotation(-1)}
          onRemoveAddition={handleRemoveAddition}
          insertText={insertText}
          setInsertText={setInsertText}
          textareaRef={activeInsert === -1 ? insertTextareaRef : undefined}
          expanded={expanded}
          alwaysShow={tokens.length === 0}
        />

        {tokens.map((token, i) => {
          // Content is sanitized with DOMPurify in tokenToHtml — safe against XSS
          const html = tokenToHtml(token);
          return (
            <div key={i}>
              {/* Token block */}
              <div
                data-token-index={i}
                className={deletedIndices.has(i) ? 'plan-block--deleted' : undefined}
                dangerouslySetInnerHTML={{ __html: html }}
              />

              {/* Deletion annotations for this token */}
              {annotations.deletions
                .filter((d) => d.tokenIndices.includes(i) && d.tokenIndices[0] === i)
                .map((d) => (
                  <div key={d.id} className="plan-deletion-card">
                    <span style={{ fontSize: 11, color: '#f7768e' }}>
                      Deleted: {d.selectedText.slice(0, 40)}{d.selectedText.length > 40 ? '...' : ''}
                    </span>
                    <button
                      className="pane-btn pane-btn--danger"
                      onClick={() => handleRemoveDeletion(d.id)}
                      style={{ fontSize: 11, marginLeft: 4 }}
                    >
                      undo
                    </button>
                  </div>
                ))}

              {/* Insert zone after this block */}
              <InsertZone
                index={i}
                active={activeInsert === i}
                additions={additionsByIndex.get(i)}
                onOpen={() => { setActiveInsert(i); setInsertText(''); }}
                onSubmit={() => handleAddAnnotation(i)}
                onRemoveAddition={handleRemoveAddition}
                insertText={insertText}
                setInsertText={setInsertText}
                textareaRef={activeInsert === i ? insertTextareaRef : undefined}
                expanded={expanded}
              />
            </div>
          );
        })}

        {/* Delete float button */}
        {deleteFloat && (
          <button
            className="plan-delete-float"
            style={{ top: deleteFloat.y, left: deleteFloat.x }}
            onMouseDown={(e) => { e.preventDefault(); handleMarkDeletion(); }}
          >
            &minus;
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Insert Zone Sub-component ── */

interface InsertZoneProps {
  index: number;
  active: boolean;
  additions?: AddAnnotation[];
  onOpen: () => void;
  onSubmit: () => void;
  onRemoveAddition: (id: string) => void;
  insertText: string;
  setInsertText: (text: string) => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  expanded?: boolean;
  alwaysShow?: boolean;
}

function InsertZone({ index, active, additions, onOpen, onSubmit, onRemoveAddition, insertText, setInsertText, textareaRef, expanded, alwaysShow }: InsertZoneProps) {
  return (
    <div className={`plan-insert-zone${alwaysShow ? ' plan-insert-zone--empty' : ''}`} data-zone-index={index}>
      {/* Existing addition annotations */}
      {additions?.map((a) => (
        <div key={a.id} className="plan-annotation-card">
          <span style={{ flex: 1, fontSize: 12, color: '#c0caf5', whiteSpace: 'pre-wrap' }}>{a.content}</span>
          <button
            className="pane-btn pane-btn--danger"
            onClick={() => onRemoveAddition(a.id)}
            style={{ fontSize: 11, flexShrink: 0 }}
          >
            &times;
          </button>
        </div>
      ))}

      {/* Active insert textarea */}
      {active ? (
        <div className="plan-annotation-card plan-annotation-card--editing">
          <textarea
            ref={textareaRef}
            className="plan-annotation-textarea"
            value={insertText}
            onChange={(e) => setInsertText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onSubmit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onSubmit(); // saves if text, discards if empty
              }
            }}
            placeholder="Add annotation... (Ctrl+Enter or Esc to save)"
            rows={2}
            style={expanded ? { minWidth: 300 } : undefined}
          />
        </div>
      ) : (
        /* + button (hover reveal) */
        <button
          className="plan-insert-btn"
          onClick={onOpen}
          title="Add annotation here"
        >
          +
        </button>
      )}
    </div>
  );
}
