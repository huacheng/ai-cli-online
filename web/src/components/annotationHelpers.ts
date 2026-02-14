import { marked, type Token } from 'marked';
import DOMPurify from 'dompurify';
import type { PlanAnnotations } from '../types/annotations';

/* ── ID generation ── */

let _idCounter = 0;
export function uid() { return `ann_${++_idCounter}_${Date.now()}`; }

/* ── Storage keys ── */

export function storageKey(sessionId: string, filePath: string) {
  return `plan-annotations-${sessionId}-${filePath}`;
}

export function scrollKey(sessionId: string, filePath: string) {
  return `plan-scroll-${sessionId}-${filePath}`;
}

/* ── Markdown rendering ── */

/** Render a single marked token to sanitized HTML (XSS-safe via DOMPurify) */
export function tokenToHtml(token: Token): string {
  const raw = String(marked.parser([token as Token], { async: false }));
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['img'],
    ADD_ATTR: ['src', 'alt', 'title', 'width', 'height'],
  });
}

/** Approximate source line for a given token index */
export function tokenSourceLine(tokens: Token[], index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < tokens.length; i++) {
    const raw = (tokens[i] as { raw?: string }).raw ?? '';
    for (const ch of raw) if (ch === '\n') line++;
  }
  return line;
}

/* ── Context extraction ── */

/**
 * Extract 20 chars before and 20 chars after an annotation position (cross-line).
 * Returns { before, after } with newlines replaced by ↵.
 */
export function surroundingContext(
  sourceLines: string[],
  startLine: number,
  endLine: number,
  selectedText?: string,
): { before: string; after: string } {
  const fullText = sourceLines.join('\n');

  let startOffset = 0;
  for (let i = 0; i < startLine - 1 && i < sourceLines.length; i++) {
    startOffset += sourceLines[i].length + 1;
  }

  let endOffset = 0;
  for (let i = 0; i < endLine && i < sourceLines.length; i++) {
    endOffset += sourceLines[i].length + 1;
  }

  let annStart = startOffset;
  let annEnd = Math.min(fullText.length, endOffset);

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

  const bStart = Math.max(0, annStart - 20);
  const before = fullText.slice(bStart, annStart).replace(/\n/g, '↵');

  const aEnd = Math.min(fullText.length, annEnd + 20);
  const after = fullText.slice(annEnd, aEnd).replace(/\n/g, '↵');

  return { before, after };
}

/* ── Annotation JSON builder ── */

export function buildAnnotationJson(
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

/* ── Predicates ── */

export function hasAnnotations(annotations: PlanAnnotations): boolean {
  return annotations.additions.length > 0 || annotations.deletions.length > 0 || annotations.replacements.length > 0 || annotations.comments.length > 0;
}

/* ── Shell quoting ── */

/** Shell-quote a path: wrap in single quotes, escape embedded single quotes */
export function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Generate /ai-cli-task plan command for a single file */
export function generatePlanCommand(filePath: string, annFilePath: string): string {
  return `/ai-cli-task plan ${shellQuote(filePath)} ${shellQuote(annFilePath)} --silent`;
}

/** Derive module path: AiTasks/<module>/ from a full file path */
export function deriveModulePath(filePath: string): string {
  const parts = filePath.split('/');
  const aiTasksIdx = parts.indexOf('AiTasks');
  return aiTasksIdx >= 0 && aiTasksIdx + 1 < parts.length
    ? parts.slice(0, aiTasksIdx + 2).join('/')
    : filePath.substring(0, filePath.lastIndexOf('/'));
}

/** Collect all annotation IDs into a Set */
export function collectIds(annotations: PlanAnnotations): Set<string> {
  const ids = new Set<string>();
  annotations.additions.forEach((a) => ids.add(a.id));
  annotations.deletions.forEach((d) => ids.add(d.id));
  annotations.replacements.forEach((r) => ids.add(r.id));
  annotations.comments.forEach((c) => ids.add(c.id));
  return ids;
}

/** Migrate old annotation data that may be missing new arrays */
export function migrateAnnotations(anns: PlanAnnotations): PlanAnnotations {
  if (!anns.replacements) anns.replacements = [];
  if (!anns.comments) anns.comments = [];
  return anns;
}
