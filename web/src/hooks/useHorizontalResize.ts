import { useCallback, useRef, useState } from 'react';

/** Drag-to-resize a horizontal split, returning left width percent and mouse handler.
 *  When `storageKey` is provided, the value persists to localStorage across unmount/remount. */
export function useHorizontalResize(initial = 50, min = 20, max = 80, storageKey?: string) {
  const [leftWidthPercent, setLeftWidthPercent] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = Number(saved);
        if (Number.isFinite(n) && n >= min && n <= max) return n;
      }
    }
    return initial;
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;

    document.body.classList.add('resizing-panes-h');

    let dragRafId: number | null = null;
    const onMouseMove = (ev: MouseEvent) => {
      if (dragRafId) return;
      dragRafId = requestAnimationFrame(() => {
        dragRafId = null;
        const relX = ev.clientX - rect.left;
        const pct = Math.min(max, Math.max(min, (relX / containerWidth) * 100));
        setLeftWidthPercent(pct);
      });
    };

    const onMouseUp = () => {
      if (dragRafId) cancelAnimationFrame(dragRafId);
      document.body.classList.remove('resizing-panes-h');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [min, max, storageKey]);

  // Persist to localStorage whenever value changes (debounced implicitly by rAF in drag)
  const prevRef = useRef(leftWidthPercent);
  if (storageKey && leftWidthPercent !== prevRef.current) {
    prevRef.current = leftWidthPercent;
    try { localStorage.setItem(storageKey, String(Math.round(leftWidthPercent))); } catch { /* full */ }
  }

  return { leftWidthPercent, containerRef, onDividerMouseDown };
}
