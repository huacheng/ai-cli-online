import { useMemo, useRef, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { useMermaidRender } from '../hooks/useMermaidRender';

interface MarkdownRendererProps {
  content: string;
  /** When provided, scroll position is persisted to localStorage under this key */
  scrollStorageKey?: string;
}

export function MarkdownRenderer({ content, scrollStorageKey }: MarkdownRendererProps) {
  const fontSize = useStore((s) => s.fontSize);
  const containerRef = useRef<HTMLDivElement>(null);

  // Content is sanitized with DOMPurify before rendering — safe against XSS
  const html = useMemo(() => {
    if (!content) return '';
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['img'],
      ADD_ATTR: ['src', 'alt', 'title', 'width', 'height'],
    });
  }, [content]);

  useMermaidRender(containerRef, html);

  // Persist scroll position to localStorage on unmount
  useEffect(() => {
    const key = scrollStorageKey;
    const el = containerRef.current;
    return () => {
      if (key && el && el.scrollTop > 0) {
        try { localStorage.setItem(key, String(Math.round(el.scrollTop))); } catch { /* full */ }
      }
    };
  }, [scrollStorageKey]);

  // Restore scroll position after content renders
  useEffect(() => {
    if (!scrollStorageKey || !html) return;
    const saved = localStorage.getItem(scrollStorageKey);
    if (saved) {
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (el) el.scrollTop = Number(saved);
      });
    }
  }, [scrollStorageKey, html]);

  if (!content) {
    return (
      <div className="md-preview" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#414868',
        fontStyle: 'italic',
        fontSize: '13px',
      }}>
        Waiting for plan output...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="md-preview"
      style={{ overflowY: 'auto', userSelect: 'text', padding: '12px 16px', fontSize: `${fontSize}px`, height: '100%' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
