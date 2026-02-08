import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const fontSize = useStore((s) => s.fontSize);

  // Content is sanitized with DOMPurify before rendering — safe against XSS
  const html = useMemo(() => {
    if (!content) return '';
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [content]);

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
      className="md-preview"
      style={{ height: '100%', overflowY: 'auto', userSelect: 'text', padding: '12px 16px', fontSize: `${fontSize}px` }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
