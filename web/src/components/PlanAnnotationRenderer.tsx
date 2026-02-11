import { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { marked, type Token } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { useTextareaUndo, handleTabKey, autoRows } from '../hooks/useTextareaKit';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { MarkdownToc, extractHeadings, toSlug, stripInlineMarkdown } from './MarkdownToc';

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

function scrollKey(sessionId: string, filePath: string) {
  return `plan-scroll-${sessionId}-${filePath}`;
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

/** Generate aggregated summary across multiple PLAN/ files */
export function generateMultiFileSummary(
  fileAnnotations: Array<{ filePath: string; annotations: PlanAnnotations; sourceLines: string[] }>
): string {
  const sections: string[] = [];
  for (const { filePath, annotations, sourceLines } of fileAnnotations) {
    const summary = generateSummary(annotations, sourceLines);
    if (!summary) continue;
    const fileName = filePath.split('/').pop() || filePath;
    sections.push(`## ${fileName}\n\n${summary}`);
  }
  if (sections.length === 0) return '';
  return '请根据以下用户批注修改 PLAN/ 目录下的文件:\n\n' + sections.join('\n\n');
}

/* ── Component ── */

export interface PlanAnnotationRendererHandle {
  /** Generate summary from current annotations; returns empty string if none */
  getSummary: () => string;
  /** Handle ESC key: submit active annotation if any, return true if handled */
  handleEscape: () => boolean;
  /** Get current scroll position of the content area */
  getScrollTop: () => number;
  /** Set scroll position of the content area */
  setScrollTop: (top: number) => void;
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

  // TOC: extract headings from markdown + map token indices to heading slugs
  const headings = useMemo(() => extractHeadings(markdown), [markdown]);
  const headingIdMap = useMemo(() => {
    const map = new Map<number, string>();
    const slugCount = new Map<string, number>();
    tokens.forEach((token, i) => {
      if (token.type === 'heading') {
        const text = stripInlineMarkdown(((token as { text?: string }).text || ''));
        const slug = toSlug(text, slugCount);
        map.set(i, slug);
      }
    });
    return map;
  }, [tokens]);

  // Baseline: set of annotation IDs that have already been forwarded
  // Editing an annotation generates a new ID, so new/modified ones won't be in the baseline
  const baselineIdsRef = useRef<Set<string>>(new Set());
  const [annotations, setAnnotations] = useState<PlanAnnotations>(() => {
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      const parsed: PlanAnnotations = saved ? JSON.parse(saved) : EMPTY_ANNOTATIONS;
      // Capture initial baseline IDs
      const ids = new Set<string>();
      parsed.additions.forEach((a) => ids.add(a.id));
      parsed.deletions.forEach((d) => ids.add(d.id));
      baselineIdsRef.current = ids;
      return parsed;
    } catch { return EMPTY_ANNOTATIONS; }
  });

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
      // Capture baseline IDs
      const ids = new Set<string>();
      parsed.additions.forEach((a) => ids.add(a.id));
      parsed.deletions.forEach((d) => ids.add(d.id));
      baselineIdsRef.current = ids;
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

  // Save scroll position on unmount, restore after content loads
  useEffect(() => {
    return () => {
      const el = containerRef.current;
      if (el && el.scrollTop > 0) {
        localStorage.setItem(scrollKey(sessionId, filePath), String(el.scrollTop));
      }
    };
  }, [sessionId, filePath]);

  useEffect(() => {
    if (!tokens.length) return;
    const saved = localStorage.getItem(scrollKey(sessionId, filePath));
    if (saved) {
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (el) el.scrollTop = Number(saved);
      });
    }
  }, [sessionId, filePath, tokens.length]);

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
  }, [insertText, tokens]);

  // Remove an addition annotation
  const handleRemoveAddition = useCallback((id: string) => {

    setAnnotations((prev) => ({
      ...prev,
      additions: prev.additions.filter((a) => a.id !== id),
    }));
  }, []);

  // Edit an existing addition annotation — assign new ID so it's detected as new vs baseline
  const handleEditAddition = useCallback((id: string, newContent: string) => {

    setAnnotations((prev) => ({
      ...prev,
      additions: prev.additions.map((a) =>
        a.id === id ? { ...a, id: uid(), content: newContent } : a
      ),
    }));
  }, []);

  // Mark deletion from selection
  const handleMarkDeletion = useCallback(() => {
    if (!deleteFloat) return;

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
  }, [deleteFloat]);

  // Remove a deletion annotation
  const handleRemoveDeletion = useCallback((id: string) => {

    setAnnotations((prev) => ({
      ...prev,
      deletions: prev.deletions.filter((d) => d.id !== id),
    }));
  }, []);

  // Edit a deletion annotation's selected text — assign new ID so it's detected as new vs baseline
  const handleEditDeletion = useCallback((id: string, newText: string) => {

    setAnnotations((prev) => ({
      ...prev,
      deletions: prev.deletions.map((d) =>
        d.id === id ? { ...d, id: uid(), selectedText: newText } : d
      ),
    }));
  }, []);

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

  // ── Right-click paste into active annotation textarea ──
  const pasteFloatElRef = useRef<HTMLDivElement | null>(null);
  const pasteFloatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePasteIntoAnnotation = useCallback((text: string) => {
    const ta = insertTextareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const current = ta.value;
    const newText = current.slice(0, start) + text + current.slice(end);
    setInsertText(newText);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    });
  }, []);

  const pasteIntoAnnotationRef = useRef(handlePasteIntoAnnotation);
  pasteIntoAnnotationRef.current = handlePasteIntoAnnotation;

  const removePasteFloat = useCallback(() => {
    if (pasteFloatTimerRef.current) { clearTimeout(pasteFloatTimerRef.current); pasteFloatTimerRef.current = null; }
    if (pasteFloatElRef.current) { pasteFloatElRef.current.remove(); pasteFloatElRef.current = null; }
  }, []);

  const showAnnosPasteFloat = useCallback((x: number, y: number) => {
    removePasteFloat();
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:1000;display:flex;align-items:center;gap:4px;padding:4px 6px;background:#24283b;border:1px solid #414868;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-family:inherit;`;
    const ta = document.createElement('textarea');
    ta.style.cssText = `width:90px;height:22px;resize:none;border:1px solid #414868;border-radius:3px;background:#1a1b26;color:#a9b1d6;font-size:11px;font-family:inherit;padding:2px 4px;outline:none;`;
    ta.placeholder = 'Ctrl+V';
    ta.addEventListener('paste', (ev) => {
      ev.preventDefault();
      const text = ev.clipboardData?.getData('text/plain');
      if (text) pasteIntoAnnotationRef.current(text);
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

  const handleContentContextMenu = useCallback((e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return; // let browser handle natively
    if (!insertTextareaRef.current) return; // no active annotation zone
    e.preventDefault();
    removePasteFloat();
    if (!navigator.clipboard?.readText) {
      showAnnosPasteFloat(e.clientX, e.clientY);
      return;
    }
    navigator.clipboard.readText().then((text) => {
      if (text) pasteIntoAnnotationRef.current(text);
    }).catch(() => {
      showAnnosPasteFloat(e.clientX, e.clientY);
    });
  }, [removePasteFloat, showAnnosPasteFloat]);

  useMermaidRender(containerRef, tokens);

  // Filter: include annotations whose ID is not in baseline (new or edited → new ID)
  const getNewAnnotations = useCallback((): PlanAnnotations => {
    const bl = baselineIdsRef.current;
    return {
      additions: annotations.additions.filter((a) => !bl.has(a.id)),
      deletions: annotations.deletions.filter((d) => !bl.has(d.id)),
    };
  }, [annotations]);

  // Execute: generate summary from new/modified annotations
  const handleExecute = useCallback(() => {
    const summary = generateSummary(getNewAnnotations(), sourceLines);
    if (summary) {
      onExecute(summary);
      // Update baseline to current IDs (mark as forwarded)
      const ids = new Set<string>();
      annotations.additions.forEach((a) => ids.add(a.id));
      annotations.deletions.forEach((d) => ids.add(d.id));
      baselineIdsRef.current = ids;
    }
  }, [getNewAnnotations, annotations, sourceLines, onExecute]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    getSummary: () => generateSummary(getNewAnnotations(), sourceLines),
    handleEscape: () => {
      if (activeInsert != null) {
        handleAddAnnotation(activeInsert);
        return true;
      }
      return false;
    },
    getScrollTop: () => containerRef.current?.scrollTop ?? 0,
    setScrollTop: (top: number) => {
      requestAnimationFrame(() => {
        if (containerRef.current) containerRef.current.scrollTop = top;
      });
    },
  }), [getNewAnnotations, sourceLines, activeInsert, handleAddAnnotation]);

  // Clear all annotations
  const handleClear = useCallback(() => {

    setAnnotations(EMPTY_ANNOTATIONS);
    onClear?.();
  }, [onClear]);

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

      {/* Content + TOC */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Annotatable content */}
      <div
        ref={containerRef}
        className="plan-anno-content md-preview"
        style={{ flex: 1, overflow: 'auto', padding: '8px 12px', position: 'relative', fontSize: `${fontSize}px`, minWidth: 0 }}
        onMouseUp={handleSelectionCheck}
        onContextMenu={handleContentContextMenu}
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
                id={headingIdMap.get(i)}
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
                          className="pane-btn pane-btn--sm"
                          onClick={() => { setEditingDelId(d.id); setEditDelText(d.selectedText); requestAnimationFrame(() => { const el = editDelRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          style={{ color: '#7aa2f7' }}
                          title="Edit deletion annotation"
                        >
                          &#x270E;
                        </button>
                        <button
                          className="pane-btn pane-btn--danger pane-btn--sm"
                          onClick={() => handleRemoveDeletion(d.id)}
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
      {/* TOC sidebar */}
      <MarkdownToc headings={headings} scrollRef={containerRef} />
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
                className="pane-btn pane-btn--sm"
                onClick={() => startEdit(a)}
                style={{ color: '#7aa2f7' }}
                title="Edit annotation"
              >
                &#x270E;
              </button>
              <button
                className="pane-btn pane-btn--danger pane-btn--sm"
                onClick={() => onRemoveAddition(a.id)}
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
