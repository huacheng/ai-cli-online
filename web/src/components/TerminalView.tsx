import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminalWebSocket } from '../hooks/useTerminalWebSocket';

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

const FONT_FAMILY = "'Maple Mono CN', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace";

interface TerminalViewProps {
  sessionId: string;
}

export function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [scrollbackVisible, setScrollbackVisible] = useState(false);
  const [scrollbackData, setScrollbackData] = useState('');

  const handleScrollbackContent = useCallback((data: string) => {
    setScrollbackData(data);
    setScrollbackVisible(true);
  }, []);

  const { sendInput, sendResize, requestScrollback } = useTerminalWebSocket(
    terminalRef,
    sessionId,
    handleScrollbackContent,
  );

  // Use refs for callbacks to decouple effect lifecycle from callback identity.
  // This prevents terminal destruction/recreation if callbacks change reference.
  const sendInputRef = useRef(sendInput);
  const sendResizeRef = useRef(sendResize);
  sendInputRef.current = sendInput;
  sendResizeRef.current = sendResize;

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 10000,
      fontSize: 14,
      fontFamily: FONT_FAMILY,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);

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
    const retryInterval = setInterval(() => {
      retryCount++;
      if (doFit() || retryCount >= 10) {
        clearInterval(retryInterval);
      }
    }, 100);

    // Forward user input to WebSocket
    terminal.onData((data) => {
      sendInputRef.current(data);
    });

    // ResizeObserver for auto-fit (rAF-aligned for smooth resizing)
    let rafId: number | null = null;
    let resizeNetworkTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
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
          }, 100);
        } catch {
          // Ignore fit errors during transitions
        }
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      clearInterval(retryInterval);
      if (rafId) cancelAnimationFrame(rafId);
      if (resizeNetworkTimer) clearTimeout(resizeNetworkTimer);
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]); // stable dep: only recreate terminal when session changes

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
        onClick={() => {
          if (scrollbackVisible) {
            setScrollbackVisible(false);
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
          fontSize: 12,
          cursor: 'pointer',
          opacity: 0.8,
          lineHeight: '20px',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
      >
        {scrollbackVisible ? '\u2715' : '\u2191'}
      </button>
      {/* Scrollback overlay with read-only xterm.js viewer */}
      {scrollbackVisible && (
        <ScrollbackViewer
          data={scrollbackData}
          onClose={() => setScrollbackVisible(false)}
        />
      )}
    </div>
  );
}

/** Read-only xterm.js instance for viewing scrollback with full ANSI color */
function ScrollbackViewer({ data, onClose }: { data: string; onClose: () => void }) {
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      scrollback: 50000,
      fontSize: 14,
      fontFamily: FONT_FAMILY,
      theme: TERMINAL_THEME,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(viewerRef.current);

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
      // Newlines are already normalized server-side to \r\n
      terminal.write(data, () => {
        terminal.scrollToBottom();
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });
    resizeObserver.observe(viewerRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [data, onClose]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        backgroundColor: '#1a1b26',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{
        padding: '4px 12px',
        background: '#24283b',
        color: '#7aa2f7',
        fontSize: 12,
        borderBottom: '1px solid #414868',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>Scrollback History (mouse wheel to scroll, ESC to close)</span>
      </div>
      <div
        ref={viewerRef}
        style={{ flex: 1, overflow: 'hidden' }}
      />
    </div>
  );
}
