import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminalWebSocket } from '../hooks/useTerminalWebSocket';
import { useStore } from '../store';
import { usePasteFloat } from '../hooks/usePasteFloat';

export interface TerminalViewHandle {
  sendInput: (data: string) => void;
  requestFileStream: (path: string) => void;
  cancelFileStream: () => void;
}

const DARK_XTERM_THEME = {
  background: '#000000',
  foreground: '#cccccc',
  cursor: '#aeafad',
  selectionBackground: 'rgba(38, 79, 120, 0.5)',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

const LIGHT_XTERM_THEME = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#0969da',
  selectionBackground: 'rgba(9, 105, 218, 0.2)',
  black: '#24292f',
  red: '#cf222e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#2da44e',
  brightYellow: '#bf8803',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
};

const FONT_FAMILY = "'JetBrains Mono', 'LXGW WenKai Mono', Menlo, Monaco, 'Courier New', monospace";

interface TerminalViewProps {
  sessionId: string;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView({ sessionId }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [scrollbackVisible, setScrollbackVisible] = useState(false);
  const [scrollbackData, setScrollbackData] = useState('');

  const fontSize = useStore((s) => s.fontSize);
  const theme = useStore((s) => s.theme);

  const handleScrollbackContent = useCallback((data: string) => {
    setScrollbackData(data);
    setScrollbackVisible(true);
  }, []);

  const { sendInput, sendResize, requestScrollback, requestFileStream, cancelFileStream } = useTerminalWebSocket(
    terminalRef,
    sessionId,
    handleScrollbackContent,
  );

  useImperativeHandle(ref, () => ({ sendInput, requestFileStream, cancelFileStream }),
    [sendInput, requestFileStream, cancelFileStream]);

  // Use refs for callbacks to decouple effect lifecycle from callback identity.
  // This prevents terminal destruction/recreation if callbacks change reference.
  const sendInputRef = useRef(sendInput);
  const sendResizeRef = useRef(sendResize);
  sendInputRef.current = sendInput;
  sendResizeRef.current = sendResize;

  const { showPasteFloat, removePasteFloat } = usePasteFloat(
    (text) => sendInputRef.current(text)
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let retryIntervalId: ReturnType<typeof setInterval> | null = null;
    let rafId: number | null = null;
    let resizeNetworkTimer: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    // Create xterm immediately (don't wait for custom fonts — they can be 10+ MB)
    // Re-fit after fonts load to correct cell width metrics
    if (disposed || !containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 10000,
      fontSize: useStore.getState().fontSize,
      fontFamily: FONT_FAMILY,
      theme: useStore.getState().theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      window.open(uri, '_blank', 'noopener,noreferrer');
    }));

    terminal.open(containerRef.current!);

