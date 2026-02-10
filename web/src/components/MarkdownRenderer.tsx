import { useMemo, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { MarkdownToc, extractHeadings, addHeadingIds } from './MarkdownToc';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const fontSize = useStore((s) => s.fontSize);
  const containerRef = useRef<HTMLDivElement>(null);

  const headings = useMemo(() => extractHeadings(content), [content]);

  // Content is sanitized with DOMPurify before rendering — safe against XSS
  // addHeadingIds injects id= attributes on <h1>-<h6> for TOC scroll-to
  const html = useMemo(() => {
    if (!content) return '';
    const raw = marked.parse(content, { async: false }) as string;
    const sanitized = DOMPurify.sanitize(raw, {
      ADD_TAGS: ['img'],
      ADD_ATTR: ['src', 'alt', 'title', 'width', 'height', 'id'],
    });
    return addHeadingIds(sanitized);
  }, [content]);

  useMermaidRender(containerRef, html);

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
    <div style={{ position: 'relative', height: '100%' }}>
      <div
        ref={containerRef}
        className="md-preview"
        style={{ height: '100%', overflowY: 'auto', userSelect: 'text', padding: '12px 16px', fontSize: `${fontSize}px` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <MarkdownToc headings={headings} scrollRef={containerRef} />
    </div>
  );
}
