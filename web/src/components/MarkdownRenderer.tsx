import { useMemo, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';
import { useMermaidRender } from '../hooks/useMermaidRender';

/** Lazy-load mermaid from CDN to avoid npm dependency conflicts */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mermaidPromise: Promise<any> | null = null;

export function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = (async () => {
    // Dynamic import from ESM CDN
    const mod = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#7aa2f7',
        primaryTextColor: '#c0caf5',
        primaryBorderColor: '#414868',
        lineColor: '#565f89',
        secondaryColor: '#bb9af7',
        tertiaryColor: '#24283b',
        background: '#1a1b26',
        mainBkg: '#24283b',
        nodeBorder: '#414868',
        clusterBkg: '#1e2030',
        titleColor: '#c0caf5',
        edgeLabelBackground: '#1e2030',
        // Gantt-specific
        gridColor: '#292e42',
        doneTaskBkgColor: '#9ece6a',
        doneTaskBorderColor: '#73a942',
        activeTaskBkgColor: '#7aa2f7',
        activeTaskBorderColor: '#5d87d6',
        critBkgColor: '#f7768e',
        critBorderColor: '#d35d72',
        taskBkgColor: '#414868',
        taskBorderColor: '#565f89',
        taskTextColor: '#c0caf5',
        taskTextDarkColor: '#1a1b26',
        sectionBkgColor: '#1e2030',
        sectionBkgColor2: '#24283b',
        altSectionBkgColor: '#1e2030',
        todayLineColor: '#e0af68',
      },
      gantt: {
        titleTopMargin: 15,
        barHeight: 24,
        barGap: 6,
        topPadding: 40,
        numberSectionStyles: 4,
        useWidth: 800,
      },
    });
    return mermaid;
  })();
  return mermaidPromise;
}

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
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
      style={{ height: '100%', overflowY: 'auto', userSelect: 'text', padding: '12px 16px', fontSize: `${fontSize}px` }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