    // Load WebGL renderer for 3-10x rendering throughput (with canvas fallback)
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to default canvas renderer
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Auto-copy selection to clipboard
    terminal.onSelectionChange(() => {
      const sel = terminal.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    // Right-click paste from clipboard into terminal
    const xtermEl = terminal.element;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      removePasteFloat();
      if (!navigator.clipboard?.readText) {
        showPasteFloat(e.clientX, e.clientY);
        return;
      }
      navigator.clipboard.readText().then((text) => {
        if (text) sendInputRef.current(text);
      }).catch(() => {
        showPasteFloat(e.clientX, e.clientY);
      });
    };

    if (xtermEl) xtermEl.addEventListener('contextmenu', handleContextMenu);

    // Fit terminal to container, retrying until container has valid dimensions
    const doFit = () => {
      try {
        const el = containerRef.current;
        if (el && el.clientWidth > 0 && el.clientHeight > 0) {
          fitAddon.fit();
          sendResizeRef.current(terminal.cols, terminal.rows);
          return true;
        }
      } catch {
        // Ignore fit errors during initialization
      }
      return false;
    };

    // Retry fit on an interval until successful or max attempts reached
    requestAnimationFrame(() => doFit());
    let retryCount = 0;
    retryIntervalId = setInterval(() => {
      retryCount++;
      if (doFit() || retryCount >= 10) {
        clearInterval(retryIntervalId!);
        retryIntervalId = null;
      }
    }, 100);

    // Re-fit when custom fonts finish loading (corrects cell width metrics)
    document.fonts.ready.then(() => {
      if (!disposed) {
        try {
          fitAddon.fit();
          sendResizeRef.current(terminal.cols, terminal.rows);
        } catch { /* ignore */ }
      }
    });

    // Also handle on-demand font loads (e.g. LXGW WenKai Mono unicode-range chunks
    // that only start downloading when CJK characters appear in terminal output).
    // xterm.js uses Canvas/WebGL so it won't auto-rerender like DOM text.
    let fontFitTimer: ReturnType<typeof setTimeout> | null = null;
    const onFontsLoadingDone = () => {
      if (disposed) return;
      // Debounce: multiple unicode-range chunks may finish in quick succession
      if (fontFitTimer) clearTimeout(fontFitTimer);
      fontFitTimer = setTimeout(() => {
        if (!disposed) {
          try {
            fitAddon.fit();
            sendResizeRef.current(terminal.cols, terminal.rows);
          } catch { /* ignore */ }
        }
      }, 100);
    };
    document.fonts.addEventListener('loadingdone', onFontsLoadingDone);

    // Forward user input to WebSocket
    terminal.onData((data) => {
      sendInputRef.current(data);
    });

    // ResizeObserver for auto-fit (rAF-aligned for smooth resizing)
    let dragFitPending = false;
    resizeObserver = new ResizeObserver(() => {
      // During pane divider drag, skip fit to avoid xterm line-rewrap flicker.
      // A single fit is performed on mouseup instead.
      const isDragging = document.body.classList.contains('resizing-panes') ||
                         document.body.classList.contains('resizing-panes-v');
      if (isDragging) {
        if (!dragFitPending) {
          dragFitPending = true;
          const onDragEnd = () => {
            document.removeEventListener('mouseup', onDragEnd);
            dragFitPending = false;
            requestAnimationFrame(() => {
              try {
                fitAddon.fit();
                sendResizeRef.current(terminal.cols, terminal.rows);
              } catch { /* ignore */ }
            });
          };
          document.addEventListener('mouseup', onDragEnd);
        }
        return;
      }

      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        try {
          fitAddon.fit();
          // Debounce network resize to avoid flooding server during drag
          if (resizeNetworkTimer) clearTimeout(resizeNetworkTimer);
          resizeNetworkTimer = setTimeout(() => {
            resizeNetworkTimer = null;
            sendResizeRef.current(terminal.cols, terminal.rows);
          }, 50);
        } catch {
          // Ignore fit errors during transitions
        }
      });
    });
    resizeObserver.observe(containerRef.current!);

    return () => {
      disposed = true;
      if (retryIntervalId) clearInterval(retryIntervalId);
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeNetworkTimer) clearTimeout(resizeNetworkTimer);
      if (fontFitTimer) clearTimeout(fontFitTimer);
      document.fonts.removeEventListener('loadingdone', onFontsLoadingDone);
      if (resizeObserver) resizeObserver.disconnect();
      removePasteFloat();
      if (xtermEl) xtermEl.removeEventListener('contextmenu', handleContextMenu);
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, [sessionId]); // stable dep: only recreate terminal when session changes

  // Dynamically update font size when store value changes
  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    if (terminal.options.fontSize === fontSize) return;
    terminal.options.fontSize = fontSize;
    try { fitAddon.fit(); } catch { /* ignore */ }
    sendResizeRef.current(terminal.cols, terminal.rows);
  }, [fontSize]);

  // Dynamically update theme when store value changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME;
    }
  }, [theme]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'var(--bg-primary)',
          contain: 'strict',
          willChange: 'transform',
          isolation: 'isolate',
        }}
      />
      {/* Scrollback toggle button */}
      <button
        tabIndex={-1}
        onClick={(e) => {
          (e.currentTarget as HTMLElement).blur();
          if (scrollbackVisible) {
            setScrollbackVisible(false);
            setScrollbackData('');
          } else {
            requestScrollback();
          }
        }}
        title="Toggle scrollback history"
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          zIndex: 10,
          background: scrollbackVisible ? 'var(--accent-blue)' : 'var(--bg-hover)',
          color: 'var(--text-bright)',
          border: 'none',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 14,
          cursor: 'pointer',
          opacity: 0.8,
          lineHeight: '20px',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
      >
        {scrollbackVisible ? '\u2715' : <span style={{ fontSize: 14 }}>{'\u{1F441}'}</span>}
      </button>
      {/* Scrollback overlay with read-only xterm.js viewer */}
      {scrollbackVisible && (
        <ScrollbackViewer
          data={scrollbackData}
          onClose={() => { setScrollbackVisible(false); setScrollbackData(''); }}
        />
      )}
    </div>
  );
});

