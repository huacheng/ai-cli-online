import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import DOMPurify from 'dompurify';

/** Lazy-load mermaid from CDN to avoid npm dependency conflicts */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mermaidPromise: Promise<any> | null = null;
let currentMermaidTheme: 'dark' | 'light' = 'dark';

const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs',
  'https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs',
];

const DARK_THEME_VARS = {
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
};

const LIGHT_THEME_VARS = {
  primaryColor: '#2e59a8',
  primaryTextColor: '#343b58',
  primaryBorderColor: '#9aa5ce',
  lineColor: '#8c8fa1',
  secondaryColor: '#7847bd',
  tertiaryColor: '#d5d6db',
  background: '#f5f5f5',
  mainBkg: '#e8e8ed',
  nodeBorder: '#9aa5ce',
  clusterBkg: '#ebebf0',
  titleColor: '#343b58',
  edgeLabelBackground: '#ebebf0',
  // Gantt-specific
  gridColor: '#d5d6db',
  doneTaskBkgColor: '#4e8a2f',
  doneTaskBorderColor: '#3d6e25',
  activeTaskBkgColor: '#2e59a8',
  activeTaskBorderColor: '#24478a',
  critBkgColor: '#c4384b',
  critBorderColor: '#a02e3e',
  taskBkgColor: '#c0c1c9',
  taskBorderColor: '#9aa5ce',
  taskTextColor: '#343b58',
  taskTextDarkColor: '#f5f5f5',
  sectionBkgColor: '#e8e8ed',
  sectionBkgColor2: '#d5d6db',
  altSectionBkgColor: '#e8e8ed',
  todayLineColor: '#b68d28',
};

const GANTT_CONFIG = {
  titleTopMargin: 15,
  barHeight: 24,
  barGap: 6,
  topPadding: 40,
  numberSectionStyles: 4,
  useWidth: 800,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function configureMermaid(mermaid: any, theme: 'dark' | 'light') {
  currentMermaidTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    themeVariables: theme === 'dark' ? DARK_THEME_VARS : LIGHT_THEME_VARS,
    gantt: GANTT_CONFIG,
  });
  return mermaid;
}

export function loadMermaid(theme: 'dark' | 'light' = 'dark') {
  if (mermaidPromise) {
    // Re-configure theme if changed
    if (currentMermaidTheme !== theme) {
      return mermaidPromise.then((mermaid) => configureMermaid(mermaid, theme));
    }
    return mermaidPromise;
  }
  mermaidPromise = (async () => {
    for (const url of CDN_URLS) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        return configureMermaid(mod.default, theme);
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

/** Render mermaid/gantt code blocks inside a container element.
 *  Re-renders existing diagrams when theme changes. */
export function useMermaidRender(
  containerRef: RefObject<HTMLElement | null>,
  dependency: unknown,
  theme: 'dark' | 'light' = 'dark',
) {
  const prevThemeRef = useRef(theme);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const themeChanged = prevThemeRef.current !== theme;
    prevThemeRef.current = theme;

    // Find new code blocks to render
    const codeBlocks = el.querySelectorAll<HTMLElement>(
      'code.language-mermaid, code.language-gantt'
    );
    // Find existing diagrams that need re-rendering on theme change
    const existingDiagrams = themeChanged
      ? el.querySelectorAll<HTMLElement>('.mermaid-diagram[data-mermaid-source]')
      : [];

    if (codeBlocks.length === 0 && existingDiagrams.length === 0) return;

    let cancelled = false;

    (async () => {
      let mermaid;
      try {
        mermaid = await loadMermaid(theme);
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

      // Re-render existing diagrams with new theme
      for (const wrapper of existingDiagrams) {
        if (cancelled) break;
        const definition = wrapper.getAttribute('data-mermaid-source');
        if (!definition) continue;

        const id = `mermaid-${++idCounter}`;
        try {
          const { svg } = await mermaid.render(id, definition);
          if (cancelled) break;
          // SVG is sanitized via DOMPurify before DOM insertion — safe against XSS
          wrapper.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'] });
        } catch {
          // Keep existing diagram on re-render failure
        }
      }

      // Render new code blocks
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
          wrapper.setAttribute('data-mermaid-source', definition);
          // SVG is sanitized via DOMPurify before DOM insertion — safe against XSS
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
  }, [dependency, theme]); // eslint-disable-line react-hooks/exhaustive-deps
}
