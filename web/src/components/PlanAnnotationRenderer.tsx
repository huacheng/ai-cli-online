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

export interface ReplaceAnnotation {
  id: string;
  tokenIndices: number[];
  startLine: number;
  endLine: number;
  selectedText: string;
  content: string;
}

export interface CommentAnnotation {
  id: string;
  tokenIndices: number[];
  startLine: number;
  endLine: number;
  selectedText: string;
  content: string;
}

export interface PlanAnnotations {
  additions: AddAnnotation[];
  deletions: DeleteAnnotation[];
  replacements: ReplaceAnnotation[];
  comments: CommentAnnotation[];
}

const EMPTY_ANNOTATIONS: PlanAnnotations = { additions: [], deletions: [], replacements: [], comments: [] };

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

/**
 * Extract 20 chars before and 20 chars after an annotation position (cross-line).
 * Returns { before, after } with newlines replaced by ↵.
 */
function surroundingContext(
  sourceLines: string[],
  startLine: number,
  endLine: number,
  selectedText?: string,
): { before: string; after: string } {
  const fullText = sourceLines.join('\n');

  // Compute char offset for startLine (1-indexed)
  let startOffset = 0;
  for (let i = 0; i < startLine - 1 && i < sourceLines.length; i++) {
    startOffset += sourceLines[i].length + 1;
  }

  // Compute char offset for end of endLine
  let endOffset = 0;
  for (let i = 0; i < endLine && i < sourceLines.length; i++) {
    endOffset += sourceLines[i].length + 1;
  }

  let annStart = startOffset;
  let annEnd = Math.min(fullText.length, endOffset);

  // Refine with selectedText if available
  if (selectedText) {
    const searchStart = Math.max(0, startOffset - 10);
    const searchEnd = Math.min(fullText.length, endOffset + 10);
    const region = fullText.slice(searchStart, searchEnd);
    const idx = region.indexOf(selectedText);
    if (idx >= 0) {
      annStart = searchStart + idx;
      annEnd = annStart + selectedText.length;
    }
  }

  // 20 chars before (use whatever is available up to 20)
  const bStart = Math.max(0, annStart - 20);
  const before = fullText.slice(bStart, annStart).replace(/\n/g, '↵');

  // 20 chars after (can cross lines)
  const aEnd = Math.min(fullText.length, annEnd + 20);
  const after = fullText.slice(annEnd, aEnd).replace(/\n/g, '↵');

  return { before, after };
}

/**
 * Build annotation JSON. Each annotation is a single context-rich string:
 *   Line{N}: ...{before 20 chars}[, selected], content, {after 20 chars}...
 */
function buildAnnotationJson(
  annotations: PlanAnnotations,
  sourceLines: string[],
): { 'Insert Annotations': string[][]; 'Delete Annotations': string[][]; 'Replace Annotations': string[][]; 'Comment Annotations': string[][] } {
  const insertAnns: string[][] = [];
  const deleteAnns: string[][] = [];
  const replaceAnns: string[][] = [];
  const commentAnns: string[][] = [];

  for (const a of annotations.additions) {
    const { before, after } = surroundingContext(sourceLines, a.sourceLine, a.sourceLine);
    insertAnns.push([`Line${a.sourceLine}:...${before}`, a.content, `${after}...`]);
  }

  for (const d of annotations.deletions) {
    const { before, after } = surroundingContext(sourceLines, d.startLine, d.endLine, d.selectedText);
    deleteAnns.push([`Line${d.startLine}:...${before}`, d.selectedText, `${after}...`]);
  }

  for (const r of annotations.replacements) {
    const { before, after } = surroundingContext(sourceLines, r.startLine, r.endLine, r.selectedText);
    replaceAnns.push([`Line${r.startLine}:...${before}`, r.selectedText, r.content, `${after}...`]);
  }

  for (const c of annotations.comments) {
    const { before, after } = surroundingContext(sourceLines, c.startLine, c.endLine, c.selectedText);
    commentAnns.push([`Line${c.startLine}:...${before}`, c.selectedText, c.content, `${after}...`]);
  }

  return {
    'Insert Annotations': insertAnns,
    'Delete Annotations': deleteAnns,
    'Replace Annotations': replaceAnns,
    'Comment Annotations': commentAnns,
  };
}

