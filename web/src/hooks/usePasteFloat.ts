import { useCallback, useEffect, useRef } from 'react';

/**
 * Reusable paste-float: right-click shows a floating textarea
 * for Ctrl+V paste when the Clipboard API is unavailable or denied.
 *
 * @param onPaste callback receiving the pasted plain text
 * @returns { showPasteFloat, removePasteFloat } for wiring into contextmenu handlers
 */
export function usePasteFloat(onPaste: (text: string) => void) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;

  const removePasteFloat = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (elRef.current) { elRef.current.remove(); elRef.current = null; }
  }, []);

  const showPasteFloat = useCallback((x: number, y: number) => {
    removePasteFloat();
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:1000;display:flex;align-items:center;gap:4px;padding:4px 6px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-family:inherit;`;
    const ta = document.createElement('textarea');
    ta.style.cssText = `width:90px;height:22px;resize:none;border:1px solid var(--border);border-radius:3px;background:var(--bg-primary);color:var(--text-primary);font-size:11px;font-family:inherit;padding:2px 4px;outline:none;`;
    ta.placeholder = 'Ctrl+V';
    ta.addEventListener('paste', (ev) => {
      ev.preventDefault();
      const text = ev.clipboardData?.getData('text/plain');
      if (text) onPasteRef.current(text);
      removePasteFloat();
    });
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') removePasteFloat(); });
    el.appendChild(ta);
    document.body.appendChild(el);
    elRef.current = el;
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
      if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;
      ta.focus();
    });
    timerRef.current = setTimeout(removePasteFloat, 8000);
  }, [removePasteFloat]);

  // Click-to-dismiss + cleanup on unmount
  useEffect(() => {
    const dismiss = () => { if (elRef.current) removePasteFloat(); };
    document.addEventListener('click', dismiss);
    return () => { document.removeEventListener('click', dismiss); removePasteFloat(); };
  }, [removePasteFloat]);

  return { showPasteFloat, removePasteFloat };
}
