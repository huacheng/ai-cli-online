import { useMemo, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../store';

/** Lazy-load mermaid from CDN to avoid npm dependency conflicts */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mermaidPromise: Promise<any> | null = null;
let mermaidIdCounter = 0;

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

  // After HTML is inserted, find mermaid code blocks and render them
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !html) return;

    const codeBlocks = el.querySelectorAll<HTMLElement>(
      'code.language-mermaid, code.language-gantt'
    );
    if (codeBlocks.length === 0) return;

    let cancelled = false;

    (async () => {
      let mermaid;
      try {
        mermaid = await loadMermaid();
      } catch {
        // CDN load failed — leave code blocks as-is
        return;
      }
      if (cancelled) return;

      for (const codeEl of codeBlocks) {
        if (cancelled) break;
        const pre = codeEl.parentElement;
        if (!pre || pre.tagName !== 'PRE') continue;

        const definition = codeEl.textContent || '';
        if (!definition.trim()) continue;

        const id = `mermaid-${++mermaidIdCounter}`;
        try {
          const { svg } = await mermaid.render(id, definition);
          if (cancelled) break;

          // Replace <pre><code> with rendered SVG
          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-diagram';
          wrapper.innerHTML = svg;
          pre.replaceWith(wrapper);
        } catch {
          // Render error inline so user sees syntax issues
          if (cancelled) break;
          pre.style.borderLeft = '3px solid #f7768e';
          pre.style.paddingLeft = '8px';
          const errSpan = document.createElement('div');
          errSpan.style.color = '#f7768e';
          errSpan.style.fontSize = '11px';
          errSpan.style.marginTop = '4px';
          errSpan.textContent = 'Mermaid syntax error';
          pre.appendChild(errSpan);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [html]);

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
