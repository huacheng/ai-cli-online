import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

/** Generate a URL-safe slug from plain text */
function toSlug(text: string, slugCount: Map<string, number>): string {
  let slug = text
    .replace(/<[^>]*>/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[&<>"'`]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) slug = 'heading';
  const count = slugCount.get(slug) || 0;
  if (count > 0) slug = `${slug}-${count}`;
  slugCount.set(slug, count + 1);
  return slug;
}

/** Strip inline markdown formatting to get plain text */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')
    .trim();
}

/** Extract headings from markdown source */
export function extractHeadings(markdown: string): TocItem[] {
  if (!markdown) return [];
  const items: TocItem[] = [];
  const slugCount = new Map<string, number>();
  const lines = markdown.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (match) {
      const level = match[1].length;
      const text = stripInlineMarkdown(match[2]);
      const id = toSlug(text, slugCount);
      items.push({ id, text, level });
    }
  }
  return items;
}

/** Add id attributes to <h1>-<h6> tags in rendered HTML (same slug logic as extractHeadings) */
export function addHeadingIds(html: string): string {
  const slugCount = new Map<string, number>();
  return html.replace(/<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
    if (/\bid\s*=/.test(attrs)) return match;
    const plainText = content.replace(/<[^>]*>/g, '').trim();
    const slug = toSlug(plainText, slugCount);
    return `<${tag}${attrs} id="${slug}">${content}</${tag}>`;
  });
}

interface MarkdownTocProps {
  headings: TocItem[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const TOC_WIDTH = 160;

export function MarkdownToc({ headings, scrollRef }: MarkdownTocProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('md-toc-collapsed') === 'true';
  });
  const tocRef = useRef<HTMLDivElement>(null);
  const tickingRef = useRef(false);

  const minLevel = useMemo(() => Math.min(...headings.map((h) => h.level)), [headings]);

  const handleToggle = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('md-toc-collapsed', String(next)); } catch { /* full */ }
      return next;
    });
  }, []);

  // Track active heading via scroll position (rAF-throttled)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || headings.length === 0) return;

    const compute = () => {
      tickingRef.current = false;
      const scrollTop = container.scrollTop;
      const offset = 50;
      let current: string | null = null;
      for (const h of headings) {
        const el = container.querySelector(`[id="${CSS.escape(h.id)}"]`);
        if (el && (el as HTMLElement).offsetTop <= scrollTop + offset) {
          current = h.id;
        }
      }
      setActiveId(current);
    };

    const onScroll = () => {
      if (!tickingRef.current) {
        tickingRef.current = true;
        requestAnimationFrame(compute);
      }
    };

    compute();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [headings, scrollRef]);

  // Scroll to heading
  const handleClick = useCallback((id: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector(`[id="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  }, [scrollRef]);

  // Auto-scroll TOC panel to keep active item visible
  useEffect(() => {
    if (!activeId || collapsed) return;
    const tocEl = tocRef.current;
    if (!tocEl) return;
    const activeEl = tocEl.querySelector(`[data-toc-id="${CSS.escape(activeId)}"]`) as HTMLElement | null;
    if (activeEl) {
      const top = activeEl.offsetTop - tocEl.offsetTop;
      const bottom = top + activeEl.offsetHeight;
      if (top < tocEl.scrollTop || bottom > tocEl.scrollTop + tocEl.clientHeight) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeId, collapsed]);

  if (headings.length < 2) return null;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={handleToggle}
        title={collapsed ? 'Show table of contents' : 'Hide table of contents'}
        style={{
          position: 'absolute',
          right: collapsed ? 4 : TOC_WIDTH + 2,
          top: 4,
          zIndex: 5,
          background: '#16161e',
          border: '1px solid #292e42',
          borderRadius: 3,
          color: '#565f89',
          fontSize: 12,
          padding: '1px 5px',
          cursor: 'pointer',
          lineHeight: '18px',
          transition: 'right 0.15s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#7aa2f7'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#565f89'; }}
      >
        {collapsed ? '\u2630' : '\u00AB'}
      </button>

      {/* TOC panel */}
      {!collapsed && (
        <div
          ref={tocRef}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: TOC_WIDTH,
            backgroundColor: '#16161ef0',
            borderLeft: '1px solid #292e42',
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '28px 4px 8px',
            zIndex: 4,
          }}
        >
          <div style={{
            fontSize: 10,
            color: '#414868',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            padding: '0 4px 4px',
            borderBottom: '1px solid #292e42',
            marginBottom: 4,
          }}>
            Contents
          </div>
          {headings.map((h, i) => (
            <div
              key={`${h.id}-${i}`}
              data-toc-id={h.id}
              onClick={() => handleClick(h.id)}
              style={{
                padding: `2px 4px 2px ${(h.level - minLevel) * 10 + 4}px`,
                fontSize: 11,
                lineHeight: 1.5,
                color: activeId === h.id ? '#7aa2f7' : '#565f89',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                borderRadius: 3,
                borderLeft: activeId === h.id ? '2px solid #7aa2f7' : '2px solid transparent',
                fontWeight: h.level <= 2 ? 500 : 400,
                transition: 'color 0.1s',
              }}
              title={h.text}
              onMouseEnter={(e) => {
                if (activeId !== h.id) e.currentTarget.style.color = '#a9b1d6';
                e.currentTarget.style.backgroundColor = '#24283b';
              }}
              onMouseLeave={(e) => {
                if (activeId !== h.id) e.currentTarget.style.color = '#565f89';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {h.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
