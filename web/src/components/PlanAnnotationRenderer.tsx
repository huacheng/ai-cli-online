import { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { marked, type Token } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { useTextareaUndo, handleTabKey, handleCtrlZ, autoRows } from '../hooks/useTextareaKit';
import { loadMermaid } from './MarkdownRenderer';

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

export interface PlanAnnotationRendererHandle {
  /** Generate summary from current annotations; returns empty string if none */
  getSummary: () => string;
}

interface Props {
  markdown: string;
  filePath: string;
  sessionId: string;
  onExecute: (summary: string) => void;
  onClear?: () => void;
  expanded?: boolean;
}

export const PlanAnnotationRenderer = forwardRef<PlanAnnotationRendererHandle, Props>(function PlanAnnotationRenderer({ markdown, filePath, sessionId, onExecute, onClear, expanded }, ref) {
  const fontSize = useStore((s) => s.fontSize);

  // Parse markdown into tokens
  const tokens = useMemo(() => {
    if (!markdown) return [];
    return marked.lexer(markdown);
  }, [markdown]);

  const sourceLines = useMemo(() => markdown.split('\n'), [markdown]);

  // Annotations state + baseline (IDs that existed on open, won't be forwarded)
  const baselineIdsRef = useRef<Set<string>>(new Set());
  const [annotations, setAnnotations] = useState<PlanAnnotations>(() => {
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      const parsed: PlanAnnotations = saved ? JSON.parse(saved) : EMPTY_ANNOTATIONS;
      // Capture initial baseline
      const ids = new Set<string>();
      parsed.additions.forEach((a) => ids.add(a.id));
      parsed.deletions.forEach((d) => ids.add(d.id));
      baselineIdsRef.current = ids;
      return parsed;
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

  // Reload annotations when filePath changes + capture baseline
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      const parsed: PlanAnnotations = saved ? JSON.parse(saved) : EMPTY_ANNOTATIONS;
      setAnnotations(parsed);
      // Capture IDs as baseline — these won't be forwarded to Chat
      const ids = new Set<string>();
      parsed.additions.forEach((a) => ids.add(a.id));
      parsed.deletions.forEach((d) => ids.add(d.id));
      baselineIdsRef.current = ids;
      historyRef.current = [];
    } catch {
      setAnnotations(EMPTY_ANNOTATIONS);
      baselineIdsRef.current = new Set();
    }
  }, [sessionId, filePath]);

  // Active insert zone editing
  const [activeInsert, setActiveInsert] = useState<number | null>(null);
  const [insertText, setInsertText] = useState('');
  const insertTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Deletion card editing
  const [editingDelId, setEditingDelId] = useState<string | null>(null);
  const [editDelText, setEditDelText] = useState('');
  const editDelRef = useRef<HTMLTextAreaElement>(null);

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

  // Edit an existing addition annotation
  const handleEditAddition = useCallback((id: string, newContent: string) => {
    pushHistory();
    setAnnotations((prev) => ({
      ...prev,
      additions: prev.additions.map((a) =>
        a.id === id ? { ...a, content: newContent } : a
      ),
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

  // Edit a deletion annotation's selected text
  const handleEditDeletion = useCallback((id: string, newText: string) => {
    pushHistory();
    setAnnotations((prev) => ({
      ...prev,
      deletions: prev.deletions.map((d) =>
        d.id === id ? { ...d, selectedText: newText } : d
      ),
    }));
  }, [pushHistory]);

  // Find closest ancestor (or self) with data-token-index
  const findTokenEl = useCallback((node: Node): Element | null => {
    let el: Element | null = node instanceof Element ? node : node.parentElement;
    while (el && el !== containerRef.current) {
      if (el.hasAttribute('data-token-index')) return el;
      el = el.parentElement;
    }
    return null;
  }, []);

  // Detect text selection for delete float
  const handleSelectionCheck = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !containerRef.current) {
      setDeleteFloat(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) { setDeleteFloat(null); return; }

    // Ensure selection is within our container
    const range = sel.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) {
      setDeleteFloat(null);
      return;
    }

    // Find token indices from selection
    const startEl = findTokenEl(range.startContainer);
    const endEl = findTokenEl(range.endContainer);
    if (!startEl || !endEl) { setDeleteFloat(null); return; }

    const startIdx = parseInt(startEl.getAttribute('data-token-index') || '0', 10);
    const endIdx = parseInt(endEl.getAttribute('data-token-index') || '0', 10);
    const indices: number[] = [];
    for (let i = Math.min(startIdx, endIdx); i <= Math.max(startIdx, endIdx); i++) indices.push(i);

    const startLine = tokenSourceLine(tokens, Math.min(startIdx, endIdx));
    const endLine = tokenSourceLine(tokens, Math.max(startIdx, endIdx) + 1);

    // Position relative to container, accounting for scroll offset
    const rect = range.getBoundingClientRect();
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    // Auto-copy selection to clipboard
    navigator.clipboard.writeText(text).catch(() => {});

    setDeleteFloat({
      x: rect.right - containerRect.left + container.scrollLeft + 6,
      y: rect.top - containerRect.top + container.scrollTop - 2,
      tokenIndices: indices,
      startLine,
      endLine,
      text,
    });
  }, [tokens, findTokenEl]);

  // Listen to selectionchange with debounce to prevent flicker
  const selTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const onSelChange = () => {
      if (selTimerRef.current) clearTimeout(selTimerRef.current);
      selTimerRef.current = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !containerRef.current) {
          setDeleteFloat(null);
          return;
        }
        const anchor = sel.anchorNode;
        if (anchor && containerRef.current.contains(anchor)) {
          handleSelectionCheck();
        }
      }, 120);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      document.removeEventListener('selectionchange', onSelChange);
      if (selTimerRef.current) clearTimeout(selTimerRef.current);
    };
  }, [handleSelectionCheck]);

  // Render mermaid/gantt code blocks after DOM update
  const mermaidIdRef = useRef(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || tokens.length === 0) return;

    const codeBlocks = el.querySelectorAll<HTMLElement>(
      'code.language-mermaid, code.language-gantt'
    );
    if (codeBlocks.length === 0) return;

    let cancelled = false;
    (async () => {
      let mermaid;
      try { mermaid = await loadMermaid(); } catch { return; }
      if (cancelled) return;

      for (const codeEl of codeBlocks) {
        if (cancelled) break;
        const pre = codeEl.parentElement;
        if (!pre || pre.tagName !== 'PRE') continue;
        const definition = codeEl.textContent || '';
        if (!definition.trim()) continue;
        const id = `plan-mermaid-${++mermaidIdRef.current}`;
        try {
          const { svg } = await mermaid.render(id, definition);
          if (cancelled) break;
          // SVG is generated by mermaid library (trusted output), safe to insert
          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-diagram';
          wrapper.innerHTML = svg;
          pre.replaceWith(wrapper);
        } catch {
          if (cancelled) break;
          pre.style.borderLeft = '3px solid #f7768e';
          pre.style.paddingLeft = '8px';
          const errSpan = document.createElement('div');
          errSpan.style.color = '#f7768e';
          errSpan.style.fontSize = '11px';
          errSpan.style.marginTop = '4px';
          errSpan.textContent = 'Mermaid syntax error';
          pre.appendChild(errSpan);
        }
      }
    })();
    return () => { cancelled = true; };
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

  // Filter annotations to only include new ones (not in baseline)
  const getNewAnnotations = useCallback((): PlanAnnotations => ({
    additions: annotations.additions.filter((a) => !baselineIdsRef.current.has(a.id)),
    deletions: annotations.deletions.filter((d) => !baselineIdsRef.current.has(d.id)),
  }), [annotations]);

  // Execute: generate summary from NEW annotations only
  const handleExecute = useCallback(() => {
    const summary = generateSummary(getNewAnnotations(), sourceLines);
    if (summary) {
      onExecute(summary);
      // Update baseline to include all current IDs (mark as forwarded)
      const ids = new Set<string>();
      annotations.additions.forEach((a) => ids.add(a.id));
      annotations.deletions.forEach((d) => ids.add(d.id));
      baselineIdsRef.current = ids;
    }
  }, [getNewAnnotations, annotations, sourceLines, onExecute]);

  // Expose getSummary to parent via ref (only new annotations)
  useImperativeHandle(ref, () => ({
    getSummary: () => generateSummary(getNewAnnotations(), sourceLines),
  }), [getNewAnnotations, sourceLines]);

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
          title="Save annotations to editor"
          style={hasAnnotations ? { color: '#9ece6a' } : { opacity: 0.4 }}
        >
          Save
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
        onMouseUp={handleSelectionCheck}
      >
        {/* Insert zone before first block */}
        <InsertZone
          index={-1}
          active={activeInsert === -1}
          additions={additionsByIndex.get(-1)}
          onOpen={() => { setActiveInsert(-1); setInsertText(''); }}
          onSubmit={() => handleAddAnnotation(-1)}
          onRemoveAddition={handleRemoveAddition}
          onEditAddition={handleEditAddition}
          insertText={insertText}
          setInsertText={setInsertText}
          textareaRef={activeInsert === -1 ? insertTextareaRef : undefined}
          expanded={expanded}
          alwaysShow={tokens.length === 0}
          fontSize={fontSize}
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
                    {editingDelId === d.id ? (
                      <textarea
                        ref={editDelRef}
                        className="plan-annotation-textarea"
                        value={editDelText}
                        onChange={(e) => setEditDelText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            const trimmed = editDelText.trim();
                            if (trimmed) handleEditDeletion(d.id, trimmed);
                            else handleRemoveDeletion(d.id);
                            setEditingDelId(null);
                          }
                          if (e.key === 'Escape') { e.preventDefault(); setEditingDelId(null); }
                        }}
                        onBlur={() => {
                          const trimmed = editDelText.trim();
                          if (trimmed) handleEditDeletion(d.id, trimmed);
                          else handleRemoveDeletion(d.id);
                          setEditingDelId(null);
                        }}
                        rows={autoRows(editDelText)}
                        style={{ fontSize: `${fontSize}px`, flex: 1 }}
                      />
                    ) : (
                      <>
                        <span
                          style={{ flex: 1, fontSize: `${fontSize}px`, color: '#f7768e', whiteSpace: 'pre-wrap', cursor: 'text' }}
                          onDoubleClick={() => { setEditingDelId(d.id); setEditDelText(d.selectedText); requestAnimationFrame(() => { const el = editDelRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          title="Double-click to edit"
                        >
                          {d.selectedText}
                        </span>
                        <button
                          className="pane-btn"
                          onClick={() => { setEditingDelId(d.id); setEditDelText(d.selectedText); requestAnimationFrame(() => { const el = editDelRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          style={{ fontSize: 11, flexShrink: 0, color: '#7aa2f7' }}
                          title="Edit deletion annotation"
                        >
                          &#x270E;
                        </button>
                        <button
                          className="pane-btn pane-btn--danger"
                          onClick={() => handleRemoveDeletion(d.id)}
                          style={{ fontSize: 11, flexShrink: 0 }}
                          title="Remove deletion"
                        >
                          &times;
                        </button>
                      </>
                    )}
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
                onEditAddition={handleEditAddition}
                insertText={insertText}
                setInsertText={setInsertText}
                textareaRef={activeInsert === i ? insertTextareaRef : undefined}
                expanded={expanded}
                fontSize={fontSize}
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
});

/* ── Insert Zone Sub-component ── */

interface InsertZoneProps {
  index: number;
  active: boolean;
  additions?: AddAnnotation[];
  onOpen: () => void;
  onSubmit: () => void;
  onRemoveAddition: (id: string) => void;
  onEditAddition: (id: string, newContent: string) => void;
  insertText: string;
  setInsertText: (text: string) => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  expanded?: boolean;
  alwaysShow?: boolean;
  fontSize?: number;
}

function InsertZone({ index, active, additions, onOpen, onSubmit, onRemoveAddition, onEditAddition, insertText, setInsertText, textareaRef, expanded, alwaysShow, fontSize = 14 }: InsertZoneProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Shared undo stacks
  const editUndo = useTextareaUndo();
  const insertUndo = useTextareaUndo();

  // Focus edit textarea when entering edit mode, cursor at end
  useEffect(() => {
    if (editingId) {
      editUndo.clearUndo();
      requestAnimationFrame(() => {
        const el = editTextareaRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    }
  }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset insert undo stack when insert zone opens
  useEffect(() => {
    if (active) insertUndo.clearUndo();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEditTextWithUndo = useCallback((next: string) => {
    setEditText((prev) => {
      editUndo.pushUndo(prev);
      return next;
    });
  }, [editUndo]);

  const setInsertTextWithUndo = useCallback((next: string) => {
    insertUndo.pushUndo(insertText);
    setInsertText(next);
  }, [insertText, setInsertText, insertUndo]);

  const startEdit = useCallback((a: AddAnnotation) => {
    setEditingId(a.id);
    setEditText(a.content);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    const trimmed = editText.trim();
    if (trimmed) {
      onEditAddition(editingId, trimmed);
    } else {
      onRemoveAddition(editingId); // empty content = delete
    }
    setEditingId(null);
    setEditText('');
  }, [editingId, editText, onEditAddition, onRemoveAddition]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  return (
    <div className={`plan-insert-zone${alwaysShow ? ' plan-insert-zone--empty' : ''}`} data-zone-index={index}>
      {/* Existing addition annotations */}
      {additions?.map((a) => (
        <div key={a.id} className="plan-annotation-card">
          {editingId === a.id ? (
            /* Edit mode */
            <textarea
              ref={editTextareaRef}
              className="plan-annotation-textarea"
              value={editText}
              onChange={(e) => setEditTextWithUndo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); return; }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
                if (e.key === 'Tab') { handleTabKey(e, setEditTextWithUndo); return; }
                if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { handleCtrlZ(e, editUndo.popUndo, setEditText); return; }
              }}
              onBlur={saveEdit}
              rows={autoRows(editText)}
              style={{ fontSize: `${fontSize}px`, flex: 1, ...(expanded ? { minWidth: 300 } : undefined) }}
            />
          ) : (
            /* Display mode — double-click to edit */
            <>
              <span
                style={{ flex: 1, fontSize: `${fontSize}px`, color: '#e0af68', whiteSpace: 'pre-wrap', cursor: 'text' }}
                onDoubleClick={() => startEdit(a)}
                title="Double-click to edit"
              >
                {a.content}
              </span>
              <button
                className="pane-btn"
                onClick={() => startEdit(a)}
                style={{ fontSize: 11, flexShrink: 0, color: '#7aa2f7' }}
                title="Edit annotation"
              >
                &#x270E;
              </button>
              <button
                className="pane-btn pane-btn--danger"
                onClick={() => onRemoveAddition(a.id)}
                style={{ fontSize: 11, flexShrink: 0 }}
              >
                &times;
              </button>
            </>
          )}
        </div>
      ))}

      {/* Active insert textarea */}
      {active ? (
        <div className="plan-annotation-card plan-annotation-card--editing">
          <textarea
            ref={textareaRef}
            className="plan-annotation-textarea"
            value={insertText}
            onChange={(e) => setInsertTextWithUndo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit(); return; }
              if (e.key === 'Escape') { e.preventDefault(); onSubmit(); return; }
              if (e.key === 'Tab') { handleTabKey(e, setInsertTextWithUndo); return; }
              if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { handleCtrlZ(e, insertUndo.popUndo, setInsertText); return; }
            }}
            placeholder="Add annotation... (Ctrl+Enter or Esc to save)"
            rows={autoRows(insertText)}
            style={{ fontSize: `${fontSize}px`, ...(expanded ? { minWidth: 300 } : undefined) }}
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
