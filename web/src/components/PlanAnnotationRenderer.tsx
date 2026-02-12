import { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { marked, type Token } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { useTextareaUndo, handleTabKey, autoRows } from '../hooks/useTextareaKit';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { fetchAnnotation, saveAnnotationRemote } from '../api/annotations';
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
  const raw = String(marked.parser([token as Token], { async: false }));
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

/** Format line context as "start...end" (max 20 chars each side) */
function formatLineContext(line: string | undefined): string {
  if (!line) return '';
  const trimmed = line.trim();
  if (trimmed.length <= 40) return trimmed;
  return trimmed.slice(0, 20) + '...' + trimmed.slice(-20);
}

/** Build annotation JSON object from annotations + sourceLines */
function buildAnnotationJson(
  annotations: PlanAnnotations,
  sourceLines: string[],
): { 'Insert Annotations': string[][]; 'Delete Annotations': string[][] } {
  const insertAnns: string[][] = [];
  const deleteAnns: string[][] = [];

  for (const a of annotations.additions) {
    const ctxBefore = sourceLines[a.sourceLine - 1] ?? '';
    const ctxAfter = sourceLines[a.sourceLine] ?? '';
    insertAnns.push([
      `${a.sourceLine}: ${formatLineContext(ctxBefore)}`,
      a.content,
      formatLineContext(ctxAfter),
    ]);
  }

  for (const d of annotations.deletions) {
    const ctxBefore = sourceLines[d.startLine - 2] ?? '';
    const ctxAfter = sourceLines[d.endLine] ?? '';
    deleteAnns.push([
      `${d.startLine}: ${formatLineContext(ctxBefore)}`,
      d.selectedText,
      formatLineContext(ctxAfter),
    ]);
  }

  return { 'Insert Annotations': insertAnns, 'Delete Annotations': deleteAnns };
}

/** Generate /aicli-task-review command for a single file */
export function generateTaskReview(
  filePath: string,
  annotations: PlanAnnotations,
  sourceLines: string[],
): string {
  if (annotations.additions.length === 0 && annotations.deletions.length === 0) return '';
  const json = JSON.stringify(buildAnnotationJson(annotations, sourceLines));
  return `/aicli-task-review ${filePath} ${json}`;
}

/** Generate aggregated /aicli-task-review commands across multiple PLAN/ files */
export function generateMultiFileSummary(
  fileAnnotations: Array<{ filePath: string; annotations: PlanAnnotations; sourceLines: string[] }>
): string {
  const commands: string[] = [];
  for (const { filePath, annotations, sourceLines } of fileAnnotations) {
    const cmd = generateTaskReview(filePath, annotations, sourceLines);
    if (cmd) commands.push(cmd);
  }
  return commands.join('\n');
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
  token: string;
  onExecute: (summary: string) => void;
  onSend?: (summary: string) => void;
  onRefresh?: () => void;
  onClose?: () => void;
  expanded?: boolean;
  readOnly?: boolean;
}

export const PlanAnnotationRenderer = forwardRef<PlanAnnotationRendererHandle, Props>(function PlanAnnotationRenderer({ markdown, filePath, sessionId, token, onExecute, onSend, onRefresh, onClose, expanded, readOnly }, ref) {
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

  // Dual-layer persistence: L1 localStorage (50ms) + L2 server (adaptive)
  const latency = useStore((s) => s.latency);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const syncInFlightRef = useRef(false);
  const annLoadedRef = useRef(false);

  useEffect(() => {
    if (!annLoadedRef.current) return;
    const lsKey = storageKey(sessionId, filePath);
    const serialized = JSON.stringify(annotations);
    // L1: 50ms debounce → localStorage
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try { localStorage.setItem(lsKey, serialized); } catch { /* full */ }
    }, 50);
    // L2: adaptive interval → server
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    const syncInterval = Math.max(200, (latency ?? 30) * 3);
    syncTimerRef.current = setTimeout(() => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      saveAnnotationRemote(token, sessionId, filePath, serialized, Date.now())
        .catch(() => {})
        .finally(() => { syncInFlightRef.current = false; });
    }, syncInterval);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [annotations, sessionId, filePath, token, latency]);

  // Reload annotations when filePath changes: L1 localStorage (instant) then L2 server (async, use newer)
  useEffect(() => {
    annLoadedRef.current = false;
    // L1: instant from localStorage
    let localAnns = EMPTY_ANNOTATIONS;
    let localUpdatedAt = 0;
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      if (saved) {
        localAnns = JSON.parse(saved);
        localUpdatedAt = Date.now(); // approximate
      }
    } catch { /* ignore */ }
    setAnnotations(localAnns);
    const ids = new Set<string>();
    localAnns.additions.forEach((a) => ids.add(a.id));
    localAnns.deletions.forEach((d) => ids.add(d.id));
    baselineIdsRef.current = ids;

    // L2: async from server
    let cancelled = false;
    fetchAnnotation(token, sessionId, filePath).then((remote) => {
      if (cancelled) return;
      if (remote && remote.updatedAt > localUpdatedAt) {
        try {
          const parsed: PlanAnnotations = JSON.parse(remote.content);
          setAnnotations(parsed);
          try { localStorage.setItem(storageKey(sessionId, filePath), remote.content); } catch { /* full */ }
          const rids = new Set<string>();
          parsed.additions.forEach((a) => rids.add(a.id));
          parsed.deletions.forEach((d) => rids.add(d.id));
          baselineIdsRef.current = rids;
        } catch { /* corrupt server data */ }
      }
    }).catch(() => { /* offline, use local */ }).finally(() => { annLoadedRef.current = true; });
    annLoadedRef.current = true; // allow saving even if fetch is slow
    return () => { cancelled = true; };
  }, [sessionId, filePath, token]);

  // Baseline version counter — increment to force re-computation of sent/unsent counts
  const [baselineVer, setBaselineVer] = useState(0);

  // Annotation counts: total / sent / unsent
  const annCounts = useMemo(() => {
    const bl = baselineIdsRef.current;
    const total = annotations.additions.length + annotations.deletions.length;
    let sent = 0;
    annotations.additions.forEach(a => { if (bl.has(a.id)) sent++; });
    annotations.deletions.forEach(d => { if (bl.has(d.id)) sent++; });
    return { total, sent, unsent: total - sent };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, baselineVer]);

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

  useMermaidRender(containerRef, tokens);

  // Filter: include annotations whose ID is not in baseline (new or edited → new ID)
  const getNewAnnotations = useCallback((): PlanAnnotations => {
    const bl = baselineIdsRef.current;
    return {
      additions: annotations.additions.filter((a) => !bl.has(a.id)),
      deletions: annotations.deletions.filter((d) => !bl.has(d.id)),
    };
  }, [annotations]);

  // Execute: generate /aicli-task-review command from new/modified annotations (Save to chat)
  const handleExecute = useCallback(() => {
    const cmd = generateTaskReview(filePath, getNewAnnotations(), sourceLines);
    if (cmd) {
      onExecute(cmd);
      const ids = new Set<string>();
      annotations.additions.forEach((a) => ids.add(a.id));
      annotations.deletions.forEach((d) => ids.add(d.id));
      baselineIdsRef.current = ids;
      setBaselineVer(v => v + 1);
    }
  }, [getNewAnnotations, annotations, sourceLines, onExecute, filePath]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    getSummary: () => {
      return generateTaskReview(filePath, getNewAnnotations(), sourceLines);
    },
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
  }), [getNewAnnotations, sourceLines, filePath, activeInsert, handleAddAnnotation]);

  // Dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Send a single annotation to terminal as /aicli-task-review command
  const handleSendSingle = useCallback((annId: string, type: 'add' | 'del') => {
    if (!onSend) return;
    const singleAnns: PlanAnnotations = { additions: [], deletions: [] };
    if (type === 'add') {
      const a = annotations.additions.find(x => x.id === annId);
      if (!a) return;
      singleAnns.additions.push(a);
    } else {
      const d = annotations.deletions.find(x => x.id === annId);
      if (!d) return;
      singleAnns.deletions.push(d);
    }
    const cmd = generateTaskReview(filePath, singleAnns, sourceLines);
    if (cmd) onSend(cmd);
    baselineIdsRef.current.add(annId);
    setBaselineVer(v => v + 1);
  }, [onSend, filePath, annotations, sourceLines]);

  // Delete annotation from dropdown
  const handleDropdownDelete = useCallback((annId: string, type: 'add' | 'del') => {
    if (type === 'add') {
      handleRemoveAddition(annId);
    } else {
      handleRemoveDeletion(annId);
    }
  }, [handleRemoveAddition, handleRemoveDeletion]);

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
      {/* Toolbar — single merged header */}
      <div className="plan-anno-toolbar">
        {/* File name */}
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={filePath}>
          {filePath.split('/').pop() || filePath}
        </span>
        {/* Refresh */}
        {onRefresh && (
          <button className="pane-btn" onClick={onRefresh} title="Refresh current file">&#x21BB;</button>
        )}
        {/* Send all to Chat */}
        <button
          className="pane-btn"
          onClick={handleExecute}
          disabled={!hasAnnotations}
          title="Send all annotations to Chat editor"
          style={hasAnnotations ? { color: 'var(--accent-green)' } : { opacity: 0.4 }}
        >
          Send
        </button>
        {/* Dropdown: first annotation preview + ▼ */}
        <div ref={dropdownRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <div
            className={`plan-anno-dropdown-trigger${dropdownOpen ? ' plan-anno-dropdown-trigger--active' : ''}`}
            onClick={() => setDropdownOpen(v => !v)}
            title={annCounts.total > 0 ? `${annCounts.total} annotations (${annCounts.unsent} unsent)` : 'No annotations'}
          >
            <span className="plan-anno-dropdown-trigger__text">
              {(() => {
                const firstAdd = annotations.additions[0];
                const firstDel = annotations.deletions[0];
                const text = firstAdd ? firstAdd.content : firstDel ? firstDel.selectedText : '';
                if (!text) return '';
                return text.slice(0, 40) + (text.length > 40 ? '...' : '');
              })()}
            </span>
            <span className="plan-anno-dropdown-trigger__arrow">&#x25BC;</span>
          </div>
          {dropdownOpen && (
            <div className="plan-anno-dropdown">
              {/* Batch send header — forwards to Chat editor */}
              {annCounts.unsent > 0 && (
                <div className="plan-anno-dropdown__header">
                  <button
                    className="pane-btn"
                    onClick={handleExecute}
                    style={{ color: 'var(--accent-blue)', fontSize: 11 }}
                  >
                    Send All Unsent ({annCounts.unsent})
                  </button>
                </div>
              )}
              <div className="plan-anno-dropdown__list">
                {annotations.additions.map(a => {
                  const isSent = baselineIdsRef.current.has(a.id);
                  return (
                    <div key={a.id} className="plan-anno-dropdown__item plan-anno-dropdown__item--add">
                      <span className="plan-anno-dropdown__type" style={{ color: 'var(--accent-yellow)' }}>+</span>
                      <span className="plan-anno-dropdown__text">{a.content.slice(0, 60)}{a.content.length > 60 ? '...' : ''}</span>
                      <button
                        className="pane-btn pane-btn--sm"
                        onClick={() => !isSent && handleSendSingle(a.id, 'add')}
                        disabled={isSent}
                        title={isSent ? 'Already sent' : 'Send to terminal'}
                        style={isSent ? { opacity: 0.3 } : { color: 'var(--accent-blue)' }}
                      >Send</button>
                      <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => handleDropdownDelete(a.id, 'add')} title="Delete">&times;</button>
                    </div>
                  );
                })}
                {annotations.deletions.map(d => {
                  const isSent = baselineIdsRef.current.has(d.id);
                  return (
                    <div key={d.id} className="plan-anno-dropdown__item plan-anno-dropdown__item--del">
                      <span className="plan-anno-dropdown__type" style={{ color: 'var(--accent-red)' }}>&minus;</span>
                      <span className="plan-anno-dropdown__text">{d.selectedText.slice(0, 60)}{d.selectedText.length > 60 ? '...' : ''}</span>
                      <button
                        className="pane-btn pane-btn--sm"
                        onClick={() => !isSent && handleSendSingle(d.id, 'del')}
                        disabled={isSent}
                        title={isSent ? 'Already sent' : 'Send to terminal'}
                        style={isSent ? { opacity: 0.3 } : { color: 'var(--accent-blue)' }}
                      >Send</button>
                      <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => handleDropdownDelete(d.id, 'del')} title="Delete">&times;</button>
                    </div>
                  );
                })}
                {annCounts.total === 0 && (
                  <div className="plan-anno-dropdown__empty">No annotations</div>
                )}
              </div>
            </div>
          )}
        </div>
        {/* Close file button — batch send + deselect file */}
        {onClose && (
          <button
            className="pane-btn pane-btn--danger"
            onClick={() => { handleExecute(); onClose(); }}
            title="Send annotations &amp; close file"
          >
            &times;
          </button>
        )}
      </div>

      {/* Content + TOC */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* Annotatable content */}
      <div
        ref={containerRef}
        className={`plan-anno-content md-preview${activeInsert != null ? ' plan-anno-content--editing' : ''}`}
        style={{ flex: 1, overflow: 'auto', padding: '8px 12px', position: 'relative', fontSize: `${fontSize}px`, minWidth: 0 }}
        onMouseUp={handleSelectionCheck}
      >
        {/* Insert zone before first block */}
        {!readOnly && (
          <InsertZone
            index={-1}
            active={activeInsert === -1}
            additions={additionsByIndex.get(-1)}
            onOpen={() => { setActiveInsert(-1); setInsertText(''); }}
            onSubmit={() => handleAddAnnotation(-1)}
            onRemoveAddition={handleRemoveAddition}
            onEditAddition={handleEditAddition}
            onSendSingle={onSend ? (id) => handleSendSingle(id, 'add') : undefined}
            isSent={(id) => baselineIdsRef.current.has(id)}
            insertText={insertText}
            setInsertText={setInsertText}
            textareaRef={activeInsert === -1 ? insertTextareaRef : undefined}
            expanded={expanded}
            alwaysShow={tokens.length === 0}
            fontSize={fontSize}
          />
        )}

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
                          style={{ flex: 1, fontSize: `${fontSize}px`, color: 'var(--accent-red)', whiteSpace: 'pre-wrap', cursor: 'text' }}
                          onDoubleClick={() => { setEditingDelId(d.id); setEditDelText(d.selectedText); requestAnimationFrame(() => { const el = editDelRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          title="Double-click to edit"
                        >
                          {d.selectedText}
                        </span>
                        {onSend && (() => {
                          const sent = baselineIdsRef.current.has(d.id);
                          return (
                            <button
                              className="pane-btn pane-btn--sm"
                              onClick={() => !sent && handleSendSingle(d.id, 'del')}
                              disabled={sent}
                              title={sent ? 'Already sent' : 'Send to terminal'}
                              style={sent ? { opacity: 0.3 } : { color: 'var(--accent-green)' }}
                            >
                              Send
                            </button>
                          );
                        })()}
                        <button
                          className="pane-btn pane-btn--sm"
                          onClick={() => { setEditingDelId(d.id); setEditDelText(d.selectedText); requestAnimationFrame(() => { const el = editDelRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          style={{ color: 'var(--accent-blue)' }}
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
              {!readOnly && (
                <InsertZone
                  index={i}
                  active={activeInsert === i}
                  additions={additionsByIndex.get(i)}
                  onOpen={() => { setActiveInsert(i); setInsertText(''); }}
                  onSubmit={() => handleAddAnnotation(i)}
                  onRemoveAddition={handleRemoveAddition}
                  onEditAddition={handleEditAddition}
                  onSendSingle={onSend ? (id) => handleSendSingle(id, 'add') : undefined}
                  isSent={(id) => baselineIdsRef.current.has(id)}
                  insertText={insertText}
                  setInsertText={setInsertText}
                  textareaRef={activeInsert === i ? insertTextareaRef : undefined}
                  expanded={expanded}
                  fontSize={fontSize}
                />
              )}
            </div>
          );
        })}

        {/* Delete float button */}
        {!readOnly && deleteFloat && (
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
  onSendSingle?: (id: string) => void;
  isSent?: (id: string) => boolean;
  insertText: string;
  setInsertText: (text: string) => void;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  expanded?: boolean;
  alwaysShow?: boolean;
  fontSize?: number;
}

function InsertZone({ index, active, additions, onOpen, onSubmit, onRemoveAddition, onEditAddition, onSendSingle, isSent, insertText, setInsertText, textareaRef, expanded, alwaysShow, fontSize = 14 }: InsertZoneProps) {
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
                style={{ flex: 1, fontSize: `${fontSize}px`, color: 'var(--accent-yellow)', whiteSpace: 'pre-wrap', cursor: 'text' }}
                onDoubleClick={() => startEdit(a)}
                title="Double-click to edit"
              >
                {a.content}
              </span>
              {onSendSingle && (() => {
                const sent = isSent?.(a.id) ?? false;
                return (
                  <button
                    className="pane-btn pane-btn--sm"
                    onClick={() => !sent && onSendSingle(a.id)}
                    disabled={sent}
                    title={sent ? 'Already sent' : 'Send to terminal'}
                    style={sent ? { opacity: 0.3 } : { color: 'var(--accent-green)' }}
                  >
                    Send
                  </button>
                );
              })()}
              <button
                className="pane-btn pane-btn--sm"
                onClick={() => startEdit(a)}
                style={{ color: 'var(--accent-blue)' }}
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
      ) : alwaysShow && !additions?.length ? (
        /* Empty file placeholder — double-click to start annotating */
        <div
          className="plan-empty-placeholder"
          onDoubleClick={onOpen}
          title="Double-click or Ctrl+Enter to edit"
        >
          Write down your plans here. Double-click or Ctrl+Enter to edit.
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
