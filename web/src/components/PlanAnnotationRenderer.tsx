import { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { marked } from 'marked';
import { useStore } from '../store';
import { useTextareaUndo, handleTabKey, autoRows } from '../hooks/useTextareaKit';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { useAnnotationPersistence } from '../hooks/useAnnotationPersistence';
import { writeTaskAnnotations } from '../api/annotations';
import { saveAnnotationRemote } from '../api/annotations';
import { saveFileContent } from '../api/docs';
import { MarkdownToc, extractHeadings, toSlug, stripInlineMarkdown } from './MarkdownToc';
import { AnnotationDropdown } from './AnnotationDropdown';
import { AnnotationCard } from './AnnotationCard';
import { SelectionFloat } from './SelectionFloat';
import {
  uid, storageKey, scrollKey, tokenToHtml, tokenSourceLine,
  buildAnnotationJson, hasAnnotations, generatePlanCommand, deriveModulePath, collectIds,
} from './annotationHelpers';
import type { AddAnnotation, PlanAnnotations } from '../types/annotations';
import { EMPTY_ANNOTATIONS } from '../types/annotations';

export type { AddAnnotation, PlanAnnotations };
export type { DeleteAnnotation, ReplaceAnnotation, CommentAnnotation } from '../types/annotations';
export { generatePlanCommand };

/* ── Component ── */

export interface PlanAnnotationRendererHandle {
  getSummary: () => string;
  handleEscape: () => boolean;
  getScrollTop: () => number;
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
  onContentSaved?: (newContent: string, mtime: number) => void;
  expanded?: boolean;
  readOnly?: boolean;
}

export const PlanAnnotationRenderer = forwardRef<PlanAnnotationRendererHandle, Props>(function PlanAnnotationRenderer({ markdown, filePath, sessionId, token, onExecute, onSend, onRefresh, onClose, onContentSaved, expanded, readOnly }, ref) {
  const fontSize = useStore((s) => s.fontSize);

  // ── Send status feedback ──
  const [sendStatus, setSendStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const sendStatusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flashStatus = useCallback((type: 'ok' | 'err', msg: string) => {
    clearTimeout(sendStatusTimerRef.current);
    setSendStatus({ type, msg });
    sendStatusTimerRef.current = setTimeout(() => setSendStatus(null), type === 'ok' ? 2500 : 5000);
  }, []);
  useEffect(() => () => clearTimeout(sendStatusTimerRef.current), []);

  // ── Edit mode state ──
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const latency = useStore((s) => s.latency);

  // Dual-layer edit persistence: L1 localStorage 50ms, L2 server adaptive
  const editLsKey = `plan-edit:${sessionId}:${filePath}`;
  const editL1TimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editL2TimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const editL2InFlightRef = useRef(false);

  useEffect(() => {
    if (!editMode) return;
    // L1: 50ms → localStorage
    clearTimeout(editL1TimerRef.current);
    editL1TimerRef.current = setTimeout(() => {
      try { localStorage.setItem(editLsKey, editContent); } catch { /* full */ }
    }, 50);
    // L2: adaptive → server (save draft to file on disk)
    clearTimeout(editL2TimerRef.current);
    const syncInterval = Math.max(200, (latency ?? 30) * 3);
    editL2TimerRef.current = setTimeout(() => {
      if (editL2InFlightRef.current) return;
      editL2InFlightRef.current = true;
      saveFileContent(token, sessionId, filePath, editContent)
        .then((result) => { onContentSaved?.(editContent, result.mtime); })
        .catch(() => {})
        .finally(() => { editL2InFlightRef.current = false; });
    }, syncInterval);
    return () => { clearTimeout(editL1TimerRef.current); clearTimeout(editL2TimerRef.current); };
  }, [editContent, editMode, editLsKey, token, sessionId, filePath, latency, onContentSaved]);

  // Reset edit mode when file changes
  useEffect(() => { setEditMode(false); }, [filePath]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editMode) requestAnimationFrame(() => editTextareaRef.current?.focus());
  }, [editMode]);

  const handleEnterEditMode = useCallback(() => {
    if (readOnly || editMode) return;
    // Restore from localStorage draft if available, otherwise use current markdown
    const saved = localStorage.getItem(`plan-edit:${sessionId}:${filePath}`);
    setEditContent(saved != null ? saved : markdown);
    setEditMode(true);
  }, [readOnly, editMode, markdown, sessionId, filePath]);

  const handleCancelEdit = useCallback(() => {
    setEditMode(false);
    setEditContent('');
    localStorage.removeItem(`plan-edit:${sessionId}:${filePath}`);
  }, [sessionId, filePath]);

  const handleSaveEdit = useCallback(async () => {
    if (editSaving) return;
    setEditSaving(true);
    try {
      const result = await saveFileContent(token, sessionId, filePath, editContent);
      onContentSaved?.(editContent, result.mtime);
      setEditMode(false);
      setEditContent('');
      localStorage.removeItem(`plan-edit:${sessionId}:${filePath}`);
      flashStatus('ok', 'Saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      flashStatus('err', msg);
      console.error('[PlanAnnotationRenderer] Failed to save file:', err);
    } finally {
      setEditSaving(false);
    }
  }, [editSaving, token, sessionId, filePath, editContent, onContentSaved, flashStatus]);

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

  // ── Annotation state ──
  const baselineIdsRef = useRef<Set<string>>(new Set());
  const annLoadedRef = useRef(false);
  const [annotations, setAnnotations] = useState<PlanAnnotations>(() => {
    try {
      const saved = localStorage.getItem(storageKey(sessionId, filePath));
      const parsed: PlanAnnotations = saved ? JSON.parse(saved) : EMPTY_ANNOTATIONS;
      baselineIdsRef.current = collectIds(parsed);
      if (!parsed.replacements) parsed.replacements = [];
      if (!parsed.comments) parsed.comments = [];
      return parsed;
    } catch { return EMPTY_ANNOTATIONS; }
  });

  // Dual-layer persistence hook
  useAnnotationPersistence({
    sessionId, filePath, token, annotations, annLoadedRef,
    setAnnotations, baselineIdsRef,
  });

  // Baseline version counter — increment to force re-computation of sent/unsent counts
  const [baselineVer, setBaselineVer] = useState(0);

  // Annotation counts
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

  // ── Editing state ──
  const [activeInsert, setActiveInsert] = useState<number | null>(null);
  const [insertText, setInsertText] = useState('');
  const insertTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Pending selection action
  const [pendingAction, setPendingAction] = useState<{
    type: 'replace' | 'comment';
    tokenIndices: number[];
    startLine: number;
    endLine: number;
    text: string;
  } | null>(null);
  const [pendingText, setPendingText] = useState('');
  const pendingTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Selection float
  const [selectionFloat, setSelectionFloat] = useState<{ x: number; y: number; tokenIndices: number[]; startLine: number; endLine: number; text: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const floatSetTimeRef = useRef(0);
  const lastMouseUpPosRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // ── Scroll persistence ──
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
    return () => { clearTimeout(timer); el.removeEventListener('scroll', saveScroll); };
  }, [sessionId, filePath]);

  useEffect(() => {
    if (!tokens.length) return;
    const saved = localStorage.getItem(scrollKey(sessionId, filePath));
    if (!saved) return;
    const target = Number(saved);
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = target;
    if (el.scrollTop >= target - 10) return;
    let settleTimer: ReturnType<typeof setTimeout>;
    const restore = () => { el.scrollTop = target; observer.disconnect(); };
    const observer = new MutationObserver(() => { clearTimeout(settleTimer); settleTimer = setTimeout(restore, 80); });
    observer.observe(el, { childList: true, subtree: true });
    const fallback = setTimeout(restore, 500);
    return () => { clearTimeout(settleTimer); clearTimeout(fallback); observer.disconnect(); };
  }, [sessionId, filePath, tokens.length]);

  // Focus textareas
  useEffect(() => { if (activeInsert != null) requestAnimationFrame(() => insertTextareaRef.current?.focus()); }, [activeInsert]);
  useEffect(() => { if (pendingAction) requestAnimationFrame(() => pendingTextareaRef.current?.focus()); }, [pendingAction]);

  // ── Flush pending edits on unmount ──
  const flushRef = useRef({ annotations, activeInsert, insertText, pendingAction, pendingText, tokens, filePath, sessionId, token });
  flushRef.current = { annotations, activeInsert, insertText, pendingAction, pendingText, tokens, filePath, sessionId, token };

  useEffect(() => {
    return () => {
      const s = flushRef.current;
      let anns = s.annotations;
      let changed = false;
      if (s.activeInsert != null && s.insertText.trim()) {
        const line = tokenSourceLine(s.tokens, s.activeInsert + 1);
        anns = { ...anns, additions: [...anns.additions, { id: uid(), afterTokenIndex: s.activeInsert, sourceLine: line, content: s.insertText.trim() }] };
        changed = true;
      }
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
      if (changed) {
        const serialized = JSON.stringify(anns);
        try { localStorage.setItem(storageKey(s.sessionId, s.filePath), serialized); } catch { /* full */ }
        saveAnnotationRemote(s.token, s.sessionId, s.filePath, serialized, Date.now()).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── CRUD handlers ──
  const handleAddAnnotation = useCallback((afterIndex: number) => {
    if (!insertText.trim()) { setActiveInsert(null); setInsertText(''); return; }
    const line = tokenSourceLine(tokens, afterIndex + 1);
    setAnnotations((prev) => ({ ...prev, additions: [...prev.additions, { id: uid(), afterTokenIndex: afterIndex, sourceLine: line, content: insertText.trim() }] }));
    setActiveInsert(null);
    setInsertText('');
  }, [insertText, tokens]);

  const handleRemoveAddition = useCallback((id: string) => {
    setAnnotations((prev) => ({ ...prev, additions: prev.additions.filter((a) => a.id !== id) }));
  }, []);

  const handleEditAddition = useCallback((id: string, newContent: string) => {
    setAnnotations((prev) => ({ ...prev, additions: prev.additions.map((a) => a.id === id ? { ...a, id: uid(), content: newContent } : a) }));
  }, []);

  const handleMarkDeletion = useCallback(() => {
    if (!selectionFloat) return;
    setAnnotations((prev) => ({ ...prev, deletions: [...prev.deletions, { id: uid(), tokenIndices: selectionFloat.tokenIndices, startLine: selectionFloat.startLine, endLine: selectionFloat.endLine, selectedText: selectionFloat.text.slice(0, 80) }] }));
    setSelectionFloat(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionFloat]);

  const handleStartSelectionAction = useCallback((type: 'replace' | 'comment') => {
    if (!selectionFloat) return;
    setPendingAction({ type, tokenIndices: selectionFloat.tokenIndices, startLine: selectionFloat.startLine, endLine: selectionFloat.endLine, text: selectionFloat.text.slice(0, 80) });
    setPendingText('');
    setSelectionFloat(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionFloat]);

  const handleSubmitPendingAction = useCallback(() => {
    if (!pendingAction) return;
    const content = pendingText.trim();
    if (!content) { setPendingAction(null); setPendingText(''); return; }
    if (pendingAction.type === 'replace') {
      setAnnotations((prev) => ({ ...prev, replacements: [...prev.replacements, { id: uid(), tokenIndices: pendingAction.tokenIndices, startLine: pendingAction.startLine, endLine: pendingAction.endLine, selectedText: pendingAction.text, content }] }));
    } else {
      setAnnotations((prev) => ({ ...prev, comments: [...prev.comments, { id: uid(), tokenIndices: pendingAction.tokenIndices, startLine: pendingAction.startLine, endLine: pendingAction.endLine, selectedText: pendingAction.text, content }] }));
    }
    setPendingAction(null);
    setPendingText('');
  }, [pendingAction, pendingText]);

  const handleRemoveReplacement = useCallback((id: string) => { setAnnotations((prev) => ({ ...prev, replacements: prev.replacements.filter((r) => r.id !== id) })); }, []);
  const handleEditReplacement = useCallback((id: string, c: string) => { setAnnotations((prev) => ({ ...prev, replacements: prev.replacements.map((r) => r.id === id ? { ...r, id: uid(), content: c } : r) })); }, []);
  const handleRemoveComment = useCallback((id: string) => { setAnnotations((prev) => ({ ...prev, comments: prev.comments.filter((c) => c.id !== id) })); }, []);
  const handleEditComment = useCallback((id: string, c: string) => { setAnnotations((prev) => ({ ...prev, comments: prev.comments.map((x) => x.id === id ? { ...x, id: uid(), content: c } : x) })); }, []);
  const handleRemoveDeletion = useCallback((id: string) => { setAnnotations((prev) => ({ ...prev, deletions: prev.deletions.filter((d) => d.id !== id) })); }, []);
  const handleEditDeletion = useCallback((id: string, t: string) => { setAnnotations((prev) => ({ ...prev, deletions: prev.deletions.map((d) => d.id === id ? { ...d, id: uid(), selectedText: t } : d) })); }, []);

  // ── Selection detection ──
  const findTokenEl = useCallback((node: Node): Element | null => {
    let el: Element | null = node instanceof Element ? node : node.parentElement;
    while (el && el !== containerRef.current) {
      if (el.hasAttribute('data-token-index')) return el;
      el = el.parentElement;
    }
    return null;
  }, []);

  const handleSelectionCheck = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !containerRef.current) { setSelectionFloat(null); return; }
    const text = sel.toString().trim();
    if (!text) { setSelectionFloat(null); return; }
    const range = sel.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) { setSelectionFloat(null); return; }
    const startEl = findTokenEl(range.startContainer);
    const endEl = findTokenEl(range.endContainer);
    if (!startEl || !endEl) { setSelectionFloat(null); return; }
    const startIdx = parseInt(startEl.getAttribute('data-token-index') || '0', 10);
    const endIdx = parseInt(endEl.getAttribute('data-token-index') || '0', 10);
    const indices: number[] = [];
    for (let i = Math.min(startIdx, endIdx); i <= Math.max(startIdx, endIdx); i++) indices.push(i);
    const startLine = tokenSourceLine(tokens, Math.min(startIdx, endIdx));
    const endLine = tokenSourceLine(tokens, Math.max(startIdx, endIdx) + 1);
    const rect = range.getBoundingClientRect();
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    navigator.clipboard.writeText(text).catch(() => {});
    const mp = lastMouseUpPosRef.current;
    const useMouse = mp && (Date.now() - mp.time < 500);
    floatSetTimeRef.current = Date.now();
    setSelectionFloat({
      x: (useMouse ? mp.x : rect.right) - containerRect.left + container.scrollLeft + 6,
      y: (useMouse ? mp.y : rect.top) - containerRect.top + container.scrollTop - 44,
      tokenIndices: indices, startLine, endLine, text,
    });
  }, [tokens, findTokenEl]);

  const selTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const onSelChange = () => {
      if (selTimerRef.current) clearTimeout(selTimerRef.current);
      selTimerRef.current = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !containerRef.current) {
          if (Date.now() - floatSetTimeRef.current < 300) return;
          setSelectionFloat(null);
          return;
        }
        const anchor = sel.anchorNode;
        if (anchor && containerRef.current.contains(anchor)) handleSelectionCheck();
      }, 120);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => { document.removeEventListener('selectionchange', onSelChange); if (selTimerRef.current) clearTimeout(selTimerRef.current); };
  }, [handleSelectionCheck]);

  const theme = useStore((s) => s.theme);
  useMermaidRender(containerRef, tokens, theme);


  // ── Execute / Send ──
  const getNewAnnotations = useCallback((): PlanAnnotations => {
    const bl = baselineIdsRef.current;
    return {
      additions: annotations.additions.filter((a) => !bl.has(a.id)),
      deletions: annotations.deletions.filter((d) => !bl.has(d.id)),
      replacements: annotations.replacements.filter((r) => !bl.has(r.id)),
      comments: annotations.comments.filter((c) => !bl.has(c.id)),
    };
  }, [annotations]);

  const handleExecute = useCallback(async () => {
    const newAnns = getNewAnnotations();
    if (!hasAnnotations(newAnns)) return;
    const annJson = buildAnnotationJson(newAnns, sourceLines);
    const modulePath = deriveModulePath(filePath);
    try {
      const { path: annFilePath } = await writeTaskAnnotations(token, sessionId, modulePath, annJson);
      const cmd = generatePlanCommand(filePath, annFilePath);
      onExecute(cmd);
      baselineIdsRef.current = collectIds(annotations);
      setBaselineVer(v => v + 1);
      const count = newAnns.additions.length + newAnns.deletions.length + newAnns.replacements.length + newAnns.comments.length;
      flashStatus('ok', `Sent ${count} annotation(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send';
      flashStatus('err', msg);
      console.error('[PlanAnnotationRenderer] Failed to write annotations:', err);
    }
  }, [getNewAnnotations, annotations, sourceLines, onExecute, filePath, token, sessionId, flashStatus]);

  const handleSendSingle = useCallback(async (annId: string, type: 'add' | 'del' | 'rep' | 'com') => {
    if (!onSend) return;
    const singleAnns: PlanAnnotations = { additions: [], deletions: [], replacements: [], comments: [] };
    if (type === 'add') { const a = annotations.additions.find(x => x.id === annId); if (!a) return; singleAnns.additions.push(a); }
    else if (type === 'del') { const d = annotations.deletions.find(x => x.id === annId); if (!d) return; singleAnns.deletions.push(d); }
    else if (type === 'rep') { const r = annotations.replacements.find(x => x.id === annId); if (!r) return; singleAnns.replacements.push(r); }
    else { const c = annotations.comments.find(x => x.id === annId); if (!c) return; singleAnns.comments.push(c); }
    const annJson = buildAnnotationJson(singleAnns, sourceLines);
    const modulePath = deriveModulePath(filePath);
    try {
      const { path: annFilePath } = await writeTaskAnnotations(token, sessionId, modulePath, annJson);
      onSend(generatePlanCommand(filePath, annFilePath));
      baselineIdsRef.current.add(annId);
      setBaselineVer(v => v + 1);
      flashStatus('ok', 'Sent 1 annotation');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send';
      flashStatus('err', msg);
      console.error('[PlanAnnotationRenderer] Failed to write single annotation:', err);
    }
  }, [onSend, filePath, annotations, sourceLines, token, sessionId, flashStatus]);

  const handleDropdownDelete = useCallback((annId: string, type: 'add' | 'del' | 'rep' | 'com') => {
    if (type === 'add') handleRemoveAddition(annId);
    else if (type === 'del') handleRemoveDeletion(annId);
    else if (type === 'rep') handleRemoveReplacement(annId);
    else handleRemoveComment(annId);
  }, [handleRemoveAddition, handleRemoveDeletion, handleRemoveReplacement, handleRemoveComment]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    getSummary: () => { const newAnns = getNewAnnotations(); return hasAnnotations(newAnns) ? '[pending annotations]' : ''; },
    handleEscape: () => {
      if (editMode) { handleCancelEdit(); return true; }
      if (pendingAction) { handleSubmitPendingAction(); return true; }
      if (activeInsert != null) { handleAddAnnotation(activeInsert); return true; }
      return false;
    },
    getScrollTop: () => containerRef.current?.scrollTop ?? 0,
    setScrollTop: (top: number) => { requestAnimationFrame(() => { if (containerRef.current) containerRef.current.scrollTop = top; }); },
  }), [getNewAnnotations, editMode, handleCancelEdit, activeInsert, handleAddAnnotation, pendingAction, handleSubmitPendingAction]);

  // ── Computed sets ──
  const deletedIndices = useMemo(() => { const set = new Set<number>(); annotations.deletions.forEach((d) => d.tokenIndices.forEach((i) => set.add(i))); return set; }, [annotations.deletions]);
  const replacedIndices = useMemo(() => { const set = new Set<number>(); annotations.replacements.forEach((r) => r.tokenIndices.forEach((i) => set.add(i))); return set; }, [annotations.replacements]);
  const commentedIndices = useMemo(() => { const set = new Set<number>(); annotations.comments.forEach((c) => c.tokenIndices.forEach((i) => set.add(i))); return set; }, [annotations.comments]);
  const additionsByIndex = useMemo(() => { const map = new Map<number, AddAnnotation[]>(); annotations.additions.forEach((a) => { const list = map.get(a.afterTokenIndex) || []; list.push(a); map.set(a.afterTokenIndex, list); }); return map; }, [annotations.additions]);

  const hasUnsent = annCounts.unsent > 0;
  const isSentCheck = useCallback((id: string) => baselineIdsRef.current.has(id), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div className="plan-anno-toolbar">
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={filePath}>
          {filePath.split('/').pop() || filePath}
        </span>
        {sendStatus && (
          <span
            style={{ fontSize: '10px', color: sendStatus.type === 'ok' ? 'var(--accent-green)' : 'var(--accent-red)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, cursor: sendStatus.type === 'err' ? 'pointer' : undefined }}
            title={sendStatus.type === 'err' ? 'Click to copy' : sendStatus.msg}
            onClick={sendStatus.type === 'err' ? () => { navigator.clipboard.writeText(sendStatus.msg).catch(() => {}); flashStatus('ok', 'Copied'); } : undefined}
          >
            {sendStatus.msg}
          </span>
        )}
        {editMode ? (
          <>
            <button className="pane-btn" onClick={handleSaveEdit} disabled={editSaving} style={{ color: 'var(--accent-green)' }} title="Save (Ctrl+S)">{editSaving ? 'Saving...' : 'Save'}</button>
            <button className="pane-btn" onClick={handleCancelEdit} disabled={editSaving} title="Cancel (Esc)">Cancel</button>
          </>
        ) : (
          <>
            {onRefresh && <button className="pane-btn" onClick={onRefresh} title="Refresh current file">&#x21BB;</button>}
            {!readOnly && <button className="pane-btn" onClick={handleEnterEditMode} title="Edit file (double-click content)">Edit</button>}
            <button className="pane-btn" onClick={handleExecute} disabled={!hasUnsent} title="Send all annotations" style={hasUnsent ? { color: 'var(--accent-green)' } : { opacity: 0.4 }}>Send</button>
            <AnnotationDropdown
              annotations={annotations}
              annCounts={annCounts}
              isSent={isSentCheck}
              onSendAll={handleExecute}
              onSendSingle={handleSendSingle}
              onDelete={handleDropdownDelete}
            />
            {onClose && (
              <button className="pane-btn pane-btn--danger" onClick={async () => { await handleExecute(); onClose(); }} title="Send annotations &amp; close file">&times;</button>
            )}
          </>
        )}
      </div>

      {/* Content + TOC */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {editMode ? (
          <textarea
            ref={editTextareaRef}
            className="plan-edit-textarea"
            style={{ fontSize: `${fontSize}px` }}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSaveEdit(); return; }
              if (e.key === 'Escape') { e.preventDefault(); handleCancelEdit(); return; }
            }}
            spellCheck={false}
          />
        ) : (
        <div
          ref={containerRef}
          className={`plan-anno-content md-preview${activeInsert != null ? ' plan-anno-content--editing' : ''}`}
          style={{ flex: 1, overflow: 'auto', padding: '8px 12px', position: 'relative', fontSize: `${fontSize}px`, minWidth: 0 }}
          onMouseUp={(e: React.MouseEvent) => { lastMouseUpPosRef.current = { x: e.clientX, y: e.clientY, time: Date.now() }; handleSelectionCheck(); }}
          onDoubleClick={(e) => {
            // Only enter edit mode on double-click if not clicking on interactive elements
            if (readOnly) return;
            const target = e.target as HTMLElement;
            if (target.closest('textarea, button, .plan-annotation-card, .plan-insert-btn, .plan-selection-float')) return;
            handleEnterEditMode();
          }}
        >
          {/* Insert zone before first block */}
          {!readOnly && (
            <InsertZone
              index={-1} active={activeInsert === -1} additions={additionsByIndex.get(-1)}
              onOpen={() => { setActiveInsert(-1); setInsertText(''); }}
              onSubmit={() => handleAddAnnotation(-1)}
              onRemoveAddition={handleRemoveAddition} onEditAddition={handleEditAddition}
              onSendSingle={onSend ? (id) => handleSendSingle(id, 'add') : undefined}
              isSent={isSentCheck} insertText={insertText} setInsertText={setInsertText}
              textareaRef={activeInsert === -1 ? insertTextareaRef : undefined}
              expanded={expanded} alwaysShow={tokens.length === 0} fontSize={fontSize}
            />
          )}

          {tokens.map((token, i) => {
            const html = tokenToHtml(token);
            return (
              <div key={i}>
                <div
                  data-token-index={i} id={headingIdMap.get(i)}
                  className={deletedIndices.has(i) ? 'plan-block--deleted' : replacedIndices.has(i) ? 'plan-block--replaced' : commentedIndices.has(i) ? 'plan-block--commented' : undefined}
                  dangerouslySetInnerHTML={{ __html: html }}
                />

                {/* Annotation cards */}
                {annotations.deletions.filter((d) => d.tokenIndices[0] === i).map((d) => (
                  <AnnotationCard key={d.id} type="del" annotation={d} fontSize={fontSize}
                    onEdit={handleEditDeletion} onRemove={handleRemoveDeletion}
                    onSend={onSend ? (id) => handleSendSingle(id, 'del') : undefined}
                    isSent={baselineIdsRef.current.has(d.id)} />
                ))}
                {annotations.replacements.filter((r) => r.tokenIndices[0] === i).map((r) => (
                  <AnnotationCard key={r.id} type="rep" annotation={r} fontSize={fontSize}
                    onEdit={handleEditReplacement} onRemove={handleRemoveReplacement}
                    onSend={onSend ? (id) => handleSendSingle(id, 'rep') : undefined}
                    isSent={baselineIdsRef.current.has(r.id)} />
                ))}
                {annotations.comments.filter((c) => c.tokenIndices[0] === i).map((c) => (
                  <AnnotationCard key={c.id} type="com" annotation={c} fontSize={fontSize}
                    onEdit={handleEditComment} onRemove={handleRemoveComment}
                    onSend={onSend ? (id) => handleSendSingle(id, 'com') : undefined}
                    isSent={baselineIdsRef.current.has(c.id)} />
                ))}

                {/* Pending replace/comment textarea */}
                {pendingAction && pendingAction.tokenIndices[0] === i && (
                  <div className={pendingAction.type === 'replace' ? 'plan-replace-card' : 'plan-comment-card'} style={{ padding: '4px 8px' }}>
                    <span style={{ color: pendingAction.type === 'replace' ? 'var(--accent-blue)' : 'var(--accent-green)', flexShrink: 0 }}>
                      {pendingAction.type === 'replace' ? '\u21C4' : '?'}
                    </span>
                    <textarea
                      ref={pendingTextareaRef} className="plan-annotation-textarea"
                      value={pendingText} onChange={(e) => setPendingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSubmitPendingAction(); return; }
                        if (e.key === 'Escape') { e.preventDefault(); handleSubmitPendingAction(); return; }
                      }}
                      onBlur={handleSubmitPendingAction}
                      placeholder={pendingAction.type === 'replace' ? 'Replace with... (Ctrl+Enter to save)' : 'Comment... (Ctrl+Enter to save)'}
                      rows={autoRows(pendingText)} style={{ fontSize: `${fontSize}px`, flex: 1 }}
                    />
                  </div>
                )}

                {/* Insert zone after this block */}
                {!readOnly && (
                  <InsertZone
                    index={i} active={activeInsert === i} additions={additionsByIndex.get(i)}
                    onOpen={() => { setActiveInsert(i); setInsertText(''); }}
                    onSubmit={() => handleAddAnnotation(i)}
                    onRemoveAddition={handleRemoveAddition} onEditAddition={handleEditAddition}
                    onSendSingle={onSend ? (id) => handleSendSingle(id, 'add') : undefined}
                    isSent={isSentCheck} insertText={insertText} setInsertText={setInsertText}
                    textareaRef={activeInsert === i ? insertTextareaRef : undefined}
                    expanded={expanded} fontSize={fontSize}
                  />
                )}
              </div>
            );
          })}

          {/* Selection float */}
          {!readOnly && selectionFloat && (
            <SelectionFloat
              x={selectionFloat.x} y={selectionFloat.y}
              onDelete={handleMarkDeletion}
              onReplace={() => handleStartSelectionAction('replace')}
              onComment={() => handleStartSelectionAction('comment')}
            />
          )}
        </div>
        )}
        {!editMode && <MarkdownToc headings={headings} scrollRef={containerRef} />}
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
  const editUndo = useTextareaUndo();
  const insertUndo = useTextareaUndo();

  useEffect(() => {
    if (editingId) {
      editUndo.clearUndo();
      requestAnimationFrame(() => { const el = editTextareaRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } });
    }
  }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (active) insertUndo.clearUndo(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEditTextWithUndo = useCallback((next: string) => { setEditText((prev) => { editUndo.pushUndo(prev); return next; }); }, [editUndo]);
  const setInsertTextWithUndo = useCallback((next: string) => { insertUndo.pushUndo(insertText); setInsertText(next); }, [insertText, setInsertText, insertUndo]);
  const startEdit = useCallback((a: AddAnnotation) => { setEditingId(a.id); setEditText(a.content); }, []);
  const saveEdit = useCallback(() => {
    if (!editingId) return;
    const trimmed = editText.trim();
    if (trimmed) onEditAddition(editingId, trimmed);
    else onRemoveAddition(editingId);
    setEditingId(null); setEditText('');
  }, [editingId, editText, onEditAddition, onRemoveAddition]);
  const cancelEdit = useCallback(() => { setEditingId(null); setEditText(''); }, []);

  return (
    <div className={`plan-insert-zone${alwaysShow ? ' plan-insert-zone--empty' : ''}`} data-zone-index={index}>
      {additions?.map((a) => (
        <div key={a.id} className="plan-annotation-card">
          {editingId === a.id ? (
            <textarea ref={editTextareaRef} className="plan-annotation-textarea" value={editText}
              onChange={(e) => setEditTextWithUndo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); return; }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
                if (e.key === 'Tab') { handleTabKey(e, setEditTextWithUndo); return; }
              }}
              onBlur={saveEdit} rows={autoRows(editText)}
              style={{ fontSize: `${fontSize}px`, flex: 1, ...(expanded ? { minWidth: 300 } : undefined) }}
            />
          ) : (
            <>
              <span style={{ flex: 1, fontSize: `${fontSize}px`, color: 'var(--accent-yellow)', whiteSpace: 'pre-wrap', cursor: 'text' }} onDoubleClick={() => startEdit(a)} title="Double-click to edit">{a.content}</span>
              {onSendSingle && (() => { const sent = isSent?.(a.id) ?? false; return (
                <button className="pane-btn pane-btn--sm" onClick={() => !sent && onSendSingle(a.id)} disabled={sent}
                  title={sent ? 'Already sent' : 'Send to terminal'} style={sent ? { opacity: 0.3 } : { color: 'var(--accent-green)' }}>Send</button>
              ); })()}
              <button className="pane-btn pane-btn--sm" onClick={() => startEdit(a)} style={{ color: 'var(--accent-blue)' }} title="Edit annotation">&#x270E;</button>
              <button className="pane-btn pane-btn--danger pane-btn--sm" onClick={() => onRemoveAddition(a.id)}>&times;</button>
            </>
          )}
        </div>
      ))}
      {active ? (
        <div className="plan-annotation-card plan-annotation-card--editing">
          <textarea ref={textareaRef} className="plan-annotation-textarea" value={insertText}
            onChange={(e) => setInsertTextWithUndo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit(); return; }
              if (e.key === 'Escape') { e.preventDefault(); onSubmit(); return; }
              if (e.key === 'Tab') { handleTabKey(e, setInsertTextWithUndo); return; }
            }}
            onBlur={onSubmit} placeholder="Add annotation... (Ctrl+Enter or Esc to save)"
            rows={autoRows(insertText)} style={{ fontSize: `${fontSize}px`, ...(expanded ? { minWidth: 300 } : undefined) }}
          />
        </div>
      ) : alwaysShow && !additions?.length ? (
        <div className="plan-empty-placeholder" onDoubleClick={onOpen} title="Double-click or Ctrl+Enter to edit">
          Write down your plans here. Double-click or Ctrl+Enter to edit.
        </div>
      ) : (
        <button className="plan-insert-btn" onClick={onOpen} title="Add annotation here">+</button>
      )}
    </div>
  );
}
