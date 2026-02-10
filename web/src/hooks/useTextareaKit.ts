import { useRef, useCallback, useMemo } from 'react';

const UNDO_MAX = 50;

/**
 * Shared textarea enhancements: undo stack, Tab→2-spaces, auto-rows.
 * Used by both MarkdownEditor and PlanAnnotationRenderer.
 */
export function useTextareaUndo() {
  const stackRef = useRef<string[]>([]);

  /** Push current value onto undo stack before a change */
  const pushUndo = useCallback((current: string) => {
    stackRef.current.push(current);
    if (stackRef.current.length > UNDO_MAX) stackRef.current.shift();
  }, []);

  /** Pop previous value from undo stack; returns undefined if empty */
  const popUndo = useCallback((): string | undefined => {
    return stackRef.current.pop();
  }, []);

  /** Clear the undo stack (e.g. on mode switch) */
  const clearUndo = useCallback(() => {
    stackRef.current = [];
  }, []);

  return useMemo(() => ({ pushUndo, popUndo, clearUndo }), [pushUndo, popUndo, clearUndo]);
}

/**
 * Handle Tab key in a textarea: insert 2 spaces at cursor position.
 * Call from onKeyDown after checking e.key === 'Tab'.
 * @param e - The keyboard event (will be preventDefault'd)
 * @param setText - State setter that receives the new text value
 * @param pushUndo - Optional: push current value to undo stack before change
 */
export function handleTabKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  setText: (v: string) => void,
  pushUndo?: (current: string) => void,
) {
  e.preventDefault();
  const ta = e.currentTarget;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  pushUndo?.(val);
  const next = val.slice(0, start) + '  ' + val.slice(end);
  setText(next);
  requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
}

/**
 * Handle Ctrl+Z in a textarea: pop from undo stack and restore.
 * Call from onKeyDown after checking Ctrl/Meta+Z.
 * @returns true if undo was performed (caller should preventDefault)
 */
export function handleCtrlZ(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  popUndo: () => string | undefined,
  setText: (v: string) => void,
): boolean {
  const prev = popUndo();
  if (prev !== undefined) {
    e.preventDefault();
    setText(prev);
    return true;
  }
  return false;
}

/**
 * Compute textarea rows from text content (line count).
 * Min 1, max `maxRows` (default 10).
 */
export function autoRows(text: string, maxRows = 10): number {
  return Math.min(maxRows, Math.max(1, (text.match(/\n/g)?.length ?? 0) + 1));
}