/** Generate /aicli-task-review command for a single file */
export function generateTaskReview(
  filePath: string,
  annotations: PlanAnnotations,
  sourceLines: string[],
): string {
  if (annotations.additions.length === 0 && annotations.deletions.length === 0 && annotations.replacements.length === 0 && annotations.comments.length === 0) return '';
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
      (parsed.replacements ?? []).forEach((r) => ids.add(r.id));
      (parsed.comments ?? []).forEach((c) => ids.add(c.id));
      baselineIdsRef.current = ids;
      // Migrate old data missing new arrays
      if (!parsed.replacements) parsed.replacements = [];
      if (!parsed.comments) parsed.comments = [];
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
    // Migrate old data missing new arrays
    if (!localAnns.replacements) localAnns.replacements = [];
    if (!localAnns.comments) localAnns.comments = [];
    setAnnotations(localAnns);
    const ids = new Set<string>();
    localAnns.additions.forEach((a) => ids.add(a.id));
    localAnns.deletions.forEach((d) => ids.add(d.id));
    localAnns.replacements.forEach((r) => ids.add(r.id));
    localAnns.comments.forEach((c) => ids.add(c.id));
    baselineIdsRef.current = ids;

    // L2: async from server
    let cancelled = false;
    fetchAnnotation(token, sessionId, filePath).then((remote) => {
      if (cancelled) return;
      if (remote && remote.updatedAt > localUpdatedAt) {
        try {
          const parsed: PlanAnnotations = JSON.parse(remote.content);
          if (!parsed.replacements) parsed.replacements = [];
          if (!parsed.comments) parsed.comments = [];
          setAnnotations(parsed);
          try { localStorage.setItem(storageKey(sessionId, filePath), remote.content); } catch { /* full */ }
          const rids = new Set<string>();
          parsed.additions.forEach((a) => rids.add(a.id));
          parsed.deletions.forEach((d) => rids.add(d.id));
          parsed.replacements.forEach((r) => rids.add(r.id));
          parsed.comments.forEach((c) => rids.add(c.id));
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
    const total = annotations.additions.length + annotations.deletions.length + annotations.replacements.length + annotations.comments.length;
    let sent = 0;
    annotations.additions.forEach(a => { if (bl.has(a.id)) sent++; });
    annotations.deletions.forEach(d => { if (bl.has(d.id)) sent++; });
    annotations.replacements.forEach(r => { if (bl.has(r.id)) sent++; });
    annotations.comments.forEach(c => { if (bl.has(c.id)) sent++; });
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

  // Replace/Comment card editing
  const [editingRepId, setEditingRepId] = useState<string | null>(null);
  const [editRepText, setEditRepText] = useState('');
  const editRepRef = useRef<HTMLTextAreaElement>(null);
  const [editingComId, setEditingComId] = useState<string | null>(null);
  const [editComText, setEditComText] = useState('');
  const editComRef = useRef<HTMLTextAreaElement>(null);

  // Pending selection action: after clicking ↔ or ? in the float, user types content
  const [pendingAction, setPendingAction] = useState<{
    type: 'replace' | 'comment';
    tokenIndices: number[];
    startLine: number;
    endLine: number;
    text: string;
  } | null>(null);
  const [pendingText, setPendingText] = useState('');
  const pendingTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Selection float button (replaces old single delete float)
  const [selectionFloat, setSelectionFloat] = useState<{ x: number; y: number; tokenIndices: number[]; startLine: number; endLine: number; text: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Grace period: prevent selectionchange from clearing a just-set float (DOM mutation may collapse selection)
  const floatSetTimeRef = useRef(0);
  // Track mouseup position so the float appears at the mouse release point
  const lastMouseUpPosRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Save scroll position continuously on scroll (debounced) + on unmount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const saveScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const key = scrollKey(sessionId, filePath);
        if (el.scrollTop > 0) {
          try { localStorage.setItem(key, String(el.scrollTop)); } catch { /* full */ }
        } else {
          localStorage.removeItem(key);
        }
      }, 50);
    };
    el.addEventListener('scroll', saveScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('scroll', saveScroll);
    };
  }, [sessionId, filePath]);

  // Restore scroll position after content renders
  useEffect(() => {
    if (!tokens.length) return;
    const saved = localStorage.getItem(scrollKey(sessionId, filePath));
    if (!saved) return;
    const target = Number(saved);
    const el = containerRef.current;
    if (!el) return;

    // Try immediately (DOM is committed when effect runs)
    el.scrollTop = target;
    if (el.scrollTop >= target - 10) return;

    // Content not tall enough yet — observe DOM mutations until it is
    let settleTimer: ReturnType<typeof setTimeout>;
    const restore = () => {
      el.scrollTop = target;
      observer.disconnect();
    };
    const observer = new MutationObserver(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(restore, 80);
    });
    observer.observe(el, { childList: true, subtree: true });
    const fallback = setTimeout(restore, 500);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(fallback);
      observer.disconnect();
    };
  }, [sessionId, filePath, tokens.length]);

  // Focus insert textarea when zone opens
  useEffect(() => {
    if (activeInsert != null) {
      requestAnimationFrame(() => insertTextareaRef.current?.focus());
    }
  }, [activeInsert]);

  // Focus pending action textarea when it opens
  useEffect(() => {
    if (pendingAction) {
      requestAnimationFrame(() => pendingTextareaRef.current?.focus());
    }
  }, [pendingAction]);

  // ── Flush pending edits on unmount (e.g. Tab switch) ──
  const flushRef = useRef({
    annotations, activeInsert, insertText, pendingAction, pendingText, tokens,
    editingDelId, editDelText, editingRepId, editRepText, editingComId, editComText,
    filePath, sessionId, token,
  });
  flushRef.current = {
    annotations, activeInsert, insertText, pendingAction, pendingText, tokens,
    editingDelId, editDelText, editingRepId, editRepText, editingComId, editComText,
    filePath, sessionId, token,
  };

  useEffect(() => {
    return () => {
      const s = flushRef.current;
      let anns = s.annotations;
      let changed = false;

      // Flush active insert
      if (s.activeInsert != null && s.insertText.trim()) {
        const line = tokenSourceLine(s.tokens, s.activeInsert + 1);
        anns = { ...anns, additions: [...anns.additions, { id: uid(), afterTokenIndex: s.activeInsert, sourceLine: line, content: s.insertText.trim() }] };
        changed = true;
      }

      // Flush pending replace/comment
      if (s.pendingAction && s.pendingText.trim()) {
        const pa = s.pendingAction;
        const content = s.pendingText.trim();
        if (pa.type === 'replace') {
          anns = { ...anns, replacements: [...anns.replacements, { id: uid(), tokenIndices: pa.tokenIndices, startLine: pa.startLine, endLine: pa.endLine, selectedText: pa.text, content }] };
        } else {
          anns = { ...anns, comments: [...anns.comments, { id: uid(), tokenIndices: pa.tokenIndices, startLine: pa.startLine, endLine: pa.endLine, selectedText: pa.text, content }] };
        }
        changed = true;
      }

      // Flush editing deletion
      if (s.editingDelId) {
        const trimmed = s.editDelText.trim();
        if (trimmed) {
          anns = { ...anns, deletions: anns.deletions.map(d => d.id === s.editingDelId ? { ...d, id: uid(), selectedText: trimmed } : d) };
        } else {
          anns = { ...anns, deletions: anns.deletions.filter(d => d.id !== s.editingDelId) };
        }
        changed = true;
      }

      // Flush editing replacement
      if (s.editingRepId) {
        const trimmed = s.editRepText.trim();
        if (trimmed) {
          anns = { ...anns, replacements: anns.replacements.map(r => r.id === s.editingRepId ? { ...r, id: uid(), content: trimmed } : r) };
        } else {
          anns = { ...anns, replacements: anns.replacements.filter(r => r.id !== s.editingRepId) };
        }
        changed = true;
      }

      // Flush editing comment
      if (s.editingComId) {
        const trimmed = s.editComText.trim();
        if (trimmed) {
          anns = { ...anns, comments: anns.comments.map(c => c.id === s.editingComId ? { ...c, id: uid(), content: trimmed } : c) };
        } else {
          anns = { ...anns, comments: anns.comments.filter(c => c.id !== s.editingComId) };
        }
        changed = true;
      }

      if (changed) {
        const serialized = JSON.stringify(anns);
        try { localStorage.setItem(storageKey(s.sessionId, s.filePath), serialized); } catch { /* full */ }
        saveAnnotationRemote(s.token, s.sessionId, s.filePath, serialized, Date.now()).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!selectionFloat) return;

    setAnnotations((prev) => ({
      ...prev,
      deletions: [...prev.deletions, {
        id: uid(),
        tokenIndices: selectionFloat.tokenIndices,
        startLine: selectionFloat.startLine,
        endLine: selectionFloat.endLine,
        selectedText: selectionFloat.text.slice(0, 80),
      }],
    }));
    setSelectionFloat(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionFloat]);

  // Start replace/comment action from selection float
  const handleStartSelectionAction = useCallback((type: 'replace' | 'comment') => {
    if (!selectionFloat) return;
    setPendingAction({
      type,
      tokenIndices: selectionFloat.tokenIndices,
      startLine: selectionFloat.startLine,
      endLine: selectionFloat.endLine,
      text: selectionFloat.text.slice(0, 80),
    });
    setPendingText('');
    setSelectionFloat(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionFloat]);

  // Submit pending replace/comment action
  const handleSubmitPendingAction = useCallback(() => {
    if (!pendingAction) return;
    const content = pendingText.trim();
    if (!content) { setPendingAction(null); setPendingText(''); return; }

    if (pendingAction.type === 'replace') {
      setAnnotations((prev) => ({
        ...prev,
        replacements: [...prev.replacements, {
          id: uid(),
          tokenIndices: pendingAction.tokenIndices,
          startLine: pendingAction.startLine,
          endLine: pendingAction.endLine,
          selectedText: pendingAction.text,
          content,
        }],
      }));
    } else {
      setAnnotations((prev) => ({
        ...prev,
        comments: [...prev.comments, {
          id: uid(),
          tokenIndices: pendingAction.tokenIndices,
          startLine: pendingAction.startLine,
          endLine: pendingAction.endLine,
          selectedText: pendingAction.text,
          content,
        }],
      }));
    }
    setPendingAction(null);
    setPendingText('');
  }, [pendingAction, pendingText]);

  // Remove a replacement annotation
  const handleRemoveReplacement = useCallback((id: string) => {
    setAnnotations((prev) => ({
      ...prev,
      replacements: prev.replacements.filter((r) => r.id !== id),
    }));
  }, []);

  // Edit a replacement annotation — assign new ID
  const handleEditReplacement = useCallback((id: string, newContent: string) => {
    setAnnotations((prev) => ({
      ...prev,
      replacements: prev.replacements.map((r) =>
        r.id === id ? { ...r, id: uid(), content: newContent } : r
      ),
    }));
  }, []);

  // Remove a comment annotation
  const handleRemoveComment = useCallback((id: string) => {
    setAnnotations((prev) => ({
      ...prev,
      comments: prev.comments.filter((c) => c.id !== id),
    }));
  }, []);

  // Edit a comment annotation — assign new ID
  const handleEditComment = useCallback((id: string, newContent: string) => {
    setAnnotations((prev) => ({
      ...prev,
      comments: prev.comments.map((c) =>
        c.id === id ? { ...c, id: uid(), content: newContent } : c
      ),
    }));
  }, []);

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
      setSelectionFloat(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) { setSelectionFloat(null); return; }

    // Ensure selection is within our container
    const range = sel.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) {
      setSelectionFloat(null);
      return;
    }

    // Find token indices from selection
    const startEl = findTokenEl(range.startContainer);
    const endEl = findTokenEl(range.endContainer);
    if (!startEl || !endEl) { setSelectionFloat(null); return; }

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

    // Use mouseup position if available and fresh (within 500ms),
    // so the float always appears near the mouse release point
    const mp = lastMouseUpPosRef.current;
    const useMouse = mp && (Date.now() - mp.time < 500);

    floatSetTimeRef.current = Date.now();
    setSelectionFloat({
      x: (useMouse ? mp.x : rect.right) - containerRect.left + container.scrollLeft + 6,
      y: (useMouse ? mp.y : rect.top) - containerRect.top + container.scrollTop - 44,
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
          // Grace period: don't clear float if it was just set (DOM mutation from rendering the float may collapse selection)
          if (Date.now() - floatSetTimeRef.current < 300) return;
          setSelectionFloat(null);
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

  const theme = useStore((s) => s.theme);
  useMermaidRender(containerRef, tokens, theme);

  // Filter: include annotations whose ID is not in baseline (new or edited → new ID)
  const getNewAnnotations = useCallback((): PlanAnnotations => {
    const bl = baselineIdsRef.current;
    return {
      additions: annotations.additions.filter((a) => !bl.has(a.id)),
      deletions: annotations.deletions.filter((d) => !bl.has(d.id)),
      replacements: annotations.replacements.filter((r) => !bl.has(r.id)),
      comments: annotations.comments.filter((c) => !bl.has(c.id)),
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
      annotations.replacements.forEach((r) => ids.add(r.id));
      annotations.comments.forEach((c) => ids.add(c.id));
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
      if (pendingAction) {
        handleSubmitPendingAction();
        return true;
      }
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
  }), [getNewAnnotations, sourceLines, filePath, activeInsert, handleAddAnnotation, pendingAction, handleSubmitPendingAction]);

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
  const handleSendSingle = useCallback((annId: string, type: 'add' | 'del' | 'rep' | 'com') => {
    if (!onSend) return;
    const singleAnns: PlanAnnotations = { additions: [], deletions: [], replacements: [], comments: [] };
    if (type === 'add') {
      const a = annotations.additions.find(x => x.id === annId);
      if (!a) return;
      singleAnns.additions.push(a);
    } else if (type === 'del') {
      const d = annotations.deletions.find(x => x.id === annId);
      if (!d) return;
      singleAnns.deletions.push(d);
    } else if (type === 'rep') {
      const r = annotations.replacements.find(x => x.id === annId);
      if (!r) return;
      singleAnns.replacements.push(r);
    } else {
      const c = annotations.comments.find(x => x.id === annId);
      if (!c) return;
      singleAnns.comments.push(c);
    }
    const cmd = generateTaskReview(filePath, singleAnns, sourceLines);
    if (cmd) onSend(cmd);
    baselineIdsRef.current.add(annId);
    setBaselineVer(v => v + 1);
  }, [onSend, filePath, annotations, sourceLines]);

  // Delete annotation from dropdown
  const handleDropdownDelete = useCallback((annId: string, type: 'add' | 'del' | 'rep' | 'com') => {
    if (type === 'add') handleRemoveAddition(annId);
    else if (type === 'del') handleRemoveDeletion(annId);
    else if (type === 'rep') handleRemoveReplacement(annId);
    else handleRemoveComment(annId);
  }, [handleRemoveAddition, handleRemoveDeletion, handleRemoveReplacement, handleRemoveComment]);

  // Check if a token index is marked for deletion
  const deletedIndices = useMemo(() => {
    const set = new Set<number>();
    annotations.deletions.forEach((d) => d.tokenIndices.forEach((i) => set.add(i)));
    return set;
  }, [annotations.deletions]);

  // Check if a token index is marked for replacement
  const replacedIndices = useMemo(() => {
    const set = new Set<number>();
    annotations.replacements.forEach((r) => r.tokenIndices.forEach((i) => set.add(i)));
    return set;
  }, [annotations.replacements]);

  // Check if a token index is marked with a comment
  const commentedIndices = useMemo(() => {
    const set = new Set<number>();
    annotations.comments.forEach((c) => c.tokenIndices.forEach((i) => set.add(i)));
    return set;
  }, [annotations.comments]);

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

  const hasAnnotations = annotations.additions.length > 0 || annotations.deletions.length > 0 || annotations.replacements.length > 0 || annotations.comments.length > 0;

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
                const firstRep = annotations.replacements[0];
                const firstCom = annotations.comments[0];
                const text = firstAdd ? firstAdd.content : firstDel ? firstDel.selectedText : firstRep ? firstRep.content : firstCom ? firstCom.content : '';
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
                {annotations.replacements.map(r => {
                  const isSent = baselineIdsRef.current.has(r.id);
                  return (
                    <div key={r.id} className="plan-anno-dropdown__item plan-anno-dropdown__item--rep">
                      <span className="plan-anno-dropdown__type" style={{ color: 'var(--accent-blue)' }}>&#x21C4;</span>
                      <span className="plan-anno-dropdown__text">{r.content.slice(0, 60)}{r.content.length > 60 ? '...' : ''}</span>
                      <button
                        className="pane-btn pane-btn--sm"
                        onClick={() => !isSent && handleSendSingle(r.id, 'rep')}
                        disabled={isSent}
                        title={isSent ? 'Already sent' : 'Send to terminal'}
                        style={isSent ? { opacity: 0.3 } : { color: 'var(--accent-blue)' }}
                      >Send</button>
                      <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => handleDropdownDelete(r.id, 'rep')} title="Delete">&times;</button>
                    </div>
                  );
                })}
                {annotations.comments.map(c => {
                  const isSent = baselineIdsRef.current.has(c.id);
                  return (
                    <div key={c.id} className="plan-anno-dropdown__item plan-anno-dropdown__item--com">
                      <span className="plan-anno-dropdown__type" style={{ color: 'var(--accent-green)' }}>?</span>
                      <span className="plan-anno-dropdown__text">{c.content.slice(0, 60)}{c.content.length > 60 ? '...' : ''}</span>
                      <button
                        className="pane-btn pane-btn--sm"
                        onClick={() => !isSent && handleSendSingle(c.id, 'com')}
                        disabled={isSent}
                        title={isSent ? 'Already sent' : 'Send to terminal'}
                        style={isSent ? { opacity: 0.3 } : { color: 'var(--accent-blue)' }}
                      >Send</button>
                      <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => handleDropdownDelete(c.id, 'com')} title="Delete">&times;</button>
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
        onMouseUp={(e: React.MouseEvent) => {
          lastMouseUpPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          handleSelectionCheck();
        }}
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
                className={deletedIndices.has(i) ? 'plan-block--deleted' : replacedIndices.has(i) ? 'plan-block--replaced' : commentedIndices.has(i) ? 'plan-block--commented' : undefined}
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
                          style={{ flex: 1, fontSize: `${fontSize}px`, color: 'var(--accent-red)', textDecoration: 'line-through', whiteSpace: 'pre-wrap', cursor: 'text' }}
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

              {/* Replace annotations for this token */}
              {annotations.replacements
                .filter((r) => r.tokenIndices.includes(i) && r.tokenIndices[0] === i)
                .map((r) => (
                  <div key={r.id} className="plan-replace-card">
                    {editingRepId === r.id ? (
                      <textarea
                        ref={editRepRef}
                        className="plan-annotation-textarea"
                        value={editRepText}
                        onChange={(e) => setEditRepText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            const trimmed = editRepText.trim();
                            if (trimmed) handleEditReplacement(r.id, trimmed);
                            else handleRemoveReplacement(r.id);
                            setEditingRepId(null);
                          }
                          if (e.key === 'Escape') { e.preventDefault(); setEditingRepId(null); }
                        }}
                        onBlur={() => {
                          const trimmed = editRepText.trim();
                          if (trimmed) handleEditReplacement(r.id, trimmed);
                          else handleRemoveReplacement(r.id);
                          setEditingRepId(null);
                        }}
                        rows={autoRows(editRepText)}
                        style={{ fontSize: `${fontSize}px`, flex: 1 }}
                      />
                    ) : (
                      <>
                        <span style={{ color: 'var(--accent-blue)', flexShrink: 0 }}>&#x21C4;</span>
                        <span
                          style={{ flex: 1, fontSize: `${fontSize}px`, whiteSpace: 'pre-wrap', cursor: 'text' }}
                          onDoubleClick={() => { setEditingRepId(r.id); setEditRepText(r.content); requestAnimationFrame(() => { const el = editRepRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          title="Double-click to edit"
                        >
                          <span style={{ color: 'var(--accent-red)', textDecoration: 'line-through' }}>{r.selectedText}</span>
                          <span style={{ color: 'var(--text-secondary)' }}> → </span>
                          <span style={{ color: 'var(--accent-blue)' }}>{r.content}</span>
                        </span>
                        {onSend && (() => {
                          const sent = baselineIdsRef.current.has(r.id);
                          return (
                            <button
                              className="pane-btn pane-btn--sm"
                              onClick={() => !sent && handleSendSingle(r.id, 'rep')}
                              disabled={sent}
                              title={sent ? 'Already sent' : 'Send to terminal'}
                              style={sent ? { opacity: 0.3 } : { color: 'var(--accent-green)' }}
                            >Send</button>
                          );
                        })()}
                        <button
                          className="pane-btn pane-btn--sm"
                          onClick={() => { setEditingRepId(r.id); setEditRepText(r.content); requestAnimationFrame(() => { const el = editRepRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          style={{ color: 'var(--accent-blue)' }}
                          title="Edit replacement"
                        >&#x270E;</button>
                        <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => handleRemoveReplacement(r.id)} title="Remove replacement">&times;</button>
                      </>
                    )}
                  </div>
                ))}

              {/* Comment annotations for this token */}
              {annotations.comments
                .filter((c) => c.tokenIndices.includes(i) && c.tokenIndices[0] === i)
                .map((c) => (
                  <div key={c.id} className="plan-comment-card">
                    {editingComId === c.id ? (
                      <textarea
                        ref={editComRef}
                        className="plan-annotation-textarea"
                        value={editComText}
                        onChange={(e) => setEditComText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            const trimmed = editComText.trim();
                            if (trimmed) handleEditComment(c.id, trimmed);
                            else handleRemoveComment(c.id);
                            setEditingComId(null);
                          }
                          if (e.key === 'Escape') { e.preventDefault(); setEditingComId(null); }
                        }}
                        onBlur={() => {
                          const trimmed = editComText.trim();
                          if (trimmed) handleEditComment(c.id, trimmed);
                          else handleRemoveComment(c.id);
                          setEditingComId(null);
                        }}
                        rows={autoRows(editComText)}
                        style={{ fontSize: `${fontSize}px`, flex: 1 }}
                      />
                    ) : (
                      <>
                        <span style={{ color: 'var(--accent-green)', flexShrink: 0 }}>?</span>
                        <span
                          style={{ flex: 1, fontSize: `${fontSize}px`, whiteSpace: 'pre-wrap', cursor: 'text' }}
                          onDoubleClick={() => { setEditingComId(c.id); setEditComText(c.content); requestAnimationFrame(() => { const el = editComRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          title="Double-click to edit"
                        >
                          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>"{c.selectedText}"</span>
                          <span style={{ color: 'var(--text-secondary)' }}>: </span>
                          <span style={{ color: 'var(--accent-green)' }}>{c.content}</span>
                        </span>
                        {onSend && (() => {
                          const sent = baselineIdsRef.current.has(c.id);
                          return (
                            <button
                              className="pane-btn pane-btn--sm"
                              onClick={() => !sent && handleSendSingle(c.id, 'com')}
                              disabled={sent}
                              title={sent ? 'Already sent' : 'Send to terminal'}
                              style={sent ? { opacity: 0.3 } : { color: 'var(--accent-green)' }}
                            >Send</button>
                          );
                        })()}
                        <button
                          className="pane-btn pane-btn--sm"
                          onClick={() => { setEditingComId(c.id); setEditComText(c.content); requestAnimationFrame(() => { const el = editComRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }); }}
                          style={{ color: 'var(--accent-blue)' }}
                          title="Edit comment"
                        >&#x270E;</button>
                        <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => handleRemoveComment(c.id)} title="Remove comment">&times;</button>
                      </>
                    )}
                  </div>
                ))}

              {/* Pending replace/comment textarea for this token */}
              {pendingAction && pendingAction.tokenIndices[0] === i && (
                <div className={pendingAction.type === 'replace' ? 'plan-replace-card' : 'plan-comment-card'} style={{ padding: '4px 8px' }}>
                  <span style={{ color: pendingAction.type === 'replace' ? 'var(--accent-blue)' : 'var(--accent-green)', flexShrink: 0 }}>
                    {pendingAction.type === 'replace' ? '\u21C4' : '?'}
                  </span>
                  <textarea
                    ref={pendingTextareaRef}
                    className="plan-annotation-textarea"
                    value={pendingText}
                    onChange={(e) => setPendingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSubmitPendingAction(); return; }
                      if (e.key === 'Escape') { e.preventDefault(); handleSubmitPendingAction(); return; }
                    }}
                    onBlur={handleSubmitPendingAction}
                    placeholder={pendingAction.type === 'replace' ? 'Replace with... (Ctrl+Enter to save)' : 'Comment... (Ctrl+Enter to save)'}
                    rows={autoRows(pendingText)}
                    style={{ fontSize: `${fontSize}px`, flex: 1 }}
                  />
                </div>
              )}

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

        {/* Selection float button group */}
        {!readOnly && selectionFloat && (
          <div
            className="plan-selection-float"
            style={{ top: selectionFloat.y, left: selectionFloat.x }}
          >
            <button
              className="plan-selection-float__delete"
              onMouseDown={(e) => { e.preventDefault(); handleMarkDeletion(); }}
              title="Delete selection"
            >&minus;</button>
            <button
              className="plan-selection-float__replace"
              onMouseDown={(e) => { e.preventDefault(); handleStartSelectionAction('replace'); }}
              title="Replace selection"
            >&#x21C4;</button>
            <button
              className="plan-selection-float__comment"
              onMouseDown={(e) => { e.preventDefault(); handleStartSelectionAction('comment'); }}
              title="Comment on selection"
            >?</button>
          </div>
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
            onBlur={onSubmit}
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
