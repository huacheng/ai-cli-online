import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminalWebSocket } from '../hooks/useTerminalWebSocket';
import { useStore } from '../store';

export interface TerminalViewHandle {
  sendInput: (data: string) => void;
  requestFileStream: (path: string) => void;
  cancelFileStream: () => void;
}

const TERMINAL_THEME = {
  background: '#1a1b26',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  selectionBackground: '#33467c',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

const FONT_FAMILY = "'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace";

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
      theme: TERMINAL_THEME,
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
    let pasteFloatEl: HTMLDivElement | null = null;
    let pasteFloatTimer: ReturnType<typeof setTimeout> | null = null;

    const removePasteFloat = () => {
      if (pasteFloatTimer) { clearTimeout(pasteFloatTimer); pasteFloatTimer = null; }
      if (pasteFloatEl) { pasteFloatEl.remove(); pasteFloatEl = null; }
    };

    const showPasteFloat = (x: number, y: number) => {
      removePasteFloat();
      // Container
      const el = document.createElement('div');
      el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:1000;
        display:flex;align-items:center;gap:4px;padding:4px 6px;
        background:#24283b;border:1px solid #414868;border-radius:4px;
        box-shadow:0 2px 8px rgba(0,0,0,0.4);font-family:inherit;`;
      // Hidden textarea to capture paste events (no clipboard-read permission needed)
      const ta = document.createElement('textarea');
      ta.style.cssText = `width:90px;height:22px;resize:none;border:1px solid #414868;
        border-radius:3px;background:#1a1b26;color:#a9b1d6;font-size:11px;
        font-family:inherit;padding:2px 4px;outline:none;`;
      ta.placeholder = 'Ctrl+V';
      ta.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const text = ev.clipboardData?.getData('text/plain');
        if (text) sendInputRef.current(text);
        removePasteFloat();
      });
      ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') removePasteFloat();
      });
      el.appendChild(ta);
      document.body.appendChild(el);
      pasteFloatEl = el;
      // Clamp position to viewport
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
        if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;
        ta.focus();
      });
      pasteFloatTimer = setTimeout(removePasteFloat, 8000);
    };

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
        // Clipboard API failed (permission denied) — show fallback paste button
        showPasteFloat(e.clientX, e.clientY);
      });
    };

    // Dismiss paste float on click elsewhere
    const handleDocClick = () => removePasteFloat();
    document.addEventListener('click', handleDocClick);
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

    // Forward user input to WebSocket
    terminal.onData((data) => {
      sendInputRef.current(data);
    });

    // ResizeObserver for auto-fit (rAF-aligned for smooth resizing)
    resizeObserver = new ResizeObserver(() => {
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
      if (resizeObserver) resizeObserver.disconnect();
      removePasteFloat();
      document.removeEventListener('click', handleDocClick);
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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#1a1b26',
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
          background: scrollbackVisible ? '#7aa2f7' : 'rgba(65, 72, 104, 0.7)',
          color: '#c0caf5',
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
      theme: TERMINAL_THEME,
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(viewerRef.current);

    // Load WebGL renderer (same as main terminal) — canvas 2D may not render
    // in some environments while WebGL works fine
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      terminal.loadAddon(webglAddon);
    } catch {
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

  const HEADER_H = 28;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        backgroundColor: '#1a1b26',
      }}
    >
      <div style={{
        height: HEADER_H,
        boxSizing: 'border-box',
        padding: '0 12px',
        background: '#24283b',
        color: '#7aa2f7',
        fontSize: 12,
        borderBottom: '1px solid #414868',
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
