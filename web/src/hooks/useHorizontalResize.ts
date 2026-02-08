import { useCallback, useRef, useState } from 'react';

/** Drag-to-resize a horizontal split, returning left width percent and mouse handler. */
export function useHorizontalResize(initial = 50, min = 20, max = 80) {
  const [leftWidthPercent, setLeftWidthPercent] = useState(initial);
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
  }, [min, max]);

  return { leftWidthPercent, containerRef, onDividerMouseDown };
}