/** Read-only xterm.js instance for viewing scrollback with full ANSI color */
function ScrollbackViewer({ data, onClose }: { data: string; onClose: () => void }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  // Use ref for onClose to decouple effect lifecycle from callback identity
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const fontSize = useStore((s) => s.fontSize);
  const theme = useStore((s) => s.theme);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Create terminal only when scrollback data changes (not on font size change)
  useEffect(() => {
    if (!viewerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      scrollback: 50000,
      fontSize,
      fontFamily: FONT_FAMILY,
      theme: theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME,
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(viewerRef.current);

    // Load WebGL renderer (same as main terminal) — canvas 2D may not render
    // in some environments while WebGL works fine
    let sbWebglAddon: WebglAddon | null = null;
    try {
      sbWebglAddon = new WebglAddon();
      sbWebglAddon.onContextLoss(() => { sbWebglAddon?.dispose(); sbWebglAddon = null; });
      terminal.loadAddon(sbWebglAddon);
    } catch {
      sbWebglAddon = null;
      // WebGL not available, fall back to default canvas renderer
    }

    // Auto-copy selection to clipboard
    terminal.onSelectionChange(() => {
      const sel = terminal.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    // Handle ESC at xterm level — xterm captures keyboard events even
    // with disableStdin, preventing document-level listeners from firing
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      return false; // don't let xterm process any keys
    });

    // Write data immediately so it's buffered regardless of fit success,
    // then fit to get correct dimensions and scroll to bottom.
    terminal.write(data);

    let fitRetryId: ReturnType<typeof setInterval> | null = null;

    const doFit = () => {
      const el = viewerRef.current;
      if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return false;
      try {
        fitAddon.fit();
        terminal.scrollToBottom();
        return true;
      } catch { return false; }
    };

    requestAnimationFrame(() => {
      if (!doFit()) {
        let count = 0;
        fitRetryId = setInterval(() => {
          count++;
          if (doFit() || count >= 30) {
            clearInterval(fitRetryId!);
            fitRetryId = null;
          }
        }, 50);
      }
    });

    let sbRafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (sbRafId) return;
      sbRafId = requestAnimationFrame(() => {
        sbRafId = null;
        doFit();
      });
    });
    resizeObserver.observe(viewerRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      if (fitRetryId) clearInterval(fitRetryId);
      if (sbRafId) cancelAnimationFrame(sbRafId);
      document.removeEventListener('keydown', onKeyDown);
      resizeObserver.disconnect();
      // C4: Explicitly dispose WebGL addon before terminal to free GPU context
      if (sbWebglAddon) { try { sbWebglAddon.dispose(); } catch { /* ignore */ } sbWebglAddon = null; }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [data]); // only recreate when scrollback data changes

  // Update font size in-place without recreating the terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
    }
  }, [fontSize]);

  // Update theme in-place without recreating the terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme === 'dark' ? DARK_XTERM_THEME : LIGHT_XTERM_THEME;
    }
  }, [theme]);

  const HEADER_H = 28;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      <div style={{
        height: HEADER_H,
        boxSizing: 'border-box',
        padding: '0 12px',
        background: 'var(--bg-tertiary)',
        color: 'var(--accent-blue)',
        fontSize: 12,
        borderBottom: '1px solid var(--scrollbar-thumb-hover)',
        display: 'flex',
        alignItems: 'center',
      }}>
        <span>Scrollback History (mouse wheel to scroll, ESC to close)</span>
      </div>
      <div
        ref={viewerRef}
        style={{
          position: 'absolute',
          top: HEADER_H,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
