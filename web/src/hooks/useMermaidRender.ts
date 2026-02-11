import { useEffect } from 'react';
import type { RefObject } from 'react';
import DOMPurify from 'dompurify';

/** Lazy-load mermaid from CDN to avoid npm dependency conflicts */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mermaidPromise: Promise<any> | null = null;

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs',
  'https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function initMermaid(mermaid: any) {
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
}

export function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = (async () => {
    for (const url of CDN_URLS) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        return initMermaid(mod.default);
      } catch (e) {
        console.warn(`[mermaid] CDN failed: ${url}`, e);
      }
    }
    // All CDNs failed — reset so next call retries
    mermaidPromise = null;
    throw new Error('All mermaid CDN sources failed');
  })();
  return mermaidPromise;
}

let idCounter = 0;

/** Render mermaid/gantt code blocks inside a container element. */
export function useMermaidRender(
  containerRef: RefObject<HTMLElement | null>,
  dependency: unknown,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const codeBlocks = el.querySelectorAll<HTMLElement>(
      'code.language-mermaid, code.language-gantt'
    );
    if (codeBlocks.length === 0) return;

    let cancelled = false;

    (async () => {
      let mermaid;
      try {
        mermaid = await loadMermaid();
      } catch (e) {
        console.error('[mermaid] Failed to load library:', e);
        if (cancelled) return;
        for (const codeEl of codeBlocks) {
          const pre = codeEl.parentElement;
          if (!pre || pre.tagName !== 'PRE') continue;
          pre.classList.add('mermaid-error');
          const errDiv = document.createElement('div');
          errDiv.className = 'mermaid-error__msg';
          errDiv.textContent = 'Failed to load Mermaid library';
          pre.appendChild(errDiv);
        }
        return;
      }
      if (cancelled) return;

      for (const codeEl of codeBlocks) {
        if (cancelled) break;
        const pre = codeEl.parentElement;
        if (!pre || pre.tagName !== 'PRE') continue;

        const definition = codeEl.textContent || '';
        if (!definition.trim()) continue;

        const id = `mermaid-${++idCounter}`;
        try {
          const { svg } = await mermaid.render(id, definition);
          if (cancelled) break;

          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-diagram';
          wrapper.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'] });
          pre.replaceWith(wrapper);
        } catch {
          if (cancelled) break;
          pre.classList.add('mermaid-error');
          const errSpan = document.createElement('div');
          errSpan.className = 'mermaid-error__msg';
          errSpan.textContent = 'Mermaid syntax error';
          pre.appendChild(errSpan);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [dependency]); // eslint-disable-line react-hooks/exhaustive-deps
}
