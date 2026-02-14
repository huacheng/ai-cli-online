import { useState, useCallback, useRef } from 'react';

interface PanelResizeOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  axis: 'x' | 'y';
  offset?: number;      // pixels to subtract from container size (e.g., title bar height)
  min: number;           // min percent
  max: number;           // max percent
  invert?: boolean;      // if true, returns (100 - computed) — used when sizing from bottom/right
  bodyClass: string;     // CSS class added to body during drag
}

/**
 * Generic panel resize hook with localStorage persistence.
 * Returns [currentPercent, dividerMouseDownHandler].
 */
export function usePanelResize(
  storageKey: string,
  defaultValue: number,
  { containerRef, axis, offset = 0, min, max, invert = false, bodyClass }: PanelResizeOptions,
): [number, (e: React.MouseEvent) => void] {
  const [percent, setPercent] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const n = Number(saved);
      if (Number.isFinite(n) && n >= min && n <= max) return n;
    }
    return defaultValue;
  });

  // Persist on change
  const prevRef = useRef(percent);
  if (percent !== prevRef.current) {
    prevRef.current = percent;
    try { localStorage.setItem(storageKey, String(Math.round(percent))); } catch { /* full */ }
  }

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const size = axis === 'x' ? rect.width : rect.height - offset;
    const origin = axis === 'x' ? rect.left : rect.top + offset;

    document.body.classList.add(bodyClass);

    const onMouseMove = (ev: MouseEvent) => {
      const pos = axis === 'x' ? ev.clientX : ev.clientY;
      let raw = ((pos - origin) / size) * 100;
      if (invert) raw = 100 - raw;
      setPercent(Math.min(max, Math.max(min, raw)));
    };

    const onMouseUp = () => {
      document.body.classList.remove(bodyClass);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [containerRef, axis, offset, min, max, invert, bodyClass]);

  return [percent, onDividerMouseDown];
}
